/**
 * Синтаксическое дерево SecLang — языка правил ModSecurity.
 *
 * Дерево отвечает на один вопрос: что именно написано и где. Смысла в нём
 * нет: звенья цепочки здесь — соседние утверждения, а не одно правило,
 * `t:lowercase` — узел `Transform`, а не шаг конвейера с типом входа.
 * Смысл достраивает `analyze.ts`, и достраивает поверх этих же узлов, не
 * копируя их.
 *
 * Каждый узел несёт `kind` и границы в исходном тексте: `start` включён,
 * `end` исключён, оба — смещения в символах от начала файла. Границы точные
 * даже там, где запись разорвана переносом `\` или экранированием `\"`:
 * значение узла (`value`, `name`) — уже разобранное, а границы — всегда
 * про исходник. Номера строк есть только у утверждений; для остального их
 * считает `position.ts` по смещению.
 *
 * Форма узлов одного вида всегда одна и та же, включая `null` на месте
 * отсутствующей части: дерево обходят в цикле, и объекты одной формы
 * движок JavaScript читает заметно быстрее.
 */

export type NodeKind =
  | 'File'
  | 'Comment'
  | 'SecRule'
  | 'SecAction'
  | 'SecRuleScript'
  | 'SecDefaultAction'
  | 'SecMarker'
  | 'Exclusion'
  | 'Directive'
  | 'Argument'
  | 'VariableList'
  | 'Variable'
  | 'Selector'
  | 'Operator'
  | 'ActionList'
  | 'Action'
  | 'Transform'
  | 'Setvar'
  | 'Ctl'
  | 'Text'
  | 'Macro';

export interface BaseNode {
  kind: NodeKind;
  /** Смещение первого символа узла в исходнике. */
  start: number;
  /** Смещение за последним символом узла. */
  end: number;
}

/* ------------------------------------------------------------------ */
/* Листья                                                              */
/* ------------------------------------------------------------------ */

/** Макрос `%{TX.score}` или `%{REMOTE_ADDR}` внутри значения. */
export interface MacroNode extends BaseNode {
  kind: 'Macro';
  /** Переменная или коллекция, как написана: `TX`, `tx`, `REMOTE_ADDR`. */
  name: string;
  /** Имя внутри коллекции — то, что стоит после `.` или `:`. */
  key: string | null;
}

/** Значение: аргумент оператора или то, что стоит у действия после `:`. */
export interface TextNode extends BaseNode {
  kind: 'Text';
  /** Разобранное значение: без одинарных кавычек и их экранирования. */
  value: string;
  /** В исходнике значение стояло в одинарных кавычках. */
  quoted: boolean;
  /** Макросы внутри значения, по порядку; пусто — значение буквальное. */
  macros: readonly MacroNode[];
}

/** Аргумент директивы верхнего уровня: слово или текст в двойных кавычках. */
export interface ArgumentNode extends BaseNode {
  kind: 'Argument';
  /** Текст без обрамляющих кавычек, `\"` раскрыт. */
  value: string;
  quoted: boolean;
}

/* ------------------------------------------------------------------ */
/* Области проверки                                                    */
/* ------------------------------------------------------------------ */

/** Параметр области проверки: `User-Agent`, `/^id_/`, `'my param'`. */
export interface SelectorNode extends BaseNode {
  kind: 'Selector';
  value: string;
  quoted: boolean;
  /** Параметр записан шаблоном `/.../`, а не именем. */
  pattern: boolean;
}

/** Один терм списка: `ARGS`, `!ARGS:token`, `&REQUEST_HEADERS:Host`. */
export interface VariableNode extends BaseNode {
  kind: 'Variable';
  /** Имя, как написано в файле. */
  name: string;
  nameStart: number;
  nameEnd: number;
  /** Префикс `!` — терм вычитается из набора. */
  exclude: boolean;
  /** Префикс `&` — берётся число элементов, а не значения. */
  count: boolean;
  selector: SelectorNode | null;
}

export interface VariableListNode extends BaseNode {
  kind: 'VariableList';
  items: VariableNode[];
}

/* ------------------------------------------------------------------ */
/* Оператор                                                            */
/* ------------------------------------------------------------------ */

export interface OperatorNode extends BaseNode {
  kind: 'Operator';
  /** Имя без `@`, как написано; у неявного оператора — `rx`. */
  name: string;
  /** Границы имени вместе с `@`; у неявного оператора пусты. */
  nameStart: number;
  nameEnd: number;
  negated: boolean;
  /** `@имя` не указано: ModSecurity подразумевает `@rx`. */
  implicit: boolean;
  argument: TextNode;
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

interface ActionBase extends BaseNode {
  /** Имя действия, как написано: `id`, `t`, `setvar`, `ctl`. */
  name: string;
  nameStart: number;
  nameEnd: number;
  /** Всё, что стоит после `:`; `null` — двоеточия нет вовсе. */
  value: TextNode | null;
}

/** Действие без собственной структуры: `id:1`, `deny`, `msg:'text'`. */
export interface PlainActionNode extends ActionBase {
  kind: 'Action';
}

/** Шаг конвейера преобразований: `t:lowercase`. */
export interface TransformNode extends ActionBase {
  kind: 'Transform';
  /** Имя преобразования, как написано. */
  transform: string;
}

export type SetvarOp = 'set' | 'add' | 'sub' | 'delete';

/** Присваивание: `setvar:tx.score=+5`, `setvar:!tx.flag`. */
export interface SetvarNode extends ActionBase {
  kind: 'Setvar';
  /** Коллекция, как написана; пусто, если запись не разобралась. */
  collection: string;
  /** Имя внутри коллекции; может содержать макросы. */
  key: string;
  op: SetvarOp;
  /** Правая часть без знака операции; `null` — её нет. */
  operand: string | null;
}

/** Настройка на время запроса: `ctl:ruleRemoveById=942100`. */
export interface CtlNode extends ActionBase {
  kind: 'Ctl';
  option: string;
  operand: string | null;
}

export type ActionNode = PlainActionNode | TransformNode | SetvarNode | CtlNode;

export interface ActionListNode extends BaseNode {
  kind: 'ActionList';
  items: ActionNode[];
}

/* ------------------------------------------------------------------ */
/* Утверждения                                                         */
/* ------------------------------------------------------------------ */

interface StatementBase extends BaseNode {
  /** Первая физическая строка утверждения, с единицы. */
  line: number;
  /** Последняя строка: больше `line`, если запись разорвана переносами. */
  endLine: number;
}

interface DirectiveBase extends StatementBase {
  /** Имя директивы, как написано; начинается в `start`. */
  name: string;
  nameEnd: number;
  /**
   * Сколько аргументов стоит после имени.
   *
   * У разобранных директив лишние аргументы в дерево не попадают, а
   * недостающие остаются `null`; число нужно, чтобы сказать и о тех,
   * и о других.
   */
  argCount: number;
}

export interface CommentNode extends StatementBase {
  kind: 'Comment';
  /** Текст без ведущего `#` и одного пробела после него. */
  text: string;
}

/** `SecRule VARIABLES "OPERATOR" "ACTIONS"`. */
export interface SecRuleNode extends DirectiveBase {
  kind: 'SecRule';
  variables: VariableListNode | null;
  operator: OperatorNode | null;
  actions: ActionListNode | null;
}

/** `SecAction "ACTIONS"`. */
export interface SecActionNode extends DirectiveBase {
  kind: 'SecAction';
  actions: ActionListNode | null;
}

/**
 * `SecRuleScript /path/to/script.lua "ACTIONS"`.
 *
 * Правило, условие которого написано на Lua. Областей проверки и оператора
 * у него нет, а действия, номер и фаза — такие же, как у обычного.
 */
export interface SecRuleScriptNode extends DirectiveBase {
  kind: 'SecRuleScript';
  /** Путь к сценарию. */
  script: ArgumentNode | null;
  actions: ActionListNode | null;
}

/** `SecDefaultAction "ACTIONS"` — умолчания для правил ниже. */
export interface SecDefaultActionNode extends DirectiveBase {
  kind: 'SecDefaultAction';
  actions: ActionListNode | null;
}

/** `SecMarker LABEL`. */
export interface SecMarkerNode extends DirectiveBase {
  kind: 'SecMarker';
  label: ArgumentNode | null;
}

/** Что директива-исключение делает с правилом. */
export type ExclusionOp = 'remove' | 'updateTarget' | 'updateAction';

/** Чем она выбирает правила: номером, текстом сообщения или тегом. */
export type ExclusionBy = 'id' | 'msg' | 'tag';

/**
 * Директива, меняющая уже загруженные правила: `SecRuleRemoveById`,
 * `SecRuleUpdateTargetByTag`, `SecRuleUpdateActionById` и остальные.
 *
 * Семь директив, одно устройство: выборка правил и то, что с ними сделать.
 * Отдельный вид узла у них потому, что их смысл — ссылка: на номер, тег
 * или сообщение правила, которое стоит где-то ещё. Проверять тут нужно не
 * запись, а то, во что эта ссылка упирается.
 */
export interface ExclusionNode extends DirectiveBase {
  kind: 'Exclusion';
  op: ExclusionOp;
  by: ExclusionBy;
  /**
   * Выборка. У удаления по номеру это все аргументы — номера и диапазоны;
   * у остальных — один: номер либо шаблон.
   */
  selectors: ArgumentNode[];
  /** `updateTarget`: области, которые приписываются правилу. */
  variables: VariableListNode | null;
  /** `updateTarget`: какую область заменить — необязательный третий аргумент. */
  replaced: ArgumentNode | null;
  /** `updateAction`: действия, которые получит правило. */
  actions: ActionListNode | null;
}

/** Любая другая директива: `SecRuleEngine On`. */
export interface DirectiveNode extends DirectiveBase {
  kind: 'Directive';
  args: ArgumentNode[];
}

export type Statement =
  | CommentNode
  | SecRuleNode
  | SecActionNode
  | SecRuleScriptNode
  | SecDefaultActionNode
  | SecMarkerNode
  | ExclusionNode
  | DirectiveNode;

/* ------------------------------------------------------------------ */
/* Файл                                                                */
/* ------------------------------------------------------------------ */

/**
 * То, что парсер не смог прочитать однозначно.
 *
 * Разбор на этом не останавливается: узел строится из того, что есть, а
 * замечание ложится сюда. Решать, ошибка это или предупреждение, — дело
 * линтера; парсер сообщает только факт.
 */
export type SyntaxIssueCode =
  /** Двойная кавычка открыта и не закрыта до конца утверждения. */
  | 'unterminatedQuote'
  /** `%{` без закрывающей `}`. */
  | 'unterminatedMacro'
  /** Значение открыто одинарной кавычкой и не закрыто до конца списка. */
  | 'unterminatedValueQuote'
  /** Внутри одинарных кавычек `\` стоит не перед `'` и не перед `\`. */
  | 'invalidQuotedPair'
  /** За закрывающей кавычкой значения стоит ещё текст: `msg:'a'b`. */
  | 'textAfterQuote'
  /** После `\` в конце строки стоят пробелы: переноса не получилось. */
  | 'continuationSpace';

export interface SyntaxIssue {
  code: SyntaxIssueCode;
  start: number;
  end: number;
}

export interface FileNode extends BaseNode {
  kind: 'File';
  source: string;
  /** Утверждения по порядку; пустые строки узлами не становятся. */
  statements: Statement[];
  issues: SyntaxIssue[];
}

export type Node =
  | FileNode
  | Statement
  | ArgumentNode
  | VariableListNode
  | VariableNode
  | SelectorNode
  | OperatorNode
  | ActionListNode
  | ActionNode
  | TextNode
  | MacroNode;

/** Узел по его `kind` — для обработчиков, подписанных на один вид. */
export type NodeOfKind<K extends NodeKind> = Extract<Node, { kind: K }>;

/* ------------------------------------------------------------------ */
/* Обход                                                               */
/* ------------------------------------------------------------------ */

/**
 * Вызывает `visit` для каждого непосредственного потомка узла.
 *
 * Порядок — порядок исходника. Это единственное место, которое знает,
 * где у какого узла лежат дети: и линтер, и поиск узла по смещению ходят
 * по дереву через него.
 */
export function forEachChild(node: Node, visit: (child: Node) => void): void {
  switch (node.kind) {
    case 'File':
      for (const statement of node.statements) visit(statement);
      return;
    case 'SecRule':
      if (node.variables) visit(node.variables);
      if (node.operator) visit(node.operator);
      if (node.actions) visit(node.actions);
      return;
    case 'SecAction':
    case 'SecDefaultAction':
      if (node.actions) visit(node.actions);
      return;
    case 'SecRuleScript':
      if (node.script) visit(node.script);
      if (node.actions) visit(node.actions);
      return;
    case 'SecMarker':
      if (node.label) visit(node.label);
      return;
    case 'Exclusion':
      for (const selector of node.selectors) visit(selector);
      if (node.variables) visit(node.variables);
      if (node.replaced) visit(node.replaced);
      if (node.actions) visit(node.actions);
      return;
    case 'Directive':
      for (const arg of node.args) visit(arg);
      return;
    case 'VariableList':
    case 'ActionList':
      for (const item of node.items) visit(item);
      return;
    case 'Variable':
      if (node.selector) visit(node.selector);
      return;
    case 'Operator':
      visit(node.argument);
      return;
    case 'Action':
    case 'Transform':
    case 'Setvar':
    case 'Ctl':
      if (node.value) visit(node.value);
      return;
    case 'Text':
      for (const macro of node.macros) visit(macro);
      return;
    default:
      return;
  }
}

/** Обходит поддерево в глубину: узел, затем его потомки. */
export function walk(node: Node, visit: (node: Node, parent: Node | null) => void): void {
  const step = (current: Node, parent: Node | null) => {
    visit(current, parent);
    forEachChild(current, (child) => step(child, current));
  };
  step(node, null);
}

/** Утверждение, покрывающее смещение; `null` — смещение между утверждениями. */
export function statementAt(file: FileNode, offset: number): Statement | null {
  // Утверждения отсортированы по смещению — нужное ищется делением пополам.
  const { statements } = file;
  let low = 0;
  let high = statements.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = statements[middle];
    if (offset < candidate.start) high = middle - 1;
    else if (offset > candidate.end) low = middle + 1;
    else return candidate;
  }
  return null;
}

/**
 * Самый глубокий узел, покрывающий смещение, и путь к нему от корня.
 *
 * Нужен редактору: по позиции курсора узнать, что под ним — имя
 * переменной, шаг конвейера или аргумент оператора. Путь возвращается
 * целиком, потому что одного листа мало: смысл `lowercase` зависит от
 * того, в каком правиле он стоит.
 */
export function nodePathAt(file: FileNode, offset: number): Node[] {
  const path: Node[] = [file];
  let found: Node | null = statementAt(file, offset);

  while (found !== null) {
    path.push(found);
    let next: Node | null = null;
    forEachChild(found, (child) => {
      if (next === null && offset >= child.start && offset <= child.end) next = child;
    });
    found = next;
  }
  return path;
}

/** Действие с таким именем; имена действий регистр не различают. */
export function findAction(list: ActionListNode | null, name: string): ActionNode | null {
  if (list === null) return null;
  const wanted = name.toLowerCase();
  for (const action of list.items) {
    if (action.name.toLowerCase() === wanted) return action;
  }
  return null;
}

export function isRuleStatement(
  node: Statement,
): node is SecRuleNode | SecActionNode | SecRuleScriptNode {
  return node.kind === 'SecRule' || node.kind === 'SecAction' || node.kind === 'SecRuleScript';
}
