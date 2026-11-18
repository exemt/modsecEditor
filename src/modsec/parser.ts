/**
 * Документ редактора — проекция дерева `seclang`.
 *
 * Разбирает текст независимое ядро (`src/seclang`): оно читает запись так же,
 * как движок, и по тому же дереву считает замечания. Своего разбора у
 * редактора нет, и это главное, ради чего модуль существует: правило, которое
 * конструктор показал бы одним, а линтер прочитал другим, — ошибка, которую
 * не видно ни в одном из двух.
 *
 * Дерево отвечает на вопрос «что написано и где», а редактору нужен ещё один:
 * «какими строками это заменить». Конструктор правит документ утверждениями —
 * вставляет, переставляет, заменяет блок целиком, — и для этого ему нужны
 * все строки файла по порядку, включая пустые, с исходным текстом каждой.
 * {@link ParsedDocument} и есть такой взгляд на дерево: утверждение на каждую
 * строку или группу строк, склеенных переносом, а `raw` — её текст как есть.
 * Склейка `raw` через перевод строки возвращает исходник символ в символ.
 *
 * Имена приводятся к принятому написанию. Движок регистр в них не различает
 * (`t:compressWhiteSpace` из CRS 2 и `t:compressWhitespace` — одно
 * преобразование), а формы конструктора ищут имя в своих таблицах буква в
 * букву. Приведи его каждая форма сама — первая же забывшая показала бы
 * исправное правило незнакомым. Исходник при этом не трогается: написанное
 * остаётся в `raw`, и в файл уходит оно, пока правило не правили.
 */

import {
  actionSpec,
  directiveName,
  operatorSpec,
  parse,
  parseActionList,
  parseArguments,
  parseOperator as parseOperatorNode,
  parseVariableList,
  transformSpec,
  variableSpec,
} from '../seclang';
import type {
  ActionListNode,
  ActionNode,
  FileNode,
  OperatorNode,
  Statement,
  VariableNode,
} from '../seclang';
import type {
  ParsedDocument,
  ParsedStatement,
  RuleAction,
  RuleOperator,
  RuleVariable,
  SecRuleStatement,
  SourceSpan,
} from './types';

/** true, если строку продолжает нечётное число завершающих обратных слэшей. */
function hasTrailingBackslash(line: string): boolean {
  const match = /\\+$/.exec(line);
  if (!match) return false;
  return match[0].length % 2 === 1;
}

/**
 * Снимает переносы `\`: физические строки утверждения — в одну.
 *
 * Директива в файле разложена переносами так, как захотел автор, а править её
 * в конструкторе приходится строкой. На месте переноса остаётся пробел: вне
 * кавычек он и есть разделитель аргументов, а строка, показанная в поле без
 * него, слиплась бы в одно слово.
 */
export function unfold(raw: string): string {
  return raw
    .split('\n')
    .map((line) => (hasTrailingBackslash(line) ? line.replace(/\\$/, ' ') : line))
    .join('');
}

/**
 * Текст узла так, как он записан, — без того, что снимает разбор строки.
 *
 * Границы узла указывают в исходник, а там внутри списка может стоять перенос
 * `\` или `\"`. Подписи, которые собираются из записи («снимает `ARGS:a`»),
 * должны показывать то же, что прочёл движок, а не обломок с обратным слэшем
 * и переводом строки посередине. Обычно снимать нечего, и текст берётся одной
 * подстрокой.
 */
function written(source: string, node: { start: number; end: number }, inFile: boolean): string {
  const text = source.slice(node.start, node.end);
  if (!inFile || text.indexOf('\\') === -1) return text;
  return text.replace(/\\[ \t]*\r?\n/g, '').replace(/\\(\\|")/g, (pair, next: string) =>
    next === '"' ? '"' : pair,
  );
}

function toVariable(node: VariableNode, source: string, inFile: boolean): RuleVariable {
  return {
    raw: written(source, node, inFile),
    name: variableSpec(node.name)?.name ?? node.name,
    selector: node.selector?.value,
    count: node.count,
    exclusion: node.exclude,
  };
}

function toOperator(node: OperatorNode, source: string, inFile: boolean): RuleOperator {
  return {
    raw: written(source, node, inFile),
    name: operatorSpec(node.name)?.name ?? node.name,
    negated: node.negated,
    argument: node.argument.value,
    implicit: node.implicit,
  };
}

/** Оператор правила, в котором его не написали: движок подразумевает `@rx`. */
function missingOperator(): RuleOperator {
  return { raw: '', name: 'rx', negated: false, argument: '', implicit: true };
}

function toAction(node: ActionNode, source: string, inFile: boolean): RuleAction {
  const name = actionSpec(node.name)?.name ?? node.name;
  const raw = written(source, node, inFile);
  if (node.value === null) return { raw, name, quoted: false };

  // У шага конвейера значение — тоже имя, и регистр в нём так же не значим.
  const value =
    node.kind === 'Transform'
      ? (transformSpec(node.transform)?.name ?? node.value.value)
      : node.value.value;
  return { raw, name, value, quoted: node.value.quoted };
}

function toActions(list: ActionListNode | null, source: string): RuleAction[] {
  return list === null ? [] : list.items.map((node) => toAction(node, source, true));
}

/** Значение первого действия с таким именем. */
function actionValue(actions: RuleAction[], name: string): string | undefined {
  return actions.find((a) => a.name === name)?.value;
}

function toStatement(
  node: Statement,
  base: { raw: string; span: SourceSpan },
  source: string,
): ParsedStatement {
  switch (node.kind) {
    case 'Comment':
      // Текст берётся из строк, а не из узла: закомментированное правило на
      // несколько строк конструктор показывает и пишет обратно одной, и на
      // месте переноса ему нужен пробел, а не слипшиеся слова.
      return { kind: 'comment', ...base, text: unfold(base.raw).trim().replace(/^#\s?/, '') };

    case 'SecRule': {
      const actions = toActions(node.actions, source);
      return {
        kind: 'SecRule',
        ...base,
        variables:
          node.variables === null
            ? []
            : node.variables.items.map((item) => toVariable(item, source, true)),
        operator:
          node.operator === null ? missingOperator() : toOperator(node.operator, source, true),
        actions,
        id: actionValue(actions, 'id'),
        phase: actionValue(actions, 'phase'),
        msg: actionValue(actions, 'msg'),
        chained: actions.some((a) => a.name === 'chain'),
      };
    }

    case 'SecAction': {
      const actions = toActions(node.actions, source);
      return {
        kind: 'SecAction',
        ...base,
        actions,
        id: actionValue(actions, 'id'),
        phase: actionValue(actions, 'phase'),
      };
    }

    case 'SecMarker':
      return { kind: 'SecMarker', ...base, label: node.label?.value ?? '' };

    case 'Directive':
      return {
        kind: 'directive',
        ...base,
        name: directiveName(node.name) ?? node.name,
        args: node.args.map((arg) => arg.value),
      };

    // Умолчания, правило на Lua и семь исключений дерево хранит уже
    // прочитанными. Формы редактора читают их сами, из аргументов, — и
    // получают те же слова, на которые строку режет разбор файла.
    default:
      return {
        kind: 'directive',
        ...base,
        name: directiveName(node.name) ?? node.name,
        args: parseArguments(source.slice(node.start, node.end))
          .slice(1)
          .map((arg) => arg.value),
      };
  }
}

/**
 * Раскладывает дерево в документ редактора.
 *
 * Пустые строки узлами дерева не становятся, а документу нужны: по ним
 * считаются индексы утверждений, и без них правка блока сдвинула бы всё, что
 * стоит ниже. Они восстанавливаются по номерам строк — всё, чего не занял ни
 * один узел, и есть пустая строка.
 */
export function toDocument(tree: FileNode): ParsedDocument {
  const { source } = tree;
  const lines = source.split('\n');
  const statements: ParsedStatement[] = [];

  /** Первая строка, которую ещё не отдали утверждением. */
  let next = 1;
  const blanksUntil = (line: number) => {
    for (; next < line; next++) {
      statements.push({
        kind: 'blank',
        raw: lines[next - 1],
        span: { startLine: next, endLine: next },
      });
    }
  };

  for (const node of tree.statements) {
    blanksUntil(node.line);
    const base = {
      raw: lines.slice(node.line - 1, node.endLine).join('\n'),
      span: { startLine: node.line, endLine: node.endLine },
    };
    statements.push(toStatement(node, base, source));
    next = node.endLine + 1;
  }
  blanksUntil(lines.length + 1);

  const rules = statements.filter((s): s is SecRuleStatement => s.kind === 'SecRule');
  return { statements, rules };
}

/** Точка входа: текст конфигурации ModSecurity → {@link ParsedDocument}. */
export function parseModsec(source: string): ParsedDocument {
  return toDocument(parse(source));
}

/*
 * Разбор отдельных частей правила — для текста, который пришёл не из файла:
 * второй аргумент директивы-исключения, цель действия `ctl`, умолчания фазы.
 * Грамматика у них та же, что у частей `SecRule`, и читает их то же ядро.
 */

/** Список переменных `ARGS|!ARGS:token|&REQUEST_HEADERS:User-Agent`. */
export function parseVariables(text: string): RuleVariable[] {
  return parseVariableList(text).items.map((item) => toVariable(item, text, false));
}

/** Содержимое кавычек оператора: `@rx foo`, `!@eq 0`, `bar`. */
export function parseOperator(text: string): RuleOperator {
  return toOperator(parseOperatorNode(text), text, false);
}

/** Список действий `id:1,phase:2,deny,t:lowercase,msg:'hi'`. */
export function parseActions(text: string): RuleAction[] {
  return parseActionList(text).items.map((item) => toAction(item, text, false));
}
