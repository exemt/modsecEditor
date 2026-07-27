/**
 * Модель визуального конструктора.
 *
 * Это «второй этаж» над разобранным документом (`ParsedDocument`): там —
 * директивы как они написаны, здесь — условия так, как их видит человек.
 *
 * Ключевое отличие: одно логическое правило в ModSecurity может занимать
 * несколько директив `SecRule`, связанных действием `chain`. Для человека это
 * одно правило с несколькими условиями, объединёнными по И, поэтому
 * {@link VisualRule} собирает всю цепочку в один объект, а каждое звено
 * становится {@link VisualCondition}.
 *
 * Внутри звена список переменных — это ИЛИ, а термы одной переменной
 * собираются в одну область проверки: `VAR:a|VAR:b` становится перечнем
 * параметров, `VAR|!VAR:a` — той же коллекцией с вычитанием.
 */

import type { RuleAction } from './types';
import type { DisruptiveAction, TargetLike } from './semantics';

/** Область проверки: переменная и список её параметров. */
export interface VisualTarget extends TargetLike {}

/** Оператор сравнения с аргументом. */
export interface VisualOperator {
  name: string;
  negated: boolean;
  argument: string;
}

/**
 * Одно условие (одна директива `SecRule` цепочки):
 * несколько целей по ИЛИ → конвейер трансформаций → оператор со значением.
 */
export interface VisualCondition {
  /** Стабильный ключ для React (не зависит от порядка). */
  key: string;
  /** Индекс исходной директивы в `ParsedDocument.statements` (-1 для новых). */
  statementIndex: number;
  /** Комментарий, стоящий вплотную перед звеном цепочки. */
  comments: string[];
  targets: VisualTarget[];
  /** Упорядоченный конвейер `t:` — порядок значим. */
  transforms: string[];
  operator: VisualOperator;
}

/** Действия правила — живут на первой директиве цепочки. */
export interface VisualActions {
  id: string;
  phase: string;
  disruptive: DisruptiveAction | '';
  /**
   * Аргумент реакции: адрес для `redirect` и `proxy`.
   *
   * У остальных реакций аргумента не бывает, и поле остаётся пустым. Хранить
   * его отдельно от имени приходится потому, что в тексте это одно действие
   * `redirect:/blocked.html`, а в форме — два разных вопроса: что сделать
   * и куда отправить.
   */
  disruptiveValue: string;
  status: string;
  msg: string;
  logdata: string;
  severity: string;
  tags: string[];
  capture: boolean;
  /** `log` / `nolog`; `null` — не задано явно. */
  log: boolean | null;
  /** `auditlog` / `noauditlog`; `null` — не задано явно. */
  auditlog: boolean | null;
  /** Значения `setvar:...` в порядке следования. */
  setvar: string[];
  /** Действия, которые конструктор не показывает, но обязан сохранить. */
  extra: RuleAction[];
}

/** Логическое правило: цепочка условий по И плюс общие действия. */
export interface VisualRule {
  key: string;
  /**
   * Первая строка блока в документе — либо сама директива, либо первая
   * строка прижатого к ней комментария (описания правила).
   */
  startIndex: number;
  /** Индекс головной директивы `SecRule`. */
  headIndex: number;
  /** Индекс последней директивы цепочки. */
  tailIndex: number;
  /** Комментарий-описание, стоящий вплотную перед правилом. */
  comments: string[];
  /** Звенья цепочки — соединены логическим И. */
  conditions: VisualCondition[];
  actions: VisualActions;
}

/** Безусловное действие `SecAction`. */
export interface VisualActionBlock {
  kind: 'action';
  key: string;
  startIndex: number;
  statementIndex: number;
  comments: string[];
  actions: VisualActions;
}

/** Метка `SecMarker`. */
export interface VisualMarkerBlock {
  kind: 'marker';
  key: string;
  startIndex: number;
  statementIndex: number;
  comments: string[];
  label: string;
}

/** Любая другая директива конфигурации — показываем только для чтения. */
export interface VisualDirectiveBlock {
  kind: 'directive';
  key: string;
  startIndex: number;
  statementIndex: number;
  comments: string[];
  name: string;
  args: string[];
}

export interface VisualRuleBlock {
  kind: 'rule';
  key: string;
  rule: VisualRule;
}

export type VisualBlock =
  | VisualRuleBlock
  | VisualActionBlock
  | VisualMarkerBlock
  | VisualDirectiveBlock;

export interface VisualModel {
  blocks: VisualBlock[];
}

/**
 * Диапазон утверждений, которые занимает блок, — от первой строки описания
 * до последней строки самой директивы.
 *
 * У правила это вся цепочка: переставлять или удалять её можно только целиком,
 * иначе `chain` останется без продолжения.
 */
export function blockRange(block: VisualBlock): [number, number] {
  return block.kind === 'rule'
    ? [block.rule.startIndex, block.rule.tailIndex]
    : [block.startIndex, block.statementIndex];
}

/** Правило модели по ключу — по нему диагностика находит, что чинить. */
export function findRule(model: VisualModel | null, key: string | undefined): VisualRule | null {
  if (model === null || key === undefined) return null;
  for (const block of model.blocks) {
    if (block.kind === 'rule' && block.key === key) return block.rule;
  }
  return null;
}

/** Пустой набор действий. */
export function emptyActions(): VisualActions {
  return {
    id: '',
    phase: '',
    disruptive: '',
    disruptiveValue: '',
    status: '',
    msg: '',
    logdata: '',
    severity: '',
    tags: [],
    capture: false,
    log: null,
    auditlog: null,
    setvar: [],
    extra: [],
  };
}

let keyCounter = 0;

/** Генератор стабильных ключей для новых элементов модели. */
export function nextKey(prefix: string): string {
  keyCounter += 1;
  return `${prefix}-${keyCounter}`;
}

/** Пустая цель по умолчанию — вся коллекция без уточнений. */
export function makeTarget(name = 'ARGS'): VisualTarget {
  return { name, count: false, mode: 'only', params: [] };
}

/** Пустое условие по умолчанию. */
export function makeCondition(): VisualCondition {
  return {
    key: nextKey('cond'),
    statementIndex: -1,
    comments: [],
    targets: [makeTarget()],
    transforms: [],
    operator: { name: 'rx', negated: false, argument: '' },
  };
}
