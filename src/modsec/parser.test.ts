import { parseModsec, parseActions, parseVariables, parseOperator } from './parser';
import type { SecRuleStatement } from './types';

describe('parseModsec', () => {
  it('splits a SecRule into variables, operator and actions', () => {
    const doc = parseModsec(
      'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:1001,phase:1,deny,status:403,msg:\'Bad bot detected\'"',
    );

    expect(doc.rules).toHaveLength(1);
    const rule = doc.rules[0];

    expect(rule.variables).toEqual([
      {
        raw: 'REQUEST_HEADERS:User-Agent',
        name: 'REQUEST_HEADERS',
        selector: 'User-Agent',
        count: false,
        exclusion: false,
      },
    ]);
    expect(rule.operator).toMatchObject({
      name: 'contains',
      argument: 'badbot',
      negated: false,
      implicit: false,
    });
    expect(rule.id).toBe('1001');
    expect(rule.phase).toBe('1');
    expect(rule.msg).toBe('Bad bot detected');
  });

  it('joins physical lines continued with a trailing backslash', () => {
    const src = 'SecRule ARGS "@rx (?i:union(.*?)select)" \\\n    "id:2001,phase:2,block,t:none,t:lowercase"';
    const doc = parseModsec(src);

    expect(doc.rules).toHaveLength(1);
    expect(doc.rules[0].span).toEqual({ startLine: 1, endLine: 2 });
    expect(doc.rules[0].operator.argument).toBe('(?i:union(.*?)select)');
    expect(doc.rules[0].actions.filter((a) => a.name === 't')).toHaveLength(2);
  });

  it('classifies comments, blanks and generic directives', () => {
    const doc = parseModsec('# hello\n\nSecRuleEngine On');
    expect(doc.statements.map((s) => s.kind)).toEqual([
      'comment',
      'blank',
      'directive',
    ]);
    expect(doc.statements[0]).toMatchObject({ kind: 'comment', text: 'hello' });
    expect(doc.statements[2]).toMatchObject({
      kind: 'directive',
      name: 'SecRuleEngine',
      args: ['On'],
    });
  });

  it('parses SecAction and detects chaining', () => {
    const doc = parseModsec(
      'SecRule ARGS "@rx a" "id:1,phase:2,chain"\nSecAction "id:2,pass,nolog"',
    );
    const rule = doc.statements[0] as SecRuleStatement;
    expect(rule.chained).toBe(true);
    expect(doc.statements[1]).toMatchObject({ kind: 'SecAction', id: '2' });
  });
});

describe('parseVariables', () => {
  it('handles exclusion, count and multiple targets', () => {
    expect(parseVariables('ARGS|!ARGS:token|&REQUEST_HEADERS')).toEqual([
      { raw: 'ARGS', name: 'ARGS', selector: undefined, count: false, exclusion: false },
      { raw: '!ARGS:token', name: 'ARGS', selector: 'token', count: false, exclusion: true },
      { raw: '&REQUEST_HEADERS', name: 'REQUEST_HEADERS', selector: undefined, count: true, exclusion: false },
    ]);
  });
});

describe('parseOperator', () => {
  it('defaults to an implicit rx operator', () => {
    expect(parseOperator('foobar')).toMatchObject({
      name: 'rx',
      argument: 'foobar',
      implicit: true,
    });
  });

  it('reads a negated operator', () => {
    expect(parseOperator('!@eq 0')).toMatchObject({
      name: 'eq',
      argument: '0',
      negated: true,
      implicit: false,
    });
  });
});

describe('parseActions', () => {
  it('keeps macros and quoted values intact', () => {
    const actions = parseActions("id:4000,pass,initcol:ip=%{REMOTE_ADDR},msg:'hi, there'");
    expect(actions.map((a) => a.name)).toEqual(['id', 'pass', 'initcol', 'msg']);
    expect(actions[2].value).toBe('ip=%{REMOTE_ADDR}');
    expect(actions[3]).toMatchObject({ value: 'hi, there', quoted: true });
  });
});
