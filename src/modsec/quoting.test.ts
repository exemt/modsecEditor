import { parseModsec, parseVariables } from './parser';
import { serializeStatement, serializeVariableList } from './serialize';
import { analyzeDocument } from './compile';
import { emitRule, makeRule } from './emit';
import { selectorIssue, selectorPattern } from './quoting';
import type { VisualTarget } from './model';

/** Текст правила, у которого единственная цель — заданная. */
function ruleText(target: VisualTarget): string {
  const rule = makeRule('1001');
  rule.conditions[0].targets = [target];
  rule.conditions[0].operator = { name: 'rx', negated: false, argument: 'evil' };
  return emitRule(rule).join('\n');
}

/** Цели правила после обратного разбора собственного вывода. */
function reparsedTargets(target: VisualTarget): VisualTarget[] | null {
  const block = analyzeDocument(parseModsec(ruleText(target))).model?.blocks[0];
  return block?.kind === 'rule' ? block.rule.conditions[0].targets : null;
}

describe('параметр области проверки', () => {
  it('хранится без кавычек и экранирования', () => {
    expect(parseVariables("ARGS:'my param'")[0].selector).toBe('my param');
    expect(parseVariables("ARGS:'/^(a|b)$/'")[0].selector).toBe('/^(a|b)$/');
    expect(parseVariables("ARGS:'it\\'s'")[0].selector).toBe("it's");
    expect(parseVariables('ARGS:token')[0].selector).toBe('token');
  });

  it('отделяется запятой так же, как движком', () => {
    expect(parseVariables('ARGS:a,b').map((v) => v.name)).toEqual(['ARGS', 'b']);
    expect(parseVariables("ARGS:'a,b'")).toHaveLength(1);
    expect(parseVariables("ARGS:'a,b'")[0].selector).toBe('a,b');
  });

  it('записывается обратно так же, с кавычками только там, где нужны', () => {
    expect(serializeVariableList(parseVariables('ARGS:token'))).toBe('ARGS:token');
    expect(serializeVariableList(parseVariables('ARGS:/^id_/'))).toBe('ARGS:/^id_/');
    // Шаблону с `|` нужны одинарные кавычки, но не двойные: пробела нет.
    expect(serializeVariableList(parseVariables("ARGS:'/^(a|b)$/'"))).toBe(
      "ARGS:'/^(a|b)$/'",
    );
    // Пробел разорвал бы строку директивы, поэтому список целиком в кавычках.
    expect(serializeVariableList(parseVariables("ARGS:'my param'"))).toBe(
      `"ARGS:'my param'"`,
    );
  });

  it('переживает круг конструктор → текст → конструктор', () => {
    for (const params of [['my param'], ['/^(a|b)$/'], ["it's"], ['a,b'], ['X-My Header']]) {
      const target: VisualTarget = { name: 'ARGS', count: false, mode: 'only', params };
      expect(reparsedTargets(target)).toEqual([target]);
    }
  });

  it('без кавычек список переменных разорвался бы по пробелу', () => {
    // Проверка на регресс: именно так правило теряло оператор и действия.
    const text = ruleText({ name: 'ARGS', count: false, mode: 'only', params: ['my param'] });
    const rule = parseModsec(text).rules[0];
    expect(rule.operator.argument).toBe('evil');
    expect(rule.id).toBe('1001');
  });
});

describe('selectorIssue', () => {
  it('молчит там, где запись понимают обе версии движка', () => {
    expect(selectorIssue('token')).toBeNull();
    expect(selectorIssue('')).toBeNull();
    expect(selectorIssue('/^id_/')).toBeNull();
    expect(selectorIssue('/^(a|b)$/')).toBeNull();
  });

  it('помечает кавычки, которых не поймёт третья версия', () => {
    expect(selectorIssue('my param')).toBe('v2only');
    expect(selectorIssue('a|b')).toBe('v2only');
  });

  it('помечает записи, которые версии прочитают по-разному', () => {
    expect(selectorIssue("it's")).toBe('ambiguous');
    expect(selectorIssue('/^(a|b)\\d/')).toBe('ambiguous');
  });
});

describe('selectorPattern', () => {
  it('заменяет пробел кодом символа и экранирует остальное', () => {
    expect(selectorPattern('my param')).toBe('/^my\\x20param$/');
    expect(selectorPattern('Add to Basket.x')).toBe('/^Add\\x20to\\x20Basket\\.x$/');
  });

  it('не предлагает замены там, где её нет', () => {
    expect(selectorPattern('token')).toBeNull();
    expect(selectorPattern('a|b c')).toBeNull();
  });
});

describe('диагностика параметров', () => {
  const codes = (target: VisualTarget) =>
    analyzeDocument(parseModsec(ruleText(target))).diagnostics.map((d) => d.code);

  it('предлагает шаблон вместо имени с пробелом', () => {
    const target: VisualTarget = {
      name: 'ARGS',
      count: false,
      mode: 'only',
      params: ['my param'],
    };
    expect(codes(target)).toContain('selectorNeedsQuotes');

    const diag = analyzeDocument(parseModsec(ruleText(target))).diagnostics.find(
      (d) => d.code === 'selectorNeedsQuotes',
    );
    expect(diag?.params?.pattern).toBe('/^my\\x20param$/');
  });

  it('сообщает, когда портируемой записи нет', () => {
    expect(codes({ name: 'ARGS', count: false, mode: 'only', params: ["it's"] })).toContain(
      'selectorNotPortable',
    );
  });

  it('молчит на обычном имени и на шаблоне', () => {
    const clean = codes({ name: 'ARGS', count: false, mode: 'only', params: ['/^id_/'] });
    expect(clean).not.toContain('selectorNeedsQuotes');
    expect(clean).not.toContain('selectorNotPortable');
  });
});

describe('значения действий', () => {
  it('не наращивают экранирование от круга к кругу', () => {
    const src = "SecRule ARGS \"@rx x\" \"id:2,phase:2,deny,msg:'it\\'s here'\"";
    expect(parseModsec(src).rules[0].msg).toBe("it's here");

    let text = src;
    for (let i = 0; i < 3; i++) {
      text = serializeStatement(parseModsec(text).statements[0]);
      expect(parseModsec(text).rules[0].msg).toBe("it's here");
    }
  });
});

describe('строка директивы', () => {
  it('не теряет закрывающую кавычку из-за пары слэшей', () => {
    const doc = parseModsec('SecRule ARGS "@rx a\\\\" "id:1,phase:2,deny"');
    expect(doc.rules[0].operator.argument).toBe('a\\\\');
    expect(doc.rules[0].id).toBe('1');
  });

  it('сохраняет кавычки у аргумента с пробелом', () => {
    const doc = parseModsec(`SecRuleUpdateActionById 900001 "msg:'a b'"`);
    expect(serializeStatement(doc.statements[0])).toBe(
      `SecRuleUpdateActionById 900001 "msg:'a b'"`,
    );
  });
});
