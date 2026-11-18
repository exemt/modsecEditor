import { lint, lintWorkspace, parse, regexFeatures } from '../index';
import type { DiagnosticCode, LintOptions } from '../index';

/**
 * Проверки второго захода: значения действий, кавычки, аргументы операторов,
 * исключения, окружение.
 *
 * По одному примеру на каждый код уже есть в папке `cases`. Здесь — то, чего
 * пример не покажет: где проверка обязана промолчать и как её ответ зависит
 * от движка. Почти каждое «молчит» в этом файле — бывшее ложное срабатывание.
 */

/** Советы об окружении и переменных: в правиле из одной строки они — шум. */
const QUIET = {
  txNeverSet: 'off',
  persistentWithoutDataDir: 'off',
  geoLookupWithoutDb: 'off',
} as const;

function codes(source: string, options: LintOptions = {}): DiagnosticCode[] {
  return lint(source, { ...options, codes: { ...QUIET, ...options.codes } }).map((d) => d.code);
}

/** Правило с такими действиями сверх обязательных. */
function action(extra: string, reaction = 'pass'): string {
  return `SecAction "id:1,phase:1,${reaction},${extra}"`;
}

function rule(variables: string, operator: string, extra = ''): string {
  return `SecRule ${variables} "${operator}" "id:1,phase:2,pass${extra === '' ? '' : `,${extra}`}"`;
}

describe('проверки: значения действий', () => {
  it('номер и фаза — то, что движок согласится загрузить', () => {
    for (const id of ['0', '-5', '1.5', 'abc']) {
      expect(codes(`SecAction "id:${id},phase:1,pass"`)).toEqual(['invalidActionValue']);
    }
    expect(codes("SecAction \"id:'12',phase:1,pass\"")).toEqual([]);

    for (const phase of ['0', '6', 'early']) {
      expect(codes(`SecAction "id:1,phase:${phase},pass"`)).toContain('invalidActionValue');
    }
    for (const phase of ['1', '5', 'request', 'RESPONSE', 'logging']) {
      expect(codes(`SecAction "id:1,phase:${phase},pass"`)).toEqual([]);
    }
  });

  it('значение, которое один движок прочитает по-своему, а другие отвергнут', () => {
    // Вторая версия читает незнакомое слово как «авария» и молчит; третья
    // и Coraza правило не грузят. Движок не назван — значит, ошибка.
    const severity = (options: LintOptions) =>
      lint(action('severity:banana'), options).map((d) => [d.code, d.severity]);
    expect(severity({})).toEqual([['suspiciousActionValue', 'error']]);
    expect(severity({ engine: 'modsecurity2' })).toEqual([['suspiciousActionValue', 'warning']]);
    expect(severity({ engine: 'coraza' })).toEqual([['suspiciousActionValue', 'error']]);

    expect(codes(action('severity:2'))).toEqual([]);
    expect(codes(action("severity:'ERROR'"))).toEqual([]);
    expect(codes(action('severity:8'))).toEqual(['suspiciousActionValue']);
    expect(codes(action("status:99,msg:'m'", 'deny'))).toEqual(['suspiciousActionValue']);
    expect(codes(action('skip:0'))).toEqual(['suspiciousActionValue']);
  });

  it('макрос в действии, которое читается один раз при загрузке', () => {
    expect(codes(action('skipAfter:%{tx.label}'))).toEqual(['macroInStaticAction']);
    expect(codes('SecAction "id:%{tx.id},phase:1,pass"')).toEqual(['macroInStaticAction']);
    expect(codes(action("status:%{tx.code},msg:'m'", 'deny'))).toEqual(['macroInStaticAction']);
    // А здесь макрос раскрывается на запросе.
    expect(codes(action("msg:'%{tx.a}',tag:'%{tx.b}',setvar:tx.c=%{tx.d}"))).toEqual([]);
  });

  it('ctl: опция и её значение', () => {
    expect(codes(action('ctl:ruleEngin=Off'))).toEqual(['unknownCtl']);
    expect(codes(action('ctl:ruleEngine=Maybe'))).toEqual(['invalidActionValue']);
    expect(codes(action('ctl:ruleEngine'))).toEqual(['invalidActionValue']);
    expect(codes(action('ctl:auditLogParts=ABXZ'))).toEqual(['invalidActionValue']);
    expect(codes(action('ctl:requestBodyLimit=abc'))).toEqual(['invalidActionValue']);

    const fine = [
      'ctl:ruleEngine=On',
      'ctl:ruleengine=detectiononly',
      'ctl:auditLogParts=+E',
      'ctl:requestBodyProcessor=JSON',
      'ctl:forceRequestBodyVariable=On',
      'ctl:debugLogLevel=3',
    ];
    for (const ctl of fine) expect(codes(action(ctl))).toEqual([]);

    // Свой обработчик тела — возможность второй версии; третья такое не грузит.
    const custom = action('ctl:requestBodyProcessor=FOO');
    expect(codes(custom, { engine: 'modsecurity2' })).toEqual([]);
    expect(lint(custom, { engine: 'modsecurity3' }).map((d) => [d.code, d.severity])).toEqual([
      ['suspiciousActionValue', 'error'],
    ]);
  });

  it('повтор: что можно писать много раз, а что перекрывает само себя', () => {
    expect(codes(action('tag:a,tag:a'))).toEqual([]);
    expect(codes(action('setvar:tx.a=+1,setvar:tx.a=+1'))).toEqual([]);

    expect(codes('SecAction "id:1,id:2,phase:1,pass"')).toEqual(['duplicateAction']);
    expect(codes(action("msg:'a',msg:'b'"))).toEqual(['duplicateAction']);
    expect(codes(action('log,nolog'))).toEqual(['conflictingActions']);
    expect(codes(action('auditlog,noauditlog'))).toEqual(['conflictingActions']);
    expect(codes(action("pass,msg:'m'", 'deny'))).toEqual(['conflictingActions']);
  });

  it('срок жизни у переменной, которая живёт один запрос', () => {
    expect(codes(action('setvar:tx.a=1,expirevar:tx.a=60'))).toEqual(['suspiciousActionValue']);
    expect(
      codes(action('initcol:ip=%{REMOTE_ADDR},setvar:ip.a=1,expirevar:ip.a=60')),
    ).toEqual([]);
  });

  it('SecDefaultAction: чего в нём не хватает и что лишнее', () => {
    expect(codes('SecDefaultAction "log"')).toEqual([
      'defaultActionIncomplete',
      'defaultActionIncomplete',
    ]);
    expect(codes('SecDefaultAction "phase:2,pass,chain"')).toEqual(['defaultActionForbidden']);
    expect(codes('SecDefaultAction "phase:2,pass,skipAfter:X"')).toContain('defaultActionForbidden');
    // Теги движок в умолчаниях не проверяет — значит, и мы не выдумываем.
    expect(codes('SecDefaultAction "phase:2,pass,tag:x"')).toEqual([]);

    expect(codes('SecDefaultAction "phase:2,log,pass,t:lowercase"')).toEqual([
      'defaultActionDeprecated',
    ]);
    // Сброс преобразований ни на что не ложится.
    expect(codes('SecDefaultAction "phase:2,log,pass,t:none"')).toEqual([]);
  });

  it('второй SecDefaultAction той же фазы — ошибка только для третьей версии', () => {
    const twice = [
      'SecDefaultAction "phase:2,log,pass"',
      'SecDefaultAction "phase:2,log,deny"',
      'SecDefaultAction "phase:1,log,pass"',
    ].join('\n');
    expect(codes(twice)).toEqual([]);
    expect(codes(twice, { engine: 'modsecurity2' })).toEqual([]);
    const found = lint(twice, { engine: 'modsecurity3' });
    expect(found.map((d) => [d.code, d.line])).toEqual([['defaultActionRepeated', 2]]);
  });
});

describe('проверки: кавычки и переносы', () => {
  it('незакрытая кавычка значения — одно замечание, без следствий', () => {
    expect(codes("SecRule ARGS \"@rx ^a\" \"id:1,phase:2,pass,msg:'unclosed\"")).toEqual([
      'unclosedValueQuote',
    ]);
    // Потерянная запятая: значение кончилось, а запись продолжается.
    expect(codes("SecRule ARGS \"@rx ^a\" \"id:1,phase:2,pass,msg:'a'tag:'b'\"")).toEqual([
      'textAfterQuote',
    ]);
    // Апостроф в середине значения без кавычек — обычный символ.
    expect(codes('SecRule ARGS "@rx ^a" "id:1,phase:2,pass,msg:it\'s"')).toEqual([]);
  });

  it('обратный слэш в кавычках: считаются слэши, дошедшие до движка', () => {
    const withMsg = (msg: string) => `SecRule ARGS "@rx ^a" "id:1,phase:2,pass,msg:'${msg}'"`;

    expect(codes(withMsg('path c:\\temp'))).toEqual(['invalidQuotedPair']);
    // Два слэша первый слой свернёт в один — и получится та же `\t`.
    expect(codes(withMsg('path c:\\\\temp'))).toEqual(['invalidQuotedPair']);
    // Три и четыре доходят парой: это и есть запись одного слэша.
    expect(codes(withMsg('path c:\\\\\\temp'))).toEqual([]);
    expect(codes(withMsg('path c:\\\\\\\\temp'))).toEqual([]);
    expect(codes(withMsg("it\\'s"))).toEqual([]);

    // Так записан шаблон параметра в CRS — и это верная запись.
    expect(codes("SecRule TX:'/^\\\\\\d+_score$/' \"@gt 0\" \"id:1,phase:2,pass\"")).toEqual([]);
    expect(codes("SecRule TX:'/^\\d+_score$/' \"@gt 0\" \"id:1,phase:2,pass\"")).toEqual([
      'invalidQuotedPair',
    ]);
  });

  it('строгость к слэшам — свойство второй версии', () => {
    const source = "SecRule ARGS \"@rx ^a\" \"id:1,phase:2,pass,msg:'path c:\\temp'\"";
    expect(codes(source, { engine: 'modsecurity2' })).toEqual(['invalidQuotedPair']);
    expect(codes(source, { engine: 'modsecurity3' })).toEqual([]);
    expect(codes(source, { engine: 'coraza' })).toEqual([]);
  });

  it('пробел после переноса: правило читается целиком, ошибка — одна', () => {
    const source = 'SecRule ARGS "@rx ^a" \\ \n    "id:1,phase:2,pass"';
    expect(parse(source).statements).toHaveLength(1);

    const found = lint(source);
    expect(found.map((d) => [d.code, d.severity, d.line])).toEqual([
      ['continuationSpace', 'error', 1],
    ]);
    expect(source.slice(found[0].start, found[0].end)).toBe('\\ ');

    // Табуляция — тот же пробел; внутри кавычек — та же ошибка.
    expect(codes('SecRule ARGS "@rx ^a" "id:1,\\\t\n    phase:2,pass"')).toEqual([
      'continuationSpace',
    ]);
    // Coraza строку перед поиском переноса обрезает.
    expect(codes(source, { engine: 'coraza' })).toEqual([]);
  });

  it('обычный перенос, CRLF и комментарий замечаний не дают', () => {
    expect(codes('SecRule ARGS "@rx ^a" \\\n    "id:1,phase:2,pass"')).toEqual([]);
    expect(codes('SecRule ARGS "@rx ^a" \\\r\n    "id:1,phase:2,pass"\r\n')).toEqual([]);
    // Комментарию продолжение не нужно: слэш с пробелом в нём — просто текст.
    const comment = '# path c:\\dir\\ \nSecAction "id:1,phase:1,pass"';
    expect(parse(comment).statements).toHaveLength(2);
    expect(codes(comment)).toEqual([]);
  });

  it('аргументы в одинарных кавычках читаются как в двойных', () => {
    const tree = parse("SecRule ARGS '@streq a b' 'id:1,phase:2,pass,t:lowercase'");
    const [statement] = tree.statements;
    expect(statement.kind).toBe('SecRule');
    if (statement.kind !== 'SecRule') return;
    expect(statement.operator?.name).toBe('streq');
    expect(statement.operator?.argument.value).toBe('a b');
    expect(statement.actions?.items.map((a) => a.name)).toEqual(['id', 'phase', 'pass', 't']);
  });
});

describe('проверки: оператор и его аргумент', () => {
  it('оператор, прочитанный как шаблон', () => {
    expect(codes(rule('ARGS', ' @contains admin', 't:lowercase'))).toEqual([
      'operatorReadAsPattern',
    ]);
    expect(codes(rule('ARGS', '!!@rx ^a'))).toEqual(['operatorReadAsPattern']);
    // Пробел после `!` движок пропускает сам.
    expect(codes(rule('ARGS', '! @rx ^a'))).toEqual([]);
    // Собака внутри шаблона — не оператор.
    expect(codes(rule('REQUEST_HEADERS:From', '^user@example\\.com$', 't:lowercase'))).toEqual([]);
  });

  it('макрос в аргументе: кто его раскроет', () => {
    expect(codes(rule('ARGS', '@pm admin %{tx.word}'))).toEqual(['macroNotExpanded']);
    expect(codes(rule('REMOTE_ADDR', '@ipMatch %{tx.ip}'))).toEqual(['macroNotExpanded']);
    expect(codes(rule('ARGS', '@rx ^%{tx.prefix}'))).toEqual([]);
    expect(codes(rule('ARGS', '@within %{tx.allowed}', 't:lowercase'))).toEqual([]);
  });

  it('ключ макроса через двоеточие читает только третья версия', () => {
    const source = action("msg:'%{REQUEST_HEADERS:Host}'");
    expect(codes(source)).toEqual(['macroKeySeparator']);
    expect(codes(source, { engine: 'coraza' })).toEqual(['macroKeySeparator']);
    expect(codes(source, { engine: 'modsecurity3' })).toEqual([]);
    expect(codes(action("msg:'%{REQUEST_HEADERS.Host}'"))).toEqual([]);
  });

  it('незнакомое имя в макросе', () => {
    expect(codes(action("msg:'%{REMOTE_ADR}'"))).toEqual(['unknownMacro']);
    expect(codes(action("msg:'%{rule.mgs}'"))).toEqual(['unknownMacro']);
    expect(codes(action("msg:'%{RULE.id} %{rule.msg} %{ENV.HOME} %{TIME_EPOCH}'"))).toEqual([]);
  });

  it('сравнение с тем, что не бывает отрицательным', () => {
    expect(codes(rule('&ARGS', '@ge 0'))).toEqual(['alwaysTrueComparison']);
    expect(codes(rule('&ARGS', '@lt 0'))).toEqual(['neverTrueComparison']);
    expect(codes(rule('&ARGS', '@eq -1'))).toEqual(['neverTrueComparison']);
    // Отрицание меняет их местами.
    expect(codes(rule('&ARGS', '!@ge 0'))).toEqual(['neverTrueComparison']);
    expect(codes(rule('&ARGS', '!@lt 0'))).toEqual(['alwaysTrueComparison']);
    // А это осмысленные проверки.
    expect(codes(rule('&ARGS', '@ge 1'))).toEqual([]);
    expect(codes(rule('&ARGS', '@gt 0'))).toEqual([]);
    expect(codes(rule('ARGS', '@lt 1', 't:length'))).toEqual([]);
  });

  it('два сравнения одной области в цепочке обязаны иметь общее решение', () => {
    const chain = (first: string, second: string, target = '&ARGS') =>
      `SecRule &ARGS "${first}" "id:1,phase:2,pass,chain"\n    SecRule ${target} "${second}"`;

    expect(codes(chain('@gt 10', '@lt 5'))).toEqual(['impossibleNumericRange']);
    expect(codes(chain('@eq 1', '@eq 2'))).toEqual(['impossibleNumericRange']);
    expect(codes(chain('@gt 5', '@lt 5'))).toEqual(['impossibleNumericRange']);

    expect(codes(chain('@gt 5', '@lt 7'))).toEqual([]);
    expect(codes(chain('@ge 5', '@le 5'))).toEqual([]);
    // Отрицание и другая область — уже не то же самое множество.
    expect(codes(chain('@gt 5', '!@gt 3'))).toEqual([]);
    expect(codes(chain('@gt 5', '@lt 3', '&ARGS_GET'))).toEqual([]);
  });

  it('буквальное сравнение без преобразований', () => {
    expect(codes(rule('ARGS', '@contains admin'))).toEqual(['noNormalisation']);
    // `t:none` — не преобразование.
    expect(codes(rule('ARGS', '@contains admin', 't:none'))).toEqual(['noNormalisation']);

    expect(codes(rule('ARGS', '@contains admin', 't:lowercase'))).toEqual([]);
    // Цифрам регистр не страшен, метод запроса клиент не кодирует.
    expect(codes(rule('ARGS', '@streq 123'))).toEqual([]);
    expect(codes(rule('REQUEST_METHOD', '@streq POST'))).toEqual([]);
    // «Всё, кроме этого слова» от чужого регистра только строже.
    expect(codes(rule('ARGS', '!@streq admin'))).toEqual([]);
    // Правило, которое не ловит, а пропускает: не узнав путь в чужом
    // регистре, оно просто не сработает. `ctl` может стоять и в звене.
    const path = '@endsWith /wp-admin/post.php';
    expect(codes(rule('REQUEST_FILENAME', path, 'nolog,ctl:ruleEngine=Off'))).toEqual([]);
    expect(
      codes(
        [
          `SecRule REQUEST_FILENAME "${path}" "id:1,phase:2,pass,nolog,chain"`,
          '    SecRule ARGS:action "@streq editpost" "ctl:ruleEngine=DetectionOnly"',
        ].join('\n'),
      ),
    ).toEqual([]);
    const jump = rule('REQUEST_FILENAME', '@endsWith /static/', 'nolog,skipAfter:END');
    expect(codes(`${jump}\nSecMarker END`)).toEqual([]);
    // Преобразование пришло из умолчаний.
    expect(
      codes(
        'SecDefaultAction "phase:2,log,pass,t:lowercase"\nSecRule ARGS "@contains admin" "id:1"',
        { codes: { defaultActionDeprecated: 'off' } },
      ),
    ).toEqual([]);
  });

  it('шаблон там, где ищут буквально', () => {
    const literal = (argument: string) => codes(rule('ARGS', `@contains ${argument}`, 't:lowercase'));

    expect(literal('\\d+')).toEqual(['literalWithRegexSyntax']);
    expect(literal('[a-z]+')).toEqual(['literalWithRegexSyntax']);
    expect(literal('[abc]*')).toEqual(['literalWithRegexSyntax']);
    expect(literal('.*admin')).toEqual(['literalWithRegexSyntax']);
    expect(codes(rule('REQUEST_URI', '@beginsWith ^/admin', 't:lowercase'))).toEqual([
      'literalWithRegexSyntax',
    ]);

    // Путь, скобки массива, вопрос, точка, тег — обычный текст.
    expect(literal('c:\\windows')).toEqual([]);
    expect(literal('\\system32')).toEqual([]);
    expect(literal('[abc]')).toEqual([]);
    expect(literal('what?')).toEqual([]);
    expect(literal('a.b')).toEqual([]);
    expect(literal('<script>alert(1)')).toEqual([]);
  });

  it('список адресов: пробел у запятой мешает ModSecurity и не мешает Coraza', () => {
    const spaced = rule('REMOTE_ADDR', '@ipMatch 10.0.0.1 , 10.0.0.2');
    expect(codes(spaced)).toEqual(['invalidIpEntry']);
    expect(codes(spaced, { engine: 'coraza' })).toEqual([]);

    expect(codes(rule('REMOTE_ADDR', '@ipMatch 10.0.0.0/8,192.168.0.0/16,::1'))).toEqual([]);
    for (const bad of ['10.0.0.0/33', '::1/129', '1.2.3', '10.0.0.1 10.0.0.2']) {
      expect(codes(rule('REMOTE_ADDR', `@ipMatch ${bad}`))).toEqual(['invalidIpEntry']);
    }
    // Запятую в конце списка движки пропускают.
    expect(codes(rule('REMOTE_ADDR', '@ipMatch 10.0.0.1,'))).toEqual([]);
  });

  it('список байтов: числа движок читает терпимо, границы — нет', () => {
    const range = (argument: string) => codes(rule('ARGS', `@validateByteRange ${argument}`));

    expect(range('9,10,13,32-126')).toEqual([]);
    expect(range('0-255')).toEqual([]);
    expect(range('32 - 126, 9')).toEqual([]);
    expect(range('126-32')).toEqual(['invalidByteRange']);
    expect(range('256')).toEqual(['invalidByteRange']);
    expect(range('a-z')).toEqual(['invalidByteRange']);
  });

  it('порядок преобразований: регистр до Base64 и проверка после раскодирования', () => {
    expect(codes(rule('ARGS', '@rx ^a', 't:none,t:lowercase,t:base64Decode'))).toEqual([
      'caseBeforeBase64',
    ]);
    expect(codes(rule('ARGS', '@rx ^a', 't:none,t:base64Decode,t:lowercase'))).toEqual([]);

    expect(
      codes('SecRule REQUEST_URI "@validateUrlEncoding" "id:1,phase:1,pass,t:none,t:urlDecodeUni"'),
    ).toEqual(['validateAfterDecode']);
    expect(codes('SecRule REQUEST_URI_RAW "@validateUrlEncoding" "id:1,phase:1,pass"')).toEqual([]);
  });
});

describe('проверка кодирования того, что движок уже раскодировал', () => {
  // Кто что раскодирует — сценарии `decode-…` стенда; верное `%25zz` после
  // раскодирования становится `%zz` и проверку не проходит.
  const validate = (target: string, phase: number, options: LintOptions = {}) =>
    lint(`SecRule ${target} "@validateUrlEncoding" "id:1,phase:${phase},pass"`, options)
      .filter((d) => d.code === 'validateDecodedInput')
      .map((d) => d.data?.engines);

  it('параметры раскодированы везде', () => {
    expect(validate('ARGS', 2)).toEqual(['ModSecurity 2, ModSecurity 3, Coraza']);
    expect(validate('ARGS_NAMES', 1, { engine: 'coraza' })).toEqual(['Coraza']);
  });

  it('то, что движок отдаёт как есть, проверять и нужно', () => {
    for (const target of ['REQUEST_URI_RAW', 'QUERY_STRING', 'REQUEST_BODY', 'REQUEST_COOKIES', 'REQUEST_HEADERS']) {
      expect({ target, found: validate(target, 2) }).toEqual({ target, found: [] });
    }
  });

  it('`REQUEST_URI`: третья версия раскодирует всегда, вторая — со второй фазы, Coraza — никогда', () => {
    expect(validate('REQUEST_URI', 1)).toEqual(['ModSecurity 3']);
    expect(validate('REQUEST_URI', 2)).toEqual(['ModSecurity 2, ModSecurity 3']);
    expect(validate('REQUEST_URI', 2, { engine: 'coraza' })).toEqual([]);
    expect(validate('REQUEST_URI', 1, { engine: 'modsecurity2' })).toEqual([]);
  });

  it('путь вторая версия до второй фазы не раскодирует', () => {
    expect(validate('REQUEST_FILENAME', 1)).toEqual(['ModSecurity 3, Coraza']);
    expect(validate('REQUEST_BASENAME', 2, { engine: 'modsecurity2' })).toEqual(['ModSecurity 2']);
  });

  it('замечание одно на условие и стоит на области проверки', () => {
    const source = 'SecRule ARGS|REQUEST_URI_RAW|ARGS_NAMES "@validateUrlEncoding" "id:1,phase:2,pass"';
    const found = lint(source).filter((d) => d.code === 'validateDecodedInput');
    expect(found).toHaveLength(1);
    expect(source.slice(found[0].start, found[0].end)).toBe('ARGS');
    // Вычитание и подсчёт значений не дают.
    expect(validate('!ARGS:a|REQUEST_URI_RAW', 2)).toEqual([]);
  });
});

describe('проверки: реакция и захват', () => {
  it('о реакции молчим там, где причина названа иначе', () => {
    expect(codes('SecRule ARGS "@rx ^a" "id:1,phase:2,log"')).toEqual(['noDisruptive']);
    // Реакция пришла из умолчаний.
    expect(codes('SecDefaultAction "phase:2,log,pass"\nSecRule ARGS "@rx ^a" "id:1"')).toEqual([]);
    // Списка действий нет вовсе — об этом уже сказано.
    expect(codes('SecRule ARGS "@rx ^a"')).not.toContain('noDisruptive');
    // Реакция записана в звене — и об этом тоже.
    const misplaced = 'SecRule ARGS "@rx ^a" "id:1,phase:2,chain"\n    SecRule ARGS "@rx b$" "deny"';
    expect(codes(misplaced)).toEqual(['chainLinkHeadAction']);
  });

  it('сообщение у блокирующего правила', () => {
    expect(codes('SecRule ARGS "@rx ^a" "id:1,phase:2,deny"')).toEqual(['blockWithoutMsg']);
    expect(codes("SecRule ARGS \"@rx ^a\" \"id:1,phase:2,deny,msg:'m'\"")).toEqual([]);
    expect(codes('SecRule ARGS "@rx ^a" "id:1,phase:2,pass"')).toEqual([]);
    // Пустое сообщение — другая ошибка; «его нет» было бы неправдой.
    expect(codes('SecRule ARGS "@rx ^a" "id:1,phase:2,deny,msg"')).toEqual(['actionValueRequired']);
  });

  it('код ответа, фаза журнала и молчаливая блокировка', () => {
    const reaction = (actions: string) => codes(`SecRule ARGS "@rx ^a" "id:1,${actions}"`);

    expect(reaction('phase:2,pass,status:404')).toEqual(['statusWithoutBlock']);
    expect(reaction("phase:2,drop,status:403,msg:'m'")).toEqual(['statusWithoutBlock']);
    expect(reaction("phase:2,block,status:403,msg:'m'")).toEqual([]);
    expect(reaction("phase:2,redirect:http://example.com/,status:302,msg:'m'")).toEqual([]);

    expect(reaction("phase:5,deny,msg:'m'")).toEqual(['disruptiveInLoggingPhase']);
    expect(reaction("phase:logging,drop,msg:'m'")).toEqual(['disruptiveInLoggingPhase']);
    expect(reaction('phase:5,pass')).toEqual([]);

    expect(reaction("phase:2,deny,nolog,msg:'m'")).toEqual(['blockWithoutLog']);
    expect(reaction("phase:2,pass,nolog,logdata:'%{MATCHED_VAR}'")).toEqual(['logdataWithoutLog']);
  });

  it('захват: умеет ли оператор и читает ли кто-нибудь', () => {
    const logged = (operator: string) =>
      codes(`SecRule ARGS "${operator}" "id:1,phase:2,pass,capture,t:lowercase,logdata:'%{TX.0}'"`);

    expect(logged('@rx ^a')).toEqual([]);
    expect(logged('@pm a b')).toEqual([]);
    expect(logged('@detectSQLi')).toEqual([]);
    expect(logged('@streq admin')).toEqual(['captureWithoutRegex']);

    expect(codes(rule('ARGS', '@rx ^(a)', 'capture'))).toEqual(['captureUnused']);
    expect(codes(rule('ARGS', '@rx ^(a)', 'capture,setvar:tx.x=%{TX.1}'))).toEqual([]);
    // Читает другое звено той же цепочки.
    expect(
      codes('SecRule ARGS "@rx ^(a)" "id:1,phase:2,pass,capture,chain"\n    SecRule TX:1 "@streq a"'),
    ).toEqual([]);
  });

  it('группа, которую читает сам шаблон, не лишняя', () => {
    expect(codes(rule('ARGS', '@rx (a)b'))).toEqual(['capturingGroupUnused']);
    expect(codes(rule('ARGS', "@rx (['\\\"])[^'\\\"]*\\1"))).toEqual([]);
    expect(codes(rule('ARGS', '@rx (?P<q>a)b(?P=q)'))).toEqual([]);
  });

  it('счётчик в голове цепочки', () => {
    const chain = (head: string, link = '') =>
      `SecRule ARGS "@rx ^a" "id:1,phase:2,pass,${head}chain"\n    SecRule ARGS "@rx b$"${link}`;

    expect(codes(chain('setvar:tx.score=+5,'))).toEqual(['setvarInChainHead']);
    // Обычное присваивание — способ передать значение следующему звену.
    expect(codes(chain('setvar:tx.seen=1,'))).toEqual([]);
    expect(codes(chain('', ' "setvar:tx.score=+5"'))).toEqual([]);
    // Без цепочки вопроса нет.
    expect(codes(rule('ARGS', '@rx ^a', 'setvar:tx.score=+5'))).toEqual([]);
  });

  it('номер из диапазона CRS — совет для чужих правил, но не для самого CRS', () => {
    expect(codes('SecRule ARGS "@rx ^a" "id:942999,phase:2,pass"')).toEqual(['idInReservedRange']);
    expect(
      codes("SecRule ARGS \"@rx ^a\" \"id:942999,phase:2,pass,ver:'OWASP_CRS/4.0.0'\""),
    ).toEqual([]);
  });
});

describe('проверки: исключения', () => {
  const tagged = "SecRule ARGS \"@rx ^a\" \"id:5001,phase:2,pass,tag:'attack-sqli'\"";
  const other = "SecRule ARGS \"@rx ^b\" \"id:5002,phase:2,pass,tag:'attack-xss'\"";

  it('выборка по тегу: шаблон для второй версии, строка для остальных', () => {
    const exact = `${tagged}\nSecRuleRemoveByTag "attack-sqli"`;
    expect(codes(exact)).toEqual([]);
    expect(codes(exact, { engine: 'modsecurity3' })).toEqual([]);

    const pattern = `${tagged}\nSecRuleRemoveByTag "^attack-"`;
    expect(codes(pattern)).toEqual(['exclusionPatternNotPortable']);
    expect(codes(pattern, { engine: 'modsecurity2' })).toEqual([]);
    expect(codes(pattern, { engine: 'coraza' })).toEqual(['exclusionPatternNotPortable']);

    // Без единого спецсимвола — и всё равно читается по-разному: вторая
    // версия найдёт `attack` внутри обоих тегов, остальные — ни в одном.
    const partial = `${tagged}\n${other}\nSecRuleRemoveByTag "attack"`;
    expect(codes(partial)).toEqual(['exclusionPatternNotPortable']);
    expect(codes(partial, { engine: 'modsecurity2' })).toEqual([]);
  });

  it('шаблон, который не собрать, — ошибка только там, где это шаблон', () => {
    const broken = `${tagged}\nSecRuleRemoveByTag "(unclosed"`;
    const found = lint(broken);
    expect(found.map((d) => [d.code, d.severity])).toEqual([['exclusionBadPattern', 'error']]);
    expect(codes(broken, { engine: 'modsecurity3' })).toEqual(['exclusionPatternNotPortable']);
  });

  it('порядок: директива — ниже цели, ctl — раньше неё', () => {
    const target = 'SecRule ARGS "@rx ^a" "id:5001,phase:2,pass"';
    const ctl = (phase: number) =>
      `SecRule REQUEST_URI "@rx ^/a" "id:5002,phase:${phase},pass,nolog,ctl:ruleRemoveById=5001"`;

    expect(codes(`${target}\nSecRuleRemoveById 5001`)).toEqual([]);
    expect(codes(`SecRuleRemoveById 5001\n${target}`)).toEqual(['exclusionBeforeRule']);

    expect(codes(`${ctl(1)}\n${target}`)).toEqual([]);
    // Строка ниже, но фаза раньше — этого достаточно.
    expect(codes(`${target}\n${ctl(1)}`)).toEqual([]);
    expect(codes(`${target}\n${ctl(2)}`)).toEqual(['exclusionCtlAfterRule']);
  });

  it('между файлами: директива в файле, который читают раньше правила', () => {
    const files = [
      { name: 'before.conf', source: 'SecRuleRemoveById 5001' },
      { name: 'rules.conf', source: 'SecRule ARGS "@rx ^a" "id:5001,phase:2,pass"' },
      { name: 'after.conf', source: 'SecRuleUpdateTargetById 5001 "!ARGS:x"' },
    ];
    const result = lintWorkspace(files);
    expect(result.map((file) => file.diagnostics.map((d) => d.code))).toEqual([
      ['exclusionInEarlierFile'],
      [],
      [],
    ]);
    expect(result[0].diagnostics[0].data).toMatchObject({ id: '5001', file: 'rules.conf' });
  });

  it('правило, снимающее диапазон вместе с собой, само себе не цель', () => {
    const source = [
      'SecRule ARGS "@rx ^a" "id:5003,phase:2,pass"',
      'SecAction "id:5001,phase:1,pass,nolog,ctl:ruleRemoveById=5001-5005"',
    ].join('\n');
    expect(codes(source)).toEqual([]);
  });

  it('о промахе говорим, только когда видно, что набор загружен', () => {
    // Номер из набора, которого здесь нет: надстройка над чужими правилами.
    expect(codes('SecRuleRemoveById 942100')).toEqual([]);
    // Соседи по тысяче загружены — значит, правила действительно нет.
    expect(codes('SecRule ARGS "@rx ^a" "id:5001,phase:2,pass"\nSecRuleRemoveById 5999')).toEqual([
      'exclusionNoMatch',
    ]);
  });

  it('огромный диапазон не перебирается по одному', () => {
    const source = 'SecRule ARGS "@rx ^a" "id:5001,phase:2,pass"\nSecRuleRemoveById 6000-4294967295';
    const started = performance.now();
    expect(codes(source)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('проверки: окружение', () => {
  const initcol = 'SecAction "id:1,phase:1,pass,nolog,initcol:ip=%{REMOTE_ADDR},setvar:ip.hits=+1"';
  const only = (source: string, options: LintOptions = {}) =>
    lint(source, { ...options, codes: { txNeverSet: 'off' } }).map((d) => d.code);

  it('каталог для коллекций нужен второй версии — и один раз на файл', () => {
    expect(only(initcol)).toEqual(['persistentWithoutDataDir']);
    expect(only(`${initcol}\n${initcol.replace('id:1', 'id:2')}`)).toEqual([
      'persistentWithoutDataDir',
    ]);
    expect(only(`SecDataDir /var/cache/modsecurity\n${initcol}`)).toEqual([]);
    expect(only(initcol, { engine: 'modsecurity3' })).toEqual([]);
  });

  it('каталог может быть задан в соседнем файле', () => {
    const result = lintWorkspace([
      { name: 'rules.conf', source: initcol },
      { name: 'server.conf', source: 'SecDataDir /var/cache/modsecurity' },
    ]);
    expect(result.map((file) => file.diagnostics.map((d) => d.code))).toEqual([[], []]);
  });

  it('база для @geoLookup', () => {
    const lookup = 'SecRule REMOTE_ADDR "@geoLookup" "id:1,phase:1,pass"';
    expect(only(lookup)).toEqual(['geoLookupWithoutDb']);
    expect(only(`SecGeoLookupDb /usr/share/GeoIP/GeoLite2-Country.mmdb\n${lookup}`)).toEqual([]);
  });

  it('тело запроса выключено — и не включено обратно через ctl', () => {
    const body = 'SecRule REQUEST_BODY "@rx ^a" "id:1,phase:2,pass"';
    expect(only(`SecRequestBodyAccess Off\n${body}`)).toEqual(['requestBodyAccessOff']);
    // Тело читается — но ошибку разбора не читает никто.
    expect(only(`SecRequestBodyAccess On\n${body}`)).toEqual(['bodyErrorUnchecked']);
    expect(only(body)).toEqual([]);
    const reopened = 'SecAction "id:2,phase:1,pass,nolog,ctl:requestBodyAccess=On"';
    expect(only(`SecRequestBodyAccess Off\n${reopened}\n${body}`)).toEqual([]);
  });

  it('значения директив', () => {
    expect(only('SecRuleEngine Offf')).toEqual(['directiveBadValue']);
    expect(only('SecRequestBodyAccess on')).toEqual(['bodyErrorUnchecked']);
    expect(only('SecRequestBodyLimit abc')).toEqual(['directiveNotNumber']);
    expect(only('SecAuditLogParts ABIJDEFHZ')).toEqual([]);
    expect(only('SecAuditLogParts ABXZ')).toEqual(['directiveUnknownFlag']);
    expect(only('SecDebugLogLevel 9')).toEqual([]);
    expect(only('SecDebugLogLevel 12')).toEqual(['directiveBadValue']);
    expect(only('SecAuditEngine')).toEqual(['directiveValueMissing']);
    expect(only('SecAuditEngine RelevantOnly Off')).toEqual(['directiveArgCount']);
    // Директива со списком значений принимает их сколько угодно.
    expect(only('SecResponseBodyMimeType text/plain text/html text/xml')).toEqual([]);
  });
});

describe('проверки: пометки линтера', () => {
  const bad = 'SecRule ARGS "@contains admin" "id:1,phase:2,pass"';

  it('опечатка в коде и пометка, которой нечего снимать', () => {
    expect(lint(`# seclang-ignore: noNormalization\n${bad}`).map((d) => d.code)).toEqual([
      'unknownIgnoreCode',
      'unusedIgnore',
      'noNormalisation',
    ]);
    expect(lint(`# seclang-ignore: caseNeverMatches\n${bad}`).map((d) => d.code)).toEqual([
      'unusedIgnore',
      'noNormalisation',
    ]);
    expect(lint(`# seclang-ignore: noNormalisation\n${bad}`)).toEqual([]);
  });

  it('при суженной проверке о лишних пометках судить нельзя', () => {
    // Замечание, ради которого пометка стоит, могло быть выключено настройкой.
    const source = `# seclang-ignore: noNormalisation\n${bad}`;
    expect(lint(source, { codes: { noNormalisation: 'off' } })).toEqual([]);
    expect(lint(source, { minSeverity: 'error' })).toEqual([]);
  });
});

describe('проверки: шаблоны глазами RE2', () => {
  it('то, чего в регулярных выражениях Go нет', () => {
    expect(regexFeatures('a\\Kb')).toEqual(['escape']);
    expect(regexFeatures('a\\h+\\R')).toEqual(['escape']);
    expect(regexFeatures('end\\Z')).toEqual(['escape']);
    expect(regexFeatures('(?#note)a')).toEqual(['comment']);
    expect(regexFeatures('(?x) a b')).toEqual(['flag']);
    expect(regexFeatures("(?'name'a)")).toEqual(['quotedName']);
    expect(regexFeatures('a{1001}')).toEqual(['largeRepeat']);
    expect(regexFeatures('a{1,2000}')).toEqual(['largeRepeat']);
  });

  it('и то, что там есть', () => {
    const fine = [
      '(?i)(?:a|b)\\s+',
      '(?i:a)(?s).',
      '(?U)a+',
      '\\x{20ac}[[:alpha:]]{1,10}\\z',
      '\\Qa.b\\E',
      '(?P<name>a)',
      '(?<name>a)',
      'a{1000}',
      // В классе символов скобки и вопросы — обычные знаки.
      '[(?#x)]\\\\K',
    ];
    for (const pattern of fine) expect(regexFeatures(pattern)).toEqual([]);
  });

  it('замечание о несовместимости называет причину словами', () => {
    const found = lint(rule('ARGS', '@rx end\\Z'), { engine: 'coraza' });
    expect(found.map((d) => d.code)).toEqual(['regexNotInEngine']);
    expect(found[0].message).toContain('\\Z');
    expect(lint(rule('ARGS', '@rx end\\Z'), { engine: 'modsecurity3' })).toEqual([]);
  });
});
