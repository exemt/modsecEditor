import { parseModsec } from './parser';
import { compileDocument, groupTargets } from './compile';
import type { DiagnosticCode } from './compile';
import type { VisualRule } from './model';

function compile(source: string) {
  return compileDocument(parseModsec(source));
}

function codes(source: string): DiagnosticCode[] {
  return compile(source).diagnostics.map((d) => d.code);
}

function firstRule(source: string): VisualRule {
  const result = compile(source);
  const block = result.model?.blocks.find((b) => b.kind === 'rule');
  if (block?.kind !== 'rule') throw new Error('no rule compiled');
  return block.rule;
}

const SIMPLE = `SecRule ARGS "@rx foo" "id:1001,phase:2,deny,status:403"`;

describe('compileDocument — structure', () => {
  it('collapses a chain into one rule with several conditions', () => {
    const rule = firstRule(
      [
        'SecRule ARGS "@rx foo" "id:1001,phase:2,deny,chain"',
        'SecRule REQUEST_METHOD "@streq POST" "chain"',
        'SecRule REMOTE_ADDR "@ipMatch 10.0.0.0/8"',
      ].join('\n'),
    );

    expect(rule.conditions).toHaveLength(3);
    expect(rule.conditions.map((c) => c.operator.name)).toEqual(['rx', 'streq', 'ipMatch']);
    expect(rule.actions.id).toBe('1001');
    expect(rule.actions.disruptive).toBe('deny');
  });

  it('reads several targets of one condition as an OR group', () => {
    const rule = firstRule('SecRule ARGS|ARGS_NAMES "@rx foo" "id:1001,phase:2,deny"');
    expect(rule.conditions[0].targets.map((t) => t.name)).toEqual(['ARGS', 'ARGS_NAMES']);
  });

  it('keeps the transformation pipeline in order', () => {
    const rule = firstRule(
      'SecRule ARGS "@rx foo" "id:1001,phase:2,deny,t:none,t:lowercase,t:urlDecode"',
    );
    expect(rule.conditions[0].transforms).toEqual(['none', 'lowercase', 'urlDecode']);
  });

  it('attaches a leading comment to the rule as its description', () => {
    const rule = firstRule(`# Блокируем бота\n${SIMPLE}`);
    expect(rule.comments).toEqual(['Блокируем бота']);
  });

  it('keeps SecMarker and unknown-free directives as separate blocks', () => {
    const result = compile(`SecRuleEngine On\nSecMarker END\n${SIMPLE}`);
    expect(result.ok).toBe(true);
    expect(result.model?.blocks.map((b) => b.kind)).toEqual(['directive', 'marker', 'rule']);
  });
});

describe('groupTargets — terms of one variable', () => {
  const targets = (list: string) =>
    groupTargets(parseModsec(`SecRule ${list} "@rx x" "id:1"`).rules[0].variables);

  it('reads a bare variable as the whole collection', () => {
    expect(targets('REQUEST_HEADERS')).toEqual([
      { name: 'REQUEST_HEADERS', count: false, mode: 'only', params: [] },
    ]);
  });

  it('collects listed parameters into one check area', () => {
    expect(targets('REQUEST_HEADERS:User-Agent|REQUEST_HEADERS:Referer')).toHaveLength(1);
    expect(targets('REQUEST_HEADERS:User-Agent|REQUEST_HEADERS:Referer')[0]).toMatchObject({
      mode: 'only',
      params: ['User-Agent', 'Referer'],
    });
  });

  it('turns subtraction from the whole collection into the "except" mode', () => {
    expect(targets('REQUEST_HEADERS|!REQUEST_HEADERS:Host')).toEqual([
      { name: 'REQUEST_HEADERS', count: false, mode: 'except', params: ['Host'] },
    ]);
  });

  // `ARGS|ARGS:token` — это по-прежнему вся коллекция, а не параметр `token`.
  it('never merges the whole collection with a listing', () => {
    expect(targets('ARGS|ARGS:token').map((t) => t.params)).toEqual([[], ['token']]);
  });

  it('never merges terms that differ in counting', () => {
    expect(targets('&ARGS:a|ARGS:b')).toHaveLength(2);
  });

  // Из перечня вычитать нечем, поэтому вычитание становится своей целью —
  // так текст правила переживает round trip без перестановки термов.
  it('keeps subtraction from a listing as a separate target', () => {
    const mixed = targets('ARGS:/^user_/|!ARGS:user_token');
    expect(mixed).toHaveLength(2);
    expect(mixed[1]).toMatchObject({ mode: 'except', params: ['user_token'], excludeOnly: true });
  });

  it('marks an exclusion with no positive target as exclude-only', () => {
    expect(targets('ARGS|!REQUEST_COOKIES:sid')[1]).toMatchObject({
      name: 'REQUEST_COOKIES',
      excludeOnly: true,
    });
  });

  it('keeps the count prefix on the target', () => {
    expect(targets('&ARGS')[0]).toMatchObject({ name: 'ARGS', count: true });
  });
});

describe('compileDocument — blocking errors', () => {
  it('rejects a rule without an id', () => {
    const result = compile('SecRule ARGS "@rx foo" "phase:2,deny"');
    expect(result.ok).toBe(false);
    expect(result.model).toBeNull();
    expect(codes('SecRule ARGS "@rx foo" "phase:2,deny"')).toContain('missingId');
  });

  it('rejects duplicate rule ids', () => {
    expect(codes(`${SIMPLE}\n${SIMPLE}`)).toContain('duplicateId');
  });

  it('rejects a chain with no following rule', () => {
    expect(codes('SecRule ARGS "@rx foo" "id:1001,phase:2,deny,chain"')).toContain(
      'danglingChain',
    );
  });

  it('rejects an unknown operator', () => {
    expect(codes('SecRule ARGS "@nope foo" "id:1001,phase:2,deny"')).toContain(
      'unknownOperator',
    );
  });

  it('rejects an id on a chain link', () => {
    expect(
      codes(
        [
          'SecRule ARGS "@rx foo" "id:1001,phase:2,deny,chain"',
          'SecRule REQUEST_METHOD "@streq POST" "id:1002"',
        ].join('\n'),
      ),
    ).toContain('chainLinkHeadAction');
  });

  it('rejects an unknown directive', () => {
    expect(codes('SecRuleEngin On')).toContain('unknownDirective');
  });

  it('rejects unbalanced quotes', () => {
    expect(codes('SecRule ARGS "@rx foo "id:1001,phase:2,deny"')).toContain(
      'unbalancedQuotes',
    );
  });
});

describe('compileDocument — warnings do not block the visual editor', () => {
  it('warns that counting ignores transformations but still compiles', () => {
    const result = compile('SecRule &ARGS "@gt 10" "id:1001,phase:2,deny,t:lowercase"');
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('countWithTransforms');
  });

  it('only warns about a missing operator value, so a fresh condition still compiles', () => {
    const result = compile('SecRule ARGS "@rx" "id:1001,phase:2,deny"');
    expect(result.ok).toBe(true);
    expect(result.diagnostics.map((d) => d.code)).toContain('operatorArgumentRequired');
  });

  it('warns about a parameter on a scalar variable', () => {
    expect(codes('SecRule REQUEST_METHOD:x "@streq POST" "id:1001,phase:2,deny"')).toContain(
      'selectorNotSupported',
    );
  });

  it('warns when a variable that requires a parameter has none', () => {
    expect(codes('SecRule TX "@rx foo" "id:1001,phase:2,deny"')).toContain('selectorRequired');
  });

  it('warns about subtracting from a variable the condition never checks', () => {
    expect(codes('SecRule ARGS|!REQUEST_COOKIES:sid "@rx foo" "id:1001,phase:2,deny"')).toContain(
      'excludeWithoutBase',
    );
  });

  it('stays quiet when the subtracted variable is checked by a listing', () => {
    expect(
      codes(
        'SecRule REQUEST_HEADERS:X-Forwarded-For|!REQUEST_HEADERS:Host "@rx foo" "id:1001,phase:2,deny"',
      ),
    ).not.toContain('excludeWithoutBase');
  });

  it('warns when the phase is earlier than the target is filled in', () => {
    expect(codes('SecRule RESPONSE_BODY "@rx foo" "id:1001,phase:1,deny"')).toContain(
      'phaseTooEarly',
    );
  });

  it('warns about a text operator on a counted value', () => {
    expect(codes('SecRule &ARGS "@contains foo" "id:1001,phase:2,deny"')).toContain(
      'operatorInputMismatch',
    );
  });

  it('warns when "none" is not the first transformation', () => {
    expect(
      codes('SecRule ARGS "@rx foo" "id:1001,phase:2,deny,t:lowercase,t:none"'),
    ).toContain('transformNoneNotFirst');
  });

  it('reports a clean rule without diagnostics', () => {
    const result = compile(
      "SecRule ARGS \"@contains foo\" \"id:1001,phase:2,deny,status:403,t:lowercase,msg:'x'\"",
    );
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });

  // Совет — третий уровень: правило работает как написано, поэтому сводка
  // остаётся чистой и переход в конструктор не блокируется.
  it('keeps the summary clean when only advice is found', () => {
    const result = compile(
      "SecRule ARGS \"@rx foo\" \"id:1001,phase:2,deny,status:403,t:lowercase,msg:'x'\"",
    );
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
    expect(result.warningCount).toBe(0);
    expect(result.adviceCount).toBe(1);
    expect(result.diagnostics[0].code).toBe('regexIsPlainText');
  });
});
