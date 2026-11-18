import { renderHook, waitFor } from '@testing-library/react';
import { parseModsec } from '../modsec/parser';
import { compileDocument } from '../modsec/compile';
import { createLinter, syncLinter } from '../modsec/inspect';
import { LONE_FILE, blockRef, loneUnit } from '../modsec/workspace';
import { useInspection } from './useInspection';
import type { Diagnostic } from '../modsec/diagnostics';
import type { Linter } from '../modsec/inspect';
import type { WorkspaceUnit } from '../modsec/workspace';

/**
 * Файл заданной длины с одним узнаваемым замечанием на правило.
 *
 * `t:lowercase,t:uppercase` дают `conflictingCaseTransforms`, а `@streq TWO`
 * с `t:lowercase` — `caseNeverMatches`. Ни то, ни другое конструктор не
 * закрывает, то есть приходит только проходом по набору, и по ним видно, о
 * каком документе идёт речь.
 */
function text(count: number, kind: 'conflict' | 'never'): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      kind === 'conflict'
        ? `SecRule ARGS "@rx x${i}" "id:${1000 + i},phase:2,deny,msg:'a',t:lowercase,t:uppercase"`
        : `SecRule ARGS "@streq TWO" "id:${1000 + i},phase:2,deny,msg:'a',t:lowercase"`,
    );
  }
  return lines.join('\n');
}

interface Props {
  units: WorkspaceUnit[];
  blocking: Diagnostic[];
  size: number;
}

/**
 * Набор из одного файла — то, что проход получает от провайдера.
 *
 * Ядро держит тот же текст, что и набор: так же поступает провайдер, прежде
 * чем отдать набор проходу. Собирается набор один раз на документ:
 * отложенный проход сверяет свой итог с тем набором, по которому шёл, по
 * тождеству — иначе он считал бы итог устаревшим на каждом кадре.
 */
function workspace(linter: Linter, source: string): Props {
  syncLinter(linter, [{ id: LONE_FILE, source }]);
  const parsed = parseModsec(source);
  const compiled = compileDocument(parsed);
  return {
    units: [loneUnit(compiled.blocks, parsed.statements)],
    blocking: compiled.diagnostics,
    size: source.length,
  };
}

function codesOf(diagnostics: { code: string }[]): string[] {
  return diagnostics.map((d) => d.code);
}

/** Сколько правил нужно, чтобы набор перестал помещаться в немедленный проход. */
const LARGE = 1500;

describe('проход по набору в приложении', () => {
  it('на небольшом файле готов к первому же кадру', () => {
    const linter = createLinter();
    const small = workspace(linter, text(20, 'conflict'));
    const { result } = renderHook(() =>
      useInspection(linter, small.units, small.blocking, small.size),
    );

    expect(result.current.inspecting).toBe(false);
    expect(codesOf(result.current.diagnostics)).toContain('conflictingCaseTransforms');
    expect(result.current.byRule.get(blockRef(LONE_FILE, 'rule-0'))).toBeDefined();
  });

  it('считает ошибки, предупреждения и советы', () => {
    const linter = createLinter();
    const small = workspace(linter, text(3, 'conflict'));
    const { result } = renderHook(() =>
      useInspection(linter, small.units, small.blocking, small.size),
    );
    const { diagnostics, errorCount, warningCount, adviceCount } = result.current;

    expect(warningCount).toBeGreaterThanOrEqual(3);
    expect(errorCount + warningCount + adviceCount).toBe(diagnostics.length);
  });

  /**
   * На большом наборе проход отложен — и об этом сказано вслух.
   *
   * Пустая панель, которая выглядит как «замечаний нет», хуже пустой панели,
   * которая говорит «проверяем»: первая обманывает, вторая лишь заставляет
   * подождать.
   */
  it('на большом наборе сначала признаётся, что ещё не проверил', async () => {
    const linter = createLinter();
    const large = workspace(linter, text(LARGE, 'conflict'));
    const { result } = renderHook(() =>
      useInspection(linter, large.units, large.blocking, large.size),
    );

    expect(result.current.inspecting).toBe(true);
    expect(codesOf(result.current.diagnostics)).not.toContain('conflictingCaseTransforms');

    await waitFor(() => expect(result.current.inspecting).toBe(false));
    expect(codesOf(result.current.diagnostics)).toContain('conflictingCaseTransforms');
    // Раскладка по блокам собрана по итогам прохода, а не только компиляции.
    expect(result.current.byRule.get(blockRef(LONE_FILE, 'rule-0'))).toBeDefined();
  });

  it('то, что закрывает конструктор, ждать не заставляет и на большом наборе', () => {
    const linter = createLinter();
    const broken = workspace(
      linter,
      ['SecRule ARGS "@nope x" "id:1,phase:2,deny"', text(LARGE, 'conflict')].join('\n'),
    );
    const { result } = renderHook(() =>
      useInspection(linter, broken.units, broken.blocking, broken.size),
    );

    expect(result.current.inspecting).toBe(true);
    expect(codesOf(result.current.diagnostics)).toEqual(['unknownOperator']);
    expect(result.current.errorCount).toBe(1);
  });

  /**
   * Замечания о прежнем тексте не переживают правку.
   *
   * Проход ждёт паузы дольше, чем длится нажатие клавиши, и его прежний итог
   * рассказывает уже о другом документе: номера строк те же, а строки другие.
   */
  it('при замене документа не оставляет замечаний о прежнем', async () => {
    const linter = createLinter();
    const first = workspace(linter, text(LARGE, 'conflict'));
    const { result, rerender } = renderHook(
      (props: Props) => useInspection(linter, props.units, props.blocking, props.size),
      { initialProps: first },
    );

    await waitFor(() => expect(result.current.inspecting).toBe(false));
    expect(codesOf(result.current.diagnostics)).toContain('conflictingCaseTransforms');

    const second = workspace(linter, text(LARGE, 'never'));
    rerender(second);

    expect(result.current.inspecting).toBe(true);
    expect(codesOf(result.current.diagnostics)).not.toContain('conflictingCaseTransforms');
    await waitFor(() => expect(result.current.inspecting).toBe(false));
    expect(codesOf(result.current.diagnostics)).toContain('caseNeverMatches');
    expect(codesOf(result.current.diagnostics)).not.toContain('conflictingCaseTransforms');
  });

  it('когда набор снова мал, отвечает сразу и не ждёт паузы', () => {
    const linter = createLinter();
    const large = workspace(linter, text(LARGE, 'conflict'));
    const { result, rerender } = renderHook(
      (props: Props) => useInspection(linter, props.units, props.blocking, props.size),
      { initialProps: large },
    );
    expect(result.current.inspecting).toBe(true);

    rerender(workspace(linter, text(5, 'never')));

    expect(result.current.inspecting).toBe(false);
    expect(codesOf(result.current.diagnostics)).toContain('caseNeverMatches');
  });
});
