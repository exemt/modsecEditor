import { CODES, expandsMacros, lint, lintWorkspace, refusedBy, refuses } from '../index';
import type { Diagnostic, Engine, LintOptions } from '../index';
import { hasAmbiguousBackslashes } from './checks/regex';

/**
 * Уровень замечания следует вердикту движков.
 *
 * «Не загрузится» — вопрос к конкретному движку, и ответы у них разные.
 * Здесь проверяется сам механизм (`refusedBy`) и проверки, появившиеся
 * после сверки с настоящими движками. Что именно движки грузят, а что нет,
 * записано стендом и сверяется в `stand.test.ts`; этот файл — о том, как
 * линтер этим знанием пользуется.
 */

const QUIET = { txNeverSet: 'off', persistentWithoutDataDir: 'off' } as const;

function found(source: string, options: LintOptions = {}): Diagnostic[] {
  return lint(source, { ...options, codes: { ...QUIET, ...options.codes } });
}

function levels(source: string, options: LintOptions = {}): Array<[string, string]> {
  return found(source, options).map((d) => [d.code, d.severity]);
}

function codes(source: string, options: LintOptions = {}): string[] {
  return found(source, options).map((d) => d.code);
}

const ENGINES: Engine[] = ['modsecurity2', 'modsecurity3', 'coraza'];

describe('отказ движков: уровень замечания', () => {
  it('движок назван — решает он один', () => {
    // `&` у переменной, которая не коллекция: вторая версия не грузит,
    // остальные принимают.
    const scalar = 'SecRule &REQUEST_METHOD "@eq 1" "id:1,phase:1,pass"';
    expect(levels(scalar, { engine: 'modsecurity2' })).toEqual([['countOnScalar', 'error']]);
    expect(levels(scalar, { engine: 'modsecurity3' })).toEqual([['countOnScalar', 'warning']]);
    expect(levels(scalar, { engine: 'coraza' })).toEqual([['countOnScalar', 'warning']]);
  });

  it('движок не назван — ошибка, если не грузят хотя бы двое', () => {
    // Один несогласный движок — различие, а не ошибка.
    expect(levels('SecRule &REQUEST_METHOD "@eq 1" "id:1,phase:1,pass"')).toEqual([
      ['countOnScalar', 'warning'],
    ]);
    // Двое из трёх.
    expect(levels('SecRuleRemoveById 9-1')).toEqual([['exclusionEmptyRange', 'error']]);
    // Все трое.
    expect(levels('SecRule ARGZ "@rx ^a\\d" "id:1,phase:2,pass"')).toEqual([
      ['unknownVariable', 'error'],
    ]);
  });

  it('список движков виден в самом замечании', () => {
    const [diagnostic] = found('SecRuleRemoveById 9-1');
    expect(diagnostic.refusedBy).toEqual(['modsecurity3', 'coraza']);
    // Замечание, с которым правило грузится везде, поля не несёт.
    const [advice] = found('SecRule REQUEST_METHOD "@rx ^TRACE$" "id:1,phase:1,pass"');
    expect(advice.code).toBe('anchoredLiteralRegex');
    expect(advice.refusedBy).toBeUndefined();
  });

  it('уровень, назначенный человеком, сильнее отказа движков', () => {
    const source = 'SecRule ARGZ "@rx ^a\\d" "id:1,phase:2,pass"';
    expect(levels(source, { codes: { unknownVariable: 'advice' } })).toEqual([
      ['unknownVariable', 'advice'],
    ]);
    expect(levels(source, { topics: { structure: 'warning' } })).toEqual([['unknownVariable', 'warning']]);
    expect(levels(source, { codes: { unknownVariable: 'off' } })).toEqual([]);
  });

  it('порог применяется к итоговому уровню', () => {
    // В словаре это предупреждение — но грузить его не станет никто.
    const source = 'SecRule ARGZ "@rx ^a\\d" "id:1,phase:2,pass"';
    expect(CODES.unknownVariable.severity).toBe('warning');
    expect(codes(source, { minSeverity: 'error' })).toEqual(['unknownVariable']);
    // А это предупреждение для одного движка и ошибка для другого.
    const scalar = 'SecRule &REQUEST_METHOD "@eq 1" "id:1,phase:1,pass"';
    expect(codes(scalar, { minSeverity: 'error', engine: 'coraza' })).toEqual([]);
    expect(codes(scalar, { minSeverity: 'error', engine: 'modsecurity2' })).toEqual(['countOnScalar']);
  });

  it('под одним кодом — случаи с разным исходом', () => {
    const severity = (value: string, engine: Engine) =>
      found(`SecAction "id:1,phase:1,pass,nolog,severity:${value}"`, { engine }).map((d) => d.severity);
    // Незнакомое слово: вторая версия читает как «авария», остальные не грузят.
    expect(ENGINES.map((engine) => severity('banana', engine))).toEqual([['warning'], ['error'], ['error']]);
    // Число вне шкалы не грузит только Coraza.
    expect(ENGINES.map((engine) => severity('8', engine))).toEqual([['warning'], ['warning'], ['error']]);
  });

  it('словарь и вспомогательные функции согласованы', () => {
    expect(refusedBy('unknownVariable')).toEqual(ENGINES);
    expect(refusedBy('caseNeverMatches')).toEqual([]);
    expect(refuses(['modsecurity2'], undefined)).toBe(false);
    expect(refuses(['modsecurity2', 'coraza'], undefined)).toBe(true);
    expect(refuses(['modsecurity2'], 'modsecurity2')).toBe(true);
    expect(refuses(['modsecurity2'], 'coraza')).toBe(false);
  });
});

describe('отказ движков: кавычки вокруг аргументов', () => {
  it('оператор и действия без двойных кавычек читает только вторая версия', () => {
    const bare = 'SecRule ARGS "@rx ^a\\d" id:1,phase:2,pass';
    expect(levels(bare)).toEqual([['unquotedArgument', 'error']]);
    expect(levels(bare, { engine: 'modsecurity2' })).toEqual([['unquotedArgument', 'warning']]);

    expect(codes("SecRule ARGS '@rx ^a\\d' 'id:1,phase:2,pass'")).toEqual(['unquotedArgument']);
    expect(codes('SecAction id:1,phase:1,pass,nolog')).toEqual(['unquotedArgument']);
    expect(codes('SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass"')).toEqual([]);
  });

  it('список областей в кавычках не читает Coraza', () => {
    const quoted = 'SecRule "ARGS|ARGS_NAMES" "@rx ^a\\d" "id:1,phase:2,pass"';
    expect(levels(quoted)).toEqual([['quotedTargets', 'warning']]);
    expect(levels(quoted, { engine: 'coraza' })).toEqual([['quotedTargets', 'error']]);
    // Параметр с пробелом иначе не записать: о нём говорит своя проверка.
    expect(codes('SecRule "ARGS:\'my param\'" "@rx ^a\\d" "id:1,phase:2,pass"')).toEqual([
      'selectorNeedsQuotes',
    ]);
  });
});

describe('отказ движков: списки', () => {
  it('пустой элемент в списке областей', () => {
    const rule = (variables: string) => `SecRule ${variables} "@rx ^a\\d" "id:1,phase:2,pass"`;
    // Две черты подряд не грузит никто, черту с краю — третья версия.
    expect(found(rule('ARGS||ARGS_NAMES'))[0]).toMatchObject({ code: 'emptyTarget', severity: 'error' });
    expect(found(rule('ARGS||ARGS_NAMES'))[0].refusedBy).toEqual(ENGINES);
    expect(levels(rule('ARGS|'))).toEqual([['emptyTarget', 'warning']]);
    expect(levels(rule('ARGS|'), { engine: 'modsecurity3' })).toEqual([['emptyTarget', 'error']]);
    expect(codes(rule('ARGS|ARGS_NAMES'))).toEqual([]);
  });

  it('запятая между областями', () => {
    const source = 'SecRule ARGS,ARGS_NAMES "@rx ^a\\d" "id:1,phase:2,pass"';
    expect(levels(source)).toEqual([['targetsCommaSeparated', 'warning']]);
    expect(levels(source, { engine: 'coraza' })).toEqual([['targetsCommaSeparated', 'error']]);
    // Запятая внутри параметра в кавычках — часть параметра.
    expect(codes("SecRule ARGS:'a,b'|ARGS_NAMES \"@rx ^a\\d\" \"id:1,phase:2,pass\"")).not.toContain(
      'targetsCommaSeparated',
    );
  });

  it('пустой элемент в списке действий', () => {
    const rule = (actions: string) => `SecRule ARGS "@rx ^a\\d" "${actions}"`;
    expect(codes(rule('id:1,phase:2,pass,'))).toEqual(['emptyAction']);
    expect(codes(rule('id:1,,phase:2,pass'))).toEqual(['emptyAction']);
    // Пробелы вокруг запятых — не пустой элемент.
    expect(codes(rule('id:1 , phase:2 , pass'))).toEqual([]);
    expect(levels(rule('id:1,phase:2,pass,'), { engine: 'modsecurity2' })).toEqual([
      ['emptyAction', 'warning'],
    ]);
    // Перенос после запятой — обычная запись CRS.
    expect(codes('SecRule ARGS "@rx ^a\\d" "id:1,\\\n    phase:2,\\\n    pass"')).toEqual([]);
  });

  it('значение без кавычек кончается на пробеле или черте', () => {
    const rule = (action: string) => `SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,log,${action}"`;
    expect(levels(rule('msg:two words'), { engine: 'modsecurity2' })).toEqual([
      ['unquotedValueBreak', 'error'],
    ]);
    expect(codes(rule('msg:a|b'))).toEqual(['unquotedValueBreak']);
    expect(codes(rule('msg:word'))).toEqual([]);
    expect(codes(rule("msg:'two words'"))).toEqual([]);
    // У `ctl` своя история с чертой, и о ней говорит проверка исключений.
    expect(codes(rule('ctl:auditEngine=Off'))).toEqual([]);
  });
});

describe('отказ движков: цепочка', () => {
  it('звено без действий третья версия принимает только перед пустой строкой', () => {
    const head = 'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,chain"';
    const link = '    SecRule REQUEST_METHOD "@rx ^P"';
    const next = 'SecAction "id:2,phase:2,pass,nolog"';

    expect(codes(`${head}\n${link}\n${next}`)).toEqual(['linkWithoutActions']);
    expect(codes(`${head}\n${link}\n# комментарий\n${next}`)).toEqual(['linkWithoutActions']);
    // Пустая строка или конец файла — и вопроса нет.
    expect(codes(`${head}\n${link}\n\n${next}`)).toEqual([]);
    expect(codes(`${head}\n${link}`)).toEqual([]);
    expect(codes(`${head}\n${link}\n`)).toEqual([]);
    expect(codes(`${head}\n${link} "t:none"\n${next}`)).toEqual([]);
  });

  it('реакцию в звене не грузит никто, номер и сообщение — только вторая версия', () => {
    const chain = (linkActions: string) =>
      `SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,log,chain"\n    SecRule ARGS "@rx b\\d$" "${linkActions}"`;
    const refused = (linkActions: string) =>
      found(chain(linkActions)).find((d) => d.code === 'chainLinkHeadAction')?.refusedBy;

    expect(refused('deny')).toEqual(ENGINES);
    expect(refused("msg:'x'")).toEqual(['modsecurity2']);
    expect(refused('id:2')).toEqual(['modsecurity2']);
  });
});

describe('отказ движков: оператор', () => {
  it('Coraza сравнивает имена операторов буква в букву', () => {
    const rule = (operator: string) => `SecRule ARGS "${operator}" "id:1,phase:2,pass,t:lowercase"`;
    expect(codes(rule('@RX ^a\\d'))).toEqual([]);
    expect(levels(rule('@RX ^a\\d'), { engine: 'coraza' })).toEqual([['operatorCase', 'error']]);
    expect(codes(rule('@beginswith /admin'), { engine: 'coraza' })).toEqual(['operatorCase']);
    expect(codes(rule('@beginsWith /admin'), { engine: 'coraza' })).toEqual([]);
    expect(found(rule('@detectsqli'), { engine: 'coraza' })[0].data).toMatchObject({
      name: 'detectsqli',
      canonical: 'detectSQLi',
    });
  });

  it('макрос в шаблоне: ModSecurity раскроет, Coraza — нет', () => {
    const source = [
      'SecAction "id:1,phase:1,pass,nolog,setvar:tx.word=abc"',
      'SecRule ARGS "@rx ^%{tx.word}$" "id:2,phase:2,pass"',
    ].join('\n');
    expect(codes(source)).toEqual([]);
    expect(codes(source, { engine: 'modsecurity3' })).toEqual([]);
    expect(codes(source, { engine: 'coraza' })).toEqual(['macroNotExpanded']);
    // В сравнении строк макрос раскрывают все.
    expect(codes(source.replace('@rx ^%{tx.word}$', '@streq %{tx.word}'), { engine: 'coraza' })).toEqual(
      ['noNormalisation'].filter(() => false),
    );

    expect(expandsMacros('coraza', 'rx', true)).toBe(false);
    expect(expandsMacros('coraza', 'streq', true)).toBe(true);
    expect(expandsMacros(undefined, 'rx', true)).toBe(true);
    expect(expandsMacros('modsecurity2', 'pm', false)).toBe(false);
  });

  it('макрос на месте адреса вторая версия не грузит', () => {
    const [diagnostic] = found('SecRule REMOTE_ADDR "@ipMatch %{tx.ip}" "id:1,phase:1,pass"');
    expect(diagnostic.code).toBe('macroNotExpanded');
    expect(diagnostic.refusedBy).toEqual(['modsecurity2']);
  });

  it('пустой аргумент: кто что принимает', () => {
    const refused = (operator: string) =>
      found(`SecRule ARGS "${operator}" "id:1,phase:2,pass"`).find(
        (d) => d.code === 'operatorArgumentRequired',
      )?.refusedBy;
    expect(refused('')).toEqual(['modsecurity2', 'modsecurity3']);
    expect(refused('@rx')).toEqual(['modsecurity3']);
    expect(refused('@streq')).toEqual(['modsecurity3', 'coraza']);
  });
});

describe('отказ движков: шаблоны', () => {
  it('символ с кодом выше \\xff ModSecurity не собирает', () => {
    const rule = (pattern: string) => `SecRule ARGS "@rx ${pattern}" "id:1,phase:2,pass"`;
    expect(levels(rule('^a\\x{20ac}'))).toEqual([['wideCodePoint', 'error']]);
    expect(levels(rule('^a\\x{20ac}'), { engine: 'coraza' })).toEqual([['wideCodePoint', 'warning']]);
    expect(codes(rule('^a[\\x7f-\\x{ff}]'))).toEqual([]);
    expect(codes(rule('^a\\xff\\d'))).toEqual([]);
  });

  it('ссылка на группу, которой нет', () => {
    const rule = (pattern: string) => `SecRule ARGS "@rx ${pattern}" "id:1,phase:2,pass"`;
    expect(codes(rule('^a\\1'))).toEqual(['invalidRegex']);
    expect(codes(rule('^(a)\\2'))).toContain('invalidRegex');
    expect(codes(rule('^(a)\\1'))).not.toContain('invalidRegex');
    expect(codes(rule('^(?P<q>a)\\1'))).not.toContain('invalidRegex');
    // В классе символов `\1` — код символа, а не ссылка.
    expect(codes(rule('^a[\\1]+'))).toEqual([]);
  });

  it('пара слэшей: когда движки прочитают её по-разному', () => {
    // Вне класса: число буквальных слэшей расходится либо меняется смысл
    // следующего символа.
    expect(hasAmbiguousBackslashes('^a\\\\d$')).toBe(true);
    expect(hasAmbiguousBackslashes('[a-z]:\\\\\\\\inetpub')).toBe(true);
    expect(hasAmbiguousBackslashes('a\\\\.b')).toBe(true);
    // В классе: слэш либо есть у всех, либо нет.
    expect(hasAmbiguousBackslashes('[\\\\/]')).toBe(true);
    expect(hasAmbiguousBackslashes('[\\\\\\\\]')).toBe(false);
    expect(hasAmbiguousBackslashes('[=\\\\\\(\\[\\.<]')).toBe(false);
    // Одиночные слэши свёртка не трогает.
    expect(hasAmbiguousBackslashes('^\\d+\\.\\w$')).toBe(false);
    expect(hasAmbiguousBackslashes('^a\\x5c\\d$')).toBe(false);
  });

  it('о паре слэшей говорим, пока движок не назван', () => {
    const source = 'SecRule ARGS "@rx ^a\\\\d+$" "id:1,phase:2,pass"';
    expect(codes(source)).toEqual(['backslashPair']);
    // Для одного движка запись однозначна.
    for (const engine of ENGINES) expect(codes(source, { engine })).not.toContain('backslashPair');
  });

  it('вторая версия видит шаблон уже со свёрнутыми слэшами', () => {
    // `\\1` для неё — ссылка на группу, которой нет; для остальных — слэш и единица.
    const source = 'SecRule ARGS "@rx ^a\\\\1" "id:1,phase:2,pass"';
    expect(codes(source, { engine: 'modsecurity2' })).toEqual(['invalidRegex']);
    expect(codes(source, { engine: 'modsecurity3' })).toEqual([]);
  });

  it('шаблон директивы для Coraza — тоже шаблон Go', () => {
    const source = 'SecAuditLogRelevantStatus "^(?:5|4(?!04))"';
    expect(codes(source, { engine: 'coraza' })).toEqual(['regexNotInEngine']);
    expect(codes(source, { engine: 'modsecurity3' })).toEqual([]);
    expect(codes('SecAuditLogRelevantStatus "^(?:(5|4)(0|1)[0-9])$"', { engine: 'coraza' })).toEqual([]);
  });
});

describe('отказ движков: чего в движке нет', () => {
  it('замечание о несовместимости — ошибка: движок такое не грузит', () => {
    // `t:uppercase` появился в третьей версии; вторая его не знает.
    const source = 'SecRule ARGS "@rx ^\\d+$" "id:1,phase:2,pass,t:uppercase"';
    expect(levels(source, { engine: 'modsecurity2' })).toEqual([['notInEngine', 'error']]);
    expect(codes(source, { engine: 'modsecurity3' })).toEqual([]);
    expect(codes(source, { engine: 'coraza' })).toEqual([]);
  });

  it('Coraza пишет только в TX и не знает долгоживущих коллекций', () => {
    const source = 'SecAction "id:1,phase:1,pass,nolog,initcol:ip=%{REMOTE_ADDR},setvar:ip.hits=+1"';
    expect(codes(source, { engine: 'coraza' })).toEqual(['notInEngine']);
    expect(found(source, { engine: 'coraza' })[0].data).toMatchObject({
      kind: 'Writing to collection',
      name: 'ip',
    });
    expect(codes('SecAction "id:1,phase:1,pass,nolog,setvar:tx.hits=+1"', { engine: 'coraza' })).toEqual([]);
    expect(codes('SecRule IP:hits "@gt 5" "id:1,phase:1,pass"', { engine: 'coraza' })).toContain(
      'notInEngine',
    );
  });

  it('блоки Apache понимает только Apache', () => {
    const source = '<IfModule security2_module>\n    SecRuleEngine On\n</IfModule>';
    expect(codes(source)).toEqual([]);
    expect(codes(source, { engine: 'modsecurity2' })).toEqual([]);
    expect(levels(source, { engine: 'modsecurity3' })).toEqual([['notInEngine', 'error']]);
    expect(codes(source, { engine: 'coraza' })).toEqual(['notInEngine']);
  });

  it('переменная в макросе: третья версия и Coraza проверяют её при загрузке', () => {
    const source = "SecAction \"id:1,phase:1,pass,log,msg:'%{WEBSERVER_ERROR_LOG}'\"";
    expect(codes(source, { engine: 'modsecurity3' })).toEqual(['notInEngine']);
    expect(codes(source, { engine: 'modsecurity2' })).toEqual([]);
  });

  it('преобразование в умолчаниях Coraza не принимает', () => {
    const [diagnostic] = found('SecDefaultAction "phase:2,log,pass,t:lowercase"', { engine: 'coraza' });
    expect(diagnostic).toMatchObject({ code: 'defaultActionDeprecated', severity: 'error' });
    expect(levels('SecDefaultAction "phase:2,log,pass,t:lowercase"', { engine: 'modsecurity2' })).toEqual([
      ['defaultActionDeprecated', 'advice'],
    ]);
  });
});

describe('отказ движков: исключения', () => {
  const rule = 'SecRule ARGS "@rx ^a\\d" "id:5001,phase:2,pass"';

  it('третьей версии порядок директивы и правила безразличен', () => {
    const before = `SecRuleRemoveById 5001\n${rule}`;
    expect(codes(before)).toEqual(['exclusionBeforeRule']);
    expect(codes(before, { engine: 'modsecurity2' })).toEqual(['exclusionBeforeRule']);
    expect(codes(before, { engine: 'modsecurity3' })).toEqual([]);
  });

  it('то же между файлами', () => {
    const files = [
      { name: 'before.conf', source: 'SecRuleRemoveById 5001' },
      { name: 'rules.conf', source: rule },
    ];
    const first = (options: LintOptions) => lintWorkspace(files, options)[0].diagnostics.map((d) => d.code);
    expect(first({})).toEqual(['exclusionInEarlierFile']);
    expect(first({ engine: 'modsecurity3' })).toEqual([]);
  });

  it('правку правила, которого ещё нет, Coraza не грузит; снятие — грузит', () => {
    const update = `SecAction "id:1,phase:1,pass,nolog"\nSecRuleUpdateTargetById 5001 "!ARGS:x"\n${rule}`;
    const [diagnostic] = found(update);
    expect(diagnostic.code).toBe('exclusionBeforeRule');
    expect(diagnostic.refusedBy).toEqual(['coraza']);
    expect(found(update, { engine: 'coraza' })[0].severity).toBe('error');

    const remove = found(`SecRuleRemoveById 5001\n${rule}`)[0];
    expect(remove.refusedBy).toBeUndefined();
  });

  it('пока в наборе нет ни одного правила, правку не грузит и вторая версия', () => {
    const [diagnostic] = found(`SecRuleUpdateTargetById 5001 "!ARGS:x"\n${rule}`);
    expect(diagnostic.refusedBy).toEqual(['modsecurity2', 'coraza']);
    expect(diagnostic.severity).toBe('error');
  });
});

describe('отказ движков: значения', () => {
  it('запятая в конце списка адресов — не ошибка', () => {
    expect(codes('SecRule REMOTE_ADDR "@ipMatch 10.0.0.1," "id:1,phase:1,pass"')).toEqual([]);
  });

  it('список байтов: у каждой ошибки свои несогласные', () => {
    const refused = (argument: string, engine?: Engine) =>
      found(`SecRule ARGS "@validateByteRange ${argument}" "id:1,phase:2,pass"`, { engine })[0]?.refusedBy;
    expect(refused('32-126,300')).toEqual(ENGINES);
    expect(refused('126-32')).toEqual(['modsecurity2', 'modsecurity3']);
    expect(refused('a-z')).toEqual(['modsecurity3', 'coraza']);
    // Пробелы внутри записи мешают только Coraza — и только при ней о них сказано.
    expect(refused('32 - 126')).toBeUndefined();
    expect(refused('32 - 126', 'coraza')).toEqual(['coraza']);
  });

  it('слово фазы Coraza сравнивает буква в букву', () => {
    const source = 'SecAction "id:1,phase:REQUEST,pass,nolog"';
    expect(codes(source)).toEqual([]);
    expect(codes(source, { engine: 'coraza' })).toEqual(['invalidActionValue']);
    expect(codes('SecAction "id:1,phase:request,pass,nolog"', { engine: 'coraza' })).toEqual([]);
  });

  it('запятая в кавычках у setvar и опция ctl в кавычках — отказ третьей версии', () => {
    const refused = (action: string) =>
      found(`SecAction "id:1,phase:1,pass,nolog,${action}"`).find((d) => d.code === 'suspiciousActionValue')
        ?.refusedBy;
    expect(refused("setvar:'tx.note=first, second'")).toEqual(['modsecurity3']);
    expect(refused("ctl:'ruleEngine=Off'")).toEqual(['modsecurity3']);
    expect(codes("SecAction \"id:1,phase:1,pass,nolog,setvar:'tx.note=first second'\"")).toEqual([]);
  });

  it('макрос в номере не грузит никто, в метке перехода — грузят все', () => {
    const refused = (source: string) => found(source)[0]?.refusedBy;
    expect(refused('SecAction "id:%{tx.id},phase:1,pass,nolog"')).toEqual(ENGINES);
    expect(refused('SecAction "id:1,phase:1,pass,nolog,skipAfter:%{tx.label}"')).toBeUndefined();
  });
});
