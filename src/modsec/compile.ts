/**
 * Компилятор правил: разобранный документ → модель визуального конструктора.
 *
 * Это шлюз между двумя вкладками редактора. Текст остаётся источником правды,
 * но перейти в визуальный режим можно только если текст «собирается»: то есть
 * его удалось разложить в {@link VisualModel} и запись в нём цела — правило
 * читается так, как написано, и у него есть всё, на чём держится форма.
 * Остальные замечания переход не блокируют — они лишь подсвечиваются.
 *
 * Модель здесь строится, а не проверяется. Что в тексте не так, говорит
 * независимое ядро (`src/seclang`); компилятор спрашивает у него одно — цела
 * ли запись в этом файле (`BLOCKING_CODES`), — и спрашивает о файле в
 * одиночку, без соседей по набору. Причин две. Ответ нужен сразу, к первому
 * же кадру: иначе визуальная вкладка открывалась бы и через мгновение
 * блокировалась. И зависеть он должен только от самого файла: правка
 * соседнего не должна закрывать конструктор в этом.
 *
 * Всё остальное — что не загрузит движок, что не сработает, что лишнее и то,
 * что видно только по набору целиком (метка в соседнем файле, переменная,
 * которую никто не выставил), — считает проход по набору в `inspect.ts`.
 */

import { lintTree, parse } from '../seclang';
import { isDisruptive } from './semantics';
import { BLOCKING_CODES, toDiagnostics } from './diagnostics';
import { readDirective } from './directives';
import { emptyActions, groupTargets } from './model';
import { unfold } from './parser';
import { LONE_FILE, fileMark } from './workspace';
import type { FileNode, LintOptions } from '../seclang';
import type { Diagnostic } from './diagnostics';
import type {
  VisualActions,
  VisualBlock,
  VisualCondition,
  VisualModel,
  VisualRule,
} from './model';
import type {
  ParsedDocument,
  ParsedStatement,
  RuleAction,
  SecRuleStatement,
} from './types';

export interface CompileResult {
  /** Запись цела — визуальный режим доступен. */
  ok: boolean;
  /** Модель конструктора; `null`, если есть блокирующие замечания. */
  model: VisualModel | null;
  /**
   * Блоки, разложенные компилятором, — даже когда модель заблокирована.
   *
   * Проходу по набору они нужны и в этом случае: правило без `id` в
   * конструктор не пустят, но сказать о нём всё остальное можно и полезно.
   */
  blocks: VisualBlock[];
  /**
   * Замечания, из-за которых конструктор закрыт, — и только они.
   *
   * Полный список, с тем, что не загрузит движок, с предупреждениями и
   * связями между файлами, отдаёт проход по набору.
   */
  diagnostics: Diagnostic[];
}

/**
 * Вопрос, который компилятор задаёт ядру: цела ли запись в файле.
 *
 * Пометки `# seclang-ignore` здесь не слушаются. Ими принимают находку в
 * списке замечаний, а запись от этого исправной не становится: правило с
 * незакрытой кавычкой разобрано не так, как хотел автор, сколько бы пометок
 * над ним ни стояло.
 */
const BLOCKING: LintOptions = { only: BLOCKING_CODES, comments: false };

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

/** Раскладывает плоский список действий в структуру для форм конструктора. */
export function toVisualActions(actions: RuleAction[]): VisualActions {
  const out = emptyActions();

  for (const a of actions) {
    switch (a.name) {
      case 'id':
        out.id = a.value ?? '';
        break;
      case 'phase':
        out.phase = a.value ?? '';
        break;
      case 'status':
        out.status = a.value ?? '';
        break;
      case 'msg':
        out.msg = a.value ?? '';
        break;
      case 'logdata':
        out.logdata = a.value ?? '';
        break;
      case 'severity':
        out.severity = a.value ?? '';
        break;
      case 'ver':
        out.ver = a.value ?? '';
        break;
      case 'rev':
        out.rev = a.value ?? '';
        break;
      case 'maturity':
        out.maturity = a.value ?? '';
        break;
      case 'accuracy':
        out.accuracy = a.value ?? '';
        break;
      case 'tag':
        if (a.value) out.tags.push(a.value);
        break;
      case 'setvar':
        if (a.value) out.setvar.push(a.value);
        break;
      case 'capture':
        out.capture = true;
        break;
      case 'log':
        out.log = true;
        break;
      case 'nolog':
        out.log = false;
        break;
      case 'auditlog':
        out.auditlog = true;
        break;
      case 'noauditlog':
        out.auditlog = false;
        break;
      // Конвейер трансформаций принадлежит условию, а `chain` — структуре.
      case 't':
      case 'chain':
        break;
      default:
        if (isDisruptive(a.name)) {
          out.disruptive = a.name;
          // У `redirect` и `proxy` адрес записан значением действия. Взять
          // одно имя значило бы потерять его при первой же правке в форме.
          out.disruptiveValue = a.value ?? '';
        } else out.extra.push(a);
    }
  }

  return out;
}

/** Список трансформаций правила в порядке следования. */
function transformsOf(actions: RuleAction[]): string[] {
  return actions
    .filter((a) => a.name === 't' && a.value !== undefined)
    .map((a) => a.value as string);
}

/* ------------------------------------------------------------------ */
/* Компиляция                                                          */
/* ------------------------------------------------------------------ */

/** Комментарии, стоящие вплотную перед утверждением `index`. */
function leadingComments(
  statements: ParsedStatement[],
  index: number,
): { startIndex: number; comments: string[] } {
  let start = index;
  const comments: string[] = [];
  for (let i = index - 1; i >= 0 && statements[i].kind === 'comment'; i--) {
    comments.unshift((statements[i] as { text: string }).text);
    start = i;
  }
  return { startIndex: start, comments };
}

/**
 * Превращает одну директиву `SecRule` в условие конструктора.
 *
 * Свои действия звено оставляет себе, а голова отдаёт правилу: `own` — это и
 * есть та развилка. Без неё действие головы попало бы в текст дважды, а
 * действие звена — ни разу, и `ctl:ruleRemoveTargetById` из последнего звена
 * исчезал бы при первой правке правила в конструкторе.
 */
function toCondition(
  rule: SecRuleStatement,
  statementIndex: number,
  comments: string[] = [],
  own = false,
): VisualCondition {
  return {
    key: `cond-${statementIndex}`,
    statementIndex,
    comments,
    targets: groupTargets(rule.variables),
    transforms: transformsOf(rule.actions),
    extra: own ? rule.actions.filter((a) => a.name !== 't' && a.name !== 'chain') : [],
    operator: {
      name: rule.operator.name,
      negated: rule.operator.negated,
      argument: rule.operator.argument,
    },
  };
}

/**
 * Раскладывает документ в блоки конструктора.
 *
 * Раскладывается любой текст, какой бы он ни был: решать, можно ли блоки
 * править, — дело вызывающего. Звено, оборвавшее цепочку, так и остаётся
 * последним; директива с незнакомым именем — строкой без формы.
 */
function buildBlocks(doc: ParsedDocument): VisualBlock[] {
  const { statements } = doc;
  const blocks: VisualBlock[] = [];

  let i = 0;
  while (i < statements.length) {
    const statement = statements[i];

    if (statement.kind === 'comment' || statement.kind === 'blank') {
      i++;
      continue;
    }

    const { startIndex, comments } = leadingComments(statements, i);

    if (statement.kind === 'SecRule') {
      // Собираем цепочку: звенья идут подряд, между ними допустимы комментарии.
      const conditions: VisualCondition[] = [toCondition(statement, i)];
      const headIndex = i;
      let tailIndex = i;
      let current: SecRuleStatement = statement;

      while (current.chained) {
        let next = tailIndex + 1;
        while (
          next < statements.length &&
          (statements[next].kind === 'comment' || statements[next].kind === 'blank')
        ) {
          next++;
        }
        const link = statements[next];
        if (link === undefined || link.kind !== 'SecRule') break;
        conditions.push(
          toCondition(link, next, leadingComments(statements, next).comments, true),
        );
        tailIndex = next;
        current = link;
      }

      const rule: VisualRule = {
        key: `rule-${headIndex}`,
        startIndex,
        headIndex,
        tailIndex,
        comments,
        conditions,
        actions: toVisualActions(statement.actions),
      };
      blocks.push({ kind: 'rule', key: rule.key, rule });

      i = tailIndex + 1;
      continue;
    }

    if (statement.kind === 'SecAction') {
      blocks.push({
        kind: 'action',
        key: `action-${i}`,
        startIndex,
        statementIndex: i,
        comments,
        actions: toVisualActions(statement.actions),
      });
      i++;
      continue;
    }

    if (statement.kind === 'SecMarker') {
      blocks.push({
        kind: 'marker',
        key: `marker-${i}`,
        startIndex,
        statementIndex: i,
        comments,
        text: unfold(statement.raw).trim(),
        label: statement.label,
      });
      i++;
      continue;
    }

    blocks.push({
      kind: 'directive',
      key: `directive-${i}`,
      startIndex,
      statementIndex: i,
      comments,
      // Отступ и переносы автора здесь снимаются: строка стоит в поле, и
      // сохранённое форматирование в нём читалось бы как часть значения.
      // Пока строку не правят, в файле она остаётся ровно такой, как была.
      text: unfold(statement.raw).trim(),
      name: statement.name,
      args: statement.args,
      // Разбор по полям — не замена тексту, а второй взгляд на ту же
      // строку. Не сошёлся — блок остаётся текстовым, и правится как
      // правился.
      form: readDirective(statement),
    });
    i++;
  }

  return blocks;
}

/** Исходник документа: склейка строк утверждений возвращает его символ в символ. */
export function sourceOf(doc: ParsedDocument): string {
  return doc.statements.map((statement) => statement.raw).join('\n');
}

const NOT_COMPILED: CompileResult = { ok: false, model: null, blocks: [], diagnostics: [] };

/**
 * Компилирует файл, дерево которого уже построено.
 *
 * Так компилирует набор: дерево файла лежит у него в кеше, и разбирать текст
 * второй раз только ради вопроса об ошибках незачем. `doc` — тот же текст,
 * разложенный в документ редактора; `null` — разложить его не удалось.
 */
export function compileTree(
  tree: FileNode,
  doc: ParsedDocument | null,
  file = LONE_FILE,
): CompileResult {
  if (doc === null) return NOT_COMPILED;

  const blocks = buildBlocks(doc);
  // Файл называется здесь, а не приписывается замечаниям потом: строка и ключ
  // правила считаются внутри файла, и замечание без него в наборе ведёт не туда.
  const diagnostics = toDiagnostics(lintTree(tree, BLOCKING), {
    file: fileMark(file),
    tree,
    statements: doc.statements,
    blocks,
  });
  const ok = diagnostics.length === 0;

  return { ok, model: ok ? { blocks } : null, blocks, diagnostics };
}

/**
 * Компилирует документ в модель конструктора.
 *
 * Возвращает `ok: false`, если запись в файле не цела — в этом случае
 * визуальная вкладка должна быть недоступна, а пользователь остаётся
 * в текстовом редакторе с подсвеченным списком проблем.
 */
export function compileDocument(doc: ParsedDocument | null, file = LONE_FILE): CompileResult {
  if (doc === null) return NOT_COMPILED;
  return compileTree(parse(sourceOf(doc)), doc, file);
}
