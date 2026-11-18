import { CODES, lint, lintWorkspace } from './index';
import type { Diagnostic, DiagnosticCode } from './index';

/**
 * Правила в этих тестах пишутся по одному, без файла настройки, и то, что
 * `TX:score` в них никто не выставил, — не предмет проверки, а шум. О
 * переменных есть свои тесты ниже, и они зовут `lint` напрямую.
 */
const ALONE = {
  codes: { txNeverSet: 'off', defaultActionDeprecated: 'off', persistentWithoutDataDir: 'off' },
} as const;

/** Замечания к тексту: код и то место исходника, на которое он указывает. */
function found(source: string): Array<[DiagnosticCode, string]> {
  return lint(source, ALONE).map((d) => [d.code, source.slice(d.start, d.end)]);
}

function codes(source: string): DiagnosticCode[] {
  return lint(source, ALONE).map((d) => d.code);
}

/** Правило с такими областями, оператором и преобразованиями — и больше ни с чем. */
function rule(variables: string, operator: string, transforms = ''): string {
  const steps = transforms === '' ? '' : `,${transforms}`;
  return `SecRule ${variables} "${operator}" "id:1,phase:2,pass${steps}"`;
}

describe('линтер: чистые правила', () => {
  it('ничего не говорит о правильной конфигурации', () => {
    const source = [
      '# Базовая настройка',
      'SecRuleEngine On',
      'SecRequestBodyAccess On',
      'Include /etc/modsecurity/extra.conf',
      'SecDefaultAction "phase:1,log,auditlog,pass"',
      '',
      'SecAction "id:1000,phase:1,pass,nolog,setvar:tx.threshold=5"',
      'SecRule REQUEST_METHOD "!@rx ^(?:GET|HEAD|POST)$" \\',
      '    "id:1001,phase:1,deny,status:405,log,msg:\'Method not allowed\'"',
      'SecRule &REQUEST_HEADERS:Host "@eq 0" "id:1002,phase:1,deny,t:none,msg:\'No Host\'"',
      'SecRule REQBODY_ERROR "!@eq 0" "id:1006,phase:2,deny,status:400,msg:\'Bad body\'"',
      'SecRule ARGS|!ARGS:token "@rx (?i)union\\s+select" \\',
      '    "id:1003,phase:2,block,capture,t:none,t:urlDecodeUni,t:lowercase,\\',
      "    msg:'SQLi',logdata:'%{TX.0}',setvar:'tx.score=%{tx.threshold}',chain\"",
      '    SecRule TX:score "@ge %{tx.threshold}" "t:none"',
      'SecRule RESPONSE_STATUS "@rx ^5\\d\\d$" "id:1004,phase:3,pass,skipAfter:END"',
      'SecRule REQUEST_URI "@streq /login" "id:1005,phase:1,pass,t:sha1,t:hexEncode,nolog"',
      'SecMarker END',
    ].join('\n');

    expect(lint(source)).toEqual([]);
  });
});

describe('линтер: форма записи', () => {
  it('незакрытая кавычка', () => {
    expect(found('SecRule ARGS "@rx a "id:1,phase:2,pass"')).toContainEqual([
      'unbalancedQuotes',
      '"',
    ]);
  });

  it('число аргументов', () => {
    expect(codes('SecRule ARGS')).toEqual(['directiveArgCount', 'missingId', 'missingPhase']);
    expect(codes('SecMarker')).toEqual(['directiveArgCount']);
    expect(found('SecRule "" "@rx ^a" "id:1,phase:2,pass"')).toEqual([['emptyTargets', 'SecRule']]);
  });

  it('незнакомые имена', () => {
    const source = [
      'SecRulEngine On',
      'SecRule ARGZ "@regex a" "id:1,phase:2,pass,t:lowercas,frobnicate"',
    ].join('\n');

    expect(found(source)).toEqual([
      ['unknownDirective', 'SecRulEngine'],
      ['unknownVariable', 'ARGZ'],
      ['unknownOperator', '@regex'],
      ['unknownTransform', 'lowercas'],
      ['unknownAction', 'frobnicate'],
    ]);
  });

  it('чужие директивы не трогает, регистр имён не различает', () => {
    expect(lint('<IfModule security2_module>\nInclude /etc/modsecurity/a.conf\n</IfModule>')).toEqual([]);
    expect(lint('secrule args "@STREQ x" "ID:1,PHASE:2,PASS,T:LowerCase"')).toEqual([]);
  });

  it('значения действий', () => {
    expect(found('SecAction "id:1,phase:1,deny:403,msg,t:,setvar"')).toEqual([
      ['actionValueUnexpected', 'deny:403'],
      ['actionValueRequired', 'msg'],
      ['actionValueRequired', 't:'],
      ['actionValueRequired', 'setvar'],
    ]);
  });

  it('номер правила: отсутствует и повторяется', () => {
    expect(found('SecRule ARGS "@rx ^a" "phase:2,pass"')).toEqual([['missingId', 'SecRule']]);
    expect(
      found(
        [
          'SecRule ARGS "@rx ^a" "id:5,phase:2,pass"',
          'SecAction "id:5,phase:2,pass"',
        ].join('\n'),
      ),
    ).toEqual([['duplicateId', 'id:5']]);
  });

  it('цепочка: обрыв и действия шапки на звене', () => {
    expect(found('SecRule ARGS "@rx ^a" "id:1,phase:2,pass,chain"\nSecRuleEngine On')).toEqual([
      ['danglingChain', 'chain'],
    ]);
    expect(
      found(
        [
          'SecRule ARGS "@rx ^a" "id:1,phase:2,deny,chain"',
          'SecRule ARGS "@rx ^b" "id:2,msg:\'x\',t:lowercase,setvar:tx.a=1"',
        ].join('\n'),
      ),
    ).toEqual([
      ['chainLinkHeadAction', 'id:2'],
      ['chainLinkHeadAction', "msg:'x'"],
    ]);
  });

  it('фаза: не задана, слишком ранняя, пришла из умолчаний', () => {
    expect(codes('SecRule ARGS "@rx ^a" "id:1,pass"')).toEqual(['missingPhase']);
    expect(codes('SecDefaultAction "phase:2,pass"\nSecRule ARGS "@rx ^a" "id:1"')).toEqual([]);

    const early = lint('SecRule REQUEST_BODY|REQUEST_URI "@rx ^a" "id:1,phase:1,pass"');
    expect(early).toHaveLength(1);
    expect(early[0]).toMatchObject({
      code: 'phaseTooEarly',
      data: { phase: '1', required: '2' },
      message: 'Phase 1 is too early: the check areas are filled in from phase 2.',
    });
  });

  it('фаза: переменная заполнена только частично', () => {
    const partial = lint('SecRule ARGS:rest_route "@rx ^/wp/" "id:1,phase:1,pass"');
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({
      code: 'phasePartial',
      severity: 'advice',
      data: { name: 'ARGS', phase: '1', required: '2' },
    });
    expect(codes('SecRule ARGS_GET:rest_route "@rx ^/wp/" "id:1,phase:1,pass"')).toEqual([]);
    expect(codes('SecRule ARGS "@rx ^a" "id:1,phase:2,pass"')).toEqual([]);
    // Если чего-то в этой фазе нет вовсе, говорить о частичном незачем.
    expect(codes('SecRule ARGS|REQUEST_BODY "@rx ^a" "id:1,phase:1,pass"')).toEqual([
      'phaseTooEarly',
    ]);
  });

  it('после незакрытой кавычки остаётся одно сообщение — о ней', () => {
    // Утверждение разрезано не там, и «нет id» было бы следствием, а не причиной.
    expect(codes('SecRule ARGZ "@regex a "id:1,phase:2,pass"')).toEqual(['unbalancedQuotes']);
    // Соседние утверждения проверяются как обычно.
    expect(
      codes('SecRule ARGS "@rx a "id:1,phase:2,pass"\nSecRule ARGZ "@rx ^a" "id:2,phase:2,pass"'),
    ).toEqual(['unbalancedQuotes', 'unknownVariable']);
  });

  it('правило на Lua: действия проверяются, номер не обязателен', () => {
    expect(codes('SecRuleScript lua/check.lua "id:1,phase:2,pass,nolog"')).toEqual([]);
    // Движок делает для таких правил исключение: без `id` они загружаются.
    expect(codes('SecRuleScript lua/check.lua "phase:5,nolog,pass"')).toEqual([]);
    expect(codes('SecRuleScript lua/check.lua "phase:2,pass,frobnicate"')).toEqual([
      'unknownAction',
    ]);
    expect(codes('SecRuleScript')).toEqual(['directiveArgCount', 'missingPhase']);
    expect(
      found(
        [
          'SecRule ARGS "@rx ^a" "id:5,phase:2,pass"',
          'SecRuleScript lua/check.lua "id:5,phase:2,pass"',
        ].join('\n'),
      ),
    ).toEqual([['duplicateId', 'id:5']]);
  });

  it('переход на метку, которой нет', () => {
    const source = 'SecRule ARGS "@rx ^a" "id:1,phase:2,pass,skipAfter:NOWHERE"';
    expect(found(source)).toEqual([['missingMarker', 'NOWHERE']]);
    // Макрос в метке не раскрывается: о несуществующей метке говорить
    // незачем, беда в самом макросе.
    expect(codes('SecAction "id:1,phase:2,pass,skipAfter:%{tx.label}"')).toEqual([
      'macroInStaticAction',
    ]);
  });
});

describe('линтер: области проверки', () => {
  it.each<[string, Array<[DiagnosticCode, string]>]>([
    ['REQUEST_URI:foo', [['selectorNotSupported', 'foo']]],
    ['TX', [['selectorRequired', 'TX']]],
    ['&REQUEST_URI', [['countOnScalar', '&REQUEST_URI']]],
    ['ARGS|!ARGS', [['excludeWithoutSelector', '!ARGS']]],
    ['ARGS:a|ARGS:b|ARGS:a', [['duplicateTarget', 'ARGS:a']]],
    ['ARGS|!ARGS:a|&ARGS:a', []],
  ])('%s', (variables, expected) => {
    expect(found(rule(variables, '@rx ^1'))).toEqual(expected);
  });
});

describe('линтер: тип значения по конвейеру', () => {
  it('шагу не подходит то, что отдал предыдущий', () => {
    const [first] = lint(rule('ARGS', '@gt 5', 't:length,t:lowercase'));
    expect(first).toMatchObject({
      code: 'transformInputMismatch',
      data: { name: 'lowercase', expected: 'text', actual: 'a number' },
    });

    expect(found(rule('ARGS', '@rx ^a', 't:sha1,t:trim,t:hexEncode'))).toEqual([
      ['transformInputMismatch', 't:trim'],
    ]);
    expect(found(rule('REQUEST_BODY_LENGTH', '@rx ^5', 't:urlDecode'))).toEqual([
      ['transformInputMismatch', 't:urlDecode'],
    ]);
  });

  it('шаг ничего не меняет', () => {
    expect(found(rule('ARGS', '@rx ^a', 't:removeWhitespace,t:trim'))).toEqual([
      ['redundantTransform', 't:trim'],
    ]);
    expect(lint(rule('ARGS', '@rx ^a', 't:sha1,t:hexEncode,t:lowercase'))[0]).toMatchObject({
      code: 'redundantTransform',
      data: { name: 'lowercase', previous: 'hexEncode' },
    });
    expect(found(rule('ARGS', '@rx ^a', 't:lowercase,t:trim,t:lowercase'))).toEqual([
      ['duplicateTransform', 't:lowercase'],
    ]);
    // Повторное раскрытие кодирования — приём, а не ошибка.
    expect(codes(rule('ARGS', '@rx ^a', 't:urlDecode,t:urlDecode'))).toEqual([]);
    expect(codes(rule('ARGS', '@rx ^a', 't:lowercase,t:urlDecode,t:lowercase'))).toEqual([]);
  });

  it('сброс не на первом месте, но t:none после умолчаний — норма', () => {
    expect(found(rule('ARGS', '@rx ^a', 't:lowercase,t:none,t:trim'))).toEqual([
      ['transformNoneNotFirst', 't:none'],
    ]);
    expect(
      codes(
        [
          'SecDefaultAction "phase:2,pass,t:lowercase"',
          rule('ARGS', '@rx ^a', 't:none,t:trim'),
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('унаследованный шаг участвует в расчёте типа', () => {
    const source = [
      'SecDefaultAction "phase:2,pass,t:lowercase"',
      rule('REQUEST_METHOD', '@streq POST'),
      rule('REQUEST_METHOD', '@streq POST', 't:lowercase').replace('id:1', 'id:2'),
    ].join('\n');

    expect(found(source)).toEqual([
      ['caseNeverMatches', 'POST'],
      ['caseNeverMatches', 'POST'],
      ['duplicateTransform', 't:lowercase'],
    ]);
  });

  it('подсчёт и оператор, не глядящий на значение', () => {
    expect(found(rule('&ARGS', '@eq 0', 't:lowercase,t:trim'))).toEqual([
      ['countWithTransforms', 't:lowercase'],
    ]);
    expect(codes(rule('&ARGS', '@eq 0', 't:none'))).toEqual([]);
    // Рядом с подсчётом стоит само значение: конвейер работает для него.
    expect(codes(rule('&ARGS:a|ARGS:a', '@rx ^0$|^[a-z]+', 't:none,t:lowercase'))).toEqual([]);

    expect(found(rule('ARGS', '@unconditionalMatch', 't:lowercase'))).toEqual([
      ['transformsWithoutCheck', 't:lowercase'],
    ]);
  });

  it('оператор на значение не смотрит, но правило читает его из MATCHED_VAR', () => {
    const idiom = 't:none,t:sha1,t:hexEncode,setvar:tx.ua_hash=%{MATCHED_VAR}';
    expect(codes(rule('REQUEST_HEADERS:User-Agent', '@unconditionalMatch', idiom))).toEqual([]);

    // Читать значение может и следующее звено цепочки.
    const chained = [
      'SecRule REQUEST_HEADERS:User-Agent "@unconditionalMatch" "id:1,phase:1,pass,t:sha1,t:hexEncode,chain"',
      '    SecRule MATCHED_VAR "@streq da39a3ee5e6b4b0d3255bfef95601890afd80709"',
    ].join('\n');
    expect(codes(chained)).toEqual([]);

    // А раз конвейер работает, к нему применимы и обычные проверки.
    const broken = 't:length,t:lowercase,setvar:tx.len=%{MATCHED_VAR}';
    expect(found(rule('ARGS', '@unconditionalMatch', broken))).toEqual([
      ['transformInputMismatch', 't:lowercase'],
    ]);
  });

  it('два сброса подряд — повтор, а не отмена', () => {
    expect(found(rule('ARGS', '@rx ^a', 't:none,t:none,t:trim'))).toEqual([
      ['duplicateTransform', 't:none'],
    ]);
    expect(lint(rule('ARGS', '@rx ^a', 't:none,t:none'))[0].data).toEqual({ name: 'none' });
  });

  it('оба приведения регистра и раскрытие после нормализации', () => {
    expect(found(rule('ARGS', '@rx ^[0-9]+$', 't:lowercase,t:uppercase'))).toEqual([
      ['conflictingCaseTransforms', 't:uppercase'],
    ]);
    // Итог конвейера — верхний регистр, и строчная буква в шаблоне не совпадёт.
    expect(codes(rule('ARGS', '@rx ^a', 't:lowercase,t:uppercase'))).toContain('caseNeverMatches');
    expect(lint(rule('REQUEST_URI', '@rx ^a', 't:normalizePath,t:urlDecodeUni'))[0]).toMatchObject({
      code: 'decodeAfterNormalise',
      data: { decode: 'urlDecodeUni', normalise: 'normalizePath' },
    });
    expect(codes(rule('REQUEST_URI', '@rx ^a', 't:urlDecodeUni,t:normalizePath'))).toEqual([]);
  });
});

describe('линтер: оператор', () => {
  it('аргумент: нужен, лишний, не число', () => {
    expect(found(rule('ARGS', '@streq'))).toEqual([['operatorArgumentRequired', '@streq']]);
    expect(found(rule('ARGS', '@detectSQLi foo'))).toEqual([['operatorArgumentUnexpected', 'foo']]);
    expect(found(rule('&ARGS', '@gt many'))).toEqual([['nonNumericArgument', 'many']]);
    expect(codes(rule('&ARGS', '@gt %{tx.limit}'))).toEqual([]);
  });

  it('тип входа: числовое сравнение над текстом', () => {
    expect(found(rule('ARGS', '@gt 5'))).toEqual([['operatorInputMismatch', '@gt']]);
    expect(found(rule('REQUEST_URI', '@lt 5'))).toEqual([['operatorInputMismatch', '@lt']]);
    expect(found(rule('ARGS:/^id_/', '@gt 5'))).toEqual([['operatorInputMismatch', '@gt']]);
    expect(codes(rule('ARGS', '@gt 5', 't:length'))).toEqual([]);
    // Что лежит в названном параметре или заголовке, знает приложение.
    expect(codes(rule('ARGS:id', '@gt 5'))).toEqual([]);
    expect(codes(rule('REQUEST_HEADERS:Content-Length', '@gt 1048576'))).toEqual([]);
    expect(codes(rule('REQUEST_BODY_LENGTH', '@gt 5'))).toEqual([]);
    // Что лежит в TX, знает только автор правил.
    expect(codes(rule('TX:score', '@gt 5'))).toEqual([]);
    expect(codes(rule('TX:score', '@gt 5', 't:lowercase'))).toEqual([]);
    // Число — это ещё и текст, но букв в нём не бывает.
    expect(codes(rule('REQUEST_BODY_LENGTH', '@rx ^5\\d\\d$'))).toEqual([]);
    expect(codes(rule('REQUEST_BODY_LENGTH', '@streq 0'))).toEqual([]);
    expect(found(rule('&ARGS', '@contains admin'))).toEqual([['operatorInputMismatch', '@contains']]);
    expect(found(rule('ARGS', '@rx ^(?:yes|no)$', 't:length'))).toEqual([
      ['operatorInputMismatch', '@rx'],
    ]);
  });

  it('сырой хеш сравнивается с текстом', () => {
    expect(lint(rule('ARGS:p', '@streq 5f4dcc3b', 't:md5'))[0]).toMatchObject({
      code: 'hashWithoutHexEncode',
      data: { name: 'md5' },
    });
    expect(codes(rule('ARGS:p', '@streq 5f4dcc3b', 't:md5,t:hexEncode'))).toEqual([]);
  });

  it('аргумент не переживёт приведение регистра', () => {
    expect(lint(rule('REQUEST_METHOD', '@streq POST', 't:lowercase'))[0]).toMatchObject({
      code: 'caseNeverMatches',
      data: { name: 'lowercase', value: 'POST' },
    });
    expect(found(rule('ARGS', '@rx ^SELECT\\b', 't:lowercase'))).toEqual([
      ['caseNeverMatches', '^SELECT\\b'],
    ]);
    expect(found(rule('ARGS', '@contains abc', 't:uppercase'))).toEqual([
      ['caseNeverMatches', 'abc'],
    ]);
    // Шестнадцатеричная запись — тоже нижний регистр, и виноват в нём hexEncode.
    expect(lint(rule('ARGS', '@streq ABCDEF', 't:sha1,t:hexEncode'))[0]).toMatchObject({
      code: 'caseNeverMatches',
      data: { name: 'hexEncode' },
    });

    expect(codes(rule('ARGS', '@rx (?i)SELECT', 't:lowercase'))).toEqual([]);
    expect(codes(rule('ARGS', '@rx \\S+[A-Z]\\D', 't:lowercase'))).toEqual([]);
    expect(codes(rule('ARGS', '@streq %{TX.Expected}', 't:lowercase'))).toEqual([]);
    expect(codes(rule('ARGS', '@pm SELECT UNION', 't:lowercase'))).toEqual([]);
    // После раскрытия кодирования заглавные буквы могут вернуться.
    expect(codes(rule('ARGS', '@streq POST', 't:lowercase,t:urlDecode'))).toEqual([]);
  });

  it('аргумент не переживёт работу с пробелами', () => {
    expect(lint(rule('ARGS', '@contains union select', 't:removeWhitespace'))[0]).toMatchObject({
      code: 'whitespaceNeverMatches',
      data: { name: 'removeWhitespace', value: 'union select' },
    });
    expect(found(rule('ARGS', '@contains a  b', 't:compressWhitespace'))).toEqual([
      ['whitespaceNeverMatches', 'a  b'],
    ]);
    expect(found(rule('ARGS', '@streq admin ', 't:trim'))).toEqual([
      ['whitespaceNeverMatches', 'admin '],
    ]);
    // Подстрока с пробелом по краю может стоять в середине значения.
    expect(codes(rule('ARGS', '@contains admin ', 't:trim'))).toEqual([]);
    expect(codes(rule('ARGS', '@contains a b', 't:compressWhitespace'))).toEqual([]);
  });
});

describe('линтер: набор файлов', () => {
  const setup = {
    name: 'setup.conf',
    source: [
      // Умолчания без преобразований не показали бы, что они наследуются.
      '# seclang-ignore: defaultActionDeprecated',
      'SecDefaultAction "phase:2,log,pass,t:lowercase"',
      'SecAction "id:100,phase:1,pass,nolog,setvar:tx.level=1"',
    ].join('\n'),
  };
  const rules = {
    name: 'rules.conf',
    source: [
      'SecRule TX:level "@lt 2" "id:200,phase:1,pass,nolog,skipAfter:END-STRICT"',
      // Фазы нет, но она придёт из умолчаний соседнего файла — вместе с t:lowercase.
      'SecRule REQUEST_METHOD "@streq POST" "id:201,deny,msg:\'POST\'"',
      'SecRule ARGS "@rx ^a" "id:100,phase:2,pass"',
    ].join('\n'),
  };
  const tail = { name: 'tail.conf', source: 'SecMarker END-STRICT' };

  const summary = (files: Array<{ name: string; source: string }>) =>
    lintWorkspace(files).map(({ name, diagnostics }) => [name, diagnostics.map((d) => d.code)]);

  it('метки, номера и умолчания видны сквозь границы файлов', () => {
    expect(summary([setup, rules, tail])).toEqual([
      ['setup.conf', []],
      ['rules.conf', ['caseNeverMatches', 'duplicateId']],
      ['tail.conf', []],
    ]);
  });

  it('лишний из двух одинаковых номеров — тот, что загружен позже', () => {
    // Правила, загруженные раньше настройки, не видят ни её умолчаний, ни её
    // переменных: `tx.level` к этому времени ещё никто не выставил.
    expect(summary([rules, tail, setup])).toEqual([
      ['rules.conf', ['txReadBeforeSet', 'missingPhase']],
      ['tail.conf', []],
      ['setup.conf', ['duplicateId']],
    ]);
  });

  it('файл в одиночку своих соседей не видит', () => {
    expect(lint(rules.source).map((d) => d.code)).toEqual([
      'txNeverSet',
      'missingMarker',
      'missingPhase',
    ]);
  });

  it('строки и смещения считаются внутри своего файла', () => {
    const [, second] = lintWorkspace([setup, rules, tail]);
    expect(second.diagnostics.map((d) => [d.code, d.line])).toEqual([
      ['caseNeverMatches', 2],
      ['duplicateId', 3],
    ]);
    const duplicate = second.diagnostics[1];
    expect(rules.source.slice(duplicate.start, duplicate.end)).toBe('id:100');
  });
});

/** Коды по файлам набора — в порядке загрузки. */
function perFile(...sources: string[]): DiagnosticCode[][] {
  const files = sources.map((source, index) => ({ name: `${index}.conf`, source }));
  return lintWorkspace(files, { codes: { persistentWithoutDataDir: 'off' } }).map((file) =>
    file.diagnostics.map((d) => d.code),
  );
}

describe('линтер: метки и переходы', () => {
  const jump = 'SecRule REQUEST_METHOD "@streq GET" "id:1,phase:1,pass,skipAfter:END"';

  it('метка ниже перехода — в том же файле или в следующем', () => {
    expect(lint(`${jump}\nSecMarker END`)).toEqual([]);
    expect(perFile(jump, 'SecMarker END')).toEqual([[], []]);
  });

  it('метки нет вовсе или она стоит выше', () => {
    expect(found(jump)).toEqual([['missingMarker', 'END']]);
    expect(found(`SecMarker END\n${jump}`)).toEqual([['markerBehind', 'END']]);
    expect(perFile('SecMarker END', jump)).toEqual([[], ['markerBehind']]);
    // Одной метки ниже достаточно, сколько бы их ни стояло выше.
    expect(codes(`SecMarker END\n${jump}\nSecMarker END`)).toEqual(['duplicateMarker']);
  });

  it('метка объявлена дважды — в том числе в разных файлах', () => {
    expect(found(`${jump}\nSecMarker END\nSecMarker "END"`)).toEqual([['duplicateMarker', '"END"']]);
    expect(perFile(`${jump}\nSecMarker END`, 'SecMarker END')).toEqual([[], ['duplicateMarker']]);
  });

  it('метка, на которую никто не прыгает', () => {
    expect(found('SecMarker LONELY')).toEqual([['unusedMarker', 'LONELY']]);
    // Переход из соседнего файла считается.
    expect(perFile('SecMarker END', jump.replace('END', 'OTHER'), 'SecMarker OTHER')).toEqual([
      ['unusedMarker'],
      [],
      [],
    ]);
    // Переход с макросом вместо метки: о нём одно замечание, и оно не о метке.
    const dynamic = 'SecAction "id:9,phase:1,pass,skipAfter:%{tx.label}"';
    expect(codes(`SecMarker LONELY\n${dynamic}`)).toEqual(['macroInStaticAction']);
  });

  it('skip считает правила своей фазы во всём наборе', () => {
    const skip = (count: number) => `SecAction "id:1,phase:1,pass,skip:${count}"`;
    const next = (id: number, phase: number) => `SecAction "id:${id},phase:${phase},pass"`;

    expect(codes([skip(2), next(2, 1), next(3, 1)].join('\n'))).toEqual([]);
    expect(lint([skip(2), next(2, 1), next(3, 2)].join('\n'))[0]).toMatchObject({
      code: 'skipBeyondEnd',
      data: { count: '2', rest: '1' },
    });
    expect(perFile(skip(2), next(2, 1), next(3, 1))).toEqual([[], [], []]);
  });
});

describe('линтер: переменные', () => {
  const read = (id: number, phase: number, name = 'flag') =>
    `SecRule TX:${name} "@eq 1" "id:${id},phase:${phase},pass"`;
  const write = (id: number, phase: number, name = 'flag') =>
    `SecAction "id:${id},phase:${phase},pass,setvar:tx.${name}=1"`;
  // Каталог для коллекций задают в настройке сервера; здесь он — шум.
  const QUIET = { codes: { persistentWithoutDataDir: 'off' } } as const;
  const all = (source: string) => lint(source, QUIET).map((d) => d.code);

  it('выставлена раньше, чем прочитана: порядок задаёт фаза, потом строка', () => {
    expect(all([write(1, 2), read(2, 2)].join('\n'))).toEqual([]);
    expect(all([read(2, 2), write(1, 1)].join('\n'))).toEqual([]);
    expect(all([read(2, 2), write(1, 2)].join('\n'))).toEqual(['txReadBeforeSet']);
    expect(all([write(1, 5), read(2, 2)].join('\n'))).toEqual(['txReadBeforeSet']);
  });

  it('то же между файлами набора', () => {
    expect(perFile(write(1, 2), read(2, 2))).toEqual([[], []]);
    expect(perFile(read(2, 2), write(1, 2))).toEqual([['txReadBeforeSet'], []]);
    expect(perFile(read(2, 2), write(1, 1))).toEqual([[], []]);
  });

  it('никем не выставлена: одно замечание на переменную в файле', () => {
    const twice = [read(1, 1), read(2, 2), 'SecAction "id:3,phase:2,pass,msg:\'%{tx.flag}\'"'];
    const result = lint(twice.join('\n'));
    expect(result.map((d) => [d.code, d.line, d.data])).toEqual([
      ['txNeverSet', 1, { name: 'flag' }],
    ]);
    // Удаление — не запись: переменной от него не появится.
    expect(all(`SecAction "id:1,phase:1,pass,setvar:!tx.flag"\n${read(2, 2)}`)).toEqual([
      'txNeverSet',
    ]);
  });

  it('чтением считаются область проверки, макрос и срок жизни — но не проверка наличия', () => {
    expect(all('SecAction "id:1,phase:2,pass,logdata:\'%{tx.flag}\'"')).toEqual(['txNeverSet']);
    expect(all('SecRule ARGS "@streq %{tx.flag}" "id:1,phase:2,pass"')).toEqual(['txNeverSet']);
    // Срок жизни у переменной, живущей один запрос, — сам по себе замечание.
    expect(all('SecAction "id:1,phase:2,pass,expirevar:tx.flag=60"')).toEqual([
      'txNeverSet',
      'suspiciousActionValue',
    ]);
    expect(all('SecAction "id:1,phase:2,pass,setvar:tx.copy=%{tx.flag}"')).toEqual(['txNeverSet']);

    expect(all('SecRule &TX:flag "@eq 0" "id:1,phase:2,pass"')).toEqual([]);
    expect(all('SecRule !TX:flag|TX:/^f/ "@rx ^a" "id:1,phase:2,pass"')).toEqual([]);
  });

  it('правило, проверившее наличие переменной, читает её без замечаний', () => {
    const guarded = [
      'SecRule &TX:limit "@eq 1" "id:1,phase:2,pass,chain"',
      '    SecRule &ARGS "@gt %{tx.limit}"',
    ].join('\n');
    expect(all(guarded)).toEqual([]);
    // Значение по умолчанию: то же правило её и выставляет.
    expect(
      all(
        [
          'SecRule &TX:limit "@eq 0" "id:1,phase:1,pass,setvar:tx.limit=5"',
          'SecRule &ARGS "@gt %{tx.limit}" "id:2,phase:2,pass"',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('запись и чтение в одном правиле, в том числе в разных звеньях', () => {
    expect(all('SecAction "id:1,phase:2,pass,setvar:tx.a=1,setvar:tx.b=+%{tx.a}"')).toEqual([]);
    expect(
      all(
        [
          'SecRule ARGS "@rx ^a" "id:1,phase:2,pass,setvar:tx.flag=1,chain"',
          '    SecRule TX:flag "@eq 1"',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('имя с макросом объясняет только те чтения, что под него подходят', () => {
    const dynamic = 'SecAction "id:1,phase:1,pass,setvar:tx.%{rule.id}_hit=1"';
    expect(all(`${dynamic}\n${read(2, 2, '942100_hit')}`)).toEqual([]);
    expect(all(`${dynamic}\n${read(2, 2, 'score')}`)).toEqual(['txNeverSet']);
  });

  it('переменные, которые выставляет движок, записи не требуют', () => {
    expect(all(read(1, 2, 'MSC_PCRE_LIMITS_EXCEEDED'))).toEqual([]);
  });

  it('имена сравниваются без учёта регистра и разделителя', () => {
    expect(
      all(
        [
          'SecAction "id:1,phase:1,pass,setvar:TX:Anomaly_Score=+5"',
          'SecRule TX:ANOMALY_SCORE "@gt 3" "id:2,phase:2,pass,msg:\'%{tx.anomaly_score}\'"',
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('захваченная группа: свою находку правило читает только с capture', () => {
    const logged = (extra: string) =>
      `SecRule ARGS "@rx (a)" "id:1,phase:2,pass${extra},logdata:'%{TX.1} %{TX.0}'"`;

    expect(all(logged(',capture'))).toEqual([]);
    // Одно замечание на правило, сколько бы групп в нём ни читали.
    const result = lint(logged(''));
    expect(result.map((d) => d.code)).toEqual(['captureMissing']);
    // Группу головы звено читает как свою: цепочка — одно правило.
    expect(
      all(
        [
          'SecRule ARGS "@rx (a)" "id:1,phase:2,pass,capture,chain"',
          '    SecRule TX:1 "@streq a"',
        ].join('\n'),
      ),
    ).toEqual([]);
    // `capture` правила выше не помогает: его группа доживёт до этого
    // правила, но это чужая находка, а не своя. Подробнее — `captures.test.ts`.
    expect(
      all([logged(',capture'), logged('').replace('id:1', 'id:2')].join('\n')),
    ).toEqual(['captureMissing']);
  });

  it('долгоживущая коллекция: её надо открыть, а порядок записи не важен', () => {
    const opened = 'SecAction "id:1,phase:1,pass,initcol:ip=%{REMOTE_ADDR}"';
    const bump = 'SecAction "id:2,phase:5,pass,setvar:ip.hits=+1"';
    const check = 'SecRule IP:hits "@gt 10" "id:3,phase:1,pass"';

    // Значение осталось от прошлого запроса: читать раньше записи можно.
    expect(all([opened, check, bump].join('\n'))).toEqual([]);

    const closed = lint([check, bump].join('\n'), QUIET);
    expect(closed.map((d) => [d.code, d.line])).toEqual([['collectionNotInitialised', 1]]);
    expect(closed[0].data).toEqual({ name: 'ip', action: 'initcol:ip=%{REMOTE_ADDR}' });

    expect(all([opened, check].join('\n'))).toEqual(['variableNeverSet']);
    // Служебные поля коллекции заполняет движок.
    expect(all(`${opened}\nSecRule IP:IS_NEW "@eq 1" "id:3,phase:1,pass"`)).toEqual([]);
    // Сессию открывает setsid, пользователя — setuid.
    expect(
      all('SecAction "id:1,phase:1,pass,setsid:%{REQUEST_COOKIES.sid},setvar:session.n=+1"'),
    ).toEqual([]);
    expect(all('SecAction "id:1,phase:1,pass,setvar:user.n=+1"')).toEqual([
      'collectionNotInitialised',
    ]);
  });

  it('коллекцию может открыть соседний файл', () => {
    const opened = 'SecAction "id:1,phase:1,pass,initcol:global=global"';
    const bump = 'SecAction "id:2,phase:1,pass,setvar:global.requests=+1"';
    expect(perFile(bump, opened)).toEqual([[], []]);
    expect(perFile(bump)).toEqual([['collectionNotInitialised']]);
  });
});

describe('линтер: настройки', () => {
  // По одному замечанию каждого рода: ошибка, предупреждения двух тем, совет.
  const source = [
    'SecRule ARGS "@rx ^a" "phase:2,pass"',
    'SecRule REQUEST_METHOD "@streq POST" "id:2,phase:1,pass,t:lowercase"',
    'SecRule ARGS "@rx ^a" "id:3,pass,t:removeWhitespace,t:trim"',
    'SecRule ARGS "@rx ^a" "id:4,phase:1,pass"',
  ].join('\n');

  const pairs = (options: Parameters<typeof lint>[1]) =>
    lint(source, options).map((d) => [d.code, d.severity]);

  it('без настроек выдаёт всё со словарными уровнями', () => {
    expect(pairs({})).toEqual([
      ['missingId', 'error'],
      ['caseNeverMatches', 'warning'],
      ['missingPhase', 'warning'],
      ['redundantTransform', 'advice'],
      ['phasePartial', 'advice'],
    ]);
  });

  it('only: проверяется только названное', () => {
    expect(pairs({ only: ['caseNeverMatches', 'phasePartial'] })).toEqual([
      ['caseNeverMatches', 'warning'],
      ['phasePartial', 'advice'],
    ]);
    expect(pairs({ only: [] })).toEqual([]);
  });

  it('codes: код выключается или получает другой уровень', () => {
    expect(pairs({ codes: { missingId: 'off', redundantTransform: 'error' } })).toEqual([
      ['caseNeverMatches', 'warning'],
      ['missingPhase', 'warning'],
      ['redundantTransform', 'error'],
      ['phasePartial', 'advice'],
    ]);
  });

  it('topics: тема выключается целиком, но названный код сильнее темы', () => {
    expect(pairs({ topics: { structure: 'off', style: 'off' } })).toEqual([
      ['caseNeverMatches', 'warning'],
      ['phasePartial', 'advice'],
    ]);
    expect(
      pairs({ topics: { structure: 'off', logic: 'error' }, codes: { missingId: 'warning' } }),
    ).toEqual([
      ['missingId', 'warning'],
      ['caseNeverMatches', 'error'],
      ['redundantTransform', 'advice'],
      ['phasePartial', 'advice'],
    ]);
  });

  it('minSeverity: отсекает всё, что ниже, — по итоговому уровню', () => {
    expect(pairs({ minSeverity: 'warning' }).map(([code]) => code)).toEqual([
      'missingId',
      'caseNeverMatches',
      'missingPhase',
    ]);
    expect(pairs({ minSeverity: 'error' })).toEqual([['missingId', 'error']]);
    // Совет, поднятый до предупреждения, порог проходит.
    expect(
      pairs({ minSeverity: 'warning', codes: { phasePartial: 'warning' } }).map(([code]) => code),
    ).toContain('phasePartial');
  });

  it('rules: замечания снимаются по номеру правила', () => {
    expect(pairs({ rules: { 2: 'off', 3: ['redundantTransform'] } }).map(([code]) => code)).toEqual([
      'missingId',
      'missingPhase',
      'phasePartial',
    ]);
    // Цепочка — одно правило: номер головы снимает замечания и со звеньев.
    const chain = [
      'SecRule REQUEST_METHOD "@streq POST" "id:7,phase:1,pass,t:lowercase,chain"',
      '    SecRule ARGZ "@rx ^a"',
    ].join('\n');
    expect(lint(chain).map((d) => d.code)).toEqual(['caseNeverMatches', 'unknownVariable']);
    expect(lint(chain, { rules: { 7: ['unknownVariable'] } }).map((d) => d.code)).toEqual([
      'caseNeverMatches',
    ]);
    expect(lint(chain, { rules: { 7: 'off' } })).toEqual([]);
  });

  it('настройки действуют и на набор файлов', () => {
    const files = [
      { name: 'a.conf', source },
      { name: 'b.conf', source: 'SecRule ARGS "@rx ^a" "id:2,phase:2,pass"' },
    ];
    const result = lintWorkspace(files, { minSeverity: 'error', rules: { 2: 'off' } });
    // Повтор номера 2 во втором файле снят вместе с правилом.
    expect(result.map((file) => file.diagnostics.map((d) => d.code))).toEqual([['missingId'], []]);
  });
});

describe('линтер: пометки в комментариях', () => {
  const bad = 'SecRule REQUEST_METHOD "@streq POST" "id:1,phase:1,pass,t:lowercase,t:removeWhitespace,t:trim"';
  const codesOf = (source: string, options?: Parameters<typeof lint>[1]) =>
    lint(source, options).map((d) => d.code);

  it('без пометки правило даёт два замечания', () => {
    expect(codesOf(bad)).toEqual(['caseNeverMatches', 'redundantTransform']);
  });

  it('пометка с кодом снимает его с правила ниже, остальное остаётся', () => {
    expect(codesOf(`# seclang-ignore: caseNeverMatches\n${bad}`)).toEqual(['redundantTransform']);
    expect(codesOf(`# seclang-ignore caseNeverMatches, redundantTransform\n${bad}`)).toEqual([]);
    expect(codesOf(`#seclang-ignore:caseNeverMatches redundantTransform\n${bad}`)).toEqual([]);
  });

  it('пометка без кодов снимает всё', () => {
    expect(codesOf(`# seclang-ignore\n${bad}`)).toEqual([]);
  });

  it('действует на одно правило — ближайшее ниже, вместе с цепочкой', () => {
    const next = bad.replace('id:1', 'id:2').replace('POST', 'PUT');
    expect(codesOf(`# seclang-ignore\n${bad}\n${next}`)).toEqual([
      'caseNeverMatches',
      'redundantTransform',
    ]);
    // Между пометкой и правилом может стоять его описание.
    expect(codesOf(`# seclang-ignore\n# Описание правила\n\n${bad}`)).toEqual([]);

    const chain = [
      '# seclang-ignore: unknownVariable',
      'SecRule REQUEST_METHOD "@streq GET" "id:1,phase:1,pass,chain"',
      '    SecRule ARGZ "@rx ^a" "chain"',
      '    SecRule ARGY "@rx ^a" "t:none"',
      'SecRule ARGX "@rx ^a" "id:2,phase:2,pass"',
    ].join('\n');
    expect(lint(chain).map((d) => [d.code, d.line])).toEqual([['unknownVariable', 5]]);
  });

  it('пометка на файл действует везде, где бы ни стояла', () => {
    const next = bad.replace('id:1', 'id:2').replace('POST', 'PUT');
    expect(codesOf(`${bad}\n${next}\n# seclang-ignore-file: caseNeverMatches`)).toEqual([
      'redundantTransform',
      'redundantTransform',
    ]);
    expect(codesOf(`# seclang-ignore-file\n${bad}\n${next}`)).toEqual([]);
  });

  it('похожий комментарий пометкой не считается', () => {
    expect(codesOf(`# see seclang-ignore docs\n${bad}`)).toHaveLength(2);
    expect(codesOf(`# seclang-ignored\n${bad}`)).toHaveLength(2);
    // Незнакомый код ничего не снимает — и об этом сказано.
    expect(codesOf(`# seclang-ignore: noSuchCode\n${bad}`)).toEqual([
      'unknownIgnoreCode',
      'unusedIgnore',
      'caseNeverMatches',
      'redundantTransform',
    ]);
  });

  it('comments: false — пометки не слушаются', () => {
    expect(codesOf(`# seclang-ignore\n${bad}`, { comments: false })).toHaveLength(2);
    expect(codesOf(`# seclang-ignore-file\n${bad}`, { comments: false })).toHaveLength(2);
  });
});

describe('линтер: результат', () => {
  const source = [
    'SecRule ARGS "@streq POST" \\',
    '    "id:1,phase:2,pass,\\',
    '    t:lowercase"',
    'SecRule ARGZ "@rx ^a" "id:2,phase:2,pass"',
  ].join('\n');

  it('замечания идут по порядку исходника со строкой и столбцом', () => {
    const result = lint(source);
    expect(result.map((d) => [d.code, d.line, d.column, d.endLine, d.endColumn])).toEqual([
      ['caseNeverMatches', 1, 22, 1, 26],
      ['unknownVariable', 4, 9, 4, 13],
    ]);
    expect(result[0].severity).toBe('warning');
    expect(result[0].topic).toBe('logic');
  });

  it('уровень можно сменить или заглушить по коду', () => {
    const result = lint(source, { codes: { caseNeverMatches: 'off', unknownVariable: 'error' } });
    expect(result.map((d: Diagnostic) => [d.code, d.severity])).toEqual([
      ['unknownVariable', 'error'],
    ]);
  });

  it('у каждого кода есть текст без незаполненных подстановок в проверках выше', () => {
    for (const [name, spec] of Object.entries(CODES)) {
      expect([name, spec.message.length > 0]).toEqual([name, true]);
    }
    for (const diagnostic of lint(source)) {
      expect(diagnostic.message).not.toMatch(/\{\w+\}/);
    }
  });
});
