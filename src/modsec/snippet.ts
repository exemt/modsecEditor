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
 * Где в наборе лежит правило с этим `id`.
 *
 * Номер правила общий на набор: по нему исключение находит цель, и по нему же
 * превью открывает исходник, не таская за собой структуру исключения.
 * Строки лежат здесь же — свёрнутому списку текст правила не нужен, а адрес
 * в шапке нужен, и собирать исходник ради двух чисел незачем.
 */
export interface RuleLocation {
  file: string;
  key: string;
  id: string;
  startLine: number;
  endLine: number;
}

/** Файл набора настолько, насколько нужно, чтобы найти правило по номеру. */
export interface RuleIndexUnit {
  id: string;
  blocks: readonly VisualBlock[];
  statements: readonly ParsedStatement[];
}

function locationOf(
  unit: RuleIndexUnit,
  block: VisualBlock,
  id: string,
): RuleLocation | null {
  const [from, to] = blockRange(block);
  const first = unit.statements[from];
  const last = unit.statements[to];
  if (first === undefined || last === undefined) return null;
  return {
    file: unit.id,
    key: block.key,
    id,
    startLine: first.span.startLine,
    endLine: last.span.endLine,
  };
}

function idOf(block: VisualBlock): string | null {
  if (block.kind === 'rule') return block.rule.actions.id;
  if (block.kind === 'action') return block.actions.id;
  return null;
}

/**
 * Первое правило (или `SecAction`) с этим `id`.
 *
 * Пустой номер не ищем: незаданные `id` не различаются, и «найти первое
 * безымянное» притворилось бы адресом, которого у поля нет.
 */
export function locateRule(
  units: readonly RuleIndexUnit[],
  id: string,
): RuleLocation | null {
  if (id === '') return null;

  for (const unit of units) {
    for (const block of unit.blocks) {
      const own = idOf(block);
      if (own !== id) continue;
      const found = locationOf(unit, block, id);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Индекс правил набора по `id`.
 *
 * Первый выигрывает: повторяющийся номер — ошибка конфигурации, и превью
 * показывает то правило, которое ModSecurity увидел раньше.
 */
export function indexRulesById(
  units: readonly RuleIndexUnit[],
): Map<string, RuleLocation> {
  const map = new Map<string, RuleLocation>();
  for (const unit of units) {
    for (const block of unit.blocks) {
      const id = idOf(block);
      if (id === null || id === '' || map.has(id)) continue;
      const found = locationOf(unit, block, id);
      if (found !== null) map.set(id, found);
    }
  }
  return map;
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
