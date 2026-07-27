import {
  ACTIONS,
  DIRECTIVES,
  KEYWORD_DOCS,
  OPERATORS,
  TRANSFORMS,
  VARIABLES,
  lookupKeyword,
} from './modsecKeywords';
import { KEYWORD_DETAILS } from './details';

describe('modsec keyword knowledge base', () => {
  it('exposes non-trivial keyword lists', () => {
    expect(DIRECTIVES.length).toBeGreaterThan(30);
    expect(ACTIONS.length).toBeGreaterThan(30);
    expect(TRANSFORMS.length).toBeGreaterThan(20);
    expect(OPERATORS.length).toBeGreaterThan(30);
    expect(VARIABLES.length).toBeGreaterThan(20);
  });

  it('provides bilingual descriptions for every keyword', () => {
    for (const doc of Object.values(KEYWORD_DOCS)) {
      expect(doc.desc.en.length).toBeGreaterThan(0);
      expect(doc.desc.ru.length).toBeGreaterThan(0);
    }
  });

  it('looks up operators with @ and optional negation', () => {
    expect(lookupKeyword('@rx')?.category).toBe('operator');
    expect(lookupKeyword('!@detectSQLi')?.keyword).toBe('detectSQLi');
  });

  it('looks up transformations written as t:name', () => {
    expect(lookupKeyword('t:urlDecodeUni')?.category).toBe('transform');
  });

  it('looks up variables ignoring & prefix and :sub suffix', () => {
    expect(lookupKeyword('&ARGS')?.keyword).toBe('ARGS');
    expect(lookupKeyword('REQUEST_HEADERS:User-Agent')?.keyword).toBe(
      'REQUEST_HEADERS',
    );
  });

  it('returns null for unknown keywords', () => {
    expect(lookupKeyword('totallyUnknown')).toBeNull();
    expect(lookupKeyword('')).toBeNull();
  });
});

// Расширенная подсказка не видна, пока не нажмут Alt, поэтому опечатка в ключе
// или ссылка на несуществующее слово ничем себя не выдаёт — кроме этих тестов.
describe('расширенные подсказки', () => {
  const details = Object.entries(KEYWORD_DETAILS);

  it('привязаны к существующим ключевым словам', () => {
    const unknown = details
      .map(([keyword]) => keyword)
      .filter((keyword) => KEYWORD_DOCS[keyword] === undefined);
    expect(unknown).toEqual([]);
  });

  it('попадают в базу знаний как поле details', () => {
    expect(KEYWORD_DOCS.rx.details?.summary.ru).toContain('регулярным выражением');
    expect(lookupKeyword('t:lowercase')?.details?.summary.en).toContain('lower case');
  });

  it('объясняют слово на двух языках подробнее, чем короткая строка', () => {
    for (const [keyword, doc] of details) {
      expect(doc.summary.en.length).toBeGreaterThan(KEYWORD_DOCS[keyword].desc.en.length);
      expect(doc.summary.ru.length).toBeGreaterThan(KEYWORD_DOCS[keyword].desc.ru.length);
    }
  });

  it('переводят все грабли, примеры и технические свойства', () => {
    for (const [, doc] of details) {
      for (const gotcha of doc.gotchas ?? []) {
        expect(gotcha.en.length).toBeGreaterThan(0);
        expect(gotcha.ru.length).toBeGreaterThan(0);
      }
      for (const fact of Object.values(doc.tech ?? {})) {
        expect(fact.en.length).toBeGreaterThan(0);
        expect(fact.ru.length).toBeGreaterThan(0);
      }
      if (doc.example) expect(doc.example.code.length).toBeGreaterThan(0);
    }
  });

  it('ссылаются в «см. также» только на известные слова', () => {
    const broken: string[] = [];
    for (const [keyword, doc] of details) {
      for (const related of doc.seeAlso ?? []) {
        if (KEYWORD_DOCS[related] === undefined) broken.push(`${keyword} -> ${related}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('покрывают всё, что встречается внутри правила', () => {
    const covered = (list: string[]) =>
      list.filter((keyword) => KEYWORD_DETAILS[keyword] !== undefined).length;

    expect(covered(OPERATORS)).toBe(OPERATORS.length);
    expect(covered(TRANSFORMS)).toBe(TRANSFORMS.length);
    expect(covered(ACTIONS)).toBe(ACTIONS.length);
    expect(covered(VARIABLES)).toBe(VARIABLES.length);
    expect(covered(DIRECTIVES)).toBe(DIRECTIVES.length);
  });
});
