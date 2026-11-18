/**
 * Исправления: что линтер умеет починить сам.
 *
 * Исправление выводится из замечания и дерева, а не записывается проверкой.
 * Так проверки остаются вопросами к правилу («что здесь не так?»), а ответ
 * на «как это переписать?» лежит в одном месте — и виден целиком: по
 * таблице ниже сразу понятно, что чинится, а что нет.
 *
 * Чинится только механическое: запись, которую можно поменять, не меняя
 * того, что правило проверяет. Убрать повтор, поставить точку вместо
 * двоеточия, стереть пробел после переноса. Всё, где нужен выбор —
 * какую из двух реакций оставить, куда перенести `t:none`, — остаётся
 * человеку: линтер, который угадывает намерение, хуже линтера, который
 * молчит.
 */

import { findAction, nodePathAt } from '../ast';
import type { FileNode, Node, OperatorNode } from '../ast';
import type { DiagnosticCode } from './codes';
import type { Diagnostic } from './engine';

/** Замена отрезка исходника: `start` включён, `end` исключён. */
export interface TextEdit {
  start: number;
  end: number;
  text: string;
}

export interface Fix {
  /** Замечание, которое исправление снимает. */
  code: DiagnosticCode;
  /** Что будет сделано — одной фразой, для кнопки или списка. */
  title: string;
  edits: TextEdit[];
}

/** Что нужно от замечания: столько отдаёт и `lint`, и свой перевод. */
type Finding = Pick<Diagnostic, 'code' | 'start' | 'end' | 'data'>;

const SPACE = 32;
const TAB = 9;
const LF = 10;
const CR = 13;
const BACKSLASH = 92;

function isBlank(code: number): boolean {
  return code === SPACE || code === TAB;
}

/**
 * Отрезок, который нужно стереть, чтобы убрать элемент списка вместе с его
 * разделителем.
 *
 * Список действий CRS записан по строке на действие, с переносом в конце
 * каждой. Убрать из такой строки одно лишь действие — значит оставить
 * пустую строку с одиноким слэшем, поэтому строка, которую элемент занимал
 * целиком, уходит вся.
 */
function removalOf(source: string, start: number, end: number, separator: string): TextEdit {
  const length = source.length;

  let after = end;
  while (after < length && isBlank(source.charCodeAt(after))) after++;

  if (source[after] === separator) {
    after++;
    let lineStart = start;
    while (lineStart > 0 && isBlank(source.charCodeAt(lineStart - 1))) lineStart--;
    const ownLine = lineStart === 0 || source.charCodeAt(lineStart - 1) === LF;

    // За разделителем — перенос: элемент был последним на своей строке.
    let tail = after;
    while (tail < length && isBlank(source.charCodeAt(tail))) tail++;
    if (source.charCodeAt(tail) === BACKSLASH) {
      let eol = tail + 1;
      while (eol < length && isBlank(source.charCodeAt(eol))) eol++;
      if (source.charCodeAt(eol) === CR) eol++;
      if (source.charCodeAt(eol) === LF && ownLine) {
        return { start: lineStart, end: eol + 1, text: '' };
      }
      return { start, end: after, text: '' };
    }
    return { start, end: tail, text: '' };
  }

  // Справа разделителя нет — элемент последний: уходит разделитель слева.
  let before = start;
  while (before > 0 && isBlank(source.charCodeAt(before - 1))) before--;
  if (source[before - 1] === separator) return { start: before - 1, end, text: '' };
  return { start, end, text: '' };
}

function operatorAt(file: FileNode, offset: number): OperatorNode | null {
  const path = nodePathAt(file, offset);
  for (let i = path.length - 1; i >= 0; i--) {
    const node: Node = path[i];
    if (node.kind === 'Operator') return node;
  }
  return null;
}

/** Заменяет оператор с его аргументом: `@rx ^admin$` → `@streq admin`. */
function replaceOperator(node: OperatorNode, name: string, argument: string): TextEdit {
  const start = node.implicit ? node.argument.start : node.nameStart;
  return { start, end: node.argument.end, text: `@${name} ${argument}` };
}

/** Одно исправление на код; `null` — здесь чинить нечего. */
const FIXERS: Partial<Record<DiagnosticCode, (file: FileNode, found: Finding) => Fix | null>> = {
  continuationSpace(_file, found) {
    return {
      code: found.code,
      title: 'Remove the whitespace after the backslash',
      edits: [{ start: found.start, end: found.end, text: '\\' }],
    };
  },

  commentSwallowsLine(file, found) {
    // Замечание стоит на первой строке комментария; слэш — последний её знак.
    let end = found.end;
    while (end > found.start && isBlank(file.source.charCodeAt(end - 1))) end--;
    if (file.source.charCodeAt(end - 1) === CR) end--;
    if (file.source.charCodeAt(end - 1) !== BACKSLASH) return null;
    return {
      code: found.code,
      title: 'Remove the trailing backslash',
      edits: [{ start: end - 1, end, text: '' }],
    };
  },

  duplicateTransform: removeAction('Remove the repeated transformation'),
  redundantTransform: removeAction('Remove the transformation that changes nothing'),
  duplicateAction: removeAction('Remove the repeated action'),

  duplicateTarget(file, found) {
    return {
      code: found.code,
      title: 'Remove the repeated check area',
      edits: [removalOf(file.source, found.start, found.end, '|')],
    };
  },

  macroKeySeparator(file, found) {
    const name = found.data?.name;
    if (name === undefined) return null;
    const at = found.start + 2 + name.length;
    if (file.source[at] !== ':') return null;
    return {
      code: found.code,
      title: 'Separate the key with a dot',
      edits: [{ start: at, end: at + 1, text: '.' }],
    };
  },

  selectorNeedsQuotes(_file, found) {
    const pattern = found.data?.pattern;
    if (pattern === undefined) return null;
    return {
      code: found.code,
      title: `Write the parameter as the pattern ${pattern}`,
      edits: [{ start: found.start, end: found.end, text: pattern }],
    };
  },

  operatorReadAsPattern(file, found) {
    // Чинится только пробел перед `@`; второй `!` может быть и замыслом.
    const text = file.source.slice(found.start, found.end);
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed === text) return null;
    return {
      code: found.code,
      title: 'Remove the whitespace before the operator',
      edits: [{ start: found.start, end: found.end, text: trimmed }],
    };
  },

  textAfterQuote(_file, found) {
    return {
      code: found.code,
      title: 'Insert the missing comma',
      edits: [{ start: found.start, end: found.start, text: ',' }],
    };
  },

  // Замена точна, только пока `^` и `$` — края всего значения; там, где они
  // ещё и границы строк, линтер говорит другое (`anchoredLiteralLines`), и
  // правки у того замечания нет: `@streq` проверял бы уже не то же самое.
  anchoredLiteralRegex(file, found) {
    const node = operatorAt(file, found.start);
    if (node === null || capturesAt(file, found.start)) return null;
    const match = /^\^([^\\^$.*+?()[\]{}|]+)\$$/.exec(node.argument.value);
    if (match === null) return null;
    return {
      code: found.code,
      title: 'Compare with "@streq"',
      edits: [replaceOperator(node, 'streq', match[1])],
    };
  },

  regexIsPlainText(file, found) {
    const node = operatorAt(file, found.start);
    if (node === null || capturesAt(file, found.start)) return null;
    return {
      code: found.code,
      title: 'Search with "@contains"',
      edits: [replaceOperator(node, 'contains', node.argument.value)],
    };
  },

  redundantLeadingWildcard(file, found) {
    const node = operatorAt(file, found.start);
    // С `capture` в `TX.0` лежит и то, что подобрала `.*`: после правки там
    // окажется меньше, и правило запишет в журнал не то, что раньше.
    if (node === null || capturesAt(file, found.start)) return null;
    const text = file.source.slice(node.argument.start, node.argument.end);
    // Якорь уходит вместе с `.*`: точка во всех трёх движках совпадает и с
    // переводом строки, и `^.*admin` находит `admin` там же, где `admin`.
    // Уходит и приставка «лениво» (`.*?`): одинокий квантор в начале шаблона
    // его ломает. `.*+` проверка лишним не считает — он «без возврата».
    const lead = /^\^?\.\*\??/.exec(text);
    if (lead === null) return null;
    // Что осталось, обязано быть шаблоном: `.*{3}` или `.**` чинить нечем.
    if (/^[*+?{]/.test(text.slice(lead[0].length))) return null;
    return {
      code: found.code,
      title: 'Remove the leading ".*"',
      edits: [{ start: node.argument.start, end: node.argument.start + lead[0].length, text: '' }],
    };
  },
};

/**
 * Стоит ли у этого условия `capture`.
 *
 * Заменить `@rx ^слово$` на `@streq слово` можно, только пока правило не
 * захватывает: `@streq` и `@contains` в `TX.0` ничего не кладут, и после
 * такой «чистки» правило молча перестанет писать в журнал то, что нашло.
 */
function capturesAt(file: FileNode, offset: number): boolean {
  for (const node of nodePathAt(file, offset)) {
    if (node.kind !== 'SecRule') continue;
    return findAction(node.actions, 'capture') !== null;
  }
  return false;
}

function removeAction(title: string): (file: FileNode, found: Finding) => Fix {
  return (file, found) => ({
    code: found.code,
    title,
    edits: [removalOf(file.source, found.start, found.end, ',')],
  });
}

/** Коды, для которых исправление вообще бывает. */
export const FIXABLE: readonly DiagnosticCode[] = Object.keys(FIXERS) as DiagnosticCode[];

/** Исправление для замечания; `null` — чинить его должен человек. */
export function fixFor(file: FileNode, diagnostic: Finding): Fix | null {
  const fixer = FIXERS[diagnostic.code];
  return fixer === undefined ? null : fixer(file, diagnostic);
}

/** Исправления для всех замечаний файла, для которых они есть. */
export function fixesFor(file: FileNode, diagnostics: readonly Finding[]): Fix[] {
  const fixes: Fix[] = [];
  for (const diagnostic of diagnostics) {
    const fix = fixFor(file, diagnostic);
    if (fix !== null) fixes.push(fix);
  }
  return fixes;
}

export interface FixResult {
  source: string;
  /** Исправления, которые вошли в результат. */
  applied: Fix[];
  /**
   * Исправления, задевшие уже изменённое место. Они не потеряны: после
   * повторной проверки их замечания появятся снова, уже с верными границами.
   */
  skipped: Fix[];
}

/**
 * Применяет исправления к тексту.
 *
 * Правки двух исправлений могут задеть одно место: два повтора подряд
 * делят разделитель. Тогда второе пропускается — применять его к тексту,
 * которого уже нет, нельзя. Проверить результат заново и повторить — дело
 * вызывающего: только он знает, когда остановиться.
 */
export function applyFixes(source: string, fixes: readonly Fix[]): FixResult {
  const applied: Fix[] = [];
  const skipped: Fix[] = [];
  const edits: TextEdit[] = [];

  const overlaps = (edit: TextEdit) =>
    edits.some((other) =>
      edit.start === edit.end || other.start === other.end
        ? edit.start === other.start && edit.end === other.end
        : edit.start < other.end && other.start < edit.end,
    );

  for (const fix of fixes) {
    if (fix.edits.some(overlaps)) {
      skipped.push(fix);
      continue;
    }
    edits.push(...fix.edits);
    applied.push(fix);
  }

  // С конца к началу: правка не сдвигает то, что стоит перед ней.
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let result = source;
  for (const edit of edits) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return { source: result, applied, skipped };
}
