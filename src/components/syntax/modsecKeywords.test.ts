import {
  ACTIONS,
  DIRECTIVES,
  KEYWORD_DOCS,
  OPERATORS,
  TRANSFORMS,
  VARIABLES,
  lookupKeyword,
} from './modsecKeywords';

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
