import { tokenize } from './modsecHighlight';

describe('modsec tokenizer', () => {
  const byType = (src: string, type: string) =>
    tokenize(src).filter((tok) => tok.type === type);

  it('recognizes directive, variable and operator', () => {
    const tokens = tokenize('SecRule ARGS "@rx foo"');
    const first = (type: string) =>
      tokens.filter((tok) => tok.type === type)[0]?.value;

    expect(first('directive')).toBe('SecRule');
    expect(first('variable')).toBe('ARGS');
    expect(first('operator')).toBe('@rx');
  });

  it('treats a leading # line as a comment', () => {
    const tokens = tokenize('# just a comment');
    expect(tokens[0]).toEqual({ type: 'comment', value: '# just a comment' });
  });

  it('recognizes transformations, actions and negated operators', () => {
    const src = 'SecRule ARGS "!@detectSQLi" "id:1,phase:2,t:lowercase,deny"';
    expect(byType(src, 'transform').map((t) => t.value)).toContain('t:lowercase');
    expect(byType(src, 'operator').map((t) => t.value)).toContain('!@detectSQLi');
    const actions = byType(src, 'action').map((t) => t.value);
    expect(actions).toEqual(expect.arrayContaining(['id', 'phase', 'deny']));
  });

  it('recognizes macro expansions', () => {
    expect(byType('initcol:ip=%{REMOTE_ADDR}', 'macro').map((t) => t.value)).toEqual([
      '%{REMOTE_ADDR}',
    ]);
  });

  it('highlights unknown Sec* directives via the fallback rule', () => {
    expect(byType('SecFooBar On', 'directive').map((t) => t.value)).toContain(
      'SecFooBar',
    );
  });

  it('prefers the longer keyword (skipAfter over skip)', () => {
    expect(byType('skipAfter END', 'action')[0]?.value).toBe('skipAfter');
  });

  it('reconstructs the original source losslessly', () => {
    const src = "SecRule ARGS \"@rx x\" \"id:1,phase:2,deny,msg:'hi'\"";
    expect(tokenize(src).map((t) => t.value).join('')).toBe(src);
  });
});
