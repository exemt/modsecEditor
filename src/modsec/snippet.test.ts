import { compileDocument } from './compile';
import { parseModsec } from './parser';
import { locateRule, ruleSnippet } from './snippet';

function compiled(source: string) {
  const doc = parseModsec(source);
  return { blocks: compileDocument(doc).blocks, statements: doc.statements };
}

function unit(name: string, source: string) {
  const doc = parseModsec(source);
  return {
    id: name,
    blocks: compileDocument(doc, name).blocks,
    statements: doc.statements,
  };
}

describe('ruleSnippet', () => {
  it('отдаёт текст и строки одного правила', () => {
    const { blocks, statements } = compiled(
      'SecRule ARGS "@rx foo" "id:1001,phase:2,deny"',
    );

    expect(ruleSnippet(blocks, statements, 'rule-0')).toEqual({
      text: 'SecRule ARGS "@rx foo" "id:1001,phase:2,deny"',
      startLine: 1,
      endLine: 1,
    });
  });

  it('берёт всю цепочку и прижатый комментарий', () => {
    const source = [
      '# SQL injection',
      'SecRule ARGS "@rx foo" "id:1001,phase:2,deny,chain"',
      'SecRule REQUEST_METHOD "@streq POST"',
    ].join('\n');
    const { blocks, statements } = compiled(source);

    expect(ruleSnippet(blocks, statements, 'rule-1')).toEqual({
      text: source,
      startLine: 1,
      endLine: 3,
    });
  });

  it('для неизвестного ключа отвечает null', () => {
    const { blocks, statements } = compiled(
      'SecRule ARGS "@rx foo" "id:1001,phase:2,deny"',
    );

    expect(ruleSnippet(blocks, statements, 'rule-99')).toBeNull();
  });
});

describe('locateRule', () => {
  it('находит правило по id в наборе', () => {
    expect(
      locateRule(
        [unit('rules.conf', 'SecRule ARGS "@rx foo" "id:1001,phase:2,deny"')],
        '1001',
      ),
    ).toEqual({
      file: 'rules.conf',
      key: 'rule-0',
      id: '1001',
      startLine: 1,
      endLine: 1,
    });
  });

  it('для неизвестного и пустого id отвечает null', () => {
    const units = [unit('rules.conf', 'SecRule ARGS "@rx foo" "id:1001,phase:2,deny"')];
    expect(locateRule(units, '9999')).toBeNull();
    expect(locateRule(units, '')).toBeNull();
  });
});

