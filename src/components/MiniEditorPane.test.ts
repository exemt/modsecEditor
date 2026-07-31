import { tokenize } from './syntax/modsecHighlight';
import { tokensByLine } from './MiniEditorPane';

describe('tokensByLine', () => {
  it('режет поток токенов по физическим строкам', () => {
    const lines = tokensByLine(tokenize('SecRule ARGS "@rx x"\nSecAction "id:1"'));

    expect(lines).toHaveLength(2);
    expect(lines[0].map((t) => t.value).join('')).toBe('SecRule ARGS "@rx x"');
    expect(lines[1].map((t) => t.value).join('')).toBe('SecAction "id:1"');
  });

  it('сохраняет пустую строку между двумя непустыми', () => {
    const lines = tokensByLine(tokenize('a\n\nb'));

    expect(lines).toHaveLength(3);
    expect(lines[0].map((t) => t.value).join('')).toBe('a');
    expect(lines[1]).toEqual([]);
    expect(lines[2].map((t) => t.value).join('')).toBe('b');
  });
});
