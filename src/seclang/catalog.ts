/**
 * Каталог языка: какие имена бывают и что о каждом известно.
 *
 * Парсер знает только форму записи. Всё, что нужно, чтобы судить о смысле,
 * лежит здесь и нигде больше: какой вид значения отдаёт переменная, что с
 * ним делает преобразование, что принимает на вход оператор, где может
 * стоять действие.
 *
 * Таблицы намеренно без подписей и переводов: это знание о языке, а не об
 * интерфейсе. Подписи к тем же именам редактор держит у себя.
 *
 * Имена движок сравнивает без учёта регистра, поэтому и поиск здесь такой
 * же; в таблицах имена записаны так, как их принято писать.
 */

import { Fact } from './value';
import type { ValueKind } from './value';

export type Phase = 1 | 2 | 3 | 4 | 5;

/* ------------------------------------------------------------------ */
/* Переменные                                                          */
/* ------------------------------------------------------------------ */

/** Можно ли уточнить переменную параметром после `:`. */
export type SelectorSupport = 'none' | 'optional' | 'required';

export interface VariableSpec {
  name: string;
  /** Раскрывается в несколько значений: допускает `&` и параметр. */
  collection: boolean;
  selector: SelectorSupport;
  /** Вид одного значения; `any` — задаёт автор правил, а не движок. */
  value: ValueKind;
  /** Фаза, начиная с которой в переменной есть хоть что-то. */
  minPhase: Phase;
  /**
   * Фаза, начиная с которой переменная заполнена целиком.
   *
   * Почти всегда совпадает с `minPhase`. Исключение — `ARGS`: параметры
   * строки запроса в ней есть уже в первой фазе, а параметры тела
   * появляются только во второй.
   */
  fullPhase: Phase;
  /** Что о значении известно наверняка, маска из `Fact`; обычно ничего. */
  facts: number;
}

const VARIABLES = new Map<string, VariableSpec>();

function variables(
  shape: 'scalar' | 'collection' | 'keyed',
  value: ValueKind,
  minPhase: Phase,
  names: string,
  fullPhase: Phase = minPhase,
): void {
  for (const name of names.split(/\s+/)) {
    if (name === '') continue;
    VARIABLES.set(name, {
      name,
      collection: shape !== 'scalar',
      selector: shape === 'scalar' ? 'none' : shape === 'keyed' ? 'required' : 'optional',
      value,
      minPhase,
      fullPhase,
      facts: 0,
    });
  }
}

/** Отмечает за переменными свойство, которое верно для любого их значения. */
function known(fact: number, names: string): void {
  for (const name of names.split(/\s+/)) {
    if (name === '') continue;
    const spec = VARIABLES.get(name);
    if (spec === undefined) throw new Error(`unknown variable ${name}`);
    spec.facts |= fact;
  }
}

variables(
  'collection',
  'string',
  1,
  `ARGS_GET ARGS_GET_NAMES REQUEST_HEADERS REQUEST_HEADERS_NAMES REQUEST_COOKIES
   REQUEST_COOKIES_NAMES MATCHED_VARS MATCHED_VARS_NAMES WEBSERVER_ERROR_LOG`,
);
// Общие параметры собираются по частям: строка запроса — сразу, тело — позже.
variables('collection', 'string', 1, 'ARGS ARGS_NAMES', 2);
variables(
  'collection',
  'string',
  2,
  `ARGS_POST ARGS_POST_NAMES FILES FILES_NAMES FILES_TMPNAMES FILES_TMP_CONTENT
   MULTIPART_PART_HEADERS`,
);
variables('collection', 'string', 3, 'RESPONSE_HEADERS RESPONSE_HEADERS_NAMES');
variables('collection', 'number', 1, 'PERF_RULES');
variables('collection', 'number', 2, 'FILES_SIZES');

// Хранилища: что положил `setvar`, то в них и лежит. По имени коллекции не
// узнать, число там или строка, поэтому вид значения не задан вовсе.
variables('keyed', 'any', 1, 'TX IP SESSION USER GLOBAL RESOURCE ENV GEO');
variables('keyed', 'string', 1, 'RULE');
variables('keyed', 'string', 2, 'XML');

variables(
  'scalar',
  'string',
  1,
  `AUTH_TYPE MATCHED_VAR MATCHED_VAR_NAME MODSEC_BUILD PATH_INFO QUERY_STRING
   REMOTE_ADDR REMOTE_HOST REMOTE_USER REQBODY_PROCESSOR REQUEST_BASENAME
   REQUEST_FILENAME REQUEST_LINE REQUEST_METHOD REQUEST_PROTOCOL REQUEST_URI
   REQUEST_URI_RAW SCRIPT_BASENAME SCRIPT_FILENAME SCRIPT_GROUPNAME SCRIPT_MODE
   SCRIPT_USERNAME SERVER_ADDR SERVER_NAME SESSIONID TIME UNIQUE_ID USERID
   USERAGENT_IP WEBAPPID`,
);
variables(
  'scalar',
  'string',
  2,
  `FULL_REQUEST MULTIPART_FILENAME MULTIPART_NAME REQBODY_ERROR_MSG
   REQBODY_PROCESSOR_ERROR_MSG REQUEST_BODY STREAM_INPUT_BODY`,
);
variables('scalar', 'string', 3, 'RESPONSE_CONTENT_TYPE RESPONSE_PROTOCOL STATUS_LINE');
variables('scalar', 'string', 4, 'RESPONSE_BODY STREAM_OUTPUT_BODY');

variables(
  'scalar',
  'number',
  1,
  `DURATION HIGHEST_SEVERITY MSC_PCRE_ERROR MSC_PCRE_LIMITS_EXCEEDED PERF_ALL
   PERF_COMBINED PERF_GC PERF_LOGGING PERF_PHASE1 PERF_PHASE2 PERF_PHASE3
   PERF_PHASE4 PERF_PHASE5 PERF_SREAD PERF_SWRITE REMOTE_PORT SCRIPT_GID
   SCRIPT_UID SDBM_DELETE_ERROR SERVER_PORT TIME_DAY TIME_EPOCH TIME_HOUR
   TIME_MIN TIME_MON TIME_SEC TIME_WDAY TIME_YEAR URLENCODED_ERROR`,
);
variables(
  'scalar',
  'number',
  2,
  `ARGS_COMBINED_SIZE FILES_COMBINED_SIZE FULL_REQUEST_LENGTH INBOUND_DATA_ERROR
   MULTIPART_BOUNDARY_QUOTED MULTIPART_BOUNDARY_WHITESPACE MULTIPART_CRLF_LF_LINES
   MULTIPART_DATA_AFTER MULTIPART_DATA_BEFORE MULTIPART_FILE_LIMIT_EXCEEDED
   MULTIPART_HEADER_FOLDING MULTIPART_INVALID_HEADER_FOLDING MULTIPART_INVALID_PART
   MULTIPART_INVALID_QUOTING MULTIPART_LF_LINE MULTIPART_MISSING_SEMICOLON
   MULTIPART_SEMICOLON_MISSING MULTIPART_STRICT_ERROR MULTIPART_UNMATCHED_BOUNDARY
   REQBODY_ERROR REQBODY_PROCESSOR_ERROR REQUEST_BODY_LENGTH`,
);
variables('scalar', 'number', 3, 'RESPONSE_CONTENT_LENGTH RESPONSE_STATUS');
variables('scalar', 'number', 4, 'OUTBOUND_DATA_ERROR');

// Переменные Coraza, которых нет в ModSecurity. Движок другой, язык тот же,
// и его рекомендованная конфигурация должна читаться без замечаний.
variables('collection', 'string', 1, 'ARGS_PATH');
variables('collection', 'string', 4, 'RESPONSE_ARGS');
variables('keyed', 'string', 2, 'REQUEST_XML JSON');
variables('keyed', 'string', 4, 'RESPONSE_XML');
variables('scalar', 'number', 1, 'URI_PARSE_ERROR ARGUMENTS_LIMIT_REACHED');
variables('scalar', 'number', 2, 'MULTIPART_DUPLICATE_PART_HEADER');
variables('scalar', 'string', 2, 'MULTIPART_FILENAME_CHARSET MULTIPART_FILENAME_LANGUAGE');
variables('scalar', 'string', 4, 'RES_BODY_PROCESSOR RES_BODY_ERROR_MSG RES_BODY_PROCESSOR_ERROR_MSG');
variables('scalar', 'number', 4, 'RES_BODY_ERROR RES_BODY_PROCESSOR_ERROR');

// Перевода строки не бывает в том, что движок берёт из разметки HTTP как
// есть: перевод строки там разделяет сами поля. Раскодированного здесь нет:
// в `ARGS` `%0a` уже перевод строки, а `REQUEST_URI` ModSecurity 3 тоже
// раскодирует — в отличие от второй версии и Coraza. Что именно движки
// раскодируют, проверено на стенде (сценарии `anchors-…`).
known(
  Fact.OneLine,
  `REQUEST_METHOD REQUEST_PROTOCOL REQUEST_LINE REQUEST_URI_RAW QUERY_STRING
   REQUEST_HEADERS REQUEST_HEADERS_NAMES REQUEST_COOKIES REQUEST_COOKIES_NAMES
   RESPONSE_HEADERS RESPONSE_HEADERS_NAMES RESPONSE_PROTOCOL STATUS_LINE
   RESPONSE_CONTENT_TYPE REMOTE_ADDR SERVER_ADDR USERAGENT_IP UNIQUE_ID`,
);

export function variableSpec(name: string): VariableSpec | null {
  return VARIABLES.get(name) ?? VARIABLES.get(name.toUpperCase()) ?? null;
}

export function variableNames(): string[] {
  return [...VARIABLES.keys()];
}

/* ------------------------------------------------------------------ */
/* Преобразования                                                      */
/* ------------------------------------------------------------------ */

export type TransformGroup =
  | 'reset'
  | 'case'
  | 'whitespace'
  | 'decode'
  | 'sanitize'
  | 'path'
  | 'encode'
  | 'hash'
  | 'measure';

export interface TransformSpec {
  name: string;
  group: TransformGroup;
  /** `t:none`: отменяет всё, что стояло в конвейере раньше. */
  resets: boolean;
  /** Виды входа, на которых преобразование осмысленно. */
  accepts: readonly ValueKind[];
  /** Вид выхода; `same` — тот же, что на входе. */
  produces: ValueKind | 'same';
  /** Свойства входа, которые переживают преобразование. */
  keeps: number;
  /** Свойства, которые появляются на выходе. */
  adds: number;
  /**
   * Свойства входа, при которых преобразование ничего не меняет.
   * Ноль — доказать бесполезность по типу нельзя.
   */
  idleWhen: number;
}

const TRANSFORMS = new Map<string, TransformSpec>();

const TEXT: readonly ValueKind[] = ['string'];
const BYTES: readonly ValueKind[] = ['string', 'binary'];
const ALL = ~0;

function transforms(
  group: TransformGroup,
  accepts: readonly ValueKind[],
  produces: ValueKind | 'same',
  names: string,
  keeps = 0,
  adds = 0,
  idleWhen = 0,
): void {
  for (const name of names.split(/\s+/)) {
    if (name === '') continue;
    TRANSFORMS.set(name.toLowerCase(), {
      name,
      group,
      resets: group === 'reset',
      accepts,
      produces,
      keeps,
      adds,
      idleWhen,
    });
  }
}

transforms('reset', ['any'], 'same', 'none');

// Регистр. Каждое из двух приведений снимает то, что обещало другое.
transforms('case', TEXT, 'string', 'lowercase', ALL & ~Fact.Upper, Fact.Lower, Fact.Lower);
transforms(
  'case',
  TEXT,
  'string',
  'uppercase',
  ALL & ~(Fact.Lower | Fact.Hex),
  Fact.Upper,
  Fact.Upper,
);

// Пробелы: ничего, кроме пробелов, не трогают.
transforms('whitespace', TEXT, 'string', 'compressWhitespace', ALL, Fact.Squeezed, Fact.Squeezed);
transforms('whitespace', TEXT, 'string', 'removeWhitespace', ALL, Fact.NoSpace, Fact.NoSpace);
transforms(
  'whitespace',
  TEXT,
  'string',
  'trim',
  ALL,
  Fact.TrimLeft | Fact.TrimRight,
  Fact.TrimLeft | Fact.TrimRight,
);
transforms('whitespace', TEXT, 'string', 'trimLeft', ALL, Fact.TrimLeft, Fact.TrimLeft);
transforms('whitespace', TEXT, 'string', 'trimRight', ALL, Fact.TrimRight, Fact.TrimRight);

// Раскрытие кодирования: на выходе может оказаться любой символ, поэтому
// всё, что было известно о тексте, перестаёт быть верным.
transforms(
  'decode',
  TEXT,
  'string',
  `urlDecode urlDecodeUni htmlEntityDecode jsDecode cssDecode escapeSeqDecode
   base64Decode base64DecodeExt hexDecode sqlHexDecode utf8toUnicode`,
);

const CASE = Fact.Lower | Fact.Upper;

// Очистка. Удаление символов пробелов не добавляет, замена на пробел —
// добавляет, и края с повторами после неё уже не гарантированы.
transforms('sanitize', BYTES, 'same', 'removeNulls', ALL, Fact.NoNul, Fact.NoNul);
transforms('sanitize', BYTES, 'same', 'replaceNulls', CASE | Fact.OneLine, Fact.NoNul, Fact.NoNul);
transforms(
  'sanitize',
  TEXT,
  'string',
  'removeComments removeCommentsChar',
  CASE | Fact.NoNul | Fact.NoSpace | Fact.OneLine,
);
transforms('sanitize', TEXT, 'string', 'replaceComments', CASE | Fact.NoNul | Fact.OneLine);
// `cmdLine` приводит к нижнему регистру и схлопывает пробелы сам.
transforms('sanitize', TEXT, 'string', 'cmdLine', Fact.NoNul, Fact.Lower | Fact.Squeezed);

transforms(
  'path',
  TEXT,
  'string',
  'normalizePath normalisePath normalizePathWin normalisePathWin',
  CASE |
    Fact.NoNul |
    Fact.NoSpace |
    Fact.TrimLeft |
    Fact.TrimRight |
    Fact.Squeezed |
    Fact.OneLine,
);

// Кодирование: принимает что угодно, отдаёт текст известного алфавита.
transforms('encode', BYTES, 'string', 'urlEncode', Fact.Lower, Fact.NoSpace | Fact.NoNul);
transforms('encode', BYTES, 'string', 'hexEncode', 0, Fact.Hex);
transforms('encode', BYTES, 'string', 'base64Encode', 0, Fact.Base64);

// Хеши и чётность отдают сырые байты: сравнивать их с текстом нельзя,
// пока они не пройдут через `hexEncode`.
transforms('hash', BYTES, 'binary', 'md5 sha1', 0, Fact.Digest);
transforms('hash', BYTES, 'binary', 'parityEven7bit parityOdd7bit parityZero7bit');

transforms('measure', BYTES, 'number', 'length', 0, Fact.NonNegative);

export function transformSpec(name: string): TransformSpec | null {
  return TRANSFORMS.get(name.toLowerCase()) ?? null;
}

export function transformNames(): string[] {
  return [...TRANSFORMS.values()].map((spec) => spec.name);
}

/* ------------------------------------------------------------------ */
/* Операторы                                                           */
/* ------------------------------------------------------------------ */

/** Что оператор ждёт аргументом. */
export type OperatorArg =
  | 'none'
  | 'string'
  | 'regex'
  | 'number'
  | 'ipList'
  | 'phrases'
  | 'file'
  | 'byteRange';

export interface OperatorSpec {
  name: string;
  arg: OperatorArg;
  /** Виды входа, на которых оператор осмыслен. */
  input: readonly ValueKind[];
  /** Сравнивает аргумент со входом буквально и с учётом регистра. */
  literal: boolean;
  /** Заполняет `TX:0`…`TX:9` при действии `capture`. */
  captures: boolean;
  /** На проверяемое значение не смотрит вовсе. */
  blind: boolean;
  /**
   * Раскрывает ли макросы в своём аргументе.
   *
   * Делают это не все: `@pm` и `@ipMatch` разбирают аргумент один раз,
   * при загрузке, и `%{tx.words}` для них — девять обычных символов.
   */
  macros: boolean;
}

const OPERATORS = new Map<string, OperatorSpec>();

// Число — это ещё и текст: `RESPONSE_STATUS "@rx ^5\d\d$"` осмыслен. Обратное
// неверно: `@gt` над текстом сравнивает то, что из него получится после
// приведения к числу, а получится, как правило, ноль.
const TEXT_INPUT: readonly ValueKind[] = ['string', 'binary', 'number'];
const NUMBER_INPUT: readonly ValueKind[] = ['number'];

function operators(
  arg: OperatorArg,
  input: readonly ValueKind[],
  names: string,
  flags: { literal?: boolean; captures?: boolean; blind?: boolean } = {},
): void {
  for (const name of names.split(/\s+/)) {
    if (name === '') continue;
    OPERATORS.set(name.toLowerCase(), {
      name,
      arg,
      input,
      literal: flags.literal === true,
      captures: flags.captures === true,
      blind: flags.blind === true,
      macros: false,
    });
  }
}

operators('regex', TEXT_INPUT, 'rx rxGlobal verifyCC verifyCPF verifySSN verifySVNR', {
  captures: true,
});
operators('regex', TEXT_INPUT, 'validateHash gsbLookup', { captures: true });
operators('string', TEXT_INPUT, 'streq contains beginsWith endsWith containsWord within strmatch', {
  literal: true,
});
operators('string', TEXT_INPUT, 'rbl rsub', { captures: true });
// Операторы Coraza: данные берутся из набора, объявленного `SecDataset`.
operators('string', TEXT_INPUT, 'ipMatchFromDataset pmFromDataset restpath validateNid');
operators('number', NUMBER_INPUT, 'eq ge gt le lt');
operators('phrases', TEXT_INPUT, 'pm', { captures: true });
operators('file', TEXT_INPUT, 'pmFromFile pmf', { captures: true });
operators(
  'file',
  TEXT_INPUT,
  'ipMatchFromFile ipMatchF validateDTD validateSchema inspectFile fuzzyHash',
);
operators('ipList', TEXT_INPUT, 'ipMatch');
operators('byteRange', TEXT_INPUT, 'validateByteRange');
operators('none', TEXT_INPUT, 'detectSQLi detectXSS', { captures: true });
operators('none', TEXT_INPUT, 'validateUrlEncoding validateUtf8Encoding');
operators('none', ['any'], 'unconditionalMatch noMatch geoLookup', { blind: true });

// Кто раскрывает макросы и кто заполняет группы при `capture` — по
// исходникам ModSecurity 2 (`re_operators.c`): там это видно по вызовам
// `expand_macros` и по работе с `capture` в каждом операторе.
for (const name of `beginsWith contains containsWord endsWith eq ge gt le lt rsub rx rxGlobal
  streq validateHash within`.split(/\s+/)) {
  const spec = OPERATORS.get(name.toLowerCase());
  if (spec !== undefined) spec.macros = true;
}

export function operatorSpec(name: string): OperatorSpec | null {
  return OPERATORS.get(name.toLowerCase()) ?? null;
}

export function operatorNames(): string[] {
  return [...OPERATORS.values()].map((spec) => spec.name);
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

export type ActionGroup = 'meta' | 'disruptive' | 'flow' | 'data' | 'logging' | 'transform';

/** Нужно ли действию значение после `:`. */
export type ActionValue = 'none' | 'required' | 'optional';

export interface ActionSpec {
  name: string;
  group: ActionGroup;
  value: ActionValue;
  /** Имеет смысл только на первом правиле цепочки. */
  headOnly: boolean;
  /**
   * Можно ли написать действие в правиле несколько раз.
   *
   * `tag` и `setvar` копятся, а у `id` или `msg` движок помнит только
   * последнее значение — молча.
   */
  repeatable: boolean;
  /**
   * Группа взаимоисключающих действий: из всех, что названы в правиле,
   * действует последнее. `deny` и `pass`, `log` и `nolog`.
   */
  exclusive: 'disruptive' | 'log' | 'auditlog' | null;
}

const ACTIONS = new Map<string, ActionSpec>();

function actions(group: ActionGroup, value: ActionValue, headOnly: boolean, names: string): void {
  for (const name of names.split(/\s+/)) {
    if (name === '') continue;
    ACTIONS.set(name.toLowerCase(), {
      name,
      group,
      value,
      headOnly,
      repeatable: false,
      exclusive: null,
    });
  }
}

actions('meta', 'required', true, 'id phase msg logdata tag rev ver severity maturity accuracy');
actions('disruptive', 'none', true, 'block deny drop pass');
actions('disruptive', 'optional', true, 'allow');
actions('disruptive', 'required', true, 'redirect proxy pause');
actions('flow', 'none', false, 'chain');
actions('flow', 'required', true, 'skip skipAfter');
actions('logging', 'none', false, 'log nolog auditlog noauditlog');
// У действий очистки журнала два написания, британское и американское;
// движок знает оба.
actions('data', 'none', false, 'capture multiMatch sanitiseMatched sanitizeMatched');
actions('data', 'optional', false, 'sanitiseMatchedBytes sanitizeMatchedBytes');
actions(
  'data',
  'required',
  false,
  `ctl setvar setenv setuid setsid setrsc initcol expirevar deprecatevar exec
   append prepend xmlns status sanitiseArg sanitiseRequestHeader
   sanitiseResponseHeader sanitizeArg sanitizeRequestHeader sanitizeResponseHeader`,
);
actions('transform', 'required', false, 't');

// Кратность и группы — по таблице регистрации действий в ModSecurity 2
// (`re_actions.c`): `ACTION_CARDINALITY_MANY` и `ACTION_CGROUP_*`.
function mark(names: string, change: (spec: ActionSpec) => void): void {
  for (const name of names.split(/\s+/)) {
    const spec = ACTIONS.get(name.toLowerCase());
    if (spec !== undefined) change(spec);
  }
}

mark(
  `t ctl xmlns setenv setvar expirevar deprecatevar initcol exec tag sanitiseArg
   sanitiseMatched sanitiseMatchedBytes sanitiseRequestHeader sanitiseResponseHeader
   sanitizeArg sanitizeMatched sanitizeMatchedBytes sanitizeRequestHeader
   sanitizeResponseHeader`,
  (spec) => {
    spec.repeatable = true;
  },
);
// `skip` и `skipAfter` движок числит в той же группе, что и реакции, но
// рядом с `pass` их пишут постоянно, и это работает: здесь группа — только
// то, что решает судьбу запроса.
mark('allow block deny drop pass proxy redirect', (spec) => {
  spec.exclusive = 'disruptive';
});
mark('log nolog', (spec) => {
  spec.exclusive = 'log';
});
mark('auditlog noauditlog', (spec) => {
  spec.exclusive = 'auditlog';
});

export function actionSpec(name: string): ActionSpec | null {
  return ACTIONS.get(name.toLowerCase()) ?? null;
}

export function actionNames(): string[] {
  return [...ACTIONS.values()].map((spec) => spec.name);
}

/**
 * Что принимает опция `ctl`.
 *
 * Список опций и их значений — из `msre_action_ctl_validate` в исходниках
 * ModSecurity 2: имя, которого здесь нет, движок отвергает при загрузке.
 */
export type CtlValue =
  /** `On`, `Off`, `DetectionOnly`. */
  | 'engine'
  /** `On`, `Off`. */
  | 'toggle'
  /** `On`, `Off`, `RelevantOnly`. */
  | 'audit'
  /** `On`, `Off`, `OnlyArgs`. */
  | 'xml'
  /** Части записи журнала, можно со знаком: `+E`, `-FH`, `ABIJ`. */
  | 'parts'
  /** Уровень от 0 до 9. */
  | 'level'
  /** Положительное целое. */
  | 'limit'
  /** Номер правила или диапазон. */
  | 'ids'
  /** Регулярное выражение. */
  | 'regex'
  /** `выборка;ЦЕЛЬ`. */
  | 'target'
  /** Что угодно. */
  | 'any';

const CTL = new Map<string, { name: string; value: CtlValue }>();

function ctl(value: CtlValue, names: string): void {
  for (const name of names.split(/\s+/)) {
    if (name !== '') CTL.set(name.toLowerCase(), { name, value });
  }
}

ctl('engine', 'ruleEngine');
ctl('toggle', 'requestBodyAccess responseBodyAccess forceRequestBodyVariable');
ctl('toggle', 'hashEnforcement hashEngine');
ctl('audit', 'auditEngine');
ctl('xml', 'parseXmlIntoArgs');
ctl('parts', 'auditLogParts');
ctl('level', 'debugLogLevel');
ctl('limit', 'requestBodyLimit responseBodyLimit');
ctl('ids', 'ruleRemoveById');
ctl('regex', 'ruleRemoveByTag ruleRemoveByMsg');
ctl('target', 'ruleRemoveTargetById ruleRemoveTargetByTag ruleRemoveTargetByMsg');
ctl('any', 'requestBodyProcessor');

export function ctlSpec(name: string): { name: string; value: CtlValue } | null {
  return CTL.get(name.toLowerCase()) ?? null;
}

export function ctlNames(): string[] {
  return [...CTL.values()].map((spec) => spec.name);
}

/** Критичность по имени; числом — от 0 до 7. */
export const SEVERITY_NAMES: readonly string[] = [
  'EMERGENCY',
  'ALERT',
  'CRITICAL',
  'ERROR',
  'WARNING',
  'NOTICE',
  'INFO',
  'DEBUG',
];

/** Поля переменной `RULE`: `%{rule.id}`, `%{rule.msg}`. */
export const RULE_FIELDS: readonly string[] = [
  'accuracy',
  'id',
  'logdata',
  'maturity',
  'msg',
  'rev',
  'severity',
  'ver',
];

/** Коллекции, в которые `setvar` может писать. */
export const WRITABLE_COLLECTIONS: readonly string[] = [
  'tx',
  'ip',
  'session',
  'user',
  'global',
  'resource',
  'env',
];

/** Номер фазы по записи: `2`, `request`, `logging`. `null` — такой фазы нет. */
export function phaseNumber(value: string): Phase | null {
  switch (value.trim().toLowerCase()) {
    case '1':
      return 1;
    case '2':
    case 'request':
      return 2;
    case '3':
      return 3;
    case '4':
    case 'response':
      return 4;
    case '5':
    case 'logging':
      return 5;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Директивы                                                           */
/* ------------------------------------------------------------------ */

const DIRECTIVES = new Map<string, string>();

for (const name of `
  SecAction SecArgumentSeparator SecArgumentsLimit SecAuditEngine SecAuditLog
  SecAuditLog2 SecAuditLogDirMode SecAuditLogFileMode SecAuditLogFormat
  SecAuditLogParts SecAuditLogRelevantStatus SecAuditLogStorageDir SecAuditLogType
  SecCacheTransformations SecChrootDir SecCollectionTimeout SecComponentSignature
  SecConnEngine SecConnReadStateLimit SecConnWriteStateLimit SecContentInjection
  SecCookieFormat SecCookieV0Separator SecDataDir SecDebugLog SecDebugLogLevel
  SecDefaultAction SecDisableBackendCompression SecGeoLookupDb SecGsbLookupDb
  SecGuardianLog SecHashEngine SecHashKey SecHashMethodPm SecHashMethodRx
  SecHashParam SecHttpBlKey SecInterceptOnError SecMarker SecParseXmlIntoArgs
  SecPcreMatchLimit SecPcreMatchLimitRecursion SecPdfProtect SecPdfProtectMethod
  SecPdfProtectSecret SecPdfProtectTimeout SecPdfProtectTokenName SecReadStateLimit
  SecRemoteRules SecRemoteRulesFailAction SecRequestBodyAccess
  SecRequestBodyInMemoryLimit SecRequestBodyJsonDepthLimit SecRequestBodyLimit
  SecRequestBodyLimitAction SecRequestBodyNoFilesLimit SecResponseBodyAccess
  SecResponseBodyLimit SecResponseBodyLimitAction SecResponseBodyMimeType
  SecResponseBodyMimeTypesClear SecRule SecRuleEngine SecRuleInheritance
  SecRulePerfTime SecRuleRemoveById SecRuleRemoveByMsg SecRuleRemoveByTag
  SecRuleScript SecRuleUpdateActionById SecRuleUpdateTargetById
  SecRuleUpdateTargetByMsg SecRuleUpdateTargetByTag SecSensorId SecServerSignature
  SecStatusEngine SecStreamInBodyInspection SecStreamOutBodyInspection SecTmpDir
  SecTmpSaveUploadedFiles SecUnicodeCodePage SecUnicodeMapFile SecUploadDir
  SecUploadFileLimit SecUploadFileMode SecUploadKeepFiles SecWebAppId
  SecWriteStateLimit SecXmlExternalEntity

  SecDataset SecIgnoreRuleCompilationErrors SecResponseBodyJsonDepthLimit
  SecRxPreFilter SecUnicodeMap
`.split(/\s+/)) {
  if (name !== '') DIRECTIVES.set(name.toLowerCase(), name);
}

/**
 * Что директива принимает аргументом.
 *
 * Директив десятки, а видов аргумента — горсть: переключатель, число,
 * уровень, набор букв. Описаны только те директивы, значение которых можно
 * проверить; о пути к файлу или произвольном тексте сказать нечего.
 */
export type DirectiveArg =
  | { kind: 'choice'; values: readonly string[] }
  /** Целое неотрицательное число. */
  | { kind: 'number' }
  /** Уровень журнала отладки, 0–9. */
  | { kind: 'level' }
  /** Права доступа в восьмеричной записи или `default`. */
  | { kind: 'mode' }
  /** Части записи журнала аудита: буквы `A`–`K` и `Z`. */
  | { kind: 'parts' }
  /** Одно обязательное значение, которое проверить нечем. */
  | { kind: 'text' }
  /** Одно значение или больше. */
  | { kind: 'list' }
  /** Аргументов нет. */
  | { kind: 'none' };

const DIRECTIVE_ARGS = new Map<string, DirectiveArg>();

function directiveArgs(arg: DirectiveArg, names: string): void {
  for (const name of names.split(/\s+/)) {
    if (name !== '') DIRECTIVE_ARGS.set(name.toLowerCase(), arg);
  }
}

const choice = (...values: string[]): DirectiveArg => ({ kind: 'choice', values });

directiveArgs(choice('On', 'Off', 'DetectionOnly'), 'SecRuleEngine SecConnEngine');
directiveArgs(choice('On', 'Off', 'RelevantOnly'), 'SecAuditEngine SecUploadKeepFiles');
directiveArgs(
  choice('On', 'Off'),
  `SecRequestBodyAccess SecResponseBodyAccess SecContentInjection
   SecStreamInBodyInspection SecStreamOutBodyInspection SecTmpSaveUploadedFiles
   SecDisableBackendCompression SecInterceptOnError SecRuleInheritance
   SecXmlExternalEntity SecStatusEngine SecHashEngine`,
);
directiveArgs(choice('On', 'Off', 'OnlyArgs'), 'SecParseXmlIntoArgs');
directiveArgs(choice('Reject', 'ProcessPartial'), 'SecRequestBodyLimitAction SecResponseBodyLimitAction');
directiveArgs(choice('Serial', 'Concurrent', 'HTTPS'), 'SecAuditLogType');
directiveArgs(choice('JSON', 'Native'), 'SecAuditLogFormat');
directiveArgs(choice('Abort', 'Warn'), 'SecRemoteRulesFailAction');
directiveArgs(choice('0', '1'), 'SecCookieFormat');
directiveArgs(
  { kind: 'number' },
  `SecRequestBodyLimit SecRequestBodyNoFilesLimit SecRequestBodyInMemoryLimit
   SecResponseBodyLimit SecPcreMatchLimit SecPcreMatchLimitRecursion SecUploadFileLimit
   SecCollectionTimeout SecArgumentsLimit SecRequestBodyJsonDepthLimit
   SecResponseBodyJsonDepthLimit SecReadStateLimit SecWriteStateLimit
   SecConnReadStateLimit SecConnWriteStateLimit SecRulePerfTime SecUnicodeCodePage`,
);
directiveArgs({ kind: 'level' }, 'SecDebugLogLevel');
directiveArgs({ kind: 'mode' }, 'SecAuditLogDirMode SecAuditLogFileMode SecUploadFileMode');
directiveArgs({ kind: 'parts' }, 'SecAuditLogParts');
directiveArgs(
  { kind: 'text' },
  `SecAuditLog SecAuditLog2 SecAuditLogStorageDir SecAuditLogRelevantStatus SecDebugLog
   SecDataDir SecTmpDir SecUploadDir SecGeoLookupDb SecComponentSignature
   SecServerSignature SecWebAppId SecSensorId SecHttpBlKey SecArgumentSeparator
   SecUnicodeMapFile SecGuardianLog SecChrootDir`,
);
directiveArgs({ kind: 'list' }, 'SecResponseBodyMimeType');
directiveArgs({ kind: 'none' }, 'SecResponseBodyMimeTypesClear');

export function directiveSpec(name: string): DirectiveArg | null {
  return DIRECTIVE_ARGS.get(name.toLowerCase()) ?? null;
}

/** Имя директивы в принятом написании; `null` — такой директивы нет. */
export function directiveName(name: string): string | null {
  return DIRECTIVES.get(name.toLowerCase()) ?? null;
}

export function directiveNames(): string[] {
  return [...DIRECTIVES.values()];
}
