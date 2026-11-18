/**
 * Движок линтера: один обход дерева на все проверки.
 *
 * Проверка — это набор обработчиков: на вид узла (`Variable`, `Transform`),
 * на условие, на правило целиком. Движок обходит дерево один раз и на
 * каждом узле зовёт всех, кто на него подписан, поэтому новая проверка
 * обхода не добавляет: цена растёт от числа узлов, а не от числа проверок,
 * умноженного на число узлов.
 *
 * Проверка ничего не знает о строках, уровнях и переводах. Она называет
 * код и место в дереве; уровень берётся из словаря (`codes.ts`), строка и
 * столбец считаются здесь, один раз и только для тех замечаний, которые
 * дошли до результата.
 */

import { forEachChild, statementAt } from '../ast';
import { analyze, analyzeAll } from '../analyze';
import { parse } from '../parser';
import { LineIndex } from '../position';
import { CODES, formatMessage } from './codes';
import { buildMute, resolveLevels } from './options';
import type { FileNode, Node, NodeKind, NodeOfKind, Statement } from '../ast';
import type { ConditionInfo, Model, RuleInfo } from '../analyze';
import type { Engine } from '../engines';
import type { DiagnosticCode, Severity, Topic } from './codes';
import type { LintOptions } from './options';

export type { LintOptions } from './options';

export interface Diagnostic {
  code: DiagnosticCode;
  severity: Severity;
  topic: Topic;
  /** Готовый английский текст; для своего перевода есть `code` и `data`. */
  message: string;
  /** Подстановки в текст замечания. */
  data?: Record<string, string>;
  /**
   * Движки, которые запись с таким замечанием не загружают; поля нет —
   * загружают все. Уровень замечания уже учитывает этот список.
   */
  refusedBy?: readonly Engine[];
  /** Границы в исходнике: `start` включён, `end` исключён. */
  start: number;
  end: number;
  /** Строка и столбец начала, с единицы. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

/** Место замечания: узел дерева или любой отрезок исходника. */
export interface Range {
  start: number;
  end: number;
}

export interface CheckContext {
  file: FileNode;
  model: Model;
  /** Настройки проверки: нужны тем, чьё поведение от них зависит. */
  options: LintOptions;
  /**
   * Называет замечание и его место.
   *
   * `refusedBy` — какие движки такую запись не загружают. Обычно это
   * свойство кода и задано в словаре; передавать список нужно там, где под
   * одним кодом стоят случаи с разным исходом (`severity:banana` третья
   * версия отвергает, `status:99` — нет).
   */
  report(
    code: DiagnosticCode,
    at: Range,
    data?: Record<string, string>,
    refusedBy?: readonly Engine[],
  ): void;
}

/**
 * На что проверка подписана.
 *
 * Узлы приходят в порядке исходника. `rule` и `condition` зовутся после
 * обхода дерева, по разу на правило и на каждое его звено: к этому
 * моменту модель построена целиком, и проверке видно всё правило сразу.
 */
export type Listeners = {
  [K in NodeKind]?: (node: NodeOfKind<K>) => void;
} & {
  rule?(rule: RuleInfo): void;
  condition?(condition: ConditionInfo): void;
  /** После всего остального — для проверок, которые копили состояние. */
  end?(): void;
};

export interface Check {
  /** Имя для списков и отладки; на замечания не влияет. */
  name: string;
  create(context: CheckContext): Listeners;
}

type Handler = (subject: never) => void;

/**
 * Проверяет уже разобранный файл.
 *
 * `model` можно передать, если она уже построена: редактору она нужна и
 * для подсказок, и строить её дважды незачем.
 */
export function lintFile(
  file: FileNode,
  checks: readonly Check[],
  options: LintOptions = {},
  model: Model = analyze(file),
): Diagnostic[] {
  // Что выключено настройками, отсекается прямо здесь: проверке незачем
  // знать, что её замечание никому не нужно.
  const levels = resolveLevels(options);
  const found: Array<Omit<Diagnostic, 'line' | 'column' | 'endLine' | 'endColumn'>> = [];

  const context: CheckContext = {
    file,
    model,
    options,
    report(code, at, data, refusedBy = CODES[code].refusedBy) {
      const severity = levels(code, refusedBy);
      if (severity === null) return;
      found.push({
        code,
        severity,
        topic: CODES[code].topic,
        message: formatMessage(code, data),
        data,
        ...(refusedBy.length > 0 ? { refusedBy } : {}),
        start: at.start,
        end: Math.max(at.end, at.start),
      });
    },
  };

  // Обработчики раскладываются по событиям заранее: на узле остаётся
  // только взять готовый список.
  const byEvent = new Map<string, Handler[]>();
  for (const check of checks) {
    const listeners = check.create(context) as unknown as Record<string, Handler | undefined>;
    for (const event of Object.keys(listeners)) {
      const handler = listeners[event];
      if (handler === undefined) continue;
      const list = byEvent.get(event);
      if (list === undefined) byEvent.set(event, [handler]);
      else list.push(handler);
    }
  }

  const emit = (event: string, subject: unknown): void => {
    const handlers = byEvent.get(event);
    if (handlers === undefined) return;
    for (let i = 0; i < handlers.length; i++) handlers[i](subject as never);
  };

  const visit = (node: Node): void => {
    emit(node.kind, node);
    forEachChild(node, visit);
  };
  visit(file);

  if (byEvent.has('rule') || byEvent.has('condition')) {
    for (const rule of model.rules) {
      emit('rule', rule);
      for (const condition of rule.conditions) emit('condition', condition);
    }
  }
  emit('end', undefined);

  // Утверждение с незакрытой кавычкой разрезано на аргументы не там, где
  // хотел автор, и всё, что сказано о его частях, — следствие одной
  // опечатки. Остаётся только сообщение о ней самой.
  const broken: Statement[] = [];
  for (const issue of file.issues) {
    if (
      issue.code !== 'unterminatedQuote' &&
      issue.code !== 'unterminatedValueQuote' &&
      issue.code !== 'textAfterQuote'
    ) {
      continue;
    }
    const statement = statementAt(file, issue.start);
    if (statement !== null) broken.push(statement);
  }
  // То же с посторонним символом там, где движок ждёт пробела или кавычки:
  // утверждение разобрано не так, как его видит автор, и о его частях
  // говорить не о чем. Метка порядка байтов ломает первое утверждение.
  for (const item of found) {
    if (item.code !== 'strayCharacter' && item.code !== 'byteOrderMark') continue;
    const statement =
      statementAt(file, item.start) ?? file.statements.find((s) => s.start > item.start) ?? null;
    if (statement !== null) broken.push(statement);
  }
  let kept =
    broken.length === 0
      ? found
      : found.filter(
          (item) =>
            item.code === 'unbalancedQuotes' ||
            item.code === 'unclosedValueQuote' ||
            item.code === 'textAfterQuote' ||
            item.code === 'strayCharacter' ||
            item.code === 'byteOrderMark' ||
            item.code === 'invisibleCharacter' ||
            !broken.some((s) => item.start >= s.start && item.start <= s.end),
        );

  // Снятое по месту: пометками в самом файле и настройкой по номеру правила.
  const mute = buildMute(file, model, options);
  if (mute !== null) {
    kept = kept.filter((item) => !mute.muted(item));
    // О самих пометках говорит тот, кто их читал: опечатка в коде и
    // пометка, которой нечего снимать.
    for (const issue of mute.finish()) {
      const severity = levels(issue.code);
      if (severity === null) continue;
      kept.push({
        code: issue.code,
        severity,
        topic: CODES[issue.code].topic,
        message: formatMessage(issue.code, issue.data),
        data: issue.data,
        start: issue.start,
        end: issue.end,
      });
    }
  }

  // Замечания читают сверху вниз. Сортировка устойчива: у замечаний об
  // одном месте сохраняется порядок проверок.
  kept.sort((a, b) => a.start - b.start);

  const lines = new LineIndex(file.source);
  return kept.map((item) => {
    const from = lines.positionAt(item.start);
    const to = lines.positionAt(item.end);
    return {
      ...item,
      line: from.line,
      column: from.column,
      endLine: to.line,
      endColumn: to.column,
    };
  });
}

/** Разбирает текст и проверяет его. */
export function lintSource(
  source: string,
  checks: readonly Check[],
  options?: LintOptions,
): Diagnostic[] {
  return lintFile(parse(source), checks, options);
}

/** Файл набора: имя — любое, по нему результат возвращается обратно. */
export interface SourceFile {
  name: string;
  source: string;
}

export interface FileDiagnostics {
  name: string;
  diagnostics: Diagnostic[];
}

/**
 * Проверяет набор файлов, загруженных в этом порядке.
 *
 * Отличается от проверки по одному тем же, чем набор отличается от файла:
 * метка для `skipAfter` ищется во всех файлах, номер правила занят один раз
 * на весь набор, а `SecDefaultAction` действует и на файлы, идущие следом.
 * Замечания возвращаются по файлам: строка и смещение считаются внутри
 * файла, и общий список был бы бесполезен.
 */
export function lintSources(
  files: readonly SourceFile[],
  checks: readonly Check[],
  options?: LintOptions,
): FileDiagnostics[] {
  const trees = files.map((file) => parse(file.source));
  const models = analyzeAll(
    trees,
    files.map((file) => file.name),
  );
  return files.map((file, index) => ({
    name: file.name,
    diagnostics: lintFile(trees[index], checks, options, models[index]),
  }));
}
