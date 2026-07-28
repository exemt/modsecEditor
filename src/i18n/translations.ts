import type { KeywordCategory } from '../components/syntax/modsecKeywords';
import type { ExampleSection } from '../data/modsecExamples';
import type { DiagnosticCode, DiagnosticSlot, DiagnosticTopic } from '../modsec/diagnostics';
import type { FixKind } from '../modsec/fixes';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'EN',
  ru: 'RU',
};

/**
 * Плоский словарь UI-строк.
 *
 * Описания ключевых слов ModSecurity живут рядом с самими ключевыми словами
 * (`modsecKeywords.ts`), человекочитаемые названия переменных, операторов и
 * трансформаций — в `modsec/semantics.ts`. Здесь только «обвязка» интерфейса
 * и тексты диагностик компилятора.
 *
 * В значениях допустимы подстановки вида `{name}` — их раскрывает `t()`.
 */
const en = {
  'app.title': 'ModSecurity Rule Editor',
  'app.close': 'Close',
  'app.cancel': 'Cancel',
  'app.apply': 'Apply',
  'app.details': 'Details',
  'app.hideDetails': 'Hide',
  'app.showFull': 'Show the whole value',
  'app.language': 'Language',

  'tab.text': 'Text',
  'tab.visual': 'Visual',
  'tab.visualBlocked': 'Fix the errors in the text to switch to the visual editor',

  'examples.title': 'Examples',
  'examples.browse': 'Open the learning examples',
  'examples.dialogTitle': 'Examples of ModSecurity rules',
  'examples.hint': 'An example replaces the whole text in the editor.',
  'examples.list': 'Example list',
  'examples.open': 'Open in the editor',

  'examples.section.basics': 'Basics',
  'examples.section.attacks': 'Attacks',
  'examples.section.policy': 'Policy and limits',
  'examples.section.logic': 'Logic',
  'examples.section.state': 'State between requests',
  'examples.section.flow': 'Flow and settings',
  'examples.section.mistakes': 'Learning mistakes',

  'examples.first-rule': 'First rule',
  'examples.first-rule.note':
    'The three parts of a rule: what to check, how to check it, what to do about it.',
  'examples.phases': 'Phases',
  'examples.phases.note': 'The same kind of check in phases 1, 2, 3 and 5 — and what each one sees.',
  'examples.targets': 'Check areas',
  'examples.targets.note': 'Several areas mean OR; "!" subtracts one of them from the check.',
  'examples.transforms': 'Transformation pipeline',
  'examples.transforms.note': 'Why decoding has to happen before the path is collapsed.',
  'examples.logging': 'Log and capture',
  'examples.logging.note': 'msg, logdata and the pattern groups captured into TX:1…TX:9.',

  'examples.sqli': 'SQL Injection',
  'examples.sqli.note': 'The built-in SQL parser instead of a pattern that never covers everything.',
  'examples.xss': 'XSS',
  'examples.xss.note': 'Markup hidden behind several layers of encoding — and the pipeline that strips them.',
  'examples.traversal': 'Path traversal',
  'examples.traversal.note': 'Two dots as a path segment of their own, checked in the raw URI.',
  'examples.rce': 'Command execution',
  'examples.rce.note': 'A phrase list checked in one pass; t:cmdLine undoes the c""url trick.',
  'examples.log4shell': 'Log4Shell (JNDI)',
  'examples.log4shell.note': 'A JNDI lookup in any text field, headers included.',
  'examples.wrappers': 'PHP wrappers',
  'examples.wrappers.note': 'php:// and data:// in a parameter that was supposed to carry a file name.',
  'examples.scanner': 'Scanners',
  'examples.scanner.note': 'Scanners announce themselves in User-Agent; drop answers with silence.',
  'examples.upload': 'Uploads',
  'examples.upload.note': 'An allow list of extensions: anything new stays closed by default.',

  'examples.limits': 'Sizes and limits',
  'examples.limits.note': 'Numeric variables — and t:length when the length of a string is needed.',
  'examples.methods': 'Methods and protocol',
  'examples.methods.note': 'Allow what is listed, refuse the rest; HTTP/1.0 without a Host.',
  'examples.leak': 'Leak in the response',
  'examples.leak.note': 'Phases 3 and 4: a stack trace inside an error page.',

  'examples.chain': 'Chain (AND)',
  'examples.chain.note': 'Either every link matches or none does; the head carries id, phase and reaction.',
  'examples.counting': 'Counting (&)',
  'examples.counting.note': '"&" asks how many, not what — and turns the input into a number.',
  'examples.negation': 'Negation',
  'examples.negation.note': 'Two different kinds of "not": before the operator and before the check area.',

  'examples.scoring': 'Anomaly scoring',
  'examples.scoring.note': 'How CRS works: signals add points, and the threshold decides once.',
  'examples.rate-limit': 'Rate limit',
  'examples.rate-limit.note':
    'A counter that outlives the request: initcol, setvar and expirevar.',

  'examples.skip-marker': 'Skip a block',
  'examples.skip-marker.note': 'One trusted path jumps over the whole strict block to a marker.',
  'examples.ctl': 'Per-request settings (ctl)',
  'examples.ctl.note': 'Lifting a single check off a single path without touching the rest.',

  'examples.never-matches': 'Never matches',
  'examples.never-matches.note':
    'Three rules that are impeccable in form and useless in meaning.',
  'examples.mistakes': 'Five mistakes in a row',
  'examples.mistakes.note': 'One mistake per rule — read them off the diagnostics panel.',
  'examples.detection-only': 'Detection only',
  'examples.detection-only.note': 'A "deny" that looks like protection while the engine only watches.',

  'editor.ariaLabel': 'ModSecurity rules editor',

  'debug.title': 'Debug',
  'debug.tab.diagnostics': 'Diagnostics',
  'debug.tab.model': 'Builder model',
  'debug.tab.parsed': 'Parsed document',
  'debug.empty': 'Nothing parsed yet.',
  'debug.clean': 'No problems found.',
  'debug.summary': '{errors} errors, {warnings} warnings',
  'debug.advice': '{advice} advice',
  'debug.adviceHide': 'Hide advice',
  'debug.adviceShow': 'Show advice',
  'debug.collapse': 'Collapse the panel',
  'debug.expand': 'Expand the panel',
  'debug.inspecting': 'checking\u2026',
  'debug.shownOf': 'showing {shown} of {total} — the rest is in the text tab',
  'debug.line': 'line {line}',
  'debug.inBuilder': 'in the builder',
  'debug.condition': 'condition {index}',
  'debug.blocked': 'Visual editor is blocked until the errors are fixed.',

  'builder.empty': 'No rules yet.',
  'builder.addRule': 'Add rule',
  'builder.deleteRule': 'Delete rule',
  'builder.rule': 'Rule',
  'builder.ruleId': 'Rule ID',
  'builder.description': 'Description',
  'builder.descriptionPlaceholder': 'What this rule does',

  // Счётчики блоков: голое число у правого края полосы ничего не обещает,
  // и подсказка обязана сказать, что именно посчитано, а не сколько.
  'builder.countConditions': 'Conditions in the chain: {count} — they fire only together',
  'builder.countConditionNotes': 'Notes about these conditions: {count}',
  'builder.countActions':
    'Actions of the rule: {count} — the ID is not among them, it stands in the card header',
  'builder.countRuleNotes':
    'Notes about the rule as a whole: {count} — what is said about a condition stands by it',
  'builder.countAllNotes': 'Notes about this rule: {count}, conditions included',

  'builder.conditions': 'Conditions',
  'builder.and': 'AND',
  'builder.or': 'OR',
  'builder.addCondition': 'Add condition',
  'builder.deleteCondition': 'Delete condition',
  'builder.addOr': 'Add',
  'builder.deleteTarget': 'Remove check area',

  'builder.scope': 'Check area',
  'builder.parameters': 'Parameters',
  'builder.anyParameter': 'Any',
  'builder.paramsAll': 'ALL',
  'builder.paramsOnly': 'ONLY',
  'builder.paramsExcept': 'ALL EXCEPT',
  // Цель без положительной части: список только вычитает из соседних.
  'builder.except': 'EXCEPT',
  'builder.paramsAllHint': 'No parameters listed — the whole collection is checked',
  'builder.paramsModeHint': 'Switch: the whole collection, only the listed parameters, or the collection without them',
  'builder.paramsAllBlocked': 'Clear the list to check the whole collection',
  'builder.paramsRequired': 'Add at least one value — the whole collection is checked so far',
  'builder.addParam': 'Add parameter',
  'builder.exclusions': 'Exclusions',
  'builder.addExcept': 'Add exclusion',
  'builder.listHint': 'One value per line.',
  'builder.listHintComma': 'A comma separates values too.',
  'builder.count': 'Count',
  'builder.countHint': 'Compare the number of elements instead of their values',
  'builder.countUnavailable': 'Counting works only for collections',

  'builder.transform': 'Transformation',
  'builder.transformNone': 'None',
  'builder.addTransform': 'Add transformation',
  'builder.transformRequired': 'Choose a transformation',
  'builder.transformsBlocked': 'Counting replaces the value with a number, so transformations do not apply',
  'builder.dragTransform': 'Drag to reorder',

  'builder.previewOpen': 'Try a sample value',
  'builder.previewClose': 'Close the sample check',
  'builder.previewNoTransforms':
    'No transformations left — there is nothing to run the sample through',
  'builder.previewSample': 'Sample value',
  'builder.previewHint': 'What arrives at this check — the pipeline shows what it turns into',
  'builder.previewInput': 'input',
  'builder.previewUnchanged': 'unchanged',
  'builder.previewEmptyValue': 'nothing left',
  'builder.previewOpaque': 'result not reproduced here',
  'builder.previewMatch': 'matches',
  'builder.previewNoMatch': 'does not match',
  'builder.previewUnknown': 'not evaluated here',

  'builder.choiceAll': 'Show every option — {count} more',
  'builder.choiceCommon': 'Show the common ones only',
  'builder.choiceOften': 'often used',

  'builder.operator': 'Operator',
  'builder.value': 'Value',
  'builder.addValue': 'Add value',
  'builder.ipInvalid': 'Not an IPv4/IPv6 address or CIDR network (e.g. 192.168.1.0/24 or 2001:db8::/32).',
  'builder.negate': 'Invert the result of this check',
  'builder.noArgument': 'This operator takes no value',
  'builder.editInWindow': 'Edit in a window',
  'builder.regexHint': 'Regular expression: checked as you type.',
  'builder.regexInvalid': 'The pattern does not compile: {reason}',
  'builder.regexPcre':
    'The pattern uses PCRE syntax that JavaScript has no equivalent for — "(?i)" and the like. The check translates it, so the rule is fine.',
  'builder.regexUnsupported':
    'PCRE has no JavaScript equivalent for "{what}". The rule itself is fine, but the editor cannot check this pattern.',

  'builder.actions': 'Actions',
  'builder.id': 'ID',
  'builder.phase': 'Phase',
  'builder.disruptive': 'Reaction',
  'builder.status': 'HTTP status',
  'builder.message': 'Message',
  'builder.logdata': 'Log data',
  'builder.severity': 'Severity',
  'builder.ver': 'Rule set version',
  'builder.rev': 'Revision',
  'builder.maturity': 'Maturity',
  'builder.accuracy': 'Accuracy',
  'builder.tags': 'Tags',
  'builder.addTag': 'Add tag',
  'builder.capture': 'Capture matches',
  'builder.log': 'Log',
  'builder.auditlog': 'Audit log',
  'builder.setvar': 'Set variables',
  'builder.otherActions': 'Other actions',
  'builder.unset': 'not set',
  'builder.more': 'More',
  'builder.less': 'Less',

  'builder.notes': 'Notes',

  'builder.secAction': 'Unconditional action',
  'builder.marker': 'Marker',
  'builder.directive': 'Directive',
  'builder.readOnly': 'Editable in the text tab only',

  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'toolbar.format': 'Format',
  'toolbar.formatHint': 'Lay the rule out line by line — one action per line (Shift+Alt+F)',
  'toolbar.formatDone': 'The text is already laid out',

  'diag.notParsed': 'The rule text has not been parsed yet.',
  'diag.unbalancedQuotes': 'Unbalanced double quotes.',
  'diag.unknownDirective': 'Unknown directive "{name}".',
  'diag.emptyTargets': 'The rule has no check areas.',
  'diag.unknownOperator': 'Unknown operator "@{name}".',
  'diag.operatorArgumentRequired': 'Operator "@{name}" requires a value.',
  'diag.danglingChain': 'The chain is broken: "chain" is set but there is no next rule.',
  'diag.missingId': 'The rule has no "id" — ModSecurity will refuse to load it.',
  'diag.duplicateId': 'Duplicate rule id "{id}".',
  'diag.chainLinkHeadAction': 'Action "{name}" is only allowed on the first rule of a chain.',

  'diag.unknownVariable': 'Unknown variable "{name}".',
  'diag.selectorNeedsQuotes':
    'Parameter "{value}" has to be quoted, and ModSecurity 3 does not read that form. Portable equivalent: {pattern}',
  'diag.selectorNotPortable':
    'Parameter "{value}" cannot be written so that ModSecurity 2 and 3 read it the same way.',
  'diag.unknownTransform': 'Unknown transformation "{name}".',
  'diag.unknownAction': 'Unknown action "{name}".',
  'diag.actionNotEditable': 'Action "{name}" is not editable in the visual builder.',
  'diag.countWithTransforms': 'Counting (&) ignores transformations.',
  'diag.countOnScalar': '"{name}" is not a collection, counting always yields 0 or 1.',
  'diag.selectorNotSupported': '"{name}" does not take a parameter.',
  'diag.selectorRequired': '"{name}" requires a parameter.',
  'diag.excludeWithoutSelector': 'Exclusion of "{name}" without a parameter removes the whole collection.',
  'diag.excludeWithoutBase': 'Exclusion of "{name}" has nothing to subtract from.',
  'diag.operatorArgumentUnexpected': 'Operator "@{name}" takes no value.',
  'diag.operatorInputMismatch': 'Operator "@{name}" does not fit the value type of this check.',
  'diag.nonNumericArgument': 'Operator "@{name}" expects a number.',
  'diag.invalidIpEntry': 'Not an IPv4/IPv6 address or CIDR network: {value}.',
  'diag.invalidRegex': 'The regular expression of "@{name}" is invalid.',
  'diag.transformNoneNotFirst': '"none" resets the pipeline and should come first.',
  'diag.duplicateTransform': 'Transformation "{name}" is applied twice.',
  'diag.missingPhase': 'The processing phase is not set.',
  'diag.phaseTooEarly': 'Phase {phase} is too early: the check areas are filled in from phase {required}.',
  'diag.noDisruptive': 'The rule has no reaction (deny / pass / …).',
  'diag.statusWithoutBlock': '"status" only matters together with deny or redirect.',

  'diag.caseNeverMatches': '"t:{name}" leaves the value in one case — "{value}" will never match.',
  'diag.whitespaceNeverMatches': '"t:{name}" changes the spaces in the value — "{value}" will never match as written.',
  'diag.hashWithoutHexEncode': 'After "t:{name}" the value is raw bytes: add "t:hexEncode" to compare it with text.',
  'diag.conflictingCaseTransforms': '"t:lowercase" and "t:uppercase" in one pipeline: only the last one has any effect.',
  'diag.impossibleNumericRange': 'The chain can never match: no value satisfies both "{first}" and "{second}".',
  'diag.literalWithRegexSyntax': 'Operator "@{name}" compares text literally — "{value}" is searched as written, not as a pattern.',
  'diag.negationMatchesNothing': 'The pattern matches any value, so the negated check never fires.',
  'diag.neverTrueComparison': 'This value is never negative — the condition can never be true.',
  'diag.matchesEverything': 'The pattern matches any value — the check filters nothing out.',
  'diag.alwaysTrueComparison': 'This value is never negative — the condition is always true.',

  'diag.decodeAfterNormalise': 'Decoding "t:{decode}" runs after "t:{normalise}": encoded sequences are still hidden when the value is normalised.',
  'diag.noNormalisation': 'The check depends on case and encoding: "t:lowercase" and "t:urlDecodeUni" usually go before it.',
  'diag.unescapedDot': 'The dot in "{value}" matches any character — write "\\." if a literal dot was meant.',
  'diag.overlappingTargets': '"{inner}" is already part of "{outer}" — the second area adds nothing.',

  'diag.requestBodyAccessOff': '"SecRequestBodyAccess Off" in this file: "{name}" is always empty.',
  'diag.responseBodyAccessOff': '"SecResponseBodyAccess Off" in this file: "{name}" is always empty.',
  'diag.disruptiveInLoggingPhase': 'In phase 5 the response has already been sent — "{name}" is ignored.',
  'diag.missingMarker': 'There is no "SecMarker {name}" in this file — the jump leads nowhere.',
  'diag.skipBeyondEnd': '"skip:{count}" skips more rules than the {rest} left in this file.',
  'diag.engineNotEnforcing': 'SecRuleEngine is "{mode}": blocking actions in this file are logged but not applied.',
  'diag.xmlWithoutProcessor': '"XML" is only filled in after "ctl:requestBodyProcessor=XML", which this file never sets.',
  'diag.txNeverSet': 'Nothing in this file sets "tx.{name}".',

  'diag.captureWithoutRegex': 'Nothing to capture: no check of this rule uses a regular expression.',
  'diag.captureMissing': '"%{TX.{index}}" is empty: the rule has no "capture" action.',
  'diag.blockWithoutLog': 'The rule blocks the request with "nolog": nothing will explain the refusal afterwards.',
  'diag.logdataWithoutLog': '"logdata" is set but logging is off — the data goes nowhere.',
  'diag.captureUnused': '"capture" is on, but "%{TX.1}" is never used in this rule.',
  'diag.blockWithoutMsg': 'A blocking rule without "msg" leaves only its id in the log.',

  'diag.possibleRedos': 'Nested quantifiers: on a crafted value this pattern can take a very long time to match.',
  'diag.regexIsPlainText': 'The pattern has no special characters — "@contains {value}" does the same and costs less.',
  'diag.anchoredLiteralRegex': 'The pattern is anchored on both sides and has no special characters — this is "@streq {value}".',
  'diag.redundantLeadingWildcard': 'A leading ".*" changes nothing: the pattern is searched anywhere in the value.',
  'diag.capturingGroupUnused': 'A capturing group without the "capture" action only slows matching down — use "(?:…)".',
  'diag.rblOnHotPath': 'Every "@rbl" check is a DNS request; on a busy path that is noticeable.',

  'diag.duplicateTarget': 'Check area "{name}" is listed twice.',
  'diag.duplicateCondition': 'Two links of the chain check exactly the same thing.',
  'diag.duplicateRule': 'The rule repeats the check of rule {id}.',
  'diag.redundantTransform': 'After "t:{previous}" the transformation "t:{name}" changes nothing.',
  'diag.transformsWithoutCheck': 'Operator "@{name}" never looks at the value — the transformations have no effect.',
  'diag.singlePhraseList': 'A list of a single phrase — "@contains {value}" says the same more plainly.',
  'diag.idInReservedRange': 'Id {id} falls into the 900000–999999 range reserved by CRS.',

  'toolbar.open': 'Open',
  'toolbar.openHint': 'Load a .conf file from disk',
  'toolbar.save': 'Save',
  'toolbar.saveHint': 'Download the text as a .conf file',
  'toolbar.copy': 'Copy',
  'toolbar.copyHint': 'Copy the whole text to the clipboard',
  'toolbar.copied': 'Copied to the clipboard',
  'toolbar.copyFailed': 'The browser did not allow access to the clipboard',

  'document.replaceTitle': 'Replace the current text?',
  'document.replaceBody':
    'The current text has been edited. Loading another document will discard those edits.',
  'document.replace': 'Replace',

  'builder.destination': 'Destination',
  'builder.collapse': 'Collapse the rule',
  'builder.expand': 'Expand the rule',
  'builder.collapseBlock': 'Collapse the block',
  'builder.expandBlock': 'Expand the block',
  'builder.collapseSection': 'Collapse "{name}"',
  'builder.expandSection': 'Expand "{name}"',
  'builder.collapseAll': 'Collapse everything',
  'builder.expandAll': 'Expand everything',
  'builder.expandAllSlow': 'Expand everything — on a file this large it takes a while',
  'builder.expandedOf': '{expanded} of {total} expanded',
  'builder.duplicateRule': 'Duplicate the rule',
  'builder.moveUp': 'Move up',
  'builder.moveDown': 'Move down',
  'builder.andMore': 'more',
  'diag.destinationMissing':
    '"{name}" needs an address — without it ModSecurity will not load the rule.',
  'diag.destinationUnexpected':
    '"{name}" takes no address: the value next to it will be rejected on load.',

  'topic.structure': 'Form',
  'topic.logic': 'Logic',
  'topic.coverage': 'Coverage',
  'topic.environment': 'Environment',
  'topic.logging': 'Logging',
  'topic.performance': 'Cost',
  'topic.style': 'Redundancy',

  'fix.title': 'Fix',
  'fix.lowercaseValue': 'Lower-case the value',
  'fix.uppercaseValue': 'Upper-case the value',
  'fix.useContains': 'Switch to @contains',
  'fix.useStreq': 'Switch to @streq',
  'fix.dropLeadingWildcard': 'Drop the leading ".*"',
  'fix.escapeDots': 'Escape the dots',
  'fix.moveNoneFirst': 'Move "none" first',
  'fix.removeTransform': 'Remove "t:{name}"',
  'fix.reorderPipeline': 'Decode first',
  'fix.clearTransforms': 'Clear the pipeline',
  'fix.addHexEncode': 'Add "t:hexEncode"',
  'fix.addNormalisation': 'Normalise before the check',
  'fix.removeTarget': 'Remove "{name}"',
  'fix.usePatternSelector': 'Match the name with a pattern',
  'fix.setPhase': 'Set the required phase',
  'fix.clearStatus': 'Clear "status"',
  'fix.restoreLog': 'Turn logging back on',
  'fix.enableCapture': 'Add "capture"',
  'fix.disableCapture': 'Remove "capture"',

  'tooltip.noDescription': 'No description available yet.',
  'tooltip.expandHint': 'Alt — details',
  'tooltip.collapseHint': 'Release Alt to collapse',
  'tooltip.syntax': 'Syntax',
  'tooltip.tech': 'Under the hood',
  'tooltip.tech.argument': 'Argument',
  'tooltip.tech.fallback': 'If omitted',
  'tooltip.tech.scope': 'Where it applies',
  'tooltip.tech.cost': 'Cost',
  'tooltip.tech.availability': 'Availability',
  'tooltip.gotchas': 'Watch out',
  'tooltip.example': 'Example',
  'tooltip.seeAlso': 'See also',
  'category.directive': 'Directive',
  'category.action': 'Action',
  'category.transform': 'Transformation',
  'category.operator': 'Operator',
  'category.variable': 'Variable',
} as const;

export type TranslationKey = keyof typeof en;

/**
 * Ключ текста диагностики.
 *
 * Возврат типизирован, поэтому забытый перевод — ошибка сборки, а не сырой
 * `diag.captureUnused`, замеченный в интерфейсе через полгода.
 */
export function diagnosticKey(code: DiagnosticCode): TranslationKey {
  return `diag.${code}`;
}

/** Ключ названия темы диагностики. */
export function topicKey(topic: DiagnosticTopic): TranslationKey {
  return `topic.${topic}`;
}

/** Ключ названия раздела учебных примеров. */
export function exampleSectionKey(section: ExampleSection): TranslationKey {
  return `examples.section.${section}`;
}

/** Ключ подписи кнопки быстрой правки. */
export function fixKey(kind: FixKind): TranslationKey {
  return `fix.${kind}`;
}

/** Ключ подписи для той части правила, к которой относится диагностика. */
export function slotKey(slot: DiagnosticSlot): TranslationKey {
  switch (slot) {
    case 'targets':
      return 'builder.scope';
    case 'transforms':
      return 'builder.transform';
    case 'operator':
      return 'builder.operator';
    case 'actions':
      return 'builder.actions';
  }
}

const ru: Record<TranslationKey, string> = {
  'app.title': 'Редактор правил ModSecurity',
  'app.close': 'Закрыть',
  'app.cancel': 'Отмена',
  'app.apply': 'Применить',
  'app.details': 'Подробности',
  'app.hideDetails': 'Скрыть',
  'app.showFull': 'Показать значение целиком',
  'app.language': 'Язык',

  'tab.text': 'Текстовый',
  'tab.visual': 'Визуальный',
  'tab.visualBlocked': 'Исправьте ошибки в тексте, чтобы перейти в визуальный редактор',

  'examples.title': 'Примеры',
  'examples.browse': 'Открыть учебные примеры',
  'examples.dialogTitle': 'Примеры правил ModSecurity',
  'examples.hint': 'Пример заменяет весь текст в редакторе.',
  'examples.list': 'Список примеров',
  'examples.open': 'Открыть в редакторе',

  'examples.section.basics': 'Основы',
  'examples.section.attacks': 'Атаки',
  'examples.section.policy': 'Политика и лимиты',
  'examples.section.logic': 'Логика',
  'examples.section.state': 'Состояние между запросами',
  'examples.section.flow': 'Поток и настройки',
  'examples.section.mistakes': 'Учебные ошибки',

  'examples.first-rule': 'Первое правило',
  'examples.first-rule.note': 'Три части правила: что проверяем, чем проверяем и что делаем.',
  'examples.phases': 'Фазы обработки',
  'examples.phases.note': 'Одна и та же проверка в фазах 1, 2, 3 и 5 — и что видит каждая из них.',
  'examples.targets': 'Области проверки',
  'examples.targets.note': 'Несколько областей — это ИЛИ, а «!» вычитает одну из них из проверки.',
  'examples.transforms': 'Конвейер преобразований',
  'examples.transforms.note': 'Почему раскодировать нужно раньше, чем сворачивать путь.',
  'examples.logging': 'Журнал и capture',
  'examples.logging.note': 'msg, logdata и группы шаблона, разложенные по TX:1…TX:9.',

  'examples.sqli': 'SQL-инъекция',
  'examples.sqli.note': 'Встроенный разборщик SQL вместо шаблона, который всё равно всего не покроет.',
  'examples.xss': 'XSS',
  'examples.xss.note': 'Разметка под несколькими слоями кодирования — и конвейер, который их снимает.',
  'examples.traversal': 'Обход каталога',
  'examples.traversal.note': 'Две точки как отдельный участок пути, проверенные в сыром URI.',
  'examples.rce': 'Запуск команд',
  'examples.rce.note': 'Список фраз одним проходом; t:cmdLine разбирает приёмы вида c""url.',
  'examples.log4shell': 'Log4Shell (JNDI)',
  'examples.log4shell.note': 'Подстановка JNDI в любом текстовом поле, включая заголовки.',
  'examples.wrappers': 'Обёртки PHP',
  'examples.wrappers.note': 'php:// и data:// в параметре, куда ждали имя файла.',
  'examples.scanner': 'Сканеры',
  'examples.scanner.note': 'Сканеры сами называют себя в User-Agent, а drop отвечает молчанием.',
  'examples.upload': 'Загрузка файлов',
  'examples.upload.note': 'Разрешительный список расширений: новый вид файла закрыт по умолчанию.',

  'examples.limits': 'Размеры и лимиты',
  'examples.limits.note': 'Числовые переменные — и t:length там, где нужна длина строки.',
  'examples.methods': 'Методы и протокол',
  'examples.methods.note': 'Разрешено перечисленное, остальное — отказ; HTTP/1.0 без Host.',
  'examples.leak': 'Утечка в ответе',
  'examples.leak.note': 'Фазы 3 и 4: трассировка стека внутри страницы с ошибкой.',

  'examples.chain': 'Цепочка (И)',
  'examples.chain.note': 'Сработают все звенья или ни одно; номер, фаза и реакция — в головном.',
  'examples.counting': 'Подсчёт (&)',
  'examples.counting.note': '«&» спрашивает «сколько», а не «что», и превращает вход в число.',
  'examples.negation': 'Отрицание',
  'examples.negation.note': 'Два разных «не»: перед оператором и перед областью проверки.',

  'examples.scoring': 'Накопительная оценка',
  'examples.scoring.note': 'Как работает CRS: подозрения копят баллы, а порог решает один раз.',
  'examples.rate-limit': 'Лимит запросов',
  'examples.rate-limit.note': 'Счётчик, который живёт дольше запроса: initcol, setvar и expirevar.',

  'examples.skip-marker': 'Переход через блок',
  'examples.skip-marker.note': 'Один доверенный путь перескакивает весь строгий блок до метки.',
  'examples.ctl': 'Настройка на один запрос (ctl)',
  'examples.ctl.note': 'Как снять одну проверку с одного адреса, не тронув остальное.',

  'examples.never-matches': 'Не сработает никогда',
  'examples.never-matches.note': 'Три правила, безупречных по форме и бесполезных по смыслу.',
  'examples.mistakes': 'Пять ошибок подряд',
  'examples.mistakes.note': 'По одной ошибке на правило — все они читаются в панели диагностик.',
  'examples.detection-only': 'Режим наблюдения',
  'examples.detection-only.note': '«deny», который выглядит защитой, пока движок только смотрит.',

  'editor.ariaLabel': 'Редактор правил ModSecurity',

  'debug.title': 'Отладка',
  'debug.tab.diagnostics': 'Диагностика',
  'debug.tab.model': 'Модель конструктора',
  'debug.tab.parsed': 'Разобранный документ',
  'debug.empty': 'Пока ничего не разобрано.',
  'debug.clean': 'Проблем не найдено.',
  'debug.summary': 'ошибок: {errors}, предупреждений: {warnings}',
  'debug.advice': 'подсказок: {advice}',
  'debug.adviceHide': 'Скрыть подсказки',
  'debug.adviceShow': 'Показать подсказки',
  'debug.collapse': 'Свернуть панель',
  'debug.expand': 'Развернуть панель',
  'debug.inspecting': 'проверяем\u2026',
  'debug.shownOf': 'показано {shown} из {total} — остальное в текстовой вкладке',
  'debug.line': 'строка {line}',
  'debug.inBuilder': 'в конструкторе',
  'debug.condition': 'условие {index}',
  'debug.blocked': 'Визуальный редактор заблокирован, пока есть ошибки.',

  'builder.empty': 'Правил пока нет.',
  'builder.addRule': 'Добавить правило',
  'builder.deleteRule': 'Удалить правило',
  'builder.rule': 'Правило',
  'builder.ruleId': 'ID правила',
  'builder.description': 'Описание',
  'builder.descriptionPlaceholder': 'Что делает это правило',

  'builder.countConditions': 'Условий в цепочке: {count} — сработают только вместе',
  'builder.countConditionNotes': 'Замечаний об этих условиях: {count}',
  'builder.countActions':
    'Действий у правила: {count} — номер сюда не входит, он в шапке карточки',
  'builder.countRuleNotes':
    'Замечаний о правиле целиком: {count} — сказанное об условии стоит рядом с ним',
  'builder.countAllNotes': 'Замечаний об этом правиле: {count}, включая условия',

  'builder.conditions': 'Условия',
  'builder.and': 'И',
  'builder.or': 'ИЛИ',
  'builder.addCondition': 'Добавить условие',
  'builder.deleteCondition': 'Удалить условие',
  'builder.addOr': 'Добавить',
  'builder.deleteTarget': 'Убрать область проверки',

  'builder.scope': 'Область проверки',
  'builder.parameters': 'Параметры',
  'builder.anyParameter': 'Любой',
  'builder.paramsAll': 'ВСЕ',
  'builder.paramsOnly': 'ТОЛЬКО',
  'builder.paramsExcept': 'ВСЕ, КРОМЕ',
  'builder.except': 'КРОМЕ',
  'builder.paramsAllHint': 'Параметры не указаны — проверяется вся коллекция',
  'builder.paramsModeHint': 'Переключить: вся коллекция, только перечисленные параметры или коллекция без них',
  'builder.paramsAllBlocked': 'Чтобы вернуть «ВСЕ», очистите список',
  'builder.paramsRequired': 'Добавьте хотя бы одно значение — пока проверяется вся коллекция',
  'builder.addParam': 'Добавить параметр',
  'builder.exclusions': 'Исключения',
  'builder.addExcept': 'Добавить исключение',
  'builder.listHint': 'По одному значению в строке.',
  'builder.listHintComma': 'Запятая тоже разделяет.',
  'builder.count': 'Подсчёт',
  'builder.countHint': 'Сравнивать количество элементов, а не их значения',
  'builder.countUnavailable': 'Подсчёт работает только для коллекций',

  'builder.transform': 'Преобразование',
  'builder.transformNone': 'Нет',
  'builder.addTransform': 'Добавить преобразование',
  'builder.transformRequired': 'Выберите преобразование',
  'builder.transformsBlocked': 'Подсчёт заменяет значение числом, поэтому преобразования не применяются',
  'builder.dragTransform': 'Перетащите, чтобы изменить порядок',

  'builder.previewOpen': 'Проверить на примере',
  'builder.previewClose': 'Закрыть проверку',
  'builder.previewNoTransforms':
    'Преобразований не осталось — прогонять пример не через что',
  'builder.previewSample': 'Пример значения',
  'builder.previewHint': 'Что придёт в эту проверку — конвейер покажет, во что оно превратится',
  'builder.previewInput': 'вход',
  'builder.previewUnchanged': 'без изменений',
  'builder.previewEmptyValue': 'ничего не осталось',
  'builder.previewOpaque': 'результат здесь не воспроизводим',
  'builder.previewMatch': 'совпадает',
  'builder.previewNoMatch': 'не совпадает',
  'builder.previewUnknown': 'здесь не проверяется',

  'builder.choiceAll': 'Показать все варианты — ещё {count}',
  'builder.choiceCommon': 'Оставить только частые',
  'builder.choiceOften': 'часто',

  'builder.operator': 'Оператор',
  'builder.value': 'Значение',
  'builder.addValue': 'Добавить значение',
  'builder.ipInvalid': 'Не похоже на IPv4/IPv6-адрес или сеть CIDR (например, 192.168.1.0/24 или 2001:db8::/32).',
  'builder.negate': 'Инвертировать результат проверки',
  'builder.noArgument': 'Оператор не принимает значение',
  'builder.editInWindow': 'Редактировать в окне',
  'builder.regexHint': 'Регулярное выражение: проверяется по ходу ввода.',
  'builder.regexInvalid': 'Шаблон не собирается: {reason}',
  'builder.regexPcre':
    'В шаблоне есть записи PCRE, которых нет в JavaScript, — «(?i)» и подобные. Проверка их переводит, с правилом всё в порядке.',
  'builder.regexUnsupported':
    'Записи PCRE «{what}» в JavaScript нет. С правилом всё в порядке, но проверить такой шаблон редактор не может.',

  'builder.actions': 'Действия',
  'builder.id': 'ID',
  'builder.phase': 'Фаза',
  'builder.disruptive': 'Реакция',
  'builder.status': 'HTTP-статус',
  'builder.message': 'Сообщение',
  'builder.logdata': 'Данные в лог',
  'builder.severity': 'Критичность',
  'builder.ver': 'Версия набора',
  'builder.rev': 'Ревизия',
  'builder.maturity': 'Зрелость',
  'builder.accuracy': 'Точность',
  'builder.tags': 'Теги',
  'builder.addTag': 'Добавить тег',
  'builder.capture': 'Захватывать совпадения',
  'builder.log': 'Логировать',
  'builder.auditlog': 'Журнал аудита',
  'builder.setvar': 'Установка переменных',
  'builder.otherActions': 'Прочие действия',
  'builder.unset': 'не задано',
  'builder.more': 'Ещё',
  'builder.less': 'Свернуть',

  'builder.notes': 'Замечания',

  'builder.secAction': 'Безусловное действие',
  'builder.marker': 'Метка',
  'builder.directive': 'Директива',
  'builder.readOnly': 'Редактируется только в текстовой вкладке',

  'toolbar.undo': 'Отменить',
  'toolbar.redo': 'Повторить',
  'toolbar.format': 'Форматировать',
  'toolbar.formatHint': 'Разложить правило по строкам — по одному действию в строке (Shift+Alt+F)',
  'toolbar.formatDone': 'Текст уже разложен по строкам',

  'diag.notParsed': 'Текст правила ещё не разобран.',
  'diag.unbalancedQuotes': 'Непарные двойные кавычки.',
  'diag.unknownDirective': 'Неизвестная директива «{name}».',
  'diag.emptyTargets': 'У правила нет областей проверки.',
  'diag.unknownOperator': 'Неизвестный оператор «@{name}».',
  'diag.operatorArgumentRequired': 'Оператору «@{name}» нужно значение.',
  'diag.danglingChain': 'Цепочка разорвана: указан «chain», но следующего правила нет.',
  'diag.missingId': 'У правила нет «id» — ModSecurity его не загрузит.',
  'diag.duplicateId': 'Идентификатор «{id}» уже используется.',
  'diag.chainLinkHeadAction': 'Действие «{name}» допустимо только на первом правиле цепочки.',

  'diag.unknownVariable': 'Неизвестная переменная «{name}».',
  'diag.selectorNeedsQuotes':
    'Параметр «{value}» приходится писать в кавычках, а ModSecurity 3 такую запись не читает. Портируемая замена: {pattern}',
  'diag.selectorNotPortable':
    'Параметр «{value}» нельзя записать так, чтобы ModSecurity 2 и 3 поняли его одинаково.',
  'diag.unknownTransform': 'Неизвестное преобразование «{name}».',
  'diag.unknownAction': 'Неизвестное действие «{name}».',
  'diag.actionNotEditable': 'Действие «{name}» не редактируется в конструкторе.',
  'diag.countWithTransforms': 'Подсчёт (&) игнорирует преобразования.',
  'diag.countOnScalar': '«{name}» не коллекция, подсчёт всегда даст 0 или 1.',
  'diag.selectorNotSupported': '«{name}» не принимает параметр.',
  'diag.selectorRequired': '«{name}» требует параметр.',
  'diag.excludeWithoutSelector': 'Исключение «{name}» без параметра убирает всю коллекцию.',
  'diag.excludeWithoutBase': 'Исключению «{name}» не из чего вычитать.',
  'diag.operatorArgumentUnexpected': 'Оператор «@{name}» не принимает значение.',
  'diag.operatorInputMismatch': 'Оператор «@{name}» не подходит к типу значения этой проверки.',
  'diag.nonNumericArgument': 'Оператор «@{name}» ожидает число.',
  'diag.invalidIpEntry': 'Не похоже на IPv4/IPv6-адрес или сеть CIDR: {value}.',
  'diag.invalidRegex': 'Регулярное выражение оператора «@{name}» некорректно.',
  'diag.transformNoneNotFirst': '«none» сбрасывает конвейер и должно стоять первым.',
  'diag.duplicateTransform': 'Преобразование «{name}» применяется дважды.',
  'diag.missingPhase': 'Не указана фаза обработки.',
  'diag.phaseTooEarly': 'Фаза {phase} слишком ранняя: области проверки заполняются с фазы {required}.',
  'diag.noDisruptive': 'У правила нет реакции (deny / pass / …).',
  'diag.statusWithoutBlock': '«status» имеет смысл только вместе с deny или redirect.',

  'diag.caseNeverMatches': '«t:{name}» приводит значение к одному регистру — «{value}» не совпадёт никогда.',
  'diag.whitespaceNeverMatches': '«t:{name}» меняет пробелы в значении — «{value}» в таком виде не совпадёт.',
  'diag.hashWithoutHexEncode': 'После «t:{name}» значение — сырые байты: чтобы сравнить его с текстом, добавьте «t:hexEncode».',
  'diag.conflictingCaseTransforms': '«t:lowercase» и «t:uppercase» в одном конвейере: работает только последнее.',
  'diag.impossibleNumericRange': 'Цепочка не сработает никогда: нет значения, которое подходит и под «{first}», и под «{second}».',
  'diag.literalWithRegexSyntax': 'Оператор «@{name}» сравнивает текст буквально — «{value}» будет искаться как написано, а не как шаблон.',
  'diag.negationMatchesNothing': 'Шаблон подходит к любому значению, поэтому проверка с отрицанием не сработает никогда.',
  'diag.neverTrueComparison': 'Это значение не бывает отрицательным — условие не выполнится никогда.',
  'diag.matchesEverything': 'Шаблон подходит к любому значению — проверка ничего не отсеивает.',
  'diag.alwaysTrueComparison': 'Это значение не бывает отрицательным — условие истинно всегда.',

  'diag.decodeAfterNormalise': 'Декодирование «t:{decode}» стоит после «t:{normalise}»: к моменту нормализации закодированное ещё не раскрыто.',
  'diag.noNormalisation': 'Проверка зависит от регистра и кодирования: обычно перед ней ставят «t:lowercase» и «t:urlDecodeUni».',
  'diag.unescapedDot': 'Точка в «{value}» совпадает с любым символом — напишите «\\.», если имелась в виду обычная точка.',
  'diag.overlappingTargets': '«{inner}» уже входит в «{outer}» — вторая область ничего не добавляет.',

  'diag.requestBodyAccessOff': 'В файле указано «SecRequestBodyAccess Off» — «{name}» всегда пусто.',
  'diag.responseBodyAccessOff': 'В файле указано «SecResponseBodyAccess Off» — «{name}» всегда пусто.',
  'diag.disruptiveInLoggingPhase': 'В фазе 5 ответ уже отправлен — действие «{name}» будет проигнорировано.',
  'diag.missingMarker': 'Метки «SecMarker {name}» в этом файле нет — переходить некуда.',
  'diag.skipBeyondEnd': '«skip:{count}» пропускает больше правил, чем осталось в файле ({rest}).',
  'diag.engineNotEnforcing': 'SecRuleEngine в режиме «{mode}»: блокирующие действия этого файла попадут в лог, но не применятся.',
  'diag.xmlWithoutProcessor': '«XML» заполняется только после «ctl:requestBodyProcessor=XML», а в этом файле его нет.',
  'diag.txNeverSet': 'Переменную «tx.{name}» в этом файле никто не выставляет.',

  'diag.captureWithoutRegex': 'Захватывать нечего: ни одна проверка правила не использует регулярное выражение.',
  'diag.captureMissing': '«%{TX.{index}}» пусто: в правиле нет действия «capture».',
  'diag.blockWithoutLog': 'Правило блокирует запрос с «nolog»: объяснить отказ потом будет нечем.',
  'diag.logdataWithoutLog': '«logdata» задан, но логирование выключено — данные никуда не попадут.',
  'diag.captureUnused': '«capture» включён, но «%{TX.1}» в правиле нигде не используется.',
  'diag.blockWithoutMsg': 'У блокирующего правила нет «msg» — в логе останется только его номер.',

  'diag.possibleRedos': 'Вложенные кванторы: на специально подобранном значении такой шаблон считается очень долго.',
  'diag.regexIsPlainText': 'В шаблоне нет спецсимволов — «@contains {value}» сделает то же самое и дешевле.',
  'diag.anchoredLiteralRegex': 'Шаблон закреплён с обеих сторон и не содержит спецсимволов — это «@streq {value}».',
  'diag.redundantLeadingWildcard': 'Ведущее «.*» ничего не меняет: шаблон и так ищется в любом месте значения.',
  'diag.capturingGroupUnused': 'Группа захвата без действия «capture» только замедляет разбор — используйте «(?:…)».',
  'diag.rblOnHotPath': 'Каждая проверка «@rbl» — запрос к DNS; на частом пути это заметно.',

  'diag.duplicateTarget': 'Область проверки «{name}» указана дважды.',
  'diag.duplicateCondition': 'Два звена цепочки проверяют одно и то же.',
  'diag.duplicateRule': 'Правило повторяет проверку правила {id}.',
  'diag.redundantTransform': 'После «t:{previous}» преобразование «t:{name}» уже ничего не меняет.',
  'diag.transformsWithoutCheck': 'Оператор «@{name}» не смотрит на значение — преобразования ни на что не влияют.',
  'diag.singlePhraseList': 'В списке одна фраза — «@contains {value}» скажет то же самое понятнее.',
  'diag.idInReservedRange': 'Номер {id} попадает в диапазон 900000–999999, занятый CRS.',

  'toolbar.open': 'Открыть',
  'toolbar.openHint': 'Загрузить файл .conf с диска',
  'toolbar.save': 'Сохранить',
  'toolbar.saveHint': 'Выгрузить текст файлом .conf',
  'toolbar.copy': 'Копировать',
  'toolbar.copyHint': 'Скопировать весь текст в буфер обмена',
  'toolbar.copied': 'Скопировано в буфер обмена',
  'toolbar.copyFailed': 'Браузер не дал доступ к буферу обмена',

  'document.replaceTitle': 'Заменить текущий текст?',
  'document.replaceBody':
    'Текущий текст изменён. Загрузка другого документа сотрёт эти правки.',
  'document.replace': 'Заменить',

  'builder.destination': 'Адрес',
  'builder.collapse': 'Свернуть правило',
  'builder.expand': 'Развернуть правило',
  'builder.collapseBlock': 'Свернуть блок',
  'builder.expandBlock': 'Развернуть блок',
  'builder.collapseSection': 'Свернуть «{name}»',
  'builder.expandSection': 'Развернуть «{name}»',
  'builder.collapseAll': 'Свернуть все',
  'builder.expandAll': 'Раскрыть все',
  'builder.expandAllSlow': 'Раскрыть все — на файле такого размера это займёт время',
  'builder.expandedOf': 'Раскрыто {expanded} из {total}',
  'builder.duplicateRule': 'Дублировать правило',
  'builder.moveUp': 'Переместить выше',
  'builder.moveDown': 'Переместить ниже',
  'builder.andMore': 'ещё',
  'diag.destinationMissing':
    '«{name}» без адреса: ModSecurity не загрузит такое правило.',
  'diag.destinationUnexpected':
    '«{name}» не принимает адрес: значение рядом с ним будет отвергнуто при загрузке.',

  'topic.structure': 'Форма',
  'topic.logic': 'Логика',
  'topic.coverage': 'Покрытие',
  'topic.environment': 'Окружение',
  'topic.logging': 'Логи',
  'topic.performance': 'Цена',
  'topic.style': 'Избыточность',

  'fix.title': 'Исправить',
  'fix.lowercaseValue': 'Привести значение к нижнему регистру',
  'fix.uppercaseValue': 'Привести значение к верхнему регистру',
  'fix.useContains': 'Заменить на @contains',
  'fix.useStreq': 'Заменить на @streq',
  'fix.dropLeadingWildcard': 'Убрать ведущее «.*»',
  'fix.escapeDots': 'Экранировать точки',
  'fix.moveNoneFirst': 'Поставить «none» первым',
  'fix.removeTransform': 'Убрать «t:{name}»',
  'fix.reorderPipeline': 'Декодировать раньше',
  'fix.clearTransforms': 'Очистить конвейер',
  'fix.addHexEncode': 'Добавить «t:hexEncode»',
  'fix.addNormalisation': 'Нормализовать перед проверкой',
  'fix.removeTarget': 'Убрать «{name}»',
  'fix.usePatternSelector': 'Задать имя шаблоном',
  'fix.setPhase': 'Подставить нужную фазу',
  'fix.clearStatus': 'Очистить «status»',
  'fix.restoreLog': 'Вернуть запись в лог',
  'fix.enableCapture': 'Добавить «capture»',
  'fix.disableCapture': 'Убрать «capture»',

  'tooltip.noDescription': 'Описание пока недоступно.',
  'tooltip.expandHint': 'Alt — подробнее',
  'tooltip.collapseHint': 'Отпустите Alt, чтобы свернуть',
  'tooltip.syntax': 'Синтаксис',
  'tooltip.tech': 'Технически',
  'tooltip.tech.argument': 'Аргумент',
  'tooltip.tech.fallback': 'Если не указан',
  'tooltip.tech.scope': 'Где действует',
  'tooltip.tech.cost': 'Стоимость',
  'tooltip.tech.availability': 'Доступность',
  'tooltip.gotchas': 'Осторожно',
  'tooltip.example': 'Пример',
  'tooltip.seeAlso': 'См. также',
  'category.directive': 'Директива',
  'category.action': 'Действие',
  'category.transform': 'Трансформация',
  'category.operator': 'Оператор',
  'category.variable': 'Переменная',
};

export const translations: Record<Locale, Record<TranslationKey, string>> = {
  en,
  ru,
};

/** Ключ перевода для подписи категории ключевого слова. */
export function categoryKey(category: KeywordCategory): TranslationKey {
  return `category.${category}` as TranslationKey;
}
