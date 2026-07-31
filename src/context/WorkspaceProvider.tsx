import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import {
  DEFAULT_NAME,
  addFiles,
  markSaved as markSavedAction,
  moveFile as moveFileAction,
  newFile as newFileThunk,
  removeFile as removeFileAction,
  replaceWorkspace as replaceWorkspaceAction,
  select as selectAction,
} from '../store/filesSlice';
import { loadDraft, saveDraft } from '../store/draft';
import { compileDocument } from '../modsec/compile';
import { readExclusions, indexWorkspaceExclusions } from '../modsec/exclusions';
import { indexRulesById, ruleSnippet } from '../modsec/snippet';
import { indexWorkspaceVariables } from '../modsec/variables';
import { fileOrder } from '../modsec/workspace';
import type { RuleLocation, RuleSnippet } from '../modsec/snippet';
import { RuleProvider } from './RuleProvider';
import { WorkspaceContext } from './workspaceContext';
import { useInspection } from './useInspection';
import type { CompileResult } from '../modsec/compile';
import type { Diagnostic } from '../modsec/diagnostics';
import type { ExclusionDirective } from '../modsec/exclusions';
import type { ParsedDocument, ParsedStatement } from '../modsec/types';
import type { WorkspaceUnit } from '../modsec/workspace';
import type { NewFile } from '../store/filesSlice';
import type { WorkspaceContextValue, WorkspaceFile } from './workspaceContext';

interface WorkspaceProviderProps {
  /** Файл, которым набор засеивается при монтировании. */
  initialFile?: NewFile;
  /**
   * Помнить набор между сессиями.
   *
   * Включается только приложением. Тесты и истории рендерят провайдер без
   * этого флага и не трогают хранилище браузера — иначе один прогон
   * подкладывал бы текст следующему.
   */
  persist?: boolean;
  children: ReactNode;
}

/** Пауза перед записью черновика: набор текста не должен идти в хранилище посимвольно. */
const DRAFT_DEBOUNCE_MS = 400;

const NO_STATEMENTS: ParsedStatement[] = [];

/** Разбор файла набора: всё, что считается по нему одному. */
interface Entry {
  /** Разбор, по которому это посчитано: сменился — считаем заново. */
  parsed: ParsedDocument | null;
  name: string;
  /** Номер в порядке включения: он входит в места исключений. */
  order: number;
  compiled: CompileResult;
  unit: WorkspaceUnit;
  directives: ExclusionDirective[];
}

/**
 * Набор файлов и всё, что считается по нему целиком.
 *
 * Смысловой проход идёт по набору, а компиляция — по файлу, и именно поэтому
 * здесь живёт кеш по файлам: правка одного файла не должна перекомпилировать
 * остальные. Отсюда же приходит компиляция активного файла — второй раз
 * считать её незачем.
 */
export function WorkspaceProvider({ initialFile, persist, children }: WorkspaceProviderProps) {
  const dispatch = useAppDispatch();
  const files = useAppSelector((s) => s.files.files);
  const activeId = useAppSelector((s) => s.files.activeId);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || initialFile === undefined) return;
    seeded.current = true;
    // Работа прошлой сессии важнее примера: пример человек всегда откроет
    // сам, а свой текст восстановить будет неоткуда.
    const restored = persist ? loadDraft() : null;
    if (restored === null) {
      dispatch(replaceWorkspaceAction({ files: [initialFile] }));
      return;
    }
    dispatch(
      replaceWorkspaceAction({
        // Черновик прошлой версии редактора хранил текст без имени.
        files: restored.files.map((file) => ({
          name: file.name === '' ? DEFAULT_NAME : file.name,
          source: file.source,
        })),
        activeAt: restored.activeAt,
      }),
    );
  }, [dispatch, initialFile, persist]);

  useEffect(() => {
    if (!persist || !seeded.current) return;
    const timer = setTimeout(() => {
      saveDraft({
        files: files.map((file) => ({ name: file.name, source: file.source })),
        activeAt: Math.max(
          0,
          files.findIndex((file) => file.id === activeId),
        ),
      });
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [persist, files, activeId]);

  // Кеш переживает пересчёт: в нём лежит работа, которую жалко потерять, а не
  // состояние — от разбора файла результат не зависит ничем другим.
  const cache = useRef(new Map<string, Entry>());

  const built = useMemo(() => {
    const next = new Map<string, Entry>();
    const units: WorkspaceUnit[] = [];
    const structural: Diagnostic[] = [];
    const directives: ExclusionDirective[] = [];

    files.forEach((file, order) => {
      const old = cache.current.get(file.id);
      let entry = old;

      if (entry === undefined || entry.parsed !== file.parsed || entry.name !== file.name || entry.order !== order) {
        const statements = file.parsed?.statements ?? NO_STATEMENTS;
        // Разбор тот же — та же и компиляция: переставили файл или переименовали,
        // а строки в нём остались прежними.
        const compiled =
          old !== undefined && old.parsed === file.parsed
            ? old.compiled
            : compileDocument(file.parsed, file.id);
        entry = {
          parsed: file.parsed,
          name: file.name,
          order,
          compiled,
          unit: { id: file.id, name: file.name, blocks: compiled.blocks, statements },
          directives: readExclusions(statements, file.id, order),
        };
      }

      next.set(file.id, entry);
      units.push(entry.unit);
      structural.push(...entry.compiled.diagnostics);
      directives.push(...entry.directives);
    });

    cache.current = next;
    return { entries: next, units, structural, directives };
  }, [files]);

  const { units, structural, directives } = built;

  const exclusions = useMemo(
    () => indexWorkspaceExclusions(units, directives),
    [units, directives],
  );
  const variables = useMemo(() => indexWorkspaceVariables(units), [units]);
  const order = useMemo(() => fileOrder(units), [units]);
  const analysis = useInspection(units, structural, exclusions, order);

  // Файла может не быть вовсе — например, до засева. Пустая компиляция
  // говорит то же, что сказала бы о неразобранном тексте: показывать нечего.
  const activeCompiled = useMemo(
    () => built.entries.get(activeId)?.compiled ?? compileDocument(null, activeId),
    [built, activeId],
  );

  const view = useMemo<WorkspaceFile[]>(
    () =>
      files.map((file) => ({
        id: file.id,
        name: file.name,
        lines: file.source === '' ? 0 : file.source.split('\n').length,
        edited: file.source !== file.baseline,
        exampleId: file.exampleId,
      })),
    [files],
  );

  const names = useMemo(() => new Map(files.map((file) => [file.id, file.name])), [files]);
  const nameOf = useCallback((id: string) => names.get(id) ?? '', [names]);
  const textOf = useCallback(
    (id: string) => files.find((file) => file.id === id)?.source ?? '',
    [files],
  );
  const snippetOf = useCallback(
    (file: string, key: string): RuleSnippet | null => {
      const unit = built.entries.get(file)?.unit;
      if (unit === undefined) return null;
      return ruleSnippet(unit.blocks, unit.statements, key);
    },
    [built],
  );
  // Индекс по id считается вместе с units: диалог списка спрашивает место
  // правила десятки раз, и каждый раз обходить набор заново незачем.
  const rulesById = useMemo(() => indexRulesById(units), [units]);
  const ruleOf = useCallback(
    (id: string): RuleLocation | null => rulesById.get(id) ?? null,
    [rulesById],
  );

  const selectFile = useCallback((id: string) => dispatch(selectAction(id)), [dispatch]);
  const openFiles = useCallback((added: NewFile[]) => dispatch(addFiles(added)), [dispatch]);
  const newFile = useCallback(() => dispatch(newFileThunk()), [dispatch]);
  const moveFile = useCallback(
    (id: string, to: number) => dispatch(moveFileAction({ id, to })),
    [dispatch],
  );
  const markSaved = useCallback((id: string) => dispatch(markSavedAction(id)), [dispatch]);
  const replaceWorkspace = useCallback(
    (next: NewFile[]) => dispatch(replaceWorkspaceAction({ files: next })),
    [dispatch],
  );

  const removeFile = useCallback(
    (id: string) => {
      // Последний файл не убирают, а очищают: редактор без файла — это
      // редактор без текста, и вернуться в него было бы неоткуда.
      if (files.length > 1) {
        dispatch(removeFileAction(id));
        return;
      }
      const only = files.find((file) => file.id === id);
      if (only === undefined) return;
      dispatch(replaceWorkspaceAction({ files: [{ name: only.name, source: '' }] }));
    },
    [dispatch, files],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      files: view,
      activeId,
      analysis,
      exclusions,
      variables,
      activeCompiled,
      nameOf,
      textOf,
      snippetOf,
      ruleOf,
      selectFile,
      openFiles,
      newFile,
      removeFile,
      moveFile,
      markSaved,
      replaceWorkspace,
    }),
    [
      view,
      activeId,
      analysis,
      exclusions,
      variables,
      activeCompiled,
      nameOf,
      textOf,
      snippetOf,
      ruleOf,
      selectFile,
      openFiles,
      newFile,
      removeFile,
      moveFile,
      markSaved,
      replaceWorkspace,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <RuleProvider>{children}</RuleProvider>
    </WorkspaceContext.Provider>
  );
}
