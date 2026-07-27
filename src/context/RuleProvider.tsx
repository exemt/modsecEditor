import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useAppDispatch, useAppSelector } from '../store/hooks';
import { applyRuleSource, undo as undoAction, redo as redoAction } from '../store/ruleSlice';
import { loadDraft, saveDraft } from '../store/draft';
import { compileDocument } from '../modsec/compile';
import {
  applyRule,
  appendRule,
  duplicateRule as duplicateRuleIn,
  removeRange,
  replaceRange,
  swapRanges,
} from '../modsec/emit';
import { formatDocument } from '../modsec/format';
import type { ParsedDocument } from '../modsec/types';
import type { VisualRule } from '../modsec/model';
import { RuleContext } from './ruleContext';
import type { RuleContextValue } from './ruleContext';

interface RuleProviderProps {
  /** Текст правила, которым инициализируется хранилище при монтировании. */
  initialSource?: string;
  /**
   * Помнить документ между сессиями.
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

/**
 * Оборачивает редактор и предоставляет контекст правила. Состояние живёт в
 * Redux; провайдер проецирует его в контекст, один раз засеивает начальным
 * значением и держит закешированный результат компиляции.
 */
export function RuleProvider({ initialSource, persist, children }: RuleProviderProps) {
  const dispatch = useAppDispatch();
  const source = useAppSelector((s) => s.rule.source);
  const parsed = useAppSelector((s) => s.rule.parsed);
  const parseError = useAppSelector((s) => s.rule.parseError);
  const canUndo = useAppSelector((s) => s.rule.past.length > 0);
  const canRedo = useAppSelector((s) => s.rule.future.length > 0);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || initialSource === undefined) return;
    seeded.current = true;
    // Работа прошлой сессии важнее примера: пример человек всегда откроет
    // сам, а свой текст восстановить будет неоткуда.
    const restored = persist ? loadDraft() : null;
    dispatch(applyRuleSource(restored ?? initialSource, 'skip'));
  }, [dispatch, initialSource, persist]);

  useEffect(() => {
    if (!persist || !seeded.current) return;
    const timer = setTimeout(() => saveDraft(source), DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [persist, source]);

  const compiled = useMemo(() => compileDocument(parsed), [parsed]);

  // Актуальная модель для колбэков без пересоздания на каждый рендер.
  const parsedRef = useRef<ParsedDocument | null>(parsed);
  parsedRef.current = parsed;

  const setSource = useCallback(
    (next: string) => {
      dispatch(applyRuleSource(next));
    },
    [dispatch],
  );

  // Структурные правки конструктора — отдельный шаг истории.
  const runDocOp = useCallback(
    (op: (doc: ParsedDocument) => string) => {
      const doc = parsedRef.current;
      if (!doc) return;
      dispatch(applyRuleSource(op(doc), 'push'));
    },
    [dispatch],
  );

  const updateRule = useCallback(
    (rule: VisualRule) => runDocOp((doc) => applyRule(doc, rule)),
    [runDocOp],
  );
  const replaceLines = useCallback(
    (from: number, to: number, lines: string[]) =>
      runDocOp((doc) => replaceRange(doc, from, to, lines)),
    [runDocOp],
  );
  const removeBlock = useCallback(
    (from: number, to: number) => runDocOp((doc) => removeRange(doc, from, to)),
    [runDocOp],
  );
  const addRule = useCallback(() => runDocOp(appendRule), [runDocOp]);
  const duplicateRule = useCallback(
    (rule: VisualRule) => runDocOp((doc) => duplicateRuleIn(doc, rule)),
    [runDocOp],
  );
  const swapBlocks = useCallback(
    (first: [number, number], second: [number, number]) =>
      runDocOp((doc) => swapRanges(doc, first, second)),
    [runDocOp],
  );

  // Форматирование — тоже структурная правка: один шаг истории, и его видно
  // заранее, поэтому кнопку можно гасить, когда текст уже разложен.
  const formatted = useMemo(() => (parsed ? formatDocument(parsed) : null), [parsed]);
  const canFormat = formatted !== null && formatted !== source;
  const formatSource = useCallback(() => {
    if (formatted === null || formatted === source) return;
    dispatch(applyRuleSource(formatted, 'push'));
  }, [dispatch, formatted, source]);

  const undo = useCallback(() => dispatch(undoAction()), [dispatch]);
  const redo = useCallback(() => dispatch(redoAction()), [dispatch]);

  const value = useMemo<RuleContextValue>(
    () => ({
      source,
      parsed,
      parseError,
      compiled,
      setSource,
      updateRule,
      replaceLines,
      removeBlock,
      addRule,
      duplicateRule,
      swapBlocks,
      formatSource,
      canFormat,
      undo,
      redo,
      canUndo,
      canRedo,
    }),
    [
      source,
      parsed,
      parseError,
      compiled,
      setSource,
      updateRule,
      replaceLines,
      removeBlock,
      addRule,
      duplicateRule,
      swapBlocks,
      formatSource,
      canFormat,
      undo,
      redo,
      canUndo,
      canRedo,
    ],
  );

  return <RuleContext.Provider value={value}>{children}</RuleContext.Provider>;
}
