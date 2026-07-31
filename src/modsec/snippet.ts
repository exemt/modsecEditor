/**
 * Фрагмент исходника блока: то, что показывают превью правила.
 *
 * Ключ блока (`rule-3`) считается внутри файла, а текст и номера строк лежат
 * в утверждениях того же файла. Здесь они собираются вместе — без React и
 * без активного файла: превью читает любой файл набора.
 */

import { blockRange } from './model';
import type { VisualBlock } from './model';
import type { ParsedStatement } from './types';

/** Кусок файла, который занимает блок: текст и его место. */
export interface RuleSnippet {
  /** Физические строки исходника, склеенные `\n` — как в файле. */
  text: string;
  /** Первая строка фрагмента в файле (1-based). */
  startLine: number;
  /** Последняя строка фрагмента в файле (1-based). */
  endLine: number;
}

/**
 * Исходник блока по ключу.
 *
 * У правила это вся цепочка вместе с прижатым сверху описанием: превью
 * показывает то же, что займёт карточка, а не одну головную директиву.
 */
export function ruleSnippet(
  blocks: readonly VisualBlock[],
  statements: readonly ParsedStatement[],
  key: string,
): RuleSnippet | null {
  const block = blocks.find((item) => item.key === key);
  if (block === undefined) return null;

  const [from, to] = blockRange(block);
  const slice = statements.slice(from, to + 1);
  if (slice.length === 0) return null;

  return {
    text: slice.map((statement) => statement.raw).join('\n'),
    startLine: slice[0].span.startLine,
    endLine: slice[slice.length - 1].span.endLine,
  };
}
