import { parseModsec } from './parser';
import { formatDocument } from './format';
import { modsecExamples } from '../data/modsecExamples';

/** Форматирует исходный текст (для краткости в тестах). */
function format(source: string): string {
  return formatDocument(parseModsec(source));
}

/** Сравнение моделей без учёта `raw`/`span` — они по определению меняются. */
function stripMeta(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) => (key === 'raw' || key === 'span' ? undefined : v)),
  );
}

/** Только содержательные утверждения: пустые строки форматтер расставляет сам. */
function meaningful(source: string): unknown {
  return stripMeta(parseModsec(source).statements.filter((s) => s.kind !== 'blank'));
}

describe('formatDocument', () => {
  it('lays actions out one per line', () => {
    const source =
      'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" ' +
      '"id:1001,phase:1,deny,status:403,msg:\'Bad bot detected\'"';

    expect(format(source)).toBe(
      [
        'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\',
        '    "id:1001,\\',
        '    phase:1,\\',
        '    deny,\\',
        '    status:403,\\',
        "    msg:'Bad bot detected'\"",
        '',
      ].join('\n'),
    );
  });

  it('keeps the transformation pipeline on a single line', () => {
    const source = 'SecRule ARGS "@rx a" "id:1,t:none,t:lowercase,t:urlDecodeUni,deny"';
    expect(format(source)).toContain('    t:none,t:lowercase,t:urlDecodeUni,\\');
  });

  it('leaves a rule without actions on one line', () => {
    expect(format('SecRule ARGS   "@rx a"')).toBe('SecRule ARGS "@rx a"\n');
  });

  it('preserves the model of every example', () => {
    for (const example of modsecExamples) {
      expect(meaningful(format(example.code))).toEqual(meaningful(example.code));
    }
  });

  it('is idempotent', () => {
    for (const example of modsecExamples) {
      const once = format(example.code);
      expect(format(once)).toBe(once);
    }
  });

  it('separates rules but keeps chain links together', () => {
    const source = [
      '# admin check',
      'SecRule REQUEST_URI "@beginsWith /admin" "id:1,chain"',
      'SecRule REQUEST_METHOD "@streq POST" "t:lowercase"',
      'SecRule ARGS "@rx x" "id:2,deny"',
    ].join('\n');

    expect(format(source)).toBe(
      [
        '# admin check',
        'SecRule REQUEST_URI "@beginsWith /admin" \\',
        '    "id:1,\\',
        '    chain"',
        'SecRule REQUEST_METHOD "@streq POST" \\',
        '    "t:lowercase"',
        '',
        'SecRule ARGS "@rx x" \\',
        '    "id:2,\\',
        '    deny"',
        '',
      ].join('\n'),
    );
  });

  it('collapses repeated blank lines and keeps the author ones', () => {
    const source = '\n\nSecRuleEngine On\n\n\n\nSecRuleEngine On\n';
    expect(format(source)).toBe('SecRuleEngine On\n\nSecRuleEngine On\n');
  });

  it('does not rewrite directives it cannot regenerate', () => {
    const source = '  SecDefaultAction "phase:2,log,auditlog,pass"  ';
    expect(format(source)).toBe('SecDefaultAction "phase:2,log,auditlog,pass"\n');
  });

  it('keeps quotes inside values escaped', () => {
    const source = 'SecRule ARGS "@rx a" "id:1,msg:\'say \\"hi\\"\'"';
    const formatted = format(source);
    expect(formatted).toContain('msg:\'say \\"hi\\"\'');
    expect(meaningful(formatted)).toEqual(meaningful(source));
  });

  it('returns an empty document unchanged', () => {
    expect(format('')).toBe('');
  });
});
