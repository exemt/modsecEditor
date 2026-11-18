import { lint } from '../index';
import type { DiagnosticCode, LintOptions } from '../index';

/**
 * Нюансы, которые линтер раньше не видел или видел неверно.
 *
 * Каждое утверждение здесь — сценарий или проба стенда
 * (`scripts/engines/scenarios.json`, `stand/probes.conf`): что движки делают
 * на самом деле, а не что о них написано в справочниках. Поэтому почти у
 * каждого замечания проверено и то, когда оно молчит, — названный движок,
 * для которого разницы нет.
 */

function codes(source: string, options: LintOptions = {}, only?: DiagnosticCode[]): string[] {
  return lint(source, { ...options, ...(only ? { only } : {}) }).map((d) => d.code);
}

function levels(source: string, options: LintOptions = {}): Array<[string, string]> {
  return lint(source, options).map((d) => [d.code, d.severity]);
}

describe('имена параметров и регистр', () => {
  it('в списке областей правила регистр не важен ни одному движку', () => {
    expect(codes('SecRule ARGS:Q|ARGS:q "@rx ^a\\d" "id:1,phase:2,pass"')).toEqual(['duplicateTarget']);
    // Шаблоны сравниваются как написаны.
    expect(codes('SecRule ARGS:/^Q/|ARGS:/^q/ "@rx ^a\\d" "id:1,phase:2,pass"', {}, ['duplicateTarget'])).toEqual([]);
  });

  it('в исключении третья версия регистр различает: повтор — только для второй и Coraza', () => {
    const twice = [
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass"',
      'SecRuleUpdateTargetById 1 "!ARGS:Foo"',
      'SecRuleUpdateTargetById 1 "!ARGS:foo"',
    ].join('\n');
    expect(codes(twice, { engine: 'modsecurity2' }, ['exclusionDuplicate'])).toEqual(['exclusionDuplicate']);
    expect(codes(twice, { engine: 'coraza' }, ['exclusionDuplicate'])).toEqual(['exclusionDuplicate']);
    expect(codes(twice, { engine: 'modsecurity3' }, ['exclusionDuplicate'])).toEqual([]);
    expect(codes(twice, {}, ['exclusionDuplicate'])).toEqual([]);
  });

  it('заголовок в исключении: третья версия сравнивает буква в букву', () => {
    const header = [
      'SecRule REQUEST_HEADERS "@rx <script\\b" "id:1,phase:1,deny,msg:x"',
      'SecRuleUpdateTargetById 1 "!REQUEST_HEADERS:User-Agent"',
    ].join('\n');
    const [found] = lint(header, { only: ['exclusionHeaderCase'] });
    expect(found.data?.pattern).toBe('REQUEST_HEADERS:/(?i)^User-Agent$/');
    expect(codes(header, { engine: 'modsecurity2' }, ['exclusionHeaderCase'])).toEqual([]);
    expect(codes(header, { engine: 'coraza' }, ['exclusionHeaderCase'])).toEqual([]);
    // Шаблон с (?i) все движки читают одинаково.
    const pattern = header.replace('!REQUEST_HEADERS:User-Agent', '!REQUEST_HEADERS:/(?i)^user-agent$/');
    expect(codes(pattern, {}, ['exclusionHeaderCase', 'selectorPatternCase'])).toEqual([]);
  });

  it('шаблон по именам параметров: Coraza учитывает регистр, остальные — нет', () => {
    const rule = (selector: string) => `SecRule ARGS:${selector} "@rx <script\\b" "id:1,phase:2,pass"`;
    expect(codes(rule('/^User_/'), {}, ['selectorPatternCase'])).toEqual(['selectorPatternCase']);
    expect(codes(rule('/^User_/'), { engine: 'modsecurity3' }, ['selectorPatternCase'])).toEqual([]);
    expect(codes(rule('/(?i)^User_/'), {}, ['selectorPatternCase'])).toEqual([]);
    expect(codes(rule('/^user_\\D/'), {}, ['selectorPatternCase'])).toEqual([]);
    // По TX, куки и заголовкам Coraza сама переводит шаблон в нижний регистр.
    expect(codes('SecRule TX:/^MSC_/ "!@streq 0" "id:1,phase:2,pass"', {}, ['selectorPatternCase'])).toEqual([]);
  });
});

describe('исключения и правило, которое они правят', () => {
  const chain = [
    'SecRule REQUEST_METHOD "@streq POST" "id:1,phase:2,deny,msg:x,chain"',
    '    SecRule ARGS:comment "@rx <script\\b" "t:none"',
  ].join('\n');

  it('область только в звене: директиву поймёт одна вторая версия', () => {
    const source = `${chain}\nSecRuleUpdateTargetById 1 "!ARGS:comment"`;
    expect(codes(source, {}, ['exclusionTargetInLink'])).toEqual(['exclusionTargetInLink']);
    expect(codes(source, { engine: 'modsecurity2' }, ['exclusionTargetInLink'])).toEqual([]);
  });

  it('у ctl наоборот: поймёт одна Coraza', () => {
    const source = `SecAction "id:2,phase:1,pass,nolog,ctl:ruleRemoveTargetById=1;ARGS:comment"\n${chain}`;
    expect(codes(source, {}, ['exclusionCtlTargetInLink'])).toEqual(['exclusionCtlTargetInLink']);
    expect(codes(source, { engine: 'coraza' }, ['exclusionCtlTargetInLink'])).toEqual([]);
  });

  it('области нет в правиле вовсе — исключению нечего снимать', () => {
    const rule = 'SecRule ARGS_GET "@rx [\\x0a\\x0d]" "id:1,phase:1,deny,msg:x"';
    const ctl = 'SecAction "id:2,phase:1,pass,nolog,ctl:ruleRemoveTargetById=1;ARGS:q"';
    expect(codes(`${ctl}\n${rule}`, {}, ['exclusionTargetNotInRule'])).toEqual(['exclusionTargetNotInRule']);
    // Тот же параметр, но в правильной коллекции, — снимает.
    expect(codes(`${ctl.replace('ARGS:q', 'ARGS_GET:q')}\n${rule}`, {}, ['exclusionTargetNotInRule'])).toEqual([]);
    // Выборка по тегу задевает многие правила, и о каждом не говорим.
    const byTag = 'SecAction "id:2,phase:1,pass,nolog,ctl:ruleRemoveTargetByTag=x;ARGS:q"';
    expect(codes(`${byTag}\n${rule.replace('msg:x', 'msg:x,tag:x')}`, {}, ['exclusionTargetNotInRule'])).toEqual([]);
  });

  it('шаблон в ctl: третья версия от него отказывается', () => {
    const source = [
      'SecAction "id:2,phase:1,pass,nolog,ctl:ruleRemoveTargetById=1;ARGS:/^q_/"',
      'SecRule ARGS "@rx <script\\b" "id:1,phase:2,deny,msg:x"',
    ].join('\n');
    expect(levels(source, { engine: 'modsecurity3', only: ['exclusionCtlPattern'] })).toEqual([
      ['exclusionCtlPattern', 'error'],
    ]);
    expect(levels(source, { only: ['exclusionCtlPattern'] })).toEqual([['exclusionCtlPattern', 'warning']]);
  });
});

describe('шаблоны: строки и байты', () => {
  it('валидатор с ^…$ в третьей версии и Coraza обходится второй строкой', () => {
    const rule = (target: string, op: string, actions = 'deny,msg:x') =>
      `SecRule ${target} "${op}" "id:1,phase:2,${actions}"`;
    const only: DiagnosticCode[] = ['anchorsMatchLines'];
    expect(codes(rule('ARGS:page', '!@rx ^\\d+$'), {}, only)).toEqual(['anchorsMatchLines']);
    expect(lint(rule('ARGS:page', '!@rx ^\\d+$'), { only })[0].data?.pattern).toBe('\\A\\d+\\z');
    expect(codes(rule('ARGS:page', '!@rx ^\\d+$'), { engine: 'modsecurity2' }, only)).toEqual([]);
    expect(codes(rule('ARGS:page', '!@rx \\A\\d+\\z'), {}, only)).toEqual([]);
    // Перевода строки в методе не бывает.
    expect(codes(rule('REQUEST_METHOD', '!@rx ^(?:GET|POST)$'), {}, only)).toEqual([]);
    // Правило обнаружения от лишней строки только находит больше.
    expect(codes(rule('ARGS', '@rx ^(?:a|b)\\d$'), {}, only)).toEqual([]);
    // А исключение — открывает дорогу.
    expect(codes(rule('ARGS:action', '@rx ^(?:edit)$', 'pass,nolog,ctl:ruleRemoveById=5'), {}, only)).toEqual([
      'anchorsMatchLines',
    ]);
    // Запись журнала дорогу не открывает.
    expect(codes(rule('ARGS:action', '!@rx ^(?:edit)$', 'pass,nolog,ctl:auditLogParts=+E'), {}, only)).toEqual([
      'anchorsMatchLines',
    ]);
    expect(codes(rule('ARGS:action', '@rx ^(?:edit)$', 'pass,nolog,ctl:auditLogParts=+E'), {}, only)).toEqual([]);
    // `.*` у обоих краёв: строки шаблону безразличны.
    expect(codes(rule('ARGS', '!@rx ^.*x.*$'), {}, only)).toEqual([]);
  });

  it('символ не из ASCII в классе: ModSecurity считает байты', () => {
    const rule = (pattern: string) => `SecRule ARGS "@rx ${pattern}" "id:1,phase:2,pass,nolog"`;
    const only: DiagnosticCode[] = ['multibyteInClass'];
    expect(codes(rule('[é]'), {}, only)).toEqual(['multibyteInClass']);
    expect(codes(rule('é+'), {}, only)).toEqual(['multibyteInClass']);
    expect(lint(rule('[ё]'), { only })[0].data?.bytes).toBe('2');
    expect(codes(rule('[é]'), { engine: 'coraza' }, only)).toEqual([]);
    // Вне класса и без повтора символ — просто байты подряд.
    expect(codes(rule('café'), {}, only)).toEqual([]);
    expect(codes(rule('(?:é|è)'), {}, only)).toEqual([]);
  });

  it('@within ищет подстроку, а не слово', () => {
    const rule = (list: string) => `SecRule REQUEST_METHOD "!@within ${list}" "id:1,phase:1,deny,msg:x"`;
    const [found] = lint(rule('GET POST'), { only: ['withinSubstring'] });
    expect(found.data).toEqual({ value: 'GET POST', sample: 'OST', pattern: '\\A(?:GET|POST)\\z' });
    // Слова в разделителях — известный приём против этого.
    expect(codes(rule('|GET| |POST|'), {}, ['withinSubstring'])).toEqual([]);
    expect(codes(rule('%{tx.allowed_methods}'), {}, ['withinSubstring'])).toEqual([]);
  });
});

describe('отрицание на параметре, которого нет', () => {
  const only: DiagnosticCode[] = ['negatedOnMissing'];

  it('сравнение с ключом без проверки присутствия', () => {
    expect(codes('SecRule REQUEST_HEADERS:X-Key "!@streq s3cr3t" "id:1,phase:1,deny,msg:x"', {}, only)).toEqual([
      'negatedOnMissing',
    ]);
    expect(
      codes('SecRule ARGS:csrf "!@streq %{SESSION.csrf}" "id:1,phase:2,deny,msg:x"', {}, only),
    ).toEqual(['negatedOnMissing']);
  });

  it('молчит, где отсутствие задумано или уже проверено', () => {
    // Проверка формата: без параметра проверять нечего.
    expect(codes('SecRule ARGS:page "!@rx ^\\d+$" "id:1,phase:2,deny,msg:x"', {}, only)).toEqual([]);
    // Сверка двух заголовков между собой.
    expect(codes('SecRule REQUEST_HEADERS:X-Host "!@streq %{TX.1}" "id:1,phase:1,deny,msg:x"', {}, only)).toEqual([]);
    // Не блокирует.
    expect(codes('SecRule REQUEST_HEADERS:X-Key "!@streq s" "id:1,phase:1,pass,nolog"', {}, only)).toEqual([]);
    // Присутствие проверяет соседнее правило.
    const both = [
      'SecRule &REQUEST_HEADERS:X-Key "@eq 0" "id:1,phase:1,deny,msg:x"',
      'SecRule REQUEST_HEADERS:X-Key "!@streq s3cr3t" "id:2,phase:1,deny,msg:x"',
    ].join('\n');
    expect(codes(both, {}, only)).toEqual([]);
  });
});

describe('уровень файла', () => {
  it('метка порядка байтов: в начале файла и в начале строки', () => {
    expect(levels('\ufeffSecAction "id:1,phase:1,pass,nolog"')).toEqual([['byteOrderMark', 'error']]);
    const joined = 'SecAction "id:1,phase:1,pass,nolog"\n\ufeffSecAction "id:2,phase:1,pass,nolog"';
    expect(lint(joined).map((d) => [d.code, d.line])).toEqual([['byteOrderMark', 2]]);
  });

  it('неразрывный пробел и типографские кавычки: одно замечание вместо лавины', () => {
    expect(codes('SecRule\u00a0ARGS "@rx a" "id:1,phase:2,pass,nolog"')).toEqual(['strayCharacter']);
    expect(codes('SecRule ARGS \u201c@rx a\u201d \u201cid:1,phase:2,pass,nolog\u201d')).toEqual(['strayCharacter']);
    // Между аргументами в кавычках неразрывный пробел третья версия пропускает.
    const between = 'SecRule ARGS "@rx ^a\\d"\u00a0"id:1,phase:2,pass,nolog"';
    expect(lint(between)[0].refusedBy).toEqual(['modsecurity2', 'coraza']);
    // В тексте сообщения они законны.
    expect(codes('SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,nolog,msg:\'\u201ca\u00a0b\u201d\'"')).toEqual([]);
  });

  it('невидимый символ внутри значения', () => {
    expect(codes('SecRule ARGS "@rx ^ad\u200bmin" "id:1,phase:2,pass,nolog"')).toEqual(['invisibleCharacter']);
  });

  it('номер правила: у каждого движка свой потолок', () => {
    const id = (value: string) => levels(`SecAction "id:${value},phase:1,pass,nolog"`);
    expect(id('2147483647')).toEqual([]);
    expect(id('2147483648')).toEqual([['idTooLarge', 'warning']]);
    expect(lint('SecAction "id:9223372036854775807,phase:1,pass,nolog"')[0].refusedBy).toEqual([
      'modsecurity2',
      'modsecurity3',
    ]);
    expect(levels('SecAction "id:2147483648,phase:1,pass,nolog"', { engine: 'modsecurity2' })).toEqual([
      ['idTooLarge', 'error'],
    ]);
  });

  it('метка с пробелом: обе версии ModSecurity не грузят', () => {
    const source = "SecAction \"id:1,phase:1,pass,nolog,skipAfter:'END CHECKS'\"\nSecMarker \"END CHECKS\"";
    expect(levels(source, { only: ['markerWithSpace'] })).toEqual([
      ['markerWithSpace', 'error'],
      ['markerWithSpace', 'error'],
    ]);
    // Coraza такую метку грузит: для неё это не ошибка, а предупреждение о переносимости.
    expect(levels(source, { engine: 'coraza', only: ['markerWithSpace'] })).toEqual([
      ['markerWithSpace', 'warning'],
      ['markerWithSpace', 'warning'],
    ]);
  });

  it('относительный Include: Apache считает от ServerRoot', () => {
    expect(codes('Include rules/*.conf', {}, ['includeRelative'])).toEqual(['includeRelative']);
    expect(codes('Include rules/*.conf', { engine: 'modsecurity3' }, ['includeRelative'])).toEqual([]);
    expect(codes('Include /etc/modsecurity/rules/*.conf', {}, ['includeRelative'])).toEqual([]);
    expect(codes('Include C:\\modsec\\rules.conf', {}, ['includeRelative'])).toEqual([]);
  });
});

describe('безопасность', () => {
  it('защиту снимает то, что клиент пишет сам', () => {
    const only: DiagnosticCode[] = ['relaxedByClientInput'];
    expect(codes('SecRule REQUEST_HEADERS:X-Forwarded-For "@ipMatch 10.0.0.1" "id:1,phase:1,allow,nolog"', {}, only)).toEqual([
      'relaxedByClientInput',
    ]);
    // Адрес клиента подделать нельзя.
    expect(codes('SecRule REMOTE_ADDR "@ipMatch 10.0.0.1" "id:1,phase:1,allow,nolog"', {}, only)).toEqual([]);
    // Хоть одно условие не от клиента — уже не только клиент решает.
    const chained = [
      'SecRule REMOTE_ADDR "@ipMatch 10.0.0.0/8" "id:1,phase:1,pass,nolog,chain"',
      '    SecRule REQUEST_HEADERS:X-Debug "@streq 1" "ctl:ruleEngine=Off"',
    ].join('\n');
    expect(codes(chained, {}, only)).toEqual([]);
    // Снять с правила одну область — обычное исключение, не выключение защиты.
    expect(
      codes('SecRule ARGS:action "@streq edit" "id:1,phase:1,pass,nolog,ctl:ruleRemoveTargetById=5;ARGS:content"', {}, only),
    ).toEqual([]);
  });

  it('значение секрета в журнале', () => {
    const only: DiagnosticCode[] = ['secretInLog'];
    const rule = (logdata: string) =>
      `SecRule ARGS:password "@rx ^.{0,7}$" "id:1,phase:2,deny,msg:x,logdata:'${logdata}'"`;
    expect(codes(rule('%{MATCHED_VAR}'), {}, only)).toEqual(['secretInLog']);
    expect(codes(rule('%{ARGS.password}'), {}, only)).toEqual(['secretInLog']);
    expect(codes(rule('%{MATCHED_VAR_NAME}'), {}, only)).toEqual([]);
  });

  it('тело разбирается, а ошибку разбора не читает никто', () => {
    const only: DiagnosticCode[] = ['bodyErrorUnchecked'];
    expect(codes('SecRequestBodyAccess On', {}, only)).toEqual(['bodyErrorUnchecked']);
    expect(codes('SecRequestBodyAccess Off', {}, only)).toEqual([]);
    const guarded = 'SecRequestBodyAccess On\nSecRule REQBODY_ERROR "!@eq 0" "id:1,phase:2,deny,msg:x"';
    expect(codes(guarded, {}, only)).toEqual([]);
  });

  it('ProcessPartial: что дальше предела, не проверяется', () => {
    expect(codes('SecRequestBodyLimitAction ProcessPartial')).toEqual(['partialBodyInspection']);
    expect(codes('SecRequestBodyLimitAction Reject')).toEqual([]);
  });
});
