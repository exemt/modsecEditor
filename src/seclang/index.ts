/**
 * SecLang — разбор и проверка правил ModSecurity.
 *
 * Модуль самодостаточен: ничего не импортирует извне своей папки и не
 * знает ни о редакторе, ни о браузере. Слоёв три, каждый следующий стоит
 * на предыдущем и ничего в нём не меняет:
 *
 *  - `parse` — текст → синтаксическое дерево с точными границами узлов;
 *  - `analyze` — дерево → смысл: цепочки, конвейер с типом значения на
 *    каждом шаге, номера правил и метки;
 *  - `lint` — замечания: что не загрузится, что не сработает, что лишнее.
 *
 * Знание о самом языке — какие бывают имена и что они значат — лежит в
 * `catalog`, типы значений — в `value`.
 */

export {
  parse,
  parseActionList,
  parseArguments,
  parseOperator,
  parseVariableList,
} from './parser';
export {
  findAction,
  forEachChild,
  isRuleStatement,
  nodePathAt,
  statementAt,
  walk,
} from './ast';
export { activeSteps, analyze, analyzeAll, runPipeline, stepOutput, stepStatus } from './analyze';
export { ENGINES, ENGINE_LABELS, engineSupports, expandsMacros, urlDecodedBy } from './engines';
export { LineIndex } from './position';
export { regexReason, reviewRegex, translateRegex } from './regex';
export { regexFeatures } from './regexFeatures';
export { BLOCKING, PERSISTENT, matchesPattern, runsBefore, toIdRange, variableKey } from './symbols';
export { isValidIpEntry } from './ip';
export {
  decodeQuoted,
  encodeQuoted,
  isPatternSelector,
  needsQuotes,
  selectorIssue,
  selectorPattern,
} from './quoting';
export {
  RULE_FIELDS,
  SEVERITY_NAMES,
  WRITABLE_COLLECTIONS,
  actionNames,
  actionSpec,
  ctlNames,
  ctlSpec,
  directiveName,
  directiveNames,
  directiveSpec,
  operatorNames,
  operatorSpec,
  phaseNumber,
  transformNames,
  transformSpec,
  variableNames,
  variableSpec,
} from './catalog';
export {
  ANY,
  BINARY,
  COUNT,
  Fact,
  NUMBER,
  STRING,
  closeFacts,
  describeType,
  factNames,
  hasFact,
  joinTypes,
  kindFits,
  valueType,
} from './value';
export {
  CODES,
  DEFAULT_CHECKS,
  FIXABLE,
  applyFixes,
  createWorkspace,
  fixFor,
  fixesFor,
  formatMessage,
  refusedBy,
  refuses,
  lint,
  lintFile,
  lintSource,
  lintSources,
  lintTree,
  lintWorkspace,
  severityOf,
  topicOf,
} from './lint';

export type * from './ast';
export type {
  ConditionInfo,
  Model,
  Pipeline,
  PipelineStep,
  RuleInfo,
  Scope,
  StepStatus,
  TargetInfo,
} from './analyze';
export type { Engine, NameKind } from './engines';
export type { Position } from './position';
export type { RegexReview, RegexRewrite, RegexTranslation } from './regex';
export type { RegexFeature } from './regexFeatures';
export type { SelectorIssue } from './quoting';
export type {
  ExclusionSite,
  IdRange,
  JumpSite,
  MarkerSite,
  Settings,
  Site,
  Symbols,
  VariableEntry,
  VariableUse,
} from './symbols';
export type {
  ActionGroup,
  ActionSpec,
  ActionValue,
  CtlValue,
  DirectiveArg,
  OperatorArg,
  OperatorSpec,
  Phase,
  SelectorSupport,
  TransformGroup,
  TransformSpec,
  VariableSpec,
} from './catalog';
export type { FactName, ValueKind, ValueType } from './value';
export type {
  Check,
  CheckContext,
  Diagnostic,
  DiagnosticCode,
  FileDiagnostics,
  Fix,
  FixResult,
  Level,
  LintOptions,
  Listeners,
  Range,
  Severity,
  SourceFile,
  TextEdit,
  Topic,
  Workspace,
} from './lint';
