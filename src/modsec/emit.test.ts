import { parseModsec } from './parser';
import { compileDocument } from './compile';
import { applyRule, duplicateRule, emitRule, removeRange, swapRanges } from './emit';
import { makeCondition, makeTarget } from './model';
import type { VisualBlock, VisualRule } from './model';

function rulesOf(source: string): VisualRule[] {
  const result = compileDocument(parseModsec(source));
  if (!result.ok || result.model === null) {
    throw new Error(`did not compile: ${result.diagnostics.map((d) => d.code).join(', ')}`);
  }
  return result.model.blocks
    .filter((b: VisualBlock): b is Extract<VisualBlock, { kind: 'rule' }> => b.kind === 'rule')
    .map((b) => b.rule);
}

/**
 * Сравнивать модели «как есть» нельзя: ключи и индексы утверждений привязаны
 * к позиции в документе и после перегенерации закономерно меняются.
 */
function shape(rule: VisualRule) {
  return {
    comments: rule.comments,
    actions: rule.actions,
    conditions: rule.conditions.map((c) => ({
      comments: c.comments,
      targets: c.targets,
      transforms: c.transforms,
      operator: c.operator,
    })),
  };
}

const CHAIN = [
  '# Подозрительный POST в админку',
  'SecRule REQUEST_FILENAME|REQUEST_URI "@beginsWith /admin" \\',
  "    \"id:5001,phase:2,deny,status:403,t:lowercase,t:normalizePath,msg:'Admin',tag:'a',chain\"",
  'SecRule REQUEST_METHOD "@streq POST" \\',
  '    "chain"',
  'SecRule REQUEST_HEADERS:X-Forwarded-For|!REQUEST_HEADERS:Host "!@ipMatch 10.0.0.0/8"',
].join('\n');

describe('emitRule — round trip', () => {
  it('survives a full parse → compile → emit → parse → compile cycle', () => {
    const before = rulesOf(CHAIN)[0];
    const after = rulesOf(emitRule(before).join('\n'))[0];
    expect(shape(after)).toEqual(shape(before));
  });

  it('emits one directive per condition and chains all but the last', () => {
    const lines = emitRule(rulesOf(CHAIN)[0]);
    expect(lines).toHaveLength(4); // комментарий + три условия

    const directives = lines.slice(1);
    expect(directives[0]).toContain(',chain"');
    expect(directives[1]).toContain('"chain"');
    expect(directives[2]).not.toContain('chain');
  });

  it('writes head actions only on the first directive of the chain', () => {
    const [head, ...links] = emitRule(rulesOf(CHAIN)[0]).slice(1);
    expect(head).toContain('id:5001');
    for (const link of links) expect(link).not.toContain('id:');
  });

  it('expands exclusions back into "!VAR:selector" entries', () => {
    const rule = rulesOf(CHAIN)[0];
    expect(emitRule(rule)[3]).toContain(
      'REQUEST_HEADERS:X-Forwarded-For|!REQUEST_HEADERS:Host',
    );
  });

  it('keeps the count prefix and operator negation', () => {
    const rule = rulesOf('SecRule &ARGS "!@gt 10" "id:1001,phase:2,deny"')[0];
    expect(emitRule(rule)[0]).toContain('SecRule &ARGS "!@gt 10"');
  });

  // Адрес перенаправления — часть реакции, а не отдельное действие: если
  // читать одно имя, правило после первой же правки в конструкторе начнёт
  // перенаправлять в никуда.
  it('keeps the destination of redirect and proxy', () => {
    const redirect = rulesOf(
      'SecRule ARGS "@rx evil" "id:1001,phase:2,redirect:/blocked.html"',
    )[0];
    expect(redirect.actions.disruptiveValue).toBe('/blocked.html');
    expect(emitRule(redirect)[0]).toContain('redirect:/blocked.html');

    const proxy = rulesOf(
      'SecRule ARGS "@rx evil" "id:1002,phase:2,proxy:http://backend/"',
    )[0];
    expect(proxy.actions.disruptiveValue).toBe('http://backend/');
    expect(emitRule(proxy)[0]).toContain('proxy:http://backend/');
  });

  // Метаданные набора движок не читает вовсе, и в этом соблазн выкинуть их
  // из модели. Тогда они уезжают в конец списка действий после первой же
  // правки соседнего поля — а правило в наборе принято писать иначе.
  it('keeps rule-set metadata in fields of its own', () => {
    const rule = rulesOf(
      'SecRule ARGS "@rx evil" ' +
        "\"id:1001,phase:2,deny,ver:'OWASP_CRS/4.0.0',rev:'2',maturity:'9',accuracy:'8'\"",
    )[0];

    expect(rule.actions.ver).toBe('OWASP_CRS/4.0.0');
    expect(rule.actions.rev).toBe('2');
    expect(rule.actions.maturity).toBe('9');
    expect(rule.actions.accuracy).toBe('8');
    expect(rule.actions.extra).toEqual([]);

    expect(emitRule(rule)[0]).toContain(
      "ver:'OWASP_CRS/4.0.0',rev:'2',maturity:'9',accuracy:'8'",
    );
  });

  it('writes reactions that take no address as a bare name', () => {
    const rule = rulesOf('SecRule ARGS "@rx evil" "id:1001,phase:2,deny,msg:\'x\'"')[0];
    expect(rule.actions.disruptiveValue).toBe('');
    expect(emitRule(rule)[0]).toContain(',deny,');
    expect(emitRule(rule)[0]).not.toContain('deny:');
  });
});

describe('duplicateRule и swapRanges — порядок и копии', () => {
  const twoRules = () =>
    parseModsec(
      [
        '# Первое',
        'SecRule ARGS "@rx first" "id:1001,phase:2,deny"',
        '',
        'SecRule ARGS "@rx second" "id:1002,phase:2,deny"',
        '',
      ].join('\n'),
    );

  it('вставляет копию сразу за оригиналом и даёт ей свободный номер', () => {
    const doc = twoRules();
    const rule = rulesOf(doc.statements.map((s) => s.raw).join('\n'))[0];
    const out = duplicateRule(doc, rule);

    expect(out.match(/^SecRule/gm)).toHaveLength(3);
    // Номер не повторяется: max + 1 по всему документу.
    expect(out).toContain('id:1003');
    expect(out.indexOf('id:1003')).toBeLessThan(out.indexOf('id:1002'));
    // Описание — часть правила, копируется вместе с ним.
    expect(out.match(/# Первое/g)).toHaveLength(2);
  });

  it('меняет местами два блока, не трогая разделитель между ними', () => {
    const doc = twoRules();
    // Первое правило занимает строки описания и директивы, второе — одну.
    expect(swapRanges(doc, [0, 1], [3, 3])).toBe(
      [
        'SecRule ARGS "@rx second" "id:1002,phase:2,deny"',
        '',
        '# Первое',
        'SecRule ARGS "@rx first" "id:1001,phase:2,deny"',
        '',
      ].join('\n'),
    );
  });

  it('не зависит от порядка, в котором переданы диапазоны', () => {
    const doc = twoRules();
    expect(swapRanges(doc, [3, 3], [0, 1])).toBe(swapRanges(doc, [0, 1], [3, 3]));
  });
});

describe('applyRule — document edits', () => {
  const doc = () =>
    parseModsec(
      [
        'SecRuleEngine On',
        '',
        'SecRule ARGS "@rx foo" "id:1001,phase:2,deny"',
        '',
        '# Хвост',
        'SecMarker END',
      ].join('\n'),
    );

  it('rewrites only the edited rule and leaves the rest untouched', () => {
    const document = doc();
    const rule = rulesOf(
      document.statements.map((s) => s.raw).join('\n'),
    )[0];

    const next = applyRule(document, {
      ...rule,
      actions: { ...rule.actions, msg: 'Найдено' },
    });

    expect(next).toContain('SecRuleEngine On');
    expect(next).toContain('# Хвост');
    expect(next).toContain('SecMarker END');
    expect(next).toContain("msg:'Найдено'");
  });

  it('adds a new condition as a chained directive', () => {
    const document = doc();
    const rule = rulesOf(document.statements.map((s) => s.raw).join('\n'))[0];

    const next = applyRule(document, {
      ...rule,
      conditions: [...rule.conditions, makeCondition()],
    });

    expect(rulesOf(next)[0].conditions).toHaveLength(2);
    expect(next).toContain(',chain"');
  });

  it('adds an OR target without losing the existing ones', () => {
    const source = [
      '# Описание',
      'SecRule REQUEST_FILENAME|REQUEST_URI "@beginsWith /admin" \\',
      '    "id:5001,phase:2,deny"',
      '',
    ].join('\n');
    const document = parseModsec(source);
    const rule = rulesOf(source)[0];
    const [condition] = rule.conditions;

    const next = applyRule(document, {
      ...rule,
      conditions: [
        { ...condition, targets: [...condition.targets, makeTarget('ARGS')] },
      ],
    });

    expect(rulesOf(next)[0].conditions[0].targets.map((t) => t.name)).toEqual([
      'REQUEST_FILENAME',
      'REQUEST_URI',
      'ARGS',
    ]);
  });

  it('drops a condition together with its directive', () => {
    const source = emitRule(rulesOf(CHAIN)[0]).join('\n');
    const document = parseModsec(source);
    const rule = rulesOf(source)[0];

    const next = applyRule(document, {
      ...rule,
      conditions: rule.conditions.slice(0, 1),
    });

    expect(rulesOf(next)[0].conditions).toHaveLength(1);
    expect(next).not.toContain('REQUEST_METHOD');
  });

  it('removes a rule together with its description', () => {
    const source = `# Описание\nSecRule ARGS "@rx foo" "id:1001,phase:2,deny"\nSecMarker END`;
    const document = parseModsec(source);
    const rule = rulesOf(source)[0];

    const next = removeRange(document, rule.startIndex, rule.tailIndex);
    expect(next).not.toContain('Описание');
    expect(next).not.toContain('SecRule');
    expect(next).toContain('SecMarker END');
  });
});
