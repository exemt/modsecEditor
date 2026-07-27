import { parseModsec } from './parser';
import { serializeStatement, replaceStatementInSource } from './serialize';
import { modsecExamples } from '../data/modsecExamples';
import type { SecRuleStatement } from './types';

describe('serialize round-trip', () => {
  it('re-parses to an equivalent model for every example', () => {
    for (const example of modsecExamples) {
      const doc = parseModsec(example.code);
      for (const statement of doc.statements) {
        if (statement.kind === 'blank' || statement.kind === 'comment') continue;
        const reparsed = parseModsec(serializeStatement(statement)).statements[0];
        // Сравниваем без учёта raw/span (они по определению меняются).
        expect(stripMeta(reparsed)).toEqual(stripMeta(statement));
      }
    }
  });
});

describe('replaceStatementInSource', () => {
  it('regenerates only the edited statement and keeps the rest verbatim', () => {
    const doc = parseModsec('# note\nSecRule ARGS "@rx a" "id:1,phase:2,deny"');
    const rule = doc.statements[1] as SecRuleStatement;

    const next: SecRuleStatement = {
      ...rule,
      actions: [
        { raw: '', name: 'id', value: '42', quoted: false },
        { raw: '', name: 'phase', value: '2', quoted: false },
        { raw: '', name: 'drop', quoted: false },
      ],
    };
    const source = replaceStatementInSource(doc, 1, next);

    expect(source.split('\n')[0]).toBe('# note');
    const reparsed = parseModsec(source).rules[0];
    expect(reparsed.id).toBe('42');
    expect(reparsed.actions.some((a) => a.name === 'drop')).toBe(true);
    expect(reparsed.actions.some((a) => a.name === 'deny')).toBe(false);
  });
});

function stripMeta(statement: unknown): unknown {
  return JSON.parse(
    JSON.stringify(statement, (key, value) =>
      key === 'raw' || key === 'span' ? undefined : value,
    ),
  );
}
