import { compileDocument } from './compile';
import { parseModsec } from './parser';
import { ruleSnippet } from './snippet';

function compiled(source: string) {
  const doc = parseModsec(source);
  return { blocks: compileDocument(doc).blocks, statements: doc.statements };
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
