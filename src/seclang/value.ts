/**
 * Тип значения, которое течёт по правилу.
 *
 * Правило — это труба: области проверки отдают значение, преобразования
 * его меняют, оператор сравнивает. Чтобы сказать, годится ли очередной
 * шаг к тому, что пришло от предыдущего, про значение нужно знать две
 * вещи.
 *
 * Первая — **вид**: текст, число или сырые байты. По нему решается, имеет
 * ли шаг смысл вообще: приводить к нижнему регистру число после `t:length`
 * нечем, а сравнивать с текстом сырой хеш после `t:sha1` бесполезно.
 *
 * Вторая — **свойства**: что о тексте известно наверняка. После
 * `t:lowercase` в нём нет заглавных букв, после `t:removeWhitespace` —
 * пробелов. По ним решается, делает ли шаг хоть что-нибудь (`t:trim`
 * после `t:removeWhitespace` — нет) и может ли сравнение вообще совпасть
 * (`@streq POST` после `t:lowercase` — нет).
 *
 * Свойства — битовая маска, а не список: их объединяют и пересекают на
 * каждом шаге каждого правила, и сложение масок здесь на порядок дешевле
 * работы со множествами.
 */

/** Вид значения; `any` — неизвестен, и о нём проверки молчат. */
export type ValueKind = 'string' | 'number' | 'binary' | 'any';

/** Что о значении известно наверняка. */
export const Fact = {
  /** Нет заглавных латинских букв. */
  Lower: 1 << 0,
  /** Нет строчных латинских букв. */
  Upper: 1 << 1,
  /** Нет пробельных символов вовсе. */
  NoSpace: 1 << 2,
  /** Нет пробелов в начале. */
  TrimLeft: 1 << 3,
  /** Нет пробелов в конце. */
  TrimRight: 1 << 4,
  /** Нет двух пробелов подряд и нет пробельных символов, кроме пробела. */
  Squeezed: 1 << 5,
  /** Только шестнадцатеричные цифры в нижнем регистре. */
  Hex: 1 << 6,
  /** Запись числа. */
  Numeric: 1 << 7,
  /** Число, которое не бывает отрицательным: длина, количество. */
  NonNegative: 1 << 8,
  /** Нет нулевых байтов. */
  NoNul: 1 << 9,
  /** Алфавит Base64. */
  Base64: 1 << 10,
  /** Сырой хеш: байты фиксированной длины, не текст. */
  Digest: 1 << 11,
  /**
   * Нет перевода строки. Тогда `^` и `$` в шаблоне — края всего значения в
   * любом движке; иначе ModSecurity 3 и Coraza находят их и на границах строк.
   */
  OneLine: 1 << 12,
} as const;

export type FactName = keyof typeof Fact;

const FACT_NAMES = Object.keys(Fact) as FactName[];

const SPACELESS = Fact.NoSpace | Fact.TrimLeft | Fact.TrimRight | Fact.Squeezed;

/**
 * Достраивает следствия: что ещё верно, раз верно это.
 *
 * Число не содержит ни букв, ни пробелов; в шестнадцатеричной записи нет
 * заглавных; текст без пробелов заведомо обрезан с обоих краёв. Следствия
 * считаются здесь, а не в таблице преобразований, чтобы автор очередной
 * строки таблицы не должен был их помнить.
 */
export function closeFacts(facts: number): number {
  let result = facts;
  if (result & Fact.NonNegative) result |= Fact.Numeric;
  if (result & Fact.Numeric) result |= Fact.Lower | Fact.Upper | SPACELESS | Fact.NoNul;
  if (result & Fact.Hex) result |= Fact.Lower | SPACELESS | Fact.NoNul;
  if (result & Fact.Base64) result |= SPACELESS | Fact.NoNul;
  if (result & Fact.NoSpace) result |= SPACELESS;
  // Перевод строки — пробельный символ, а других, кроме пробела, в сжатом
  // тексте нет.
  if (result & Fact.Squeezed) result |= Fact.OneLine;
  return result;
}

export interface ValueType {
  kind: ValueKind;
  /** Маска из {@link Fact}; всегда замкнута по следствиям. */
  facts: number;
}

export const ANY: ValueType = Object.freeze({ kind: 'any', facts: 0 });
export const STRING: ValueType = Object.freeze({ kind: 'string', facts: 0 });
export const BINARY: ValueType = Object.freeze({ kind: 'binary', facts: 0 });
export const NUMBER: ValueType = Object.freeze({
  kind: 'number',
  facts: closeFacts(Fact.Numeric),
});
/** Количество элементов (`&ARGS`) и длина: число, и не отрицательное. */
export const COUNT: ValueType = Object.freeze({
  kind: 'number',
  facts: closeFacts(Fact.NonNegative),
});

export function valueType(kind: ValueKind, facts = 0): ValueType {
  return { kind, facts: closeFacts(kind === 'number' ? facts | Fact.Numeric : facts) };
}

export function hasFact(type: ValueType, fact: number): boolean {
  return (type.facts & fact) === fact;
}

/** Ширина вида: всё, что число, — ещё и текст; всё, что текст, — байты. */
const WIDTH: Record<ValueKind, number> = { number: 0, string: 1, binary: 2, any: 3 };

/**
 * Общий тип нескольких источников: `ARGS|REQUEST_BODY_LENGTH`.
 *
 * Вид берётся самый широкий, свойства — только общие для всех. Неизвестный
 * вид заражает результат: если хоть один источник непонятен, вид значения
 * уже не назвать. Свойства при этом остаются, если они общие: что в
 * `REQUEST_HEADERS:Content-Length`, решает клиент, но перевода строки там не
 * бывает, как и в `REQUEST_METHOD` рядом.
 */
export function joinTypes(a: ValueType, b: ValueType): ValueType {
  if (a.kind === 'any' || b.kind === 'any') return { kind: 'any', facts: a.facts & b.facts };
  return {
    kind: WIDTH[a.kind] >= WIDTH[b.kind] ? a.kind : b.kind,
    facts: a.facts & b.facts,
  };
}

/** Годится ли значение туда, где ждут один из перечисленных видов. */
export function kindFits(kind: ValueKind, accepted: readonly ValueKind[]): boolean {
  return kind === 'any' || accepted.includes(kind) || accepted.includes('any');
}

/** Имена свойств маски — для сообщений и отладки. */
export function factNames(facts: number): FactName[] {
  return FACT_NAMES.filter((name) => (facts & Fact[name]) !== 0);
}

export function describeType(type: ValueType): string {
  const names = factNames(type.facts);
  return names.length === 0 ? type.kind : `${type.kind}<${names.join(',')}>`;
}
