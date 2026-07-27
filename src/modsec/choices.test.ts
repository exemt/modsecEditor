import { operatorChoices, transformChoices } from './choices';
import { OPERATOR_NAMES, TRANSFORM_NAMES } from './semantics';
import { recommendedOperators, recommendedTransforms } from './suggestions';
import type { Choice } from './choices';
import type { TargetLike } from './semantics';

function target(name: string, extra: Partial<TargetLike> = {}): TargetLike {
  return { name, count: false, mode: 'only', params: [], ...extra };
}

function values(choices: Choice[]): string[] {
  return choices.map((choice) => choice.value);
}

function find(choices: Choice[], value: string): Choice {
  const found = choices.find((choice) => choice.value === value);
  if (found === undefined) throw new Error(`нет варианта «${value}»`);
  return found;
}

/** Названия должны быть различимы на каждом из языков по отдельности. */
function expectUniqueLabels(choices: Choice[]): void {
  for (const locale of ['en', 'ru'] as const) {
    const labels = choices.map((choice) => choice.label[locale]);
    expect(labels).toHaveLength(new Set(labels).size);
  }
}

describe('варианты преобразований', () => {
  it('показывают все известные преобразования, ничего не теряя', () => {
    expect(values(transformChoices('string', [], '')).sort()).toEqual(
      [...TRANSFORM_NAMES].sort(),
    );
  });

  it('над числом текстовые преобразования помечены как неподходящие', () => {
    const choices = transformChoices('number', [], '');

    expect(find(choices, 'lowercase').unfit?.ru).toContain('уже число');
    // Сброс применим к чему угодно: он возвращает исходное значение целей.
    expect(find(choices, 'none').unfit).toBeNull();
  });

  it('неподходящие уезжают в конец списка, а не исчезают', () => {
    const choices = transformChoices('number', [], '');
    const firstUnfit = choices.findIndex((choice) => choice.unfit !== null);
    const lastFit = choices.map((choice) => choice.unfit === null).lastIndexOf(true);

    expect(firstUnfit).toBeGreaterThan(lastFit);
  });

  it('уместное для этой области стоит первым и вынесено в свой раздел', () => {
    const choices = transformChoices('string', ['urlDecodeUni'], '');

    expect(choices[0].value).toBe('urlDecodeUni');
    expect(choices[0].recommended).toBe(true);
    expect(choices[0].group.ru).toBe('Подходит этой проверке');
  });

  it('рекомендация, неприменимая к значению, рекомендацией не остаётся', () => {
    const choices = transformChoices('number', ['lowercase'], '');
    expect(find(choices, 'lowercase').recommended).toBe(false);
  });

  it('незнакомое преобразование из чужого правила не пропадает', () => {
    const choices = transformChoices('string', [], 'sqlHexDecode');
    const unknown = find(choices, 'sqlHexDecode');

    expect(unknown.common).toBe(true);
    expect(unknown.note.ru).toContain('проверьте написание');
  });

  it('у каждого варианта есть название и пояснение на обоих языках', () => {
    for (const choice of transformChoices('string', [], '')) {
      expect(choice.label.en).not.toBe('');
      expect(choice.label.ru).not.toBe('');
      expect(choice.note.en).not.toBe('');
      expect(choice.note.ru).not.toBe('');
    }
  });

  // Синонимы вроде normalizePath и normalisePath делают одно и то же, но
  // общая подпись на двоих не даёт понять, что стоит в закрытом поле.
  it('названия не повторяются, даже у синонимов', () => {
    expectUniqueLabels(transformChoices('string', [], ''));
  });
});

describe('варианты операторов', () => {
  it('показывают все известные операторы, ничего не теряя', () => {
    expect(values(operatorChoices('string', [], '')).sort()).toEqual(
      [...OPERATOR_NAMES].sort(),
    );
  });

  it('над числом текстовые операторы помечены, а числовые — нет', () => {
    const choices = operatorChoices('number', [], '');

    expect(find(choices, 'contains').unfit).not.toBeNull();
    expect(find(choices, 'gt').unfit).toBeNull();
  });

  it('у каждого варианта есть название и пояснение на обоих языках', () => {
    for (const choice of operatorChoices('string', [], '')) {
      expect(choice.label.en).not.toBe('');
      expect(choice.label.ru).not.toBe('');
      expect(choice.note.en).not.toBe('');
      expect(choice.note.ru).not.toBe('');
    }
  });

  it('названия не повторяются: «равно» у строк и у чисел — разные проверки', () => {
    expectUniqueLabels(operatorChoices('string', [], ''));
  });
});

describe('уместное на этой области проверки', () => {
  it('адрес сравнивают с сетью, а не с подстрокой', () => {
    expect(recommendedOperators([target('REMOTE_ADDR')], 'string')).toContain('ipMatch');
  });

  it('путь нормализуют, а заголовок — нет', () => {
    expect(recommendedTransforms([target('REQUEST_FILENAME')])).toContain('normalizePath');
    expect(recommendedTransforms([target('REQUEST_HEADERS')])).not.toContain(
      'normalizePath',
    );
  });

  it('параметр уточняет рекомендацию сильнее, чем имя переменной', () => {
    const agent = recommendedOperators(
      [target('REQUEST_HEADERS', { params: ['User-Agent'] })],
      'string',
    );
    expect(agent[0]).toBe('pmFromFile');
  });

  it('числовой вход отменяет знание об области проверки', () => {
    const counting = recommendedOperators([target('ARGS', { count: true })], 'number');
    expect(counting).toEqual(['eq', 'gt', 'ge', 'lt', 'le']);
  });

  it('о незнакомой переменной ничего не выдумывают сверх общего', () => {
    expect(recommendedTransforms([target('CUSTOM_THING')])).toEqual(
      recommendedTransforms([target('ANOTHER_THING')]),
    );
  });

  it('рекомендуют только то, что база знаний действительно знает', () => {
    const known = new Set(TRANSFORM_NAMES);
    for (const name of recommendedTransforms([target('ARGS')])) {
      expect(known.has(name)).toBe(true);
    }

    const operators = new Set(OPERATOR_NAMES);
    for (const name of recommendedOperators([target('ARGS')], 'string')) {
      expect(operators.has(name)).toBe(true);
    }
  });
});
