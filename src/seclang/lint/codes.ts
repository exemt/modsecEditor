/**
 * Словарь замечаний линтера: код, уровень, тема и текст.
 *
 * Уровень и тема заданы по одному разу на код, а не в месте вызова: иначе
 * одно и то же замечание со временем начинает выдаваться то ошибкой, то
 * советом, и заглушить его целиком уже нельзя.
 *
 * Уровни различаются последствием:
 *
 *  - `error` — движок такую конфигурацию не загрузит (или загрузит так, что
 *    правило заведомо не то, что написано);
 *  - `warning` — загрузит, но правило сделает не то, что задумано;
 *  - `advice` — правило делает то, что написано; есть способ проще.
 *
 * «Не загрузит» — вопрос к конкретному движку, и ответы у них разные.
 * Поэтому у кода может быть список `refusedBy`: какие движки отказываются
 * грузить такую запись. Назван движок из списка — замечание становится
 * ошибкой; не назван никакой — становится ею, если отказываются хотя бы два
 * из трёх. Списки не выдуманы: каждый проверен на настоящих движках стендом
 * `scripts/engines`, а его вердикты сверяет `engines.test.ts`.
 *
 * Текст здесь — английский и запасной: тому, у кого своих переводов нет.
 * У редактора они свои, по ключу `diag.<код>` в `src/i18n/translations.ts`,
 * и ключ там типизирован: новый код без перевода на двух языках не даст
 * редактору собраться. Имена подстановок — часть того же договора: перевод
 * подставляет их по имени.
 */

import type { Engine } from '../engines';

export type Severity = 'error' | 'warning' | 'advice';

export type Topic =
  /** Форма записи: имена, обязательные части, целостность цепочки. */
  | 'structure'
  /** Логика проверки: несовместимые шаги, сравнения, которые не совпадут. */
  | 'logic'
  /** Покрытие: проверка сработает, но часть входа пропустит. */
  | 'coverage'
  /** Зависимость от остального набора: меток, переменных, коллекций. */
  | 'environment'
  /** Что останется в журнале и будет ли это тем, что ждали. */
  | 'logging'
  /** Цена исполнения на каждом запросе. */
  | 'performance'
  /** Избыточность и запись, которую принято писать иначе. */
  | 'style';

interface CodeSpec {
  severity: Severity;
  topic: Topic;
  message: string;
  /** Движки, которые такую запись не загружают; пусто — загружают все. */
  refusedBy: readonly Engine[];
}

/** Сокращения для списков: кто отказывается грузить запись. */
const V2: readonly Engine[] = ['modsecurity2'];
const V3: readonly Engine[] = ['modsecurity3'];
const CORAZA: readonly Engine[] = ['coraza'];
const V2_V3: readonly Engine[] = ['modsecurity2', 'modsecurity3'];
const V2_CORAZA: readonly Engine[] = ['modsecurity2', 'coraza'];
const V3_CORAZA: readonly Engine[] = ['modsecurity3', 'coraza'];
const ALL: readonly Engine[] = ['modsecurity2', 'modsecurity3', 'coraza'];
const NONE: readonly Engine[] = [];

/** Те же списки — для проверок, у которых исход зависит от случая. */
export const REFUSED = { V2, V3, CORAZA, V2_V3, V2_CORAZA, V3_CORAZA, ALL, NONE } as const;

function code(
  severity: Severity,
  topic: Topic,
  message: string,
  refusedBy: readonly Engine[] = NONE,
): CodeSpec {
  return { severity, topic, message, refusedBy };
}

export const CODES = {
  /* --- Не загрузится ------------------------------------------------ */
  unbalancedQuotes: code('error', 'structure', 'Unbalanced double quotes.', ALL),
  unknownDirective: code('error', 'structure', 'Unknown directive "{name}".', ALL),
  byteOrderMark: code(
    'error',
    'structure',
    'A byte order mark (U+FEFF) before the directive: no engine reads it. Save the file as UTF-8 without BOM — and the files it was joined from.',
    ALL,
  ),
  strayCharacter: code(
    'warning',
    'structure',
    '{code} is not a plain space or quote, and the engine reads it as part of the word. Characters like this come from copying out of web pages, documents and chats.',
    ALL,
  ),
  invisibleCharacter: code(
    'warning',
    'coverage',
    'Invisible {code} inside the value: the text is not what it looks like, and a pattern with it will not match what you see.',
  ),
  directiveArgCount: code('error', 'structure', '"{name}" does not take {count} arguments.', ALL),
  emptyTargets: code('error', 'structure', 'The rule has no check areas.'),
  unknownOperator: code('error', 'structure', 'Unknown operator "@{name}".', V2_CORAZA),
  danglingChain: code(
    'error',
    'structure',
    'The chain is broken: "chain" is set but there is no next rule.',
  ),
  missingId: code(
    'error',
    'structure',
    'The rule has no "id" — ModSecurity will refuse to load it.',
    V2,
  ),
  duplicateId: code('error', 'structure', 'Duplicate rule id "{id}".', V2_CORAZA),
  chainLinkHeadAction: code(
    'error',
    'structure',
    'Action "{name}" is only allowed on the first rule of a chain.',
    V2,
  ),

  /* --- Загрузится, но записано не по правилам ------------------------ */
  unterminatedMacro: code('warning', 'structure', 'Macro "%{" is never closed.', V3_CORAZA),
  unclosedValueQuote: code(
    'error',
    'structure',
    'The value opens with a single quote that is never closed: everything up to the end of the list becomes part of it.',
    V2,
  ),
  textAfterQuote: code(
    'warning',
    'structure',
    'The quoted value has already ended: "{text}" after it is read as a separate entry. A comma is probably missing.',
    V3,
  ),
  invalidQuotedPair: code(
    'warning',
    'structure',
    'Inside single quotes a backslash may only stand before a quote or another backslash: ModSecurity 2 rejects "{pair}".',
    V2,
  ),
  continuationSpace: code(
    'error',
    'structure',
    'There is whitespace after the trailing backslash: the line is not continued, and the next one is read on its own.',
    V2_V3,
  ),
  emptyTarget: code(
    'warning',
    'structure',
    'The list of check areas has an empty element: "{text}".',
    V3,
  ),
  targetsCommaSeparated: code(
    'warning',
    'structure',
    'Check areas are separated by "|": a comma between them is not read by Coraza.',
    CORAZA,
  ),
  emptyAction: code(
    'warning',
    'structure',
    'The action list has an empty element: a comma with nothing after it.',
    V3_CORAZA,
  ),
  unquotedArgument: code(
    'warning',
    'structure',
    'The {part} is not in double quotes: only ModSecurity 2 reads it this way.',
    V3_CORAZA,
  ),
  quotedTargets: code(
    'warning',
    'structure',
    'The list of check areas is in double quotes: Coraza does not read it this way.',
    CORAZA,
  ),
  linkWithoutActions: code(
    'warning',
    'structure',
    'The chain link has no action list and the next line is not empty: ModSecurity 3 reads that line as the missing actions. Add "t:none" or leave a blank line.',
    V3,
  ),
  unquotedValueBreak: code(
    'warning',
    'structure',
    'Without quotes the value of "{name}" ends at the first space or "|": ModSecurity 2 reads "{rest}" as a separate action.',
    V2,
  ),
  operatorCase: code(
    'error',
    'structure',
    'Coraza compares operator names exactly: write "@{canonical}" instead of "@{name}".',
    CORAZA,
  ),
  operatorReadAsPattern: code(
    'warning',
    'structure',
    'The operator has to start right after the quote: "{value}" is read as a regular expression.',
  ),
  unknownVariable: code('warning', 'structure', 'Unknown variable "{name}".', ALL),
  unknownTransform: code('warning', 'structure', 'Unknown transformation "{name}".', ALL),
  unknownAction: code('warning', 'structure', 'Unknown action "{name}".', ALL),
  actionValueRequired: code('warning', 'structure', 'Action "{name}" requires a value.', ALL),
  actionValueUnexpected: code('warning', 'structure', 'Action "{name}" takes no value.', ALL),
  operatorArgumentRequired: code('warning', 'structure', 'Operator "@{name}" requires a value.'),
  operatorArgumentUnexpected: code('warning', 'structure', 'Operator "@{name}" takes no value.'),
  missingPhase: code('warning', 'structure', 'The processing phase is not set.'),

  /* --- Области проверки ---------------------------------------------- */
  countOnScalar: code(
    'warning',
    'logic',
    '"{name}" is not a collection, counting always yields 0 or 1.',
    V2,
  ),
  selectorNotSupported: code('warning', 'logic', '"{name}" does not take a parameter.', ALL),
  selectorRequired: code('warning', 'logic', '"{name}" requires a parameter.', V2),
  excludeWithoutSelector: code(
    'warning',
    'logic',
    'Exclusion of "{name}" without a parameter removes the whole collection.',
  ),

  /* --- Конвейер: тип значения от шага к шагу -------------------------- */
  transformInputMismatch: code(
    'warning',
    'logic',
    '"t:{name}" works on {expected}, but the value at this step is {actual}.',
  ),
  countWithTransforms: code('warning', 'logic', 'Counting (&) ignores transformations.'),
  transformNoneNotFirst: code(
    'warning',
    'logic',
    '"none" resets the pipeline and should come first.',
  ),
  duplicateTransform: code('warning', 'logic', 'Transformation "{name}" is applied twice.'),
  conflictingCaseTransforms: code(
    'warning',
    'logic',
    '"t:lowercase" and "t:uppercase" in one pipeline: only the last one has any effect.',
  ),

  /* --- Оператор: совпадёт ли сравнение -------------------------------- */
  operatorInputMismatch: code(
    'warning',
    'logic',
    'Operator "@{name}" does not fit the value type of this check.',
  ),
  nonNumericArgument: code('warning', 'logic', 'Operator "@{name}" expects a number.'),
  hashWithoutHexEncode: code(
    'warning',
    'logic',
    'After "t:{name}" the value is raw bytes: add "t:hexEncode" to compare it with text.',
  ),
  caseNeverMatches: code(
    'warning',
    'logic',
    '"t:{name}" leaves the value in one case — "{value}" will never match.',
  ),
  whitespaceNeverMatches: code(
    'warning',
    'logic',
    '"t:{name}" changes the spaces in the value — "{value}" will never match as written.',
  ),

  /* --- Покрытие и окружение ------------------------------------------- */
  phaseTooEarly: code(
    'warning',
    'coverage',
    'Phase {phase} is too early: the check areas are filled in from phase {required}.',
  ),
  phasePartial: code(
    'advice',
    'coverage',
    'In phase {phase} "{name}" is only partly filled: the rest arrives in phase {required}.',
  ),
  caseBeforeBase64: code(
    'warning',
    'logic',
    'Base64 is case-sensitive: "t:{change}" before "t:{decode}" destroys the encoded value.',
  ),
  validateAfterDecode: code(
    'warning',
    'logic',
    '"@{name}" runs after "t:{decode}": by then nothing encoded is left to validate.',
  ),
  markerWithSpace: code(
    'warning',
    'structure',
    'Label "{name}" has a space: ModSecurity 2 and 3 do not load it. Use "_" or "-" instead.',
    V2_V3,
  ),
  idTooLarge: code(
    'warning',
    'structure',
    'Id {id} is out of range: ModSecurity 2 takes ids up to 2147483647, ModSecurity 3 up to 9007199254740992, Coraza up to 9223372036854775807.',
    V2,
  ),
  partialBodyInspection: code(
    'warning',
    'environment',
    'With "ProcessPartial" everything past SecRequestBodyLimit goes uninspected: padding the body carries an attack past the rules. "Reject" refuses such requests instead.',
  ),
  includeRelative: code(
    'advice',
    'environment',
    'Apache resolves "{path}" from ServerRoot, ModSecurity 3 and Coraza from the folder of this file. An absolute path means the same everywhere.',
  ),
  relaxedByClientInput: code(
    'warning',
    'coverage',
    'The rule turns protection off ("{action}") on what the client writes itself — "{target}" — and nothing else: any client can send it.',
  ),
  secretInLog: code(
    'advice',
    'logging',
    'The rule writes the value of "{target}" to the log through "{macro}": passwords and tokens end up there in plain text. Log the name ("%{MATCHED_VAR_NAME}") instead.',
  ),
  bodyErrorUnchecked: code(
    'warning',
    'environment',
    'The body is inspected, but no rule reads REQBODY_ERROR: when the body parser fails, what it did not parse goes uninspected. The recommended configurations of all three engines stop such requests (rule 200002).',
  ),
  withinSubstring: code(
    'advice',
    'coverage',
    '"@within" looks for the value anywhere inside "{value}": "{sample}" passes too. For an exact list write "@rx {pattern}".',
  ),
  negatedOnMissing: code(
    'advice',
    'coverage',
    'If "{target}" is not sent at all, the rule does not run, and "!@{name}" does not catch the missing value. Check its presence too: "&{target}" "@eq 0".',
  ),
  validateDecodedInput: code(
    'warning',
    'logic',
    '"{variable}" reaches "@validateUrlEncoding" already URL-decoded ({engines}): a valid "%25" turns into a bare "%" and fails. The value as sent is in "REQUEST_URI_RAW", "QUERY_STRING" or "REQUEST_BODY".',
  ),
  setvarInChainHead: code(
    'advice',
    'logic',
    'The counter grows as soon as the first condition matches, whether or not the rest of the chain does: move "setvar" to the last link.',
  ),
  decodeAfterNormalise: code(
    'warning',
    'coverage',
    'Decoding "t:{decode}" runs after "t:{normalise}": encoded sequences are still hidden when the value is normalised.',
  ),
  missingMarker: code(
    'warning',
    'environment',
    'There is no "SecMarker {name}" in the loaded files — the jump leads nowhere.',
  ),

  /* --- Значения действий ------------------------------------------------ */
  invalidActionValue: code(
    'error',
    'structure',
    '"{name}" does not accept "{value}": expected {expected}.',
  ),
  unknownCtl: code('error', 'structure', 'Unknown ctl option "{name}".', ALL),
  defaultActionIncomplete: code(
    'error',
    'structure',
    'SecDefaultAction must specify {missing}.',
    V2_V3,
  ),
  defaultActionForbidden: code(
    'error',
    'structure',
    'SecDefaultAction must not contain "{name}": defaults are not a rule.',
    V2_V3,
  ),
  defaultActionDeprecated: code(
    'advice',
    'style',
    '"{name}" in SecDefaultAction is deprecated: it silently applies to every rule below.',
  ),
  defaultActionRepeated: code(
    'error',
    'structure',
    'ModSecurity 3 accepts one SecDefaultAction per phase, and phase {phase} already has one.',
    V3,
  ),
  suspiciousActionValue: code(
    'warning',
    'structure',
    '"{name}" will not read "{value}" as written: expected {expected}.',
  ),
  duplicateAction: code(
    'warning',
    'structure',
    'Action "{name}" is set more than once: only the last one counts.',
  ),
  conflictingActions: code(
    'warning',
    'logic',
    '"{first}" and "{second}" exclude each other: only the last one counts.',
  ),
  unknownMacro: code('warning', 'structure', 'Unknown variable in macro "%{{name}}".'),
  macroNotExpanded: code(
    'warning',
    'logic',
    'Operator "@{name}" does not expand macros: the text is compared as written.',
  ),
  macroInStaticAction: code(
    'warning',
    'logic',
    'Action "{name}" is read once, when the configuration loads: the macro in it is never expanded.',
  ),
  macroKeySeparator: code(
    'warning',
    'structure',
    'Inside a macro the key goes after a dot: "%{{name}.{key}}". The colon form is read only by ModSecurity 3.',
    CORAZA,
  ),
  commentSwallowsLine: code(
    'warning',
    'structure',
    'The comment ends with a backslash, so the next line becomes part of it.',
  ),

  /* --- Реакция и журнал ------------------------------------------------- */
  noDisruptive: code('warning', 'structure', 'The rule has no reaction (deny / pass / …).'),
  statusWithoutBlock: code(
    'warning',
    'logic',
    '"status" only matters together with deny or redirect.',
  ),
  disruptiveInLoggingPhase: code(
    'warning',
    'environment',
    'In phase 5 the response has already been sent — "{name}" is ignored.',
  ),
  blockWithoutLog: code(
    'warning',
    'logging',
    'The rule blocks the request with "nolog": nothing will explain the refusal afterwards.',
  ),
  logdataWithoutLog: code(
    'warning',
    'logging',
    '"logdata" is set but logging is off — the data goes nowhere.',
  ),
  captureWithoutRegex: code(
    'warning',
    'logging',
    'Nothing to capture: "capture" acts on the check it is written in, and its operator does not capture.',
  ),
  blockWithoutMsg: code(
    'advice',
    'logging',
    'A blocking rule without "msg" leaves only its id in the log.',
  ),
  captureUnused: code(
    'advice',
    'logging',
    '"capture" is on, but nothing reads "TX.0"–"TX.9": neither this rule nor any that runs after it.',
  ),
  idInReservedRange: code(
    'advice',
    'style',
    'Id {id} falls into the 900000–999999 range reserved by CRS.',
  ),

  /* --- Аргументы операторов и согласованность условий -------------------- */
  invalidIpEntry: code(
    'warning',
    'logic',
    'Not an IPv4/IPv6 address or CIDR network: {value}.',
    V2_V3,
  ),
  invalidByteRange: code(
    'warning',
    'logic',
    'Not a byte or a range of bytes from 0 to 255: {value}.',
    ALL,
  ),
  literalWithRegexSyntax: code(
    'warning',
    'logic',
    'Operator "@{name}" compares text literally — "{value}" is searched as written, not as a pattern.',
  ),
  alwaysTrueComparison: code(
    'warning',
    'logic',
    'This value is never negative — the condition is always true.',
  ),
  neverTrueComparison: code(
    'warning',
    'logic',
    'This value is never negative — the condition can never be true.',
  ),
  impossibleNumericRange: code(
    'warning',
    'logic',
    'The chain can never match: no value satisfies both "{first}" and "{second}".',
  ),
  excludeWithoutBase: code(
    'warning',
    'logic',
    'Exclusion of "{name}" has nothing to subtract from.',
  ),
  selectorNeedsQuotes: code(
    'warning',
    'structure',
    'Parameter "{value}" has to be quoted, and ModSecurity 3 does not read that form. Portable equivalent: {pattern}',
    V3_CORAZA,
  ),
  selectorNotPortable: code(
    'warning',
    'structure',
    'Parameter "{value}" cannot be written so that ModSecurity 2 and 3 read it the same way.',
    CORAZA,
  ),
  wideCodePoint: code(
    'warning',
    'structure',
    'ModSecurity compiles patterns byte by byte: "{escape}" is above \\xff, and the pattern is rejected.',
    V2_V3,
  ),
  backslashPair: code(
    'warning',
    'logic',
    'A doubled backslash is read differently: under Apache ModSecurity 2 receives a single one, ModSecurity 3 and Coraza receive both. For a literal backslash write "\\x5c".',
  ),
  lookbehindNotFixed: code(
    'warning',
    'structure',
    'A lookbehind with an unbounded repeat: PCRE needs to know its length and rejects the pattern.',
    ALL,
  ),
  noNormalisation: code(
    'advice',
    'coverage',
    'The check depends on case and encoding: "t:lowercase" and "t:urlDecodeUni" usually go before it.',
  ),
  overlappingTargets: code(
    'advice',
    'coverage',
    '"{inner}" is already part of "{outer}" — the second area adds nothing.',
  ),
  rblOnHotPath: code(
    'advice',
    'performance',
    'Every "@rbl" check is a DNS request; on a busy path that is noticeable.',
  ),
  singlePhraseList: code(
    'advice',
    'style',
    'A list of a single phrase — "@contains {value}" says the same more plainly.',
  ),
  duplicateCondition: code(
    'advice',
    'style',
    'Two links of the chain check exactly the same thing.',
  ),
  duplicateRule: code('advice', 'style', 'The rule repeats rule {id}.'),

  /* --- Исключения: ссылки на правила ------------------------------------ */
  exclusionNoTarget: code(
    'error',
    'structure',
    '"{name}" is missing its required argument and changes nothing.',
    ALL,
  ),
  exclusionBadId: code(
    'warning',
    'structure',
    '"{value}" is neither a rule id nor a range like 942190-942200.',
    V3_CORAZA,
  ),
  exclusionUpdateActionMetadata: code(
    'warning',
    'structure',
    '"{name}" cannot change "{action}": id and phase stay as the rule set defined them.',
    V2,
  ),
  exclusionCtlNoTarget: code(
    'warning',
    'structure',
    '"{name}" removes one target of a rule, but no target follows the ";" — so nothing is removed.',
    V3,
  ),
  exclusionCtlBadId: code(
    'warning',
    'logic',
    '"{name}" takes a single rule id or a range like 942190-942200; "{value}" is read whole and matches nothing.',
    V3,
  ),
  exclusionCtlTargetList: code(
    'warning',
    'logic',
    'Only one target follows the ";" of "{name}", but several are written — "{targets}". None of them is removed.',
    V2_V3,
  ),
  exclusionCtlDeadTarget: code(
    'warning',
    'logic',
    'Target "{target}" matches none of the rule targets: "{name}" compares by name and parameter, without "!" or "&".',
    V3,
  ),
  exclusionCtlCarrierStops: code(
    'warning',
    'logic',
    'The rule carrying this exclusion answers with "{action}", so the rules it lifts are never reached anyway.',
  ),
  exclusionUpdateTargetNotExclusion: code(
    'warning',
    'logic',
    '"{name}" has no "!": "{targets}" is added to the targets of the rule instead of excluding one of them.',
  ),
  exclusionRemovedThenUpdated: code(
    'warning',
    'logic',
    'The rule is already removed on line {line} — there is nothing left to change in it.',
  ),
  exclusionEmptyRange: code(
    'warning',
    'logic',
    'Range "{target}" is inverted: no rule falls into it.',
    V3_CORAZA,
  ),
  exclusionBeforeRule: code(
    'warning',
    'environment',
    '"{name}" stands above rule {id}: exclusions apply as the configuration is read, so this one does nothing.',
  ),
  exclusionInEarlierFile: code(
    'warning',
    'environment',
    '"{name}" sits in a file read before "{file}", where rule {id} is: exclusions apply as the configuration is read, so this one does nothing.',
  ),
  exclusionCtlAfterRule: code(
    'warning',
    'environment',
    '"{name}" runs in phase {phase}, later than rule {id}: by then the rule has already been checked.',
  ),
  exclusionNoMatch: code(
    'advice',
    'environment',
    'No rule of the loaded files matches "{target}".',
  ),
  exclusionTooBroad: code(
    'advice',
    'coverage',
    '"{name}" removes {count} rules — a targeted exclusion keeps the protection everywhere else.',
  ),
  exclusionDuplicate: code('advice', 'style', 'The same exclusion is already on line {line}.'),
  exclusionBadPattern: code(
    'error',
    'structure',
    '"{name}" selects by a regular expression, and "{value}" is not one: {reason}.',
    V2,
  ),
  exclusionPatternNotPortable: code(
    'warning',
    'environment',
    'Only ModSecurity 2 reads "{value}" as a regular expression; ModSecurity 3 and Coraza compare it with the whole {what}, so the selection differs.',
  ),
  selectorPatternCase: code(
    'warning',
    'environment',
    'Coraza compares a pattern over parameter names with case, ModSecurity without it: "{value}" misses names that differ only in case. Start the pattern with "(?i)" to read the same everywhere.',
  ),
  exclusionTargetNotInRule: code(
    'warning',
    'logic',
    'Rule {id} does not inspect "{target}": "{name}" has nothing to remove there.',
  ),
  exclusionTargetInLink: code(
    'warning',
    'environment',
    'Rule {id} inspects "{target}" only in a chain link: ModSecurity 2 removes it there, ModSecurity 3 and Coraza change only the first condition, and for them "{name}" does nothing.',
  ),
  exclusionCtlTargetInLink: code(
    'warning',
    'environment',
    'Rule {id} inspects "{target}" only in a chain link: Coraza removes it there, ModSecurity 2 and 3 change only the first condition, and for them "{name}" does nothing.',
  ),
  exclusionCtlPattern: code(
    'warning',
    'environment',
    'A pattern in "{name}" ("{target}"): only Coraza applies it. ModSecurity 2 skips it without a word, ModSecurity 3 does not load it. SecRuleUpdateTargetById takes a pattern in every engine.',
    V3,
  ),
  exclusionHeaderCase: code(
    'warning',
    'environment',
    'ModSecurity 3 compares the header name in an exclusion letter by letter, and clients spell it differently — over HTTP/2 always in lower case: "{target}" stays inspected for some of them. A pattern reads the same in every engine: "{pattern}".',
  ),
  exclusionCtlHeaderCase: code(
    'warning',
    'environment',
    'ModSecurity 3 compares the header name in an exclusion letter by letter, and clients spell it differently — over HTTP/2 always in lower case: "{target}" stays inspected for some of them. ModSecurity 3 takes no pattern here; remove "{lower}" as well.',
  ),
  exclusionByMsgFragile: code(
    'advice',
    'style',
    '"{name}" selects by message text, and that is not a stable interface — a tag or an id survives an update of the rule set.',
  ),
  exclusionCtlAlreadyRemoved: code(
    'advice',
    'style',
    'The rule is already removed for good on line {line} — a per-request exclusion adds nothing to that.',
  ),

  /* --- Окружение и директивы -------------------------------------------- */
  directiveValueMissing: code('error', 'structure', '"{name}" is missing its value.', ALL),
  directiveNotNumber: code(
    'error',
    'structure',
    '"{name}" expects a whole number, and "{value}" is not one.',
    ALL,
  ),
  directiveBadValue: code('warning', 'structure', '"{name}" has no value "{value}".', V2_CORAZA),
  directiveUnknownFlag: code(
    'warning',
    'structure',
    'An audit log entry has no part "{value}".',
    ALL,
  ),
  requestBodyAccessOff: code(
    'warning',
    'environment',
    '"SecRequestBodyAccess Off" in the loaded files: "{name}" is always empty.',
  ),
  responseBodyAccessOff: code(
    'warning',
    'environment',
    '"SecResponseBodyAccess Off" in the loaded files: "{name}" is always empty.',
  ),
  engineNotEnforcing: code(
    'advice',
    'environment',
    'SecRuleEngine is "{mode}": blocking actions are logged but not applied.',
  ),
  xmlWithoutProcessor: code(
    'advice',
    'environment',
    '"XML" is only filled in after "ctl:requestBodyProcessor=XML", which none of the loaded files sets.',
  ),
  persistentWithoutDataDir: code(
    'advice',
    'environment',
    'Collection "{name}" is kept between requests only when "SecDataDir" is set, and none of the loaded files sets it.',
  ),
  geoLookupWithoutDb: code(
    'advice',
    'environment',
    '"@geoLookup" needs the database named by "SecGeoLookupDb", and none of the loaded files sets it.',
  ),
  fileNotFound: code(
    'warning',
    'environment',
    'Data file "{path}" does not exist: the engine refuses to load a rule that refers to it.',
  ),
  geoWithoutLookup: code(
    'advice',
    'environment',
    '"GEO" is only filled in by "@geoLookup", which none of the loaded files uses.',
  ),

  /* --- Пометки линтера -------------------------------------------------- */
  unknownIgnoreCode: code(
    'warning',
    'style',
    'There is no check called "{name}": this ignore comment silences nothing.',
  ),
  unusedIgnore: code('advice', 'style', 'This ignore comment has nothing left to silence.'),

  /* --- Совместимость с движком ----------------------------------------- */
  notInEngine: code('error', 'structure', '{kind} "{name}" is not supported by {engine}.'),
  regexNotInEngine: code(
    'error',
    'structure',
    'The pattern uses {feature}, which {engine} regular expressions do not have: the rule will not compile.',
  ),

  /* --- Регулярные выражения -------------------------------------------- */
  invalidRegex: code(
    'warning',
    'structure',
    'The regular expression of "@{name}" is invalid: {reason}.',
    ALL,
  ),
  invalidSelectorPattern: code(
    'warning',
    'structure',
    'Parameter pattern "{value}" is not a valid regular expression: {reason}.',
    V2_CORAZA,
  ),
  matchesEverything: code(
    'warning',
    'logic',
    'The pattern matches any value — the check filters nothing out.',
  ),
  negationMatchesNothing: code(
    'warning',
    'logic',
    'The pattern matches any value, so the negated check never fires.',
  ),
  possibleRedos: code(
    'warning',
    'performance',
    'Nested quantifiers: on a crafted value this pattern can take a very long time to match.',
  ),
  unescapedDot: code(
    'advice',
    'coverage',
    'The dot in "{value}" matches any character — write "\\." if a literal dot was meant.',
  ),
  regexIsPlainText: code(
    'advice',
    'performance',
    'The pattern has no special characters — "@contains {value}" does the same and costs less.',
  ),
  anchoredLiteralRegex: code(
    'advice',
    'performance',
    'The pattern is anchored on both sides and has no special characters — this is "@streq {value}".',
  ),
  anchorsMatchLines: code(
    'warning',
    'coverage',
    'ModSecurity 3 and Coraza match "^" and "$" at every line break: one more line in the value gets past this check. "\\A" and "\\z" mark the edges of the whole value in every engine: "{pattern}".',
  ),
  multibyteInClass: code(
    'warning',
    'coverage',
    'ModSecurity compares bytes, not letters: "{char}" takes {bytes} bytes, and inside "[…]" or before a repeat each byte counts on its own: the pattern matches stray bytes, not "{char}" as a whole. Coraza compares letters. List such characters as alternatives: "(?:{char}|…)".',
  ),
  anchoredLiteralLines: code(
    'advice',
    'coverage',
    'ModSecurity 3 and Coraza match "^" and "$" at every line break: the pattern finds "{value}" on any line of the value, "@streq {value}" only as the whole value.',
  ),
  redundantLeadingWildcard: code(
    'advice',
    'performance',
    'A leading ".*" changes nothing: the pattern is searched anywhere in the value.',
  ),
  capturingGroupUnused: code(
    'advice',
    'performance',
    'A capturing group without "capture" in the same check only slows matching down — use "(?:…)".',
  ),

  /* --- Указатели: метки, переменные, коллекции ------------------------- */
  markerBehind: code(
    'warning',
    'environment',
    '"SecMarker {name}" stands above this rule: "skipAfter" only looks down, so everything left in the phase is skipped.',
  ),
  duplicateMarker: code(
    'warning',
    'environment',
    '"SecMarker {name}" is declared more than once: a jump stops at the first one below it.',
  ),
  skipBeyondEnd: code(
    'warning',
    'environment',
    '"skip:{count}" skips more rules than the {rest} left after it.',
  ),
  txReadBeforeSet: code(
    'warning',
    'environment',
    '"tx.{name}" is read before anything sets it: every rule that sets it runs later.',
  ),
  collectionNotInitialised: code(
    'warning',
    'environment',
    'Collection "{name}" is never opened: without "{action}" its variables do not outlive the request.',
  ),
  captureMissing: code(
    'warning',
    'logging',
    '"TX.{index}" is not what this rule found: without "capture" next to the operator it holds what an earlier rule captured — or nothing.',
  ),
  groupNeverCaptured: code(
    'warning',
    'environment',
    'Nothing fills "TX.{index}" before this rule: no rule that runs earlier captures it.',
  ),
  groupFromEarlierRule: code(
    'advice',
    'logging',
    '"TX.{index}" is not filled by this rule: at best it holds what an earlier rule captured.',
  ),
  txNeverSet: code(
    'advice',
    'environment',
    'Nothing in the loaded files sets "tx.{name}".',
  ),
  variableNeverSet: code(
    'advice',
    'environment',
    'Nothing in the loaded files sets "{name}".',
  ),
  unusedMarker: code('advice', 'style', 'No rule jumps to "SecMarker {name}".'),

  /* --- Избыточность --------------------------------------------------- */
  duplicateTarget: code('advice', 'style', 'Check area "{name}" is listed twice.'),
  redundantTransform: code(
    'advice',
    'style',
    'After "t:{previous}" the transformation "t:{name}" changes nothing.',
  ),
  transformsWithoutCheck: code(
    'advice',
    'style',
    'Operator "@{name}" never looks at the value — the transformations have no effect.',
  ),
} as const satisfies Record<string, CodeSpec>;

export type DiagnosticCode = keyof typeof CODES;

export function severityOf(name: DiagnosticCode): Severity {
  return CODES[name].severity;
}

/** Движки, которые запись с таким замечанием не загружают. */
export function refusedBy(name: DiagnosticCode): readonly Engine[] {
  return CODES[name].refusedBy;
}

/**
 * Становится ли замечание ошибкой из-за отказа движков.
 *
 * Движок назван — решает он один. Не назван — правило должно грузиться
 * везде, но один несогласный движок ещё не делает запись ошибкой: так
 * каждое различие между движками выдавалось бы за ошибку. Двое из трёх —
 * уже делают.
 */
export function refuses(engines: readonly Engine[], engine: Engine | undefined): boolean {
  return engine === undefined ? engines.length >= 2 : engines.includes(engine);
}

export function topicOf(name: DiagnosticCode): Topic {
  return CODES[name].topic;
}

/** Подставляет значения в текст замечания: `{name}` → `data.name`. */
export function formatMessage(name: DiagnosticCode, data?: Record<string, string>): string {
  const template: string = CODES[name].message;
  if (data === undefined) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => data[key] ?? whole);
}
