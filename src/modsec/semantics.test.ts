import {
  conditionConstraints,
  countSupported,
  operatorsForInput,
  pipelineOutput,
  selectorSupport,
  targetsMinPhase,
} from './semantics';
import type { TargetLike } from './semantics';

function target(name: string, extra: Partial<TargetLike> = {}): TargetLike {
  return { name, count: false, mode: 'only', params: [], ...extra };
}

describe('взаимные ограничения проверок', () => {
  it('подсчёт превращает вход в число и отключает преобразования', () => {
    const constraints = conditionConstraints([target('ARGS', { count: true })], []);

    expect(constraints.inputKind).toBe('number');
    expect(constraints.transformsAllowed).toBe(false);
    expect(constraints.transformsBlockedBy).toBe('count');
  });

  it('после подсчёта остаются только числовые операторы', () => {
    const constraints = conditionConstraints([target('ARGS', { count: true })], []);

    expect(constraints.operators).toEqual(expect.arrayContaining(['eq', 'gt', 'lt']));
    expect(constraints.operators).not.toContain('contains');
    expect(constraints.operators).not.toContain('detectSQLi');
  });

  it('текстовая цель без подсчёта допускает строковые операторы', () => {
    const constraints = conditionConstraints([target('ARGS')], ['lowercase']);

    expect(constraints.inputKind).toBe('string');
    expect(constraints.transformsAllowed).toBe(true);
    expect(constraints.operators).toContain('contains');
  });

  it('t:length переводит проверку в числовую', () => {
    expect(pipelineOutput('string', ['lowercase', 'length'])).toBe('number');
    expect(conditionConstraints([target('ARGS')], ['length']).operators).not.toContain(
      'contains',
    );
  });

  it('t:none сбрасывает накопленный конвейер', () => {
    expect(pipelineOutput('string', ['length', 'none'])).toBe('string');
  });

  it('числовая переменная сама по себе даёт числовой вход', () => {
    expect(conditionConstraints([target('RESPONSE_STATUS')], []).inputKind).toBe('number');
  });

  it('смесь числовой и текстовой цели считается текстовой', () => {
    const constraints = conditionConstraints(
      [target('RESPONSE_STATUS'), target('ARGS')],
      [],
    );
    expect(constraints.inputKind).toBe('string');
  });
});

describe('метаданные переменных', () => {
  it('скаляры не принимают параметр и не считаются', () => {
    expect(selectorSupport('REQUEST_METHOD')).toBe('none');
    expect(countSupported('REQUEST_METHOD')).toBe(false);
  });

  it('коллекции принимают параметр и считаются', () => {
    expect(selectorSupport('REQUEST_HEADERS')).toBe('optional');
    expect(countSupported('REQUEST_HEADERS')).toBe(true);
  });

  it('для TX параметр обязателен', () => {
    expect(selectorSupport('TX')).toBe('required');
  });

  it('минимальная фаза берётся по самой поздней цели', () => {
    expect(targetsMinPhase([target('REQUEST_METHOD'), target('RESPONSE_BODY')])).toBe(4);
  });

  it('незнакомая переменная не ломает подсчёт ограничений', () => {
    const constraints = conditionConstraints([target('CUSTOM_THING')], []);
    expect(constraints.inputKind).toBe('string');
    expect(constraints.minPhase).toBe(1);
  });
});

describe('операторы по типу входа', () => {
  it('числовой вход не принимает detectSQLi', () => {
    expect(operatorsForInput('number')).not.toContain('detectSQLi');
  });

  it('строковый вход принимает и rx, и detectXSS', () => {
    const operators = operatorsForInput('string');
    expect(operators).toContain('rx');
    expect(operators).toContain('detectXSS');
  });
});
