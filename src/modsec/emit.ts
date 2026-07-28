/**
 * Обратное преобразование: модель конструктора → текст ModSecurity.
 *
 * Пара к `compile.ts`. Текст остаётся единственным источником правды, поэтому
 * любое действие в визуальном редакторе сводится к «собрать новый текст
 * правила и переразобрать документ».
 *
 * Перегенерируется только затронутый блок; остальные строки документа
 * выводятся из своего `raw`, так что чужое форматирование и комментарии
 * не страдают.
 *
 * Инвариант, который держат тесты:
 * `compile(parse(emit(rule)))` даёт то же самое правило.
 */

import { dquote, serializeActions, serializeVariableList } from './serialize';
import { emptyActions, makeCondition, nextKey } from './model';
import type {
  VisualActions,
  VisualCondition,
  VisualRule,
  VisualTarget,
} from './model';
import type {
  ParsedDocument,
  RuleAction,
  RuleVariable,
} from './types';

/** Отступ строки продолжения (как в примерах CRS). */
const CONTINUATION_INDENT = '    ';

function action(name: string, value?: string): RuleAction {
  return { raw: '', name, value, quoted: false };
}

/**
 * Действие, значение которого принято писать в кавычках.
 *
 * Без кавычек `msg:текст` тоже разберётся, но наборы правил пишут иначе, и
 * выведенное правило должно выглядеть как соседние в файле.
 */
function quotedAction(name: string, value: string): RuleAction {
  return { raw: '', name, value, quoted: true };
}

/* ------------------------------------------------------------------ */
/* Цели и оператор                                                     */
/* ------------------------------------------------------------------ */

/**
 * Разворачивает цели обратно в плоский список термов.
 *
 * Формы ровно три: вся коллекция (`VAR`), перечень параметров
 * (`VAR:a|VAR:b`) и коллекция с вычитанием (`VAR|!VAR:a`). Вычитающие термы
 * идут после своей положительной части — иначе ModSecurity вычтет из ещё
 * не набранного, и правило будет значить не то, что показывает конструктор.
 */
export function targetsToVariables(targets: VisualTarget[]): RuleVariable[] {
  const variables: RuleVariable[] = [];

  for (const target of targets) {
    const listed = target.mode === 'only' ? target.params : [];
    const subtracted = target.mode === 'except' ? target.params : [];

    if (!target.excludeOnly) {
      const selectors = listed.length === 0 ? [undefined] : listed;
      for (const selector of selectors) {
        variables.push({
          raw: '',
          name: target.name,
          selector,
          count: target.count,
          exclusion: false,
        });
      }
    }

    for (const selector of subtracted) {
      variables.push({
        raw: '',
        name: target.name,
        selector: selector === '' ? undefined : selector,
        count: false,
        exclusion: true,
      });
    }
  }

  return variables;
}

/** Собирает содержимое кавычек оператора: `@rx foo`, `!@eq 0`. */
export function emitOperator(operator: VisualCondition['operator']): string {
  const negation = operator.negated ? '!' : '';
  const argument = operator.argument === '' ? '' : ` ${operator.argument}`;
  return `${negation}@${operator.name}${argument}`;
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

/**
 * Раскладывает действия правила обратно в плоский список в каноническом
 * порядке: метаданные → реакция → трансформации → логирование → связка.
 */
export function actionsToList(
  actions: VisualActions,
  transforms: string[],
  chain: boolean,
): RuleAction[] {
  const list: RuleAction[] = [];

  if (actions.id !== '') list.push(action('id', actions.id));
  if (actions.phase !== '') list.push(action('phase', actions.phase));
  if (actions.disruptive !== '') {
    const target = actions.disruptiveValue;
    list.push(action(actions.disruptive, target === '' ? undefined : target));
  }
  if (actions.status !== '') list.push(action('status', actions.status));
  if (actions.capture) list.push(action('capture'));

  for (const t of transforms) list.push(action('t', t));

  if (actions.log === true) list.push(action('log'));
  if (actions.log === false) list.push(action('nolog'));
  if (actions.auditlog === true) list.push(action('auditlog'));
  if (actions.auditlog === false) list.push(action('noauditlog'));

  if (actions.msg !== '') list.push(quotedAction('msg', actions.msg));
  if (actions.logdata !== '') list.push(quotedAction('logdata', actions.logdata));
  if (actions.severity !== '') list.push(action('severity', actions.severity));
  if (actions.ver !== '') list.push(quotedAction('ver', actions.ver));
  if (actions.rev !== '') list.push(quotedAction('rev', actions.rev));
  if (actions.maturity !== '') list.push(quotedAction('maturity', actions.maturity));
  if (actions.accuracy !== '') list.push(quotedAction('accuracy', actions.accuracy));
  for (const tag of actions.tags) list.push(quotedAction('tag', tag));
  for (const setvar of actions.setvar) list.push(action('setvar', setvar));

  list.push(...actions.extra);

  if (chain) list.push(action('chain'));

  return list;
}

/* ------------------------------------------------------------------ */
/* Директивы                                                           */
/* ------------------------------------------------------------------ */

/** Одна директива `SecRule` с переносом строки перед списком действий. */
function emitSecRule(variables: string, operator: string, actions: string): string {
  const head = `SecRule ${variables} ${dquote(operator)}`;
  if (actions === '') return head;
  return `${head} \\\n${CONTINUATION_INDENT}${dquote(actions)}`;
}

/**
 * Сериализует одно звено цепочки.
 * Действия «шапки» пишутся только в головное звено; остальные несут лишь
 * собственные трансформации и, если это не последнее звено, `chain`.
 */
export function emitCondition(
  condition: VisualCondition,
  headActions: VisualActions | null,
  chain: boolean,
): string {
  const variables = serializeVariableList(targetsToVariables(condition.targets));
  const operator = emitOperator(condition.operator);

  const list = headActions
    ? actionsToList(headActions, condition.transforms, chain)
    : [
        ...condition.transforms.map((t) => action('t', t)),
        ...(chain ? [action('chain')] : []),
      ];

  const comments = condition.comments.map((c) => (c === '' ? '#' : `# ${c}`));
  const directive = emitSecRule(variables, operator, serializeActions(list));
  return [...comments, directive].join('\n');
}

/** Собирает всё логическое правило: комментарий-описание + цепочку условий. */
export function emitRule(rule: VisualRule): string[] {
  const lines: string[] = rule.comments.map((c) => (c === '' ? '#' : `# ${c}`));

  rule.conditions.forEach((condition, index) => {
    const isHead = index === 0;
    const isLast = index === rule.conditions.length - 1;
    lines.push(emitCondition(condition, isHead ? rule.actions : null, !isLast));
  });

  return lines;
}

/** Сериализует `SecAction`. */
export function emitActionBlock(actions: VisualActions, comments: string[]): string[] {
  const lines = comments.map((c) => (c === '' ? '#' : `# ${c}`));
  const list = actionsToList(actions, [], false);
  lines.push(`SecAction \\\n${CONTINUATION_INDENT}${dquote(serializeActions(list))}`);
  return lines;
}

/* ------------------------------------------------------------------ */
/* Операции над документом                                             */
/* ------------------------------------------------------------------ */

/**
 * Заменяет диапазон утверждений `[from, to]` на готовые строки.
 * Остальные утверждения сохраняют исходное форматирование.
 */
export function replaceRange(
  doc: ParsedDocument,
  from: number,
  to: number,
  lines: string[],
): string {
  const out: string[] = [];

  doc.statements.forEach((statement, index) => {
    if (index === from) out.push(...lines);
    if (index >= from && index <= to) return;
    out.push(statement.raw);
  });

  if (from >= doc.statements.length) out.push(...lines);
  return out.join('\n');
}

/** Применяет изменённое правило к документу и возвращает новый текст. */
export function applyRule(doc: ParsedDocument, rule: VisualRule): string {
  return replaceRange(doc, rule.startIndex, rule.tailIndex, emitRule(rule));
}

/** Удаляет блок документа (правило целиком вместе с его описанием). */
export function removeRange(doc: ParsedDocument, from: number, to: number): string {
  return replaceRange(doc, from, to, []);
}

/**
 * Вставляет копию правила сразу за оригиналом.
 *
 * Копия получает свободный `id`: два правила с одним номером ModSecurity
 * не примет, а молча оставить дубль номера — значит отдать человеку заведомо
 * нерабочий файл. Всё остальное, включая описание, копируется как есть:
 * дублируют обычно ради «почти такого же» правила.
 */
export function duplicateRule(doc: ParsedDocument, rule: VisualRule): string {
  const copy: VisualRule = {
    ...rule,
    key: nextKey('rule'),
    actions: { ...rule.actions, id: nextFreeId(doc) },
  };
  const lines = doc.statements.map((s) => s.raw);
  const tail = rule.tailIndex;

  return [
    ...lines.slice(0, tail + 1),
    '',
    ...emitRule(copy),
    ...lines.slice(tail + 1),
  ].join('\n');
}

/**
 * Меняет местами два диапазона утверждений.
 *
 * Всё, что лежит между ними, остаётся на месте: пустые строки — разделители
 * блоков, и таскать их за правилом значило бы слипание соседей после первой
 * же перестановки.
 */
export function swapRanges(
  doc: ParsedDocument,
  first: [number, number],
  second: [number, number],
): string {
  const [aFrom, aTo] = first;
  const [bFrom, bTo] = second;
  if (aFrom > bFrom) return swapRanges(doc, second, first);

  const lines = doc.statements.map((s) => s.raw);
  return [
    ...lines.slice(0, aFrom),
    ...lines.slice(bFrom, bTo + 1),
    ...lines.slice(aTo + 1, bFrom),
    ...lines.slice(aFrom, aTo + 1),
    ...lines.slice(bTo + 1),
  ].join('\n');
}

/** Следующий свободный числовой id (max + 1, но не меньше 1000). */
export function nextFreeId(doc: ParsedDocument): string {
  let max = 999;
  for (const statement of doc.statements) {
    if (statement.kind !== 'SecRule' && statement.kind !== 'SecAction') continue;
    const value = statement.actions.find((a) => a.name === 'id')?.value;
    const parsed = value !== undefined ? Number.parseInt(value, 10) : Number.NaN;
    if (!Number.isNaN(parsed) && parsed > max) max = parsed;
  }
  return String(max + 1);
}

/** Заготовка нового правила с одним пустым условием. */
export function makeRule(id: string): VisualRule {
  return {
    key: nextKey('rule'),
    startIndex: -1,
    headIndex: -1,
    tailIndex: -1,
    comments: [],
    conditions: [makeCondition()],
    // Заготовка отличается от пустого набора ровно тем, без чего правило не
    // загрузится или сразу получит замечание: остальные поля перечислять
    // здесь незачем — новое поле модели не должно требовать правки заготовки.
    actions: { ...emptyActions(), id, phase: '2', disruptive: 'deny', status: '403' },
  };
}

/** Добавляет новое правило в конец документа. */
export function appendRule(doc: ParsedDocument): string {
  const lines = doc.statements.map((s) => s.raw);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  const rule = makeRule(nextFreeId(doc));
  if (lines.length > 0) lines.push('');
  lines.push(...emitRule(rule), '');
  return lines.join('\n');
}
