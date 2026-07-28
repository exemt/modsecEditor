import { renderHook, waitFor } from '@testing-library/react';
import { parseModsec } from '../modsec/parser';
import { compileDocument } from '../modsec/compile';
import { useInspection } from './useInspection';

/**
 * Файл заданной длины с одним узнаваемым смысловым замечанием на правило.
 *
 * `mark` попадает в трансформации: `t:lowercase,t:uppercase` дают
 * `conflictingCaseTransforms`, а `@streq TWO` с `t:lowercase` —
 * `caseNeverMatches`. Оба замечания смысловые, то есть приходят только
 * отложенным проходом, и по ним видно, о каком документе идёт речь.
 */
function document(count: number, kind: 'conflict' | 'never') {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      kind === 'conflict'
        ? `SecRule ARGS "@rx x${i}" "id:${1000 + i},phase:2,deny,msg:'a',t:lowercase,t:uppercase"`
        : `SecRule ARGS "@streq TWO" "id:${1000 + i},phase:2,deny,msg:'a',t:lowercase"`,
    );
  }
  const parsed = parseModsec(lines.join('\n'));
  return { parsed, compiled: compileDocument(parsed) };
}

function codesOf(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((d) => d.code);
}

describe('смысловой проход в приложении', () => {
  it('на небольшом файле готов к первому же кадру', () => {
    const { parsed, compiled } = document(20, 'conflict');
    const { result } = renderHook(() => useInspection(compiled, parsed));

    expect(result.current.inspecting).toBe(false);
    expect(codesOf(result.current.diagnostics)).toContain('conflictingCaseTransforms');
  });

  /**
   * На большом файле проход отложен — и об этом сказано вслух.
   *
   * Пустая панель, которая выглядит как «замечаний нет», хуже пустой панели,
   * которая говорит «проверяем»: первая обманывает, вторая лишь заставляет
   * подождать.
   */
  it('на большом файле сначала признаётся, что ещё не проверил', async () => {
    const { parsed, compiled } = document(250, 'conflict');
    const { result } = renderHook(() => useInspection(compiled, parsed));

    expect(result.current.inspecting).toBe(true);
    expect(codesOf(result.current.diagnostics)).not.toContain('conflictingCaseTransforms');

    await waitFor(() => expect(result.current.inspecting).toBe(false));
    expect(codesOf(result.current.diagnostics)).toContain('conflictingCaseTransforms');
    // Раскладка по правилам собрана по итогам прохода, а не только структуры.
    expect(result.current.byRule.get('rule-0')).toBeDefined();
  });

  it('структурные замечания большого файла ждать не заставляет', () => {
    const { parsed } = document(250, 'conflict');
    const broken = parseModsec(
      ['SecRule ARGS "@nope x" "id:1,phase:2,deny"', ...parsed.statements.map((s) => s.raw)].join(
        '\n',
      ),
    );
    const { result } = renderHook(() => useInspection(compileDocument(broken), broken));

    expect(codesOf(result.current.diagnostics)).toContain('unknownOperator');
  });

  /**
   * Замечания о прежнем тексте не переживают правку.
   *
   * Проход длится дольше, чем нажатие клавиши, и его незаконченный результат
   * рассказывает уже о другом документе: номера строк те же, а строки другие.
   */
  it('при замене документа не оставляет замечаний о прежнем', async () => {
    const first = document(250, 'conflict');
    const { result, rerender } = renderHook(
      ({ compiled, parsed }: ReturnType<typeof document>) => useInspection(compiled, parsed),
      { initialProps: first },
    );

    await waitFor(() => expect(result.current.inspecting).toBe(false));
    expect(codesOf(result.current.diagnostics)).toContain('conflictingCaseTransforms');

    const second = document(250, 'never');
    rerender(second);

    expect(codesOf(result.current.diagnostics)).not.toContain('conflictingCaseTransforms');
    await waitFor(() => expect(result.current.inspecting).toBe(false));
    expect(codesOf(result.current.diagnostics)).toContain('caseNeverMatches');
    expect(codesOf(result.current.diagnostics)).not.toContain('conflictingCaseTransforms');
  });
});
