/**
 * Линтер SecLang: стандартный набор проверок и точки входа.
 *
 * Порядок набора — порядок, в котором замечания об одном месте попадут в
 * результат: сначала форма записи, потом смысл.
 */

import { lintFile, lintSource, lintSources } from './engine';
import { createWorkspaceWith } from './workspace';
import { operators, pipeline } from './checks/flow';
import { actionValues, reactions } from './checks/actions';
import { captures } from './checks/captures';
import { characters } from './checks/characters';
import { security } from './checks/security';
import { engines } from './checks/engine';
import { directives, environment } from './checks/environment';
import { exclusions } from './checks/exclusions';
import { macros, operands } from './checks/operands';
import { regexes } from './checks/regex';
import { names, rules, syntax } from './checks/structure';
import { markers, variables } from './checks/symbols';
import { targets } from './checks/targets';
import type { FileNode } from '../ast';
import type { Model } from '../analyze';
import type { Check, Diagnostic, FileDiagnostics, LintOptions, SourceFile } from './engine';
import type { Workspace } from './workspace';

export const DEFAULT_CHECKS: readonly Check[] = [
  syntax,
  characters,
  names,
  rules,
  targets,
  pipeline,
  operators,
  regexes,
  actionValues,
  reactions,
  macros,
  operands,
  markers,
  variables,
  captures,
  exclusions,
  security,
  environment,
  directives,
  engines,
];

/** Разбирает текст конфигурации и возвращает замечания по порядку исходника. */
export function lint(source: string, options: LintOptions = {}): Diagnostic[] {
  return lintSource(source, options.checks ?? DEFAULT_CHECKS, options);
}

/** То же для уже разобранного файла — когда дерево и модель нужны и сами. */
export function lintTree(file: FileNode, options: LintOptions = {}, model?: Model): Diagnostic[] {
  return lintFile(file, options.checks ?? DEFAULT_CHECKS, options, model);
}

/** Проверяет набор файлов в порядке загрузки; замечания — по файлам. */
export function lintWorkspace(
  files: readonly SourceFile[],
  options: LintOptions = {},
): FileDiagnostics[] {
  return lintSources(files, options.checks ?? DEFAULT_CHECKS, options);
}

/**
 * Набор, который проверяют много раз: разбор файла повторяется, только
 * когда изменился его текст. Настройки — те, что будут действовать, если
 * `lint()` набора не передать свои.
 */
export function createWorkspace(options: LintOptions = {}): Workspace {
  return createWorkspaceWith(options.checks ?? DEFAULT_CHECKS, options);
}

export { CODES, formatMessage, refusedBy, refuses, severityOf, topicOf } from './codes';
export { FIXABLE, applyFixes, fixFor, fixesFor } from './fixes';
export type { Fix, FixResult, TextEdit } from './fixes';
export type { Workspace } from './workspace';
export { lintFile, lintSource, lintSources } from './engine';
export type { DiagnosticCode, Severity, Topic } from './codes';
export type { Level } from './options';
export type {
  Check,
  CheckContext,
  Diagnostic,
  FileDiagnostics,
  LintOptions,
  Listeners,
  Range,
  SourceFile,
} from './engine';
