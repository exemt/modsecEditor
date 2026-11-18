import { reviewRegex, translateRegex } from './regex';
import { regexFeatures } from './regexFeatures';

/**
 * Основные тесты перевода шаблонов живут рядом с редактором
 * (`src/modsec/regex.test.ts`) и ходят сюда же: логика одна. Здесь — то,
 * что добавилось уже в модуле.
 */

describe('перевод шаблона: код символа в фигурных скобках', () => {
  it('переводит `\\x{hh}` в запись, понятную без флага u', () => {
    expect(translateRegex('\\x{ff}').source).toBe('\\xff');
    expect(translateRegex('\\x{7}').source).toBe('\\x07');
    expect(translateRegex('\\x{20ac}').source).toBe('\\u20ac');
    expect(translateRegex('a\\x{41}b').rewrites).toContain('shorthand');
  });

  it('внутри класса символов — тоже: иначе диапазон читается задом наперёд', () => {
    // Так записан шаблон правила 933210 в CRS 4.
    const pattern = '[A-Z_a-z\\x7f-\\x{ff}][0-9A-Z_a-z\\x7f-\\x{ff}]*';
    const review = reviewRegex(pattern);
    expect(review.reason).toBeNull();
    expect(review.regex?.test('caf\xe9')).toBe(true);
    expect(review.regex?.test('!')).toBe(false);
  });

  it('обычный `\\xhh` и квантор после `x` не трогает', () => {
    expect(translateRegex('\\x41{2}').source).toBe('\\x41{2}');
    expect(translateRegex('x{2}').source).toBe('x{2}');
  });
});

describe('возможности PCRE, которых нет в RE2', () => {
  it.each<[string, string[]]>([
    ['^(?=.*\\d)', ['lookahead']],
    ['foo(?!bar)', ['lookahead']],
    ['(?<=\\$)\\d+', ['lookbehind']],
    ['(?<!\\.)\\.php$', ['lookbehind']],
    ["(['\"]).*?\\1", ['backreference']],
    ['(?P<q>a)(?P=q)', ['backreference']],
    ['\\k<name>', ['backreference']],
    ['a++b', ['possessive']],
    ['a*+b', ['possessive']],
    ['a?+b', ['possessive']],
    ['a{2,}+b', ['possessive']],
    ['(?>a|ab)c', ['atomic']],
    ['\\((?:[^()]|(?R))*\\)', ['recursion']],
    ['(?(1)a|b)', ['conditional']],
    ['(?=a)(?<=b)\\1', ['lookahead', 'lookbehind', 'backreference']],
  ])('%s', (pattern, expected) => {
    expect(regexFeatures(pattern)).toEqual(expected);
  });

  it.each([
    '(?i)\\bunion\\b',
    '(?:a|b)+?c*?',
    '(?P<name>\\w+)',
    'a+b',
    'a{2,5}?',
    // То же самое внутри класса и после слэша — обычные знаки.
    '[(?=!<]+',
    '\\(\\?=x\\)',
    '[a-z]++'.slice(0, 6),
    '\\Q(?=a)\\1\\E',
    '\\d+\\.\\d+',
    '[[:alpha:]]+',
    '[]\\1(?=]',
  ])('ничего не находит в %s', (pattern) => {
    expect(regexFeatures(pattern)).toEqual([]);
  });
});
