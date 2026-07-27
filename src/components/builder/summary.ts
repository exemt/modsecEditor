/**
 * Однострочные выжимки для свёрнутых блоков конструктора.
 *
 * Свёрнутый блок не должен превращаться в закрытую дверь: по строке заголовка
 * человек решает, разворачивать его или пролистнуть. Поэтому выжимка пишется
 * в том же виде, что и текст правила, — её сверяют с файлом глазами.
 */

import { emitOperator, targetsToVariables } from '../../modsec/emit';
import { serializeVariables } from '../../modsec/serialize';
import type { VisualCondition } from '../../modsec/model';

/**
 * Предел длины аргумента оператора в выжимке.
 *
 * Регулярное выражение бывает длиннее всей строки заголовка, и без обрезки
 * первое же условие съело бы место, отведённое остальным.
 */
const ARGUMENT_LIMIT = 40;

function clip(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Выжимка одного условия: где смотрим и что ищем. */
export function conditionSummary(condition: VisualCondition): string {
  const where = serializeVariables(targetsToVariables(condition.targets));
  const what = emitOperator({
    ...condition.operator,
    argument: clip(condition.operator.argument, ARGUMENT_LIMIT),
  });
  return `${where} ${what}`.trim();
}
