/**
 * Указатели набора: что на что ссылается через границы правил и файлов.
 *
 * У правила есть три вида связей, смысл которых лежит не в нём самом:
 *
 *  - **метки** — `skipAfter:END` ничего не значит, пока не известно, есть
 *    ли `SecMarker END` и стоит ли он ниже;
 *  - **переменные** — `SecRule TX:score` ничего не проверяет, если
 *    `setvar:tx.score` нет нигде или он выполнится позже;
 *  - **коллекции** — запись в `ip.counter` теряется по концу запроса, если
 *    коллекцию никто не открыл через `initcol`.
 *
 * Здесь собирается, где каждое имя объявлено и где использовано. Судить
 * об этом — дело проверок; указатели только отвечают на вопрос «где».
 *
 * Порядок исполнения — не порядок файла: движок проходит фазу целиком и
 * только внутри неё идёт по строкам. `setvar` из пятой фазы, написанный в
 * начале файла, случится позже чтения во второй. Поэтому у каждого места
 * есть и фаза, и порядковый номер в наборе.
 */

import { findAction } from './ast';
import { parseVariableList } from './parser';
import { countGroups } from './regexFeatures';
import type {
  ActionListNode,
  ActionNode,
  BaseNode,
  CtlNode,
  DirectiveNode,
  ExclusionBy,
  ExclusionNode,
  FileNode,
  MacroNode,
  SecMarkerNode,
  SelectorNode,
  TextNode,
  VariableNode,
} from './ast';
import type { ConditionInfo, RuleInfo } from './analyze';

/**
 * Что с переменной сделано в этом месте.
 *
 *  - `set`, `add`, `sub` — значение появилось или изменилось;
 *  - `delete` — переменная убрана (`setvar:!tx.name`);
 *  - `expire` — ей назначен срок жизни (`expirevar`, `deprecatevar`);
 *  - `read` — значение прочитано: областью проверки или макросом;
 *  - `test` — проверено, есть ли она вообще (`&TX:name`).
 *
 * `test` стоит отдельно от `read` не ради полноты. `SecRule &TX:limit
 * "@eq 0"` — обычный способ задать значение по умолчанию, и читать так
 * переменную, которой ещё нет, — именно то, для чего приём придуман.
 */
export type VariableUse = 'set' | 'add' | 'sub' | 'delete' | 'expire' | 'read' | 'test';

/** Место, в котором имя объявлено или использовано. */
export interface Site {
  file: FileNode;
  rule: RuleInfo;
  /** Узел записи — действие, область проверки или макрос: по нему место показывают. */
  node: BaseNode;
  use: VariableUse;
}

export interface VariableEntry {
  /** Коллекция в нижнем регистре: `tx`, `ip`. */
  collection: string;
  /** Имя в нижнем регистре: движок их регистр не различает. */
  name: string;
  /** `set`, `add`, `sub`, `delete`. */
  writes: Site[];
  /** `read` и `expire`: и то и другое требует, чтобы значение уже было. */
  reads: Site[];
  /** `test`. */
  tests: Site[];
}

export interface MarkerSite {
  file: FileNode;
  node: SecMarkerNode;
  /** Порядковый номер в наборе — общий с правилами. */
  order: number;
}

export interface JumpSite {
  file: FileNode;
  rule: RuleInfo;
  /** Значение действия `skipAfter` — сама метка. */
  node: TextNode;
}

/** Номера правил от и до включительно; одиночный номер — диапазон из одного. */
export interface IdRange {
  from: number;
  to: number;
}

/**
 * Исключение: запись, которая снимает правило или меняет его.
 *
 * Бывает двух родов, и ведут они себя противоположно. Директива
 * (`SecRuleRemoveById`) применяется, пока конфигурация читается, и обязана
 * стоять ниже своей цели. Действие `ctl` применяется, когда сработал его
 * носитель, и обязано отработать раньше цели — а порядок исполнения задаёт
 * сначала фаза и только потом строка.
 */
export interface ExclusionSite {
  file: FileNode;
  source: 'directive' | 'ctl';
  /** Сама запись: директива либо действие `ctl`. */
  node: ExclusionNode | CtlNode;
  /** Правило, в котором стоит `ctl`; у директивы его нет. */
  carrier: RuleInfo | null;
  /** Имя, как написано: `SecRuleRemoveById`, `ruleRemoveTargetById`. */
  name: string;
  op: 'remove' | 'removeTarget' | 'updateTarget' | 'updateAction';
  by: ExclusionBy;
  ids: IdRange[];
  /** То, что стоит на месте номера, но ни номером, ни диапазоном не читается. */
  badIds: string[];
  /** Шаблон выборки по тегу или сообщению. */
  pattern: string | null;
  /** Области: приписываемые (`updateTarget`) или снимаемые (`removeTarget`). */
  targets: VariableNode[];
  /** У `updateTarget` есть третий аргумент — заменяемая область. */
  replaced: boolean;
  /** Порядковый номер в наборе: у директивы свой, у `ctl` — носителя. */
  order: number;
  /** Не хватает выборки или того, что с правилом сделать. */
  incomplete: boolean;
}

/**
 * Условие, которое заполняет `TX:0`…`TX:9`.
 *
 * Захват устроен не так, как выглядит. Проверено на трёх движках, и ведут
 * они себя одинаково:
 *
 *  - `capture` действует на то условие, в списке действий которого записан.
 *    В голове цепочки он не заставит захватывать оператор звена, в звене —
 *    оператор головы;
 *  - группы живут до конца запроса. Правило без `capture` их не трогает,
 *    правило с `capture`, которое не совпало, — тоже. Поэтому `%{TX.1}` без
 *    своего `capture` не пусто, а равно тому, что захватило правило выше;
 *  - `setvar` головы исполняется, когда совпала голова, — раньше, чем
 *    звено успеет что-то захватить.
 *
 * Расходятся движки в одном: ModSecurity 2, захватив, стирает группы
 * старше последней заполненной, а ModSecurity 3 и Coraza оставляют в них
 * прежнее.
 */
export interface CaptureSite {
  file: FileNode;
  rule: RuleInfo;
  /** Номер условия в цепочке. */
  index: number;
  /** Действие `capture`; у захвата из `SecDefaultAction` — само условие. */
  node: BaseNode;
  /** Старшая группа, которую условие заполнит: ноль — только совпадение целиком. */
  groups: number;
  /** `capture` пришёл из `SecDefaultAction`, в условии его нет. */
  inherited: boolean;
}

/**
 * Чтение захваченной группы: `%{TX.1}`, `TX:0`.
 *
 * Где оно стоит, решает, чей захват к нему успеет:
 *
 *  - `target`, `argument` — область проверки и аргумент оператора: читаются
 *    до того, как условие совпало, и своего захвата не видят;
 *  - `action` — значение действия: исполняется, когда совпало это условие;
 *  - `log` — `msg` и `logdata`: раскрываются, когда совпала вся цепочка.
 */
export interface GroupRead {
  file: FileNode;
  rule: RuleInfo;
  /** Номер условия, в котором стоит чтение; у `SecAction` — ноль. */
  index: number;
  where: 'target' | 'argument' | 'action' | 'log';
  group: number;
  node: BaseNode;
}

/** Последние значения переключателей набора — так их читает и движок. */
export interface Settings {
  ruleEngine: { value: string; node: DirectiveNode; file: FileNode } | null;
  requestBodyAccess: boolean | null;
  responseBodyAccess: boolean | null;
  /** В наборе есть `SecDataDir`: без него коллекции не переживают запрос. */
  dataDir: boolean;
  /** В наборе есть `SecGeoLookupDb`: без базы `@geoLookup` ничего не найдёт. */
  geoDb: boolean;
}

export interface Symbols {
  /** Переменные по ключу `tx.score`. */
  variables: Map<string, VariableEntry>;
  /**
   * Записи с макросом в имени, по коллекциям: `setvar:tx.%{rule.id}_hit=1`.
   *
   * Какое имя получится, известно только на запросе, но не всё равно какое:
   * оно обязано подойти под шаблон, в котором макросы заменены на «что
   * угодно». Чтение `tx.score` такой записью не объяснить, а `tx.942100_hit` —
   * можно.
   */
  patterns: Map<string, RegExp[]>;
  /** Коллекция → где её открывают: `initcol`, `setsid`, `setuid`, `setrsc`. */
  inits: Map<string, Site[]>;
  /** Условия, заполняющие `TX:0`…`TX:9`, по правилам. */
  captures: Map<RuleInfo, CaptureSite[]>;
  /** Чтения захваченных групп по правилам. */
  groupReads: Map<RuleInfo, GroupRead[]>;
  /**
   * Правила, которым `capture` достался из `SecDefaultAction`.
   *
   * Вторая версия и Coraza такой захват исполняют, третья — нет. Здесь он
   * считается захватом: сказать «группу никто не заполняет» там, где в
   * двух движках из трёх её заполняют, было бы неправдой.
   */
  defaultCapture: Set<RuleInfo>;
  /**
   * Правила, читающие `TX` целиком или по шаблону, под который подходит
   * имя группы: `SecRule TX "@rx …"` видит и `TX.0`…`TX.9`.
   */
  groupSweeps: Set<RuleInfo>;
  markers: Map<string, MarkerSite[]>;
  /** Переходы `skipAfter` по метке; метка из макроса сюда не попадает. */
  jumps: Map<string, JumpSite[]>;
  /**
   * Где-то в наборе метка перехода берётся из макроса.
   *
   * Куда такой переход ведёт, известно только на запросе, поэтому сказать
   * про метку «на неё никто не прыгает» при нём уже нельзя.
   */
  dynamicJumps: boolean;
  /** Исключения — директивы и `ctl` — в порядке набора. */
  exclusions: ExclusionSite[];
  settings: Settings;
  /** Где-то в наборе стоит `ctl:requestBodyProcessor=XML`. */
  xmlProcessor: boolean;
  /** Где-то в наборе стоит `@geoLookup`: он заполняет `GEO`. */
  geoLookup: boolean;
  /** Где-то `ctl` включает разбор тела запроса или ответа обратно. */
  bodyAccessCtl: boolean;
  /** В наборе есть правило, прерывающее запрос. */
  blocking: boolean;
}

export function newSymbols(): Symbols {
  return {
    variables: new Map(),
    patterns: new Map(),
    inits: new Map(),
    captures: new Map(),
    groupReads: new Map(),
    defaultCapture: new Set(),
    groupSweeps: new Set(),
    markers: new Map(),
    jumps: new Map(),
    dynamicJumps: false,
    exclusions: [],
    settings: {
      ruleEngine: null,
      requestBodyAccess: null,
      responseBodyAccess: null,
      dataDir: false,
      geoDb: false,
    },
    xmlProcessor: false,
    geoLookup: false,
    bodyAccessCtl: false,
    blocking: false,
  };
}

/** Коллекции, в которые пишет `setvar` и за которыми есть смысл следить. */
const TRACKED = new Set(['tx', 'ip', 'session', 'user', 'global', 'resource']);

/** Коллекции, живущие дольше запроса: их открывают явно. */
export const PERSISTENT = new Set(['ip', 'session', 'user', 'global', 'resource']);

/** Реакции, прерывающие запрос. */
export const BLOCKING = new Set(['deny', 'drop', 'redirect', 'proxy', 'block']);

/** Номер или диапазон `942100-942199`; `null` — ни то ни другое. */
export function toIdRange(text: string): IdRange | null {
  const match = /^(\d+)(?:-(\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const from = Number.parseInt(match[1], 10);
  return { from, to: match[2] === undefined ? from : Number.parseInt(match[2], 10) };
}

/** Опции `ctl`, которые снимают правило или его область. */
const CTL_EXCLUSIONS: Record<string, ['remove' | 'removeTarget', ExclusionBy] | undefined> = {
  ruleremovebyid: ['remove', 'id'],
  ruleremovebytag: ['remove', 'tag'],
  ruleremovebymsg: ['remove', 'msg'],
  ruleremovetargetbyid: ['removeTarget', 'id'],
  ruleremovetargetbytag: ['removeTarget', 'tag'],
  ruleremovetargetbymsg: ['removeTarget', 'msg'],
};

/** Исключение, записанное директивой. */
export function directiveExclusion(
  file: FileNode,
  node: ExclusionNode,
  order: number,
): ExclusionSite {
  const ids: IdRange[] = [];
  const badIds: string[] = [];
  let pattern: string | null = null;

  if (node.by === 'id') {
    for (const selector of node.selectors) {
      const range = toIdRange(selector.value);
      if (range === null) badIds.push(selector.value);
      else ids.push(range);
    }
  } else if (node.selectors.length > 0) {
    pattern = node.selectors[0].value;
  }

  const targets = node.variables === null ? [] : node.variables.items;
  const selected = node.by === 'id' ? node.selectors.length > 0 : (pattern ?? '') !== '';
  const payload =
    node.op === 'remove'
      ? true
      : node.op === 'updateTarget'
        ? targets.length > 0
        : node.actions !== null && node.actions.items.length > 0;

  return {
    file,
    source: 'directive',
    node,
    carrier: null,
    name: node.name,
    op: node.op,
    by: node.by,
    ids,
    badIds,
    pattern,
    targets,
    replaced: node.replaced !== null,
    order,
    incomplete: !selected || !payload,
  };
}

/**
 * Исключение, записанное действием `ctl`; `null` — это другая опция.
 *
 * Выборка по номеру здесь ровно одна: `ctl:ruleRemoveById=1,2` движок
 * прочитает как один номер с именем «1,2» и ничего по нему не найдёт.
 * Поэтому всё, что не читается номером или диапазоном, остаётся целиком.
 */
function ctlExclusion(file: FileNode, rule: RuleInfo, node: CtlNode): ExclusionSite | null {
  const kind = CTL_EXCLUSIONS[node.option.toLowerCase()];
  if (kind === undefined) return null;
  const [op, by] = kind;

  const operand = node.operand ?? '';
  const semicolon = op === 'removeTarget' ? operand.indexOf(';') : -1;
  const selector = (semicolon === -1 ? operand : operand.slice(0, semicolon)).trim();
  const targets =
    semicolon === -1 ? [] : parseVariableList(operand.slice(semicolon + 1)).items;

  const ids: IdRange[] = [];
  const badIds: string[] = [];
  if (by === 'id' && selector !== '') {
    const range = toIdRange(selector);
    if (range === null) badIds.push(selector);
    else ids.push(range);
  }

  return {
    file,
    source: 'ctl',
    node,
    carrier: rule,
    name: node.option,
    op,
    by,
    ids,
    badIds,
    pattern: by === 'id' ? null : selector,
    targets,
    replaced: false,
    order: rule.order,
    incomplete: selector === '',
  };
}

/** Действия, чьи макросы раскрываются, когда совпала вся цепочка. */
const LOGGED = new Set(['msg', 'logdata']);

/** Действие, открывающее коллекцию, → коллекция; `null` — названа в значении. */
const OPENERS: Record<string, string | null> = {
  initcol: null,
  setsid: 'session',
  setuid: 'user',
  setrsc: 'resource',
};

export function variableKey(collection: string, name: string): string {
  return `${collection.toLowerCase()}.${name.toLowerCase()}`;
}

/** Операторы, которые при `capture` кладут найденное в `TX.0` и больше ничего. */
const WHOLE_MATCH_ONLY = new Set(['pm', 'pmfromfile', 'pmf', 'detectsqli', 'detectxss']);

/**
 * Старшая группа, которую оператор условия заполнит при `capture`.
 *
 * `-1` — оператор не захватывает вовсе; `null` — захватывает, но сколько
 * групп, отсюда не видно: шаблон собирается из макроса, оператор незнаком
 * или считает группы по-своему. Неизвестность трактуется в пользу правила
 * обеими сторонами: как захват, когда `capture` есть, и не как забытый
 * захват, когда его нет.
 */
export function groupsOf(condition: ConditionInfo): number | null {
  const spec = condition.operator;
  const node = condition.node.operator;
  if (spec === null || node === null) return null;
  if (!spec.captures) return -1;

  const name = spec.name.toLowerCase();
  if (WHOLE_MATCH_ONLY.has(name)) return 0;
  if (name !== 'rx' && name !== 'rxglobal') return null;
  if (node.argument.macros.length > 0) return null;
  return Math.min(9, countGroups(node.argument.value));
}

/** Действие `capture`, записанное в самом условии. */
export function ownCapture(condition: ConditionInfo): ActionNode | null {
  return findAction(condition.node.actions, 'capture');
}

/** Действует ли на условие `capture` — свой или из `SecDefaultAction`. */
export function capturesHere(symbols: Symbols, condition: ConditionInfo): boolean {
  return ownCapture(condition) !== null || symbols.defaultCapture.has(condition.rule);
}

/** Правило `a` исполняется раньше правила `b`: сначала фаза, потом порядок загрузки. */
export function runsBefore(a: RuleInfo, b: RuleInfo): boolean {
  if (a.effectivePhase !== b.effectivePhase) return a.effectivePhase < b.effectivePhase;
  return a.order < b.order;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/** Коллекция и имя: `tx.score`, `ip:counter`. Разделитель — первый из двух. */
function splitTarget(target: string): [string, string] {
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i);
    if (code === 46 || code === 58) return [target.slice(0, i), target.slice(i + 1)];
  }
  return [target, ''];
}

/** Шаблон имени с макросами: всё, кроме макросов, буквально. */
function namePattern(name: string): RegExp {
  const literal = name
    .toLowerCase()
    .split(/%\{[^}]*\}/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'));
  return new RegExp(`^${literal.join('.*')}$`);
}

/**
 * Заносит в указатели всё, что правило объявляет и использует.
 *
 * Зовётся, когда правило собрано целиком, вместе со звеньями цепочки:
 * место записи — это правило, а не утверждение, потому что исполняется
 * цепочка как одно целое.
 */
export function collectRule(symbols: Symbols, file: FileNode, rule: RuleInfo): void {
  const at = (node: BaseNode, use: VariableUse): Site => ({ file, rule, node, use });

  /** Где сейчас идёт сбор: от этого зависит, чей захват успеет к чтению. */
  let index = 0;
  let where: GroupRead['where'] = 'action';

  const note = (collection: string, name: string, site: Site): void => {
    const key = variableKey(collection, name);
    let entry = symbols.variables.get(key);
    if (entry === undefined) {
      entry = { collection, name: name.toLowerCase(), writes: [], reads: [], tests: [] };
      symbols.variables.set(key, entry);
    }
    if (collection === 'tx' && site.use === 'read' && /^\d$/.test(name)) {
      push(symbols.groupReads, rule, { file, rule, index, where, group: Number(name), node: site.node });
    }
    if (site.use === 'test') entry.tests.push(site);
    else if (site.use === 'read' || site.use === 'expire') entry.reads.push(site);
    else entry.writes.push(site);
  };

  const macros = (list: readonly MacroNode[]): void => {
    for (const macro of list) {
      if (macro.key === null || macro.key === '') continue;
      const collection = macro.name.toLowerCase();
      if (TRACKED.has(collection)) note(collection, macro.key, at(macro, 'read'));
    }
  };

  const actions = (list: ActionListNode | null, condition: number): void => {
    if (list === null) return;

    for (const action of list.items) {
      index = condition;
      where = LOGGED.has(action.name.toLowerCase()) ? 'log' : 'action';
      // Макрос в любом значении — чтение, в том числе в имени и в правой
      // части самого `setvar`.
      if (action.value !== null) macros(action.value.macros);

      if (action.kind === 'Setvar') {
        const collection = action.collection.toLowerCase();
        if (!TRACKED.has(collection) || action.key === '') continue;
        if (action.key.indexOf('%{') === -1) note(collection, action.key, at(action, action.op));
        else push(symbols.patterns, collection, namePattern(action.key));
        continue;
      }
      if (action.kind === 'Ctl') {
        const exclusion = ctlExclusion(file, rule, action);
        if (exclusion !== null) symbols.exclusions.push(exclusion);

        const option = action.option.toLowerCase();
        const operand = (action.operand ?? '').trim().toLowerCase();
        if (option === 'requestbodyprocessor' && operand === 'xml') symbols.xmlProcessor = true;
        if ((option === 'requestbodyaccess' || option === 'responsebodyaccess') && operand === 'on') {
          symbols.bodyAccessCtl = true;
        }
        continue;
      }
      if (action.kind !== 'Action') continue;

      const name = action.name.toLowerCase();
      const value = action.value === null ? '' : action.value.value;
      if (BLOCKING.has(name)) symbols.blocking = true;

      if (name === 'skipafter') {
        if (action.value === null || value === '') continue;
        // Метка из макроса известна только на запросе.
        if (action.value.macros.length > 0) symbols.dynamicJumps = true;
        else push(symbols.jumps, value, { file, rule, node: action.value });
      } else if (name === 'expirevar' || name === 'deprecatevar') {
        const equals = value.indexOf('=');
        const [collection, key] = splitTarget(equals === -1 ? value : value.slice(0, equals));
        const lower = collection.trim().toLowerCase();
        if (TRACKED.has(lower) && key !== '' && key.indexOf('%{') === -1) {
          note(lower, key.trim(), at(action, 'expire'));
        }
      } else if (name in OPENERS) {
        const fixed = OPENERS[name];
        const equals = value.indexOf('=');
        const collection = fixed ?? value.slice(0, Math.max(0, equals)).trim().toLowerCase();
        if (collection !== '') push(symbols.inits, collection, at(action, 'set'));
      }
    }
  };

  actions(rule.head.actions, 0);

  for (const condition of rule.conditions) {
    const { node } = condition;
    if (condition.index > 0) actions(node.actions, condition.index);

    // Захват: `capture` при операторе, которому есть что захватывать.
    const capture = ownCapture(condition);
    if (capture !== null || symbols.defaultCapture.has(rule)) {
      const groups = groupsOf(condition);
      if (groups !== -1) {
        push(symbols.captures, rule, {
          file,
          rule,
          index: condition.index,
          node: capture ?? node,
          groups: groups ?? 9,
          inherited: capture === null,
        });
      }
    }

    index = condition.index;
    where = 'argument';
    if (node.operator !== null) {
      macros(node.operator.argument.macros);
      if (node.operator.name.toLowerCase() === 'geolookup') symbols.geoLookup = true;
    }

    where = 'target';
    for (const target of condition.targets) {
      const variable = target.node;
      // Вычитаемый терм переменную не читает, а убирает из набора целей.
      if (variable.exclude) continue;
      const collection = variable.name.toLowerCase();
      if (!TRACKED.has(collection)) continue;
      // Без параметра и по шаблону читается не переменная, а что найдётся.
      const { selector } = variable;
      if (selector === null || selector.pattern || selector.value === '') {
        if (collection === 'tx' && !variable.count && sweepsGroups(selector)) {
          symbols.groupSweeps.add(rule);
        }
        continue;
      }
      note(collection, selector.value, at(variable, variable.count ? 'test' : 'read'));
    }
  }
}

/** Подойдёт ли параметр области к имени группы — `0`…`9`. */
function sweepsGroups(selector: SelectorNode | null): boolean {
  if (selector === null || selector.value === '') return true;
  try {
    const pattern = new RegExp(selector.value.replace(/^\/|\/$/g, ''), 'i');
    for (let group = 0; group <= 9; group++) {
      if (pattern.test(String(group))) return true;
    }
    return false;
  } catch {
    // Шаблон, который здесь не собрать, мог бы и подойти.
    return true;
  }
}

/** Может ли имя получиться из записи с макросом в имени. */
export function matchesPattern(symbols: Symbols, collection: string, name: string): boolean {
  const patterns = symbols.patterns.get(collection);
  if (patterns === undefined) return false;
  for (const pattern of patterns) {
    if (pattern.test(name)) return true;
  }
  return false;
}
