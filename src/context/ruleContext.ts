import { createContext, useContext } from 'react';
import type { ParsedDocument } from '../modsec/types';
import type { CompileResult } from '../modsec/compile';
import type { VisualRule } from '../modsec/model';

/**
 * Значение контекста редактора правил — тонкий фасад над Redux.
 *
 * Текст правила остаётся источником правды: и текстовый редактор, и
 * визуальный конструктор в конечном счёте вызывают `setSource`. Разница лишь
 * в том, что конструктор сначала собирает новый текст из модели.
 */
export interface RuleContextValue {
  /** «Сырой» текст правила. */
  source: string;
  /** Объектная модель текста (null до первого разбора). */
  parsed: ParsedDocument | null;
  /** Ошибка разбора, если парсер неожиданно упал. */
  parseError: string | null;
  /**
   * Результат компиляции: модель конструктора и список диагностик.
   * `compiled.ok === false` означает, что визуальная вкладка недоступна.
   */
  compiled: CompileResult;

  /** Обновить текст правила (запускает повторный разбор и компиляцию). */
  setSource: (source: string) => void;
  /** Записать изменённое правило обратно в текст. */
  updateRule: (rule: VisualRule) => void;
  /** Заменить диапазон утверждений готовыми строками. */
  replaceLines: (from: number, to: number, lines: string[]) => void;
  /** Удалить блок документа по диапазону утверждений. */
  removeBlock: (from: number, to: number) => void;
  /** Добавить новое правило в конец документа. */
  addRule: () => void;
  /** Разложить текст по строкам: по одному действию в строке. */
  formatSource: () => void;
  /** false, когда форматировать нечего — текст уже в нужном виде. */
  canFormat: boolean;

  /* --- История --- */
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const RuleContext = createContext<RuleContextValue | null>(null);

/** Доступ к контексту правила. Бросает, если вызван вне `RuleProvider`. */
export function useRule(): RuleContextValue {
  const ctx = useContext(RuleContext);
  if (ctx === null) {
    throw new Error('useRule must be used within a <RuleProvider>');
  }
  return ctx;
}
