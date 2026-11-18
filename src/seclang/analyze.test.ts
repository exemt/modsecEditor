import { activeSteps, analyze, analyzeAll, runPipeline, stepStatus } from './analyze';
import { transformSpec } from './catalog';
import { parse, parseActionList } from './parser';
import { ANY, COUNT, Fact, NUMBER, STRING, describeType, hasFact, joinTypes } from './value';
import type { ConditionInfo } from './analyze';
import type { TransformNode } from './ast';
import type { ValueType } from './value';

function model(source: string) {
  return analyze(parse(source));
}

function condition(source: string, rule = 0, link = 0): ConditionInfo {
  return model(source).rules[rule].conditions[link];
}

/** Конвейер по списку имён: то, что спросит форма конструктора. */
function pipe(base: ValueType, names: string) {
  const text = names
    .split(',')
    .map((name) => `t:${name}`)
    .join(',');
  return runPipeline(base, parseActionList(text).items as TransformNode[]);
}

describe('типы значений', () => {
  it('достраивает следствия свойств', () => {
    expect(hasFact(NUMBER, Fact.Lower | Fact.NoSpace | Fact.TrimLeft)).toBe(true);
    expect(hasFact(COUNT, Fact.Numeric | Fact.NonNegative)).toBe(true);
    expect(hasFact(STRING, Fact.Lower)).toBe(false);
  });

  it('объединяет источники: вид — самый широкий, свойства — общие', () => {
    expect(joinTypes(NUMBER, STRING)).toEqual(STRING);
    expect(joinTypes(NUMBER, COUNT).kind).toBe('number');
    expect(hasFact(joinTypes(NUMBER, COUNT), Fact.NonNegative)).toBe(false);
    expect(joinTypes(STRING, ANY)).toEqual(ANY);
  });

  it('неизвестный вид не стирает общих свойств', () => {
    // Что в `REQUEST_HEADERS:Content-Length`, решает клиент, но перевода
    // строки в заголовке не бывает — как и в методе запроса рядом.
    const header = { kind: 'any' as const, facts: Fact.OneLine };
    const method = { kind: 'string' as const, facts: Fact.OneLine };
    expect(joinTypes(header, method)).toEqual(header);
    expect(joinTypes(header, STRING)).toEqual(ANY);
  });

  it('без пробельных символов нет и перевода строки', () => {
    expect(hasFact(NUMBER, Fact.OneLine)).toBe(true);
    expect(hasFact(pipe(STRING, 'compressWhitespace').output, Fact.OneLine)).toBe(true);
    expect(hasFact(pipe(STRING, 'trim').output, Fact.OneLine)).toBe(false);
  });
});

describe('конвейер', () => {
  it('ведёт тип от шага к шагу', () => {
    const { steps, output } = pipe(STRING, 'lowercase,removeWhitespace,length');

    expect(steps.map((s) => [s.status, describeType(s.input), s.output.kind])).toEqual([
      ['ok', 'string', 'string'],
      ['ok', 'string<Lower>', 'string'],
      ['ok', 'string<Lower,NoSpace,TrimLeft,TrimRight,Squeezed,OneLine>', 'number'],
    ]);
    expect(output.kind).toBe('number');
    expect(hasFact(output, Fact.NonNegative)).toBe(true);
  });

  it('замечает шаг, которому вход не подходит', () => {
    expect(pipe(STRING, 'length,lowercase').steps.map((s) => s.status)).toEqual(['ok', 'mismatch']);
    expect(pipe(STRING, 'sha1,trim').steps.map((s) => s.status)).toEqual(['ok', 'mismatch']);
    expect(pipe(STRING, 'sha1,hexEncode,lowercase').steps.map((s) => s.status)).toEqual([
      'ok',
      'ok',
      // Шестнадцатеричная запись и так в нижнем регистре.
      'idle',
    ]);
    expect(pipe(NUMBER, 'urlDecode').steps[0].status).toBe('mismatch');
  });

  it('замечает шаг, который ничего не меняет', () => {
    expect(pipe(STRING, 'removeWhitespace,trim').steps[1].status).toBe('idle');
    expect(pipe(STRING, 'trimLeft,trimRight,trim').steps[2].status).toBe('idle');
    expect(pipe(STRING, 'lowercase,lowercase').steps[1].status).toBe('idle');
    // Раскрытие кодирования может вернуть заглавные буквы.
    expect(pipe(STRING, 'lowercase,urlDecode,lowercase').steps[2].status).toBe('ok');
    expect(pipe(STRING, 'lowercase,uppercase').steps[1].status).toBe('ok');
  });

  it('t:none возвращает к исходному типу', () => {
    const result = pipe(STRING, 'length,none,lowercase');
    expect(result.steps.map((s) => s.status)).toEqual(['ok', 'reset', 'ok']);
    expect(result.activeFrom).toBe(2);
    expect(activeSteps(result).map((s) => s.node.transform)).toEqual(['lowercase']);
    expect(describeType(result.output)).toBe('string<Lower>');
  });

  it('о значении неизвестного вида молчит, но свойства копит', () => {
    const result = pipe(ANY, 'lowercase,trim');
    expect(result.steps.map((s) => s.status)).toEqual(['ok', 'ok']);
    expect(result.output.kind).toBe('any');
    expect(hasFact(result.output, Fact.Lower | Fact.TrimLeft)).toBe(true);
    expect(pipe(ANY, 'length').output.kind).toBe('number');
  });

  it('незнакомое преобразование делает тип неизвестным', () => {
    const result = pipe(STRING, 'lowercase,frobnicate,trim');
    expect(result.steps[1].status).toBe('unknown');
    expect(result.steps[2].input).toBe(ANY);
  });

  it('отвечает, можно ли поставить преобразование в это место', () => {
    const afterLength = pipe(STRING, 'length').output;
    expect(stepStatus(transformSpec('lowercase'), afterLength)).toBe('mismatch');
    expect(stepStatus(transformSpec('lowercase'), STRING)).toBe('ok');
    expect(stepStatus(transformSpec('LOWERCASE'), STRING)).toBe('ok');
    expect(stepStatus(transformSpec('nope'), STRING)).toBe('unknown');
  });
});

describe('analyze', () => {
  it('собирает цепочку в одно правило', () => {
    const { rules, conditions } = model(
      [
        'SecRule REQUEST_METHOD "@streq POST" "id:1,phase:2,deny,chain"',
        '# пояснение между звеньями',
        '    SecRule &ARGS "@gt 10" "chain"',
        '    SecRule ARGS "@rx x" "t:lowercase"',
        'SecAction "id:2,phase:1,pass,nolog"',
      ].join('\n'),
    );

    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ id: '1', phase: 2, effectivePhase: 2, dangling: false });
    expect(rules[0].conditions.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(rules[0].conditions[1].counting).toBe(true);
    expect(rules[1]).toMatchObject({ id: '2', phase: 1, conditions: [] });
    expect(conditions.size).toBe(3);
  });

  it('помечает оборванную цепочку', () => {
    expect(model('SecRule ARGS "@rx a" "id:1,chain"\nSecMarker X').rules[0].dangling).toBe(true);
    expect(model('SecRule ARGS "@rx a" "id:1,chain"').rules[0].dangling).toBe(true);
  });

  it('считает исходный тип по областям проверки', () => {
    const base = (variables: string) =>
      describeType(condition(`SecRule ${variables} "@rx a" "id:1"`).pipeline.base);

    expect(base('ARGS')).toBe('string');
    expect(base('RESPONSE_STATUS')).toMatch(/^number</);
    expect(base('&ARGS')).toMatch(/NonNegative/);
    expect(base('TX:score')).toBe('any');
    expect(base('ARGS|REQUEST_BODY_LENGTH')).toBe('string');
    // Вычитаемая область в тип не вносит ничего.
    expect(base('ARGS|!TX:x')).toBe('string');
    expect(base('NOT_A_VARIABLE')).toBe('any');
    expect(base('args')).toBe('string');
  });

  it('наследует преобразования из SecDefaultAction своей фазы', () => {
    const source = [
      'SecDefaultAction "phase:2,log,pass,t:lowercase"',
      'SecRule ARGS "@rx a" "id:1,phase:2,t:trim"',
      'SecRule ARGS "@rx a" "id:2,phase:2,t:none,t:trim"',
      'SecRule REQUEST_URI "@rx a" "id:3,phase:1,t:trim"',
    ].join('\n');

    const steps = (rule: number) =>
      condition(source, rule).pipeline.steps.map((s) => [s.node.transform, s.inherited]);

    expect(steps(0)).toEqual([
      ['lowercase', true],
      ['trim', false],
    ]);
    expect(activeSteps(condition(source, 1).pipeline).map((s) => s.node.transform)).toEqual(['trim']);
    expect(steps(2)).toEqual([['trim', false]]);
  });

  it('подсчётом считает условие, только если считаются все его области', () => {
    const counting = (variables: string) =>
      condition(`SecRule ${variables} "@eq 0" "id:1"`).counting;

    expect(counting('&ARGS')).toBe(true);
    expect(counting('&ARGS|&REQUEST_COOKIES|!ARGS:x')).toBe(true);
    expect(counting('&ARGS|ARGS')).toBe(false);
    expect(counting('ARGS')).toBe(false);
  });

  it('вид названного параметра оставляет неизвестным', () => {
    const base = (variables: string) =>
      condition(`SecRule ${variables} "@rx a" "id:1"`).pipeline.base.kind;

    expect(base('REQUEST_HEADERS')).toBe('string');
    expect(base('REQUEST_HEADERS:/^X-/')).toBe('string');
    expect(base('REQUEST_HEADERS:Content-Length')).toBe('any');
    expect(base('ARGS:id')).toBe('any');
    // Число остаётся числом, как бы его ни выбрали.
    expect(base('FILES_SIZES:upload')).toBe('number');
  });

  it('правило на Lua — правило без условий', () => {
    const { rules } = model('SecRuleScript lua/check.lua "id:9,phase:1,pass"');
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ id: '9', phase: 1, conditions: [] });
    expect(rules[0].head.kind).toBe('SecRuleScript');
  });

  it('набор файлов: умолчания идут сверху вниз, метки и номера видны отовсюду', () => {
    const [first, second, third] = analyzeAll(
      [
        'SecDefaultAction "phase:1,pass,t:lowercase"\nSecAction "id:1,phase:1,pass"',
        'SecRule REQUEST_URI "@rx a" "id:2,t:trim,skipAfter:END"\nSecAction "id:1,pass"',
        'SecMarker END',
      ].map((source) => parse(source)),
    );

    expect(first.scope).toBe(second.scope);
    expect(second.scope).toBe(third.scope);
    expect(second.markers.has('END')).toBe(false);
    expect(second.scope.markers.has('END')).toBe(true);
    expect(second.scope.ids.get('1')).toHaveLength(2);
    expect(second.ids.get('1')).toHaveLength(1);

    // Правило второго файла наследует фазу и преобразование из первого.
    const inherited = second.rules[0];
    expect(inherited).toMatchObject({ phase: null, effectivePhase: 1, hasDefaults: true });
    expect(inherited.conditions[0].pipeline.steps.map((s) => [s.node.transform, s.inherited])).toEqual([
      ['lowercase', true],
      ['trim', false],
    ]);
    // А правило первого, стоящее после умолчаний, — уже тоже.
    expect(first.rules[0].hasDefaults).toBe(true);
    // Одиночный файл — набор из одного: чужих умолчаний у него нет.
    expect(model('SecAction "id:1,pass"').rules[0].hasDefaults).toBe(false);
  });

  it('ведёт указатели номеров, меток и директив', () => {
    const result = model(
      [
        'SecRuleEngine DetectionOnly',
        'SecRule ARGS "@rx a" "id:7,phase:2,pass"',
        'SecRule ARGS "@rx b" "id:7,phase:2,pass"',
        'SecMarker END',
      ].join('\n'),
    );

    expect(result.ids.get('7')).toHaveLength(2);
    expect(result.markers.has('END')).toBe(true);
    expect(result.directives.get('secruleengine')?.[0].args[0].value).toBe('DetectionOnly');
  });
});
