/**
 * Смысловая модель: что дерево значит.
 *
 * Парсер отдаёт утверждения по одному. Здесь они связываются: звенья
 * цепочки собираются в правило, преобразования — в конвейер с типом
 * значения на каждом шаге, номера правил и метки — в указатели на весь
 * файл.
 *
 * Модель строится одним проходом по утверждениям и ничего не копирует из
 * дерева: каждая её запись ссылается на узлы, из которых получена. Линтер
 * поэтому может говорить о смысле («на этом шаге в руках уже число»), а
 * показывать место в исходнике.
 *
 * Главное здесь — {@link Pipeline}. По нему отвечают на вопросы, ради
 * которых модель и нужна: какой тип отдал предыдущий шаг, годится ли он
 * следующему, можно ли в этом месте поставить такое преобразование.
 */

import { findAction } from './ast';
import { operatorSpec, phaseNumber, transformSpec, variableSpec } from './catalog';
import { collectRule, directiveExclusion, newSymbols } from './symbols';
import { ANY, BINARY, COUNT, NUMBER, STRING, closeFacts, joinTypes, kindFits } from './value';
import type {
  ActionListNode,
  ActionNode,
  DirectiveNode,
  FileNode,
  SecActionNode,
  SecDefaultActionNode,
  SecRuleScriptNode,
  SecMarkerNode,
  SecRuleNode,
  Statement,
  TransformNode,
  VariableNode,
} from './ast';
import type { OperatorSpec, Phase, TransformSpec, VariableSpec } from './catalog';
import type { Symbols } from './symbols';
import type { ValueType } from './value';

/* ------------------------------------------------------------------ */
/* Конвейер                                                            */
/* ------------------------------------------------------------------ */

/**
 * Что шаг значит для значения, которое до него дошло.
 *
 *  - `ok` — шаг применим и что-то делает;
 *  - `idle` — применим, но по типу входа видно, что ничего не изменит;
 *  - `mismatch` — вход не того вида: текстовое преобразование над числом;
 *  - `reset` — `t:none`, конвейер начинается заново;
 *  - `unknown` — такого преобразования каталог не знает.
 */
export type StepStatus = 'ok' | 'idle' | 'mismatch' | 'reset' | 'unknown';

export interface PipelineStep {
  node: TransformNode;
  spec: TransformSpec | null;
  /** Что пришло от предыдущего шага. */
  input: ValueType;
  /** Что уйдёт следующему. */
  output: ValueType;
  status: StepStatus;
  /** Шаг пришёл из `SecDefaultAction`, а не записан в самом правиле. */
  inherited: boolean;
}

export interface Pipeline {
  /** Что отдают области проверки — с этого конвейер начинается. */
  base: ValueType;
  steps: PipelineStep[];
  /** Что получается в конце конвейера. */
  output: ValueType;
  /**
   * Что увидит оператор.
   *
   * Обычно то же, что `output`. Но с действием `multiMatch` оператор
   * запускается не один раз в конце, а на исходном значении и после
   * каждого шага, который его изменил. Наверняка о таком входе известно
   * только общее для всех этих значений: `@streq POST` после
   * `t:lowercase,multiMatch` совпадёт — с тем, что было до приведения.
   */
  seen: ValueType;
  /** Первый шаг после последнего `t:none`: работают только шаги с него. */
  activeFrom: number;
}

/** Применим ли шаг к значению такого типа и сделает ли он что-нибудь. */
export function stepStatus(spec: TransformSpec | null, input: ValueType): StepStatus {
  if (spec === null) return 'unknown';
  if (spec.resets) return 'reset';
  if (!kindFits(input.kind, spec.accepts)) return 'mismatch';
  if (spec.idleWhen !== 0 && (input.facts & spec.idleWhen) === spec.idleWhen) return 'idle';
  return 'ok';
}

/** Тип значения после шага. `base` нужен только `t:none`: он к нему возвращает. */
export function stepOutput(
  spec: TransformSpec | null,
  input: ValueType,
  base: ValueType,
): ValueType {
  if (spec === null) return ANY;
  if (spec.resets) return base;
  // Текстовый шаг вида не проясняет: `t:lowercase` над `TX:score` отдаст то
  // же число, что получил. Свойства при этом копятся как обычно — про
  // регистр после него известно всё, даже если неизвестно остальное.
  const textual = spec.produces === 'same' || spec.produces === 'string';
  const kind: ValueType['kind'] =
    spec.produces === 'same' || (input.kind === 'any' && textual) ? input.kind : spec.produces;
  return { kind, facts: closeFacts((input.facts & spec.keeps) | spec.adds) };
}

/**
 * Проводит значение по списку преобразований.
 *
 * В результате — тип на входе и выходе каждого шага, а не только итог:
 * выбирать очередное преобразование нужно по тому, что лежит в руках
 * именно перед ним.
 */
export function runPipeline(
  base: ValueType,
  transforms: readonly TransformNode[],
  inheritedCount = 0,
  multiMatch = false,
): Pipeline {
  const steps: PipelineStep[] = [];
  let current = base;
  let activeFrom = 0;

  for (let i = 0; i < transforms.length; i++) {
    const node = transforms[i];
    const spec = transformSpec(node.transform);
    const status = stepStatus(spec, current);
    // Текстовый шаг над числом или байтами значение не преображает: нижний
    // регистр от `42` — те же `42`. Тип поэтому остаётся прежним, иначе одна
    // неуместная трансформация тянула бы за собой замечания к оператору.
    const inert = status === 'mismatch' && spec !== null && !spec.accepts.includes('binary');
    const output = inert ? current : stepOutput(spec, current, base);
    steps.push({ node, spec, input: current, output, status, inherited: i < inheritedCount });
    if (status === 'reset') activeFrom = i + 1;
    current = output;
  }

  let seen = current;
  if (multiMatch) {
    seen = base;
    for (let i = activeFrom; i < steps.length; i++) seen = joinTypes(seen, steps[i].output);
  }

  return { base, steps, output: current, seen, activeFrom };
}

/* ------------------------------------------------------------------ */
/* Области проверки                                                    */
/* ------------------------------------------------------------------ */

export interface TargetInfo {
  node: VariableNode;
  spec: VariableSpec | null;
  /** Что отдаёт эта область; у вычитаемой (`!ARGS:x`) значения нет. */
  type: ValueType;
}

function targetType(node: VariableNode, spec: VariableSpec | null): ValueType {
  // Количество — число, чем бы ни была сама переменная.
  if (node.count) return COUNT;
  if (spec === null) return ANY;
  // Что лежит в названном параметре, решает приложение, а не движок:
  // `REQUEST_HEADERS:Content-Length` — число, `ARGS:name` — текст. Вид
  // известен только у коллекции целиком и у выборки по шаблону. Касается
  // это текстовых коллекций: размер файла остаётся числом, как его ни выбери.
  // Свойства самой коллекции при этом остаются: число в
  // `REQUEST_HEADERS:Content-Length` или нет, перевода строки в заголовке нет.
  const selector = node.selector;
  const named = selector !== null && !selector.pattern && selector.value !== '';
  if (named && spec.collection && spec.value === 'string') return withFacts(ANY, spec.facts);
  switch (spec.value) {
    case 'number':
      return NUMBER;
    case 'string':
      return withFacts(STRING, spec.facts);
    case 'binary':
      return withFacts(BINARY, spec.facts);
    default:
      return withFacts(ANY, spec.facts);
  }
}

/** Тип с добавленными свойствами; без них — тот же общий объект. */
function withFacts(type: ValueType, facts: number): ValueType {
  return facts === 0 ? type : { kind: type.kind, facts: closeFacts(type.facts | facts) };
}

/* ------------------------------------------------------------------ */
/* Правила                                                             */
/* ------------------------------------------------------------------ */

/** Одно условие: один `SecRule`, звено цепочки или всё правило целиком. */
export interface ConditionInfo {
  node: SecRuleNode;
  rule: RuleInfo;
  /** Номер звена в цепочке, с нуля; ноль — голова. */
  index: number;
  targets: TargetInfo[];
  /**
   * Все области — подсчёт `&`: в оператор уходит только количество.
   *
   * Смешанный список (`&ARGS:a|ARGS:a`) подсчётом не считается: значение
   * второй области идёт через конвейер как обычно.
   */
  counting: boolean;
  pipeline: Pipeline;
  operator: OperatorSpec | null;
}

/** Правило целиком: цепочка `SecRule`, одиночный `SecAction` или `SecRuleScript`. */
export interface RuleInfo {
  head: SecRuleNode | SecActionNode | SecRuleScriptNode;
  /** Звенья по порядку; у `SecAction` и `SecRuleScript` их нет. */
  conditions: ConditionInfo[];
  id: string | null;
  idNode: ActionNode | null;
  /** Теги правила, как написаны: по ним его выбирают исключения. */
  tags: string[];
  /** Сообщение правила; `null` — его нет. */
  msg: string | null;
  /** Фаза, как она записана; `null` — не записана или не читается. */
  phase: Phase | null;
  phaseNode: ActionNode | null;
  /** Фаза, в которой правило исполнится: записанная, из умолчаний либо вторая. */
  effectivePhase: Phase;
  /** Выше правила, в этом файле или в загруженных раньше, есть `SecDefaultAction`. */
  hasDefaults: boolean;
  /**
   * Порядковый номер в наборе, общий для правил и меток.
   *
   * Вместе с фазой задаёт порядок исполнения: по нему решается, стоит ли
   * метка ниже перехода и выполнится ли запись раньше чтения.
   */
  order: number;
  /** Последнее звено объявило `chain`, а продолжения нет. */
  dangling: boolean;
}

/**
 * То, что видно сквозь границы файлов.
 *
 * Набор правил — это несколько файлов, загруженных по порядку, и часть
 * связей идёт между ними: `skipAfter` прыгает на метку из соседнего файла,
 * номер правила занят один раз на всю конфигурацию, переменная выставлена
 * в одном файле и прочитана в другом. У одиночного файла область — он сам.
 *
 * Метки, переменные и коллекции описаны в `symbols.ts`.
 */
export interface Scope extends Symbols {
  /** Все правила набора в порядке загрузки. */
  rules: RuleInfo[];
  /** Правила по номеру во всём наборе, в порядке загрузки. */
  ids: Map<string, RuleInfo[]>;
  /** Имена файлов набора, если их назвали: по ним замечание ссылается на соседа. */
  names: Map<FileNode, string>;
  /** Файл, в котором стоит правило. */
  files: Map<RuleInfo, FileNode>;
}

export interface Model {
  file: FileNode;
  rules: RuleInfo[];
  /** Условие по его утверждению. */
  conditions: Map<SecRuleNode, ConditionInfo>;
  /** Правила этого файла по номеру. */
  ids: Map<string, RuleInfo[]>;
  /** Метки этого файла. */
  markers: Map<string, SecMarkerNode[]>;
  /** Все `SecDefaultAction` файла, по порядку. */
  defaults: SecDefaultActionNode[];
  /** Прочие директивы по имени в нижнем регистре. */
  directives: Map<string, DirectiveNode[]>;
  /** Общее на весь набор; у файлов одного набора это один и тот же объект. */
  scope: Scope;
}

const DEFAULT_PHASE: Phase = 2;

/** То, что переходит от файла к файлу при разборе набора. */
interface Carry {
  scope: Scope;
  /** Преобразования из `SecDefaultAction` по фазам: действуют на правила ниже. */
  defaults: Map<Phase, TransformNode[]>;
  /** Фаза последнего `SecDefaultAction`; `null` — умолчаний ещё не было. */
  defaultPhase: Phase | null;
  /** Фазы, чей `SecDefaultAction` включает `capture`. */
  capturing: Set<Phase>;
  /** Следующий порядковый номер для правила или метки. */
  sequence: number;
}

function newCarry(): Carry {
  return {
    scope: { ...newSymbols(), rules: [], ids: new Map(), names: new Map(), files: new Map() },
    defaults: new Map(),
    defaultPhase: null,
    capturing: new Set(),
    sequence: 0,
  };
}

function collectTransforms(list: ActionListNode | null, into: TransformNode[]): void {
  if (list === null) return;
  for (const action of list.items) {
    if (action.kind === 'Transform') into.push(action);
  }
}

function hasChain(list: ActionListNode | null): boolean {
  return findAction(list, 'chain') !== null;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

/** Строит смысловую модель одного файла. */
export function analyze(file: FileNode): Model {
  return analyzeInto(file, newCarry());
}

/**
 * Строит модели набора файлов, загруженных в этом порядке.
 *
 * Порядок значим: умолчания действуют на правила ниже себя, в том числе в
 * следующих файлах, а из двух правил с одним номером лишнее — второе.
 * Метки, наоборот, видны отовсюду: `skipAfter` прыгает вперёд, в файл,
 * который ещё не разобран.
 */
export function analyzeAll(files: readonly FileNode[], names?: readonly string[]): Model[] {
  const carry = newCarry();
  if (names !== undefined) {
    files.forEach((file, index) => carry.scope.names.set(file, names[index] ?? ''));
  }
  return files.map((file) => analyzeInto(file, carry));
}

function analyzeInto(file: FileNode, carry: Carry): Model {
  const { scope, defaults } = carry;
  const model: Model = {
    file,
    rules: [],
    conditions: new Map(),
    ids: new Map(),
    markers: new Map(),
    defaults: [],
    directives: new Map(),
    scope,
  };

  const { statements } = file;

  const startRule = (head: RuleInfo['head']): RuleInfo => {
    const idNode = findAction(head.actions, 'id');
    const phaseNode = findAction(head.actions, 'phase');
    const phase = phaseNode?.value ? phaseNumber(phaseNode.value.value) : null;
    const id = idNode?.value ? idNode.value.value.trim() : null;

    const tags: string[] = [];
    let msg: string | null = null;
    if (head.actions !== null) {
      for (const action of head.actions.items) {
        if (action.kind !== 'Action' || action.value === null) continue;
        const name = action.name.toLowerCase();
        if (name === 'tag') tags.push(action.value.value);
        else if (name === 'msg') msg = action.value.value;
      }
    }

    const rule: RuleInfo = {
      head,
      conditions: [],
      id: id === '' ? null : id,
      idNode,
      tags,
      msg,
      phase,
      phaseNode,
      effectivePhase: phase ?? carry.defaultPhase ?? DEFAULT_PHASE,
      hasDefaults: carry.defaultPhase !== null,
      order: carry.sequence++,
      dangling: false,
    };
    model.rules.push(rule);
    scope.rules.push(rule);
    scope.files.set(rule, file);
    if (carry.capturing.has(rule.effectivePhase)) scope.defaultCapture.add(rule);
    if (rule.id !== null) {
      push(model.ids, rule.id, rule);
      push(scope.ids, rule.id, rule);
    }
    return rule;
  };

  const addCondition = (rule: RuleInfo, node: SecRuleNode): void => {
    const targets: TargetInfo[] = [];
    let base: ValueType | null = null;
    let counted = 0;
    let positive = 0;

    if (node.variables !== null) {
      for (const variable of node.variables.items) {
        const spec = variableSpec(variable.name);
        const type = targetType(variable, spec);
        targets.push({ node: variable, spec, type });
        if (variable.exclude) continue;
        positive++;
        if (variable.count) counted++;
        base = base === null ? type : joinTypes(base, type);
      }
    }
    const counting = positive > 0 && counted === positive;

    const inherited = defaults.get(rule.effectivePhase);
    const transforms: TransformNode[] = inherited === undefined ? [] : inherited.slice();
    const inheritedCount = transforms.length;
    collectTransforms(node.actions, transforms);

    const condition: ConditionInfo = {
      node,
      rule,
      index: rule.conditions.length,
      targets,
      counting,
      pipeline: runPipeline(
        base ?? ANY,
        transforms,
        inheritedCount,
        findAction(node.actions, 'multiMatch') !== null,
      ),
      operator: node.operator === null ? null : operatorSpec(node.operator.name),
    };
    rule.conditions.push(condition);
    model.conditions.set(node, condition);
  };

  for (let i = 0; i < statements.length; i++) {
    const statement: Statement = statements[i];

    switch (statement.kind) {
      case 'SecRule': {
        const rule = startRule(statement);
        addCondition(rule, statement);

        // Звенья идут подряд; между ними допустимы только комментарии.
        let current = statement;
        while (hasChain(current.actions)) {
          let next = i + 1;
          while (next < statements.length && statements[next].kind === 'Comment') next++;
          const link = statements[next];
          if (link === undefined || link.kind !== 'SecRule') {
            rule.dangling = true;
            break;
          }
          addCondition(rule, link);
          current = link;
          i = next;
        }
        // Указатели собираются, когда цепочка сложена целиком: место
        // записи — правило, а не отдельное звено.
        collectRule(scope, file, rule);
        break;
      }

      case 'SecAction':
      case 'SecRuleScript':
        collectRule(scope, file, startRule(statement));
        break;

      case 'SecDefaultAction': {
        const phaseNode = findAction(statement.actions, 'phase');
        const declared = phaseNode?.value ? phaseNumber(phaseNode.value.value) : null;
        const phase = declared ?? DEFAULT_PHASE;
        const transforms: TransformNode[] = [];
        collectTransforms(statement.actions, transforms);
        defaults.set(phase, transforms);
        if (findAction(statement.actions, 'capture') === null) carry.capturing.delete(phase);
        else carry.capturing.add(phase);
        carry.defaultPhase = phase;
        model.defaults.push(statement);
        break;
      }

      case 'SecMarker':
        if (statement.label !== null) {
          push(model.markers, statement.label.value, statement);
          push(scope.markers, statement.label.value, {
            file,
            node: statement,
            order: carry.sequence++,
          });
        }
        break;

      case 'Exclusion':
        scope.exclusions.push(directiveExclusion(file, statement, carry.sequence++));
        break;

      case 'Directive': {
        const name = statement.name.toLowerCase();
        push(model.directives, name, statement);
        // Переключатели набора: побеждает последний, так его читает и движок.
        const value = statement.args.length > 0 ? statement.args[0].value : '';
        if (name === 'secruleengine') {
          scope.settings.ruleEngine = { value, node: statement, file };
        } else if (name === 'secrequestbodyaccess' || name === 'secresponsebodyaccess') {
          const lower = value.toLowerCase();
          const state = lower === 'on' ? true : lower === 'off' ? false : null;
          if (name === 'secrequestbodyaccess') scope.settings.requestBodyAccess = state;
          else scope.settings.responseBodyAccess = state;
        } else if (name === 'secdatadir') {
          scope.settings.dataDir = true;
        } else if (name === 'secgeolookupdb') {
          scope.settings.geoDb = true;
        }
        break;
      }

      default:
        break;
    }
  }

  return model;
}

/** Шаги конвейера, которые действительно исполняются: после последнего `t:none`. */
export function activeSteps(pipeline: Pipeline): PipelineStep[] {
  return pipeline.activeFrom === 0 ? pipeline.steps : pipeline.steps.slice(pipeline.activeFrom);
}
