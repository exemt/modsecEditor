/**
 * Движки: что из языка понимает каждый.
 *
 * Язык один, движков три, и совпадают они не полностью. Правило, написанное
 * для ModSecurity 2, может не загрузиться в третьей версии или в Coraza —
 * не из-за ошибки, а потому что действие или оператор там не сделаны.
 *
 * Каталог (`catalog.ts`) знает объединение: всё, что есть хотя бы в одном
 * движке. Здесь — разница между ними. Без названного движка линтер о ней
 * молчит: правило, верное хоть где-то, не считается неверным.
 *
 * Откуда данные:
 *
 *  - **ModSecurity 3** — пометки «Supported on libModSecurity» в официальном
 *    справочнике. Он местами отстал от кода, поэтому взято только то, что
 *    там названо неподдерживаемым и не появилось в выпусках позже: список
 *    нарочно короче, чем мог бы быть, зато не врёт.
 *  - **Coraza** — реестры в исходниках версии 3.8.1: движок сам перечисляет,
 *    какие операторы, действия, преобразования, переменные и директивы он
 *    знает. Всё остальное для него не существует.
 */

export type Engine = 'modsecurity2' | 'modsecurity3' | 'coraza';

/** Какого рода имя: по нему выбирается список и слово в сообщении. */
export type NameKind = 'variable' | 'operator' | 'transform' | 'action' | 'directive';

export const ENGINE_LABELS: Record<Engine, string> = {
  modsecurity2: 'ModSecurity 2',
  modsecurity3: 'ModSecurity 3',
  coraza: 'Coraza',
};

function names(list: string): Set<string> {
  return new Set(list.toLowerCase().split(/\s+/).filter((name) => name !== ''));
}

type Table = Record<NameKind, Set<string>>;

/* ------------------------------------------------------------------ */
/* Coraza: что есть                                                    */
/* ------------------------------------------------------------------ */

const CORAZA: Table = {
  variable: names(`
    ARGS ARGS_COMBINED_SIZE ARGS_GET ARGS_GET_NAMES ARGS_NAMES ARGS_PATH ARGS_POST
    ARGS_POST_NAMES ARGUMENTS_LIMIT_REACHED AUTH_TYPE DURATION ENV FILES
    FILES_COMBINED_SIZE FILES_NAMES FILES_SIZES FILES_TMPNAMES FILES_TMP_CONTENT
    FULL_REQUEST FULL_REQUEST_LENGTH GEO HIGHEST_SEVERITY INBOUND_DATA_ERROR JSON
    MATCHED_VAR MATCHED_VARS MATCHED_VARS_NAMES MATCHED_VAR_NAME
    MULTIPART_BOUNDARY_QUOTED MULTIPART_BOUNDARY_WHITESPACE MULTIPART_CRLF_LF_LINES
    MULTIPART_DATA_AFTER MULTIPART_DATA_BEFORE MULTIPART_DUPLICATE_PART_HEADER
    MULTIPART_FILENAME MULTIPART_FILENAME_CHARSET MULTIPART_FILENAME_LANGUAGE
    MULTIPART_FILE_LIMIT_EXCEEDED MULTIPART_HEADER_FOLDING
    MULTIPART_INVALID_HEADER_FOLDING MULTIPART_INVALID_PART MULTIPART_INVALID_QUOTING
    MULTIPART_LF_LINE MULTIPART_MISSING_SEMICOLON MULTIPART_NAME MULTIPART_PART_HEADERS
    MULTIPART_STRICT_ERROR MULTIPART_UNMATCHED_BOUNDARY OUTBOUND_DATA_ERROR PATH_INFO
    QUERY_STRING REMOTE_ADDR REMOTE_HOST REMOTE_PORT REQBODY_ERROR REQBODY_ERROR_MSG
    REQBODY_PROCESSOR REQBODY_PROCESSOR_ERROR REQBODY_PROCESSOR_ERROR_MSG
    REQUEST_BASENAME REQUEST_BODY REQUEST_BODY_LENGTH REQUEST_COOKIES
    REQUEST_COOKIES_NAMES REQUEST_FILENAME REQUEST_HEADERS REQUEST_HEADERS_NAMES
    REQUEST_LINE REQUEST_METHOD REQUEST_PROTOCOL REQUEST_URI REQUEST_URI_RAW
    REQUEST_XML RESPONSE_ARGS RESPONSE_BODY RESPONSE_CONTENT_LENGTH
    RESPONSE_CONTENT_TYPE RESPONSE_HEADERS RESPONSE_HEADERS_NAMES RESPONSE_PROTOCOL
    RESPONSE_STATUS RESPONSE_XML RES_BODY_ERROR RES_BODY_ERROR_MSG RES_BODY_PROCESSOR
    RES_BODY_PROCESSOR_ERROR RES_BODY_PROCESSOR_ERROR_MSG RULE SERVER_ADDR SERVER_NAME
    SERVER_PORT SESSIONID STATUS_LINE TIME TIME_DAY TIME_EPOCH TIME_HOUR TIME_MIN
    TIME_MON TIME_SEC TIME_WDAY TIME_YEAR TX UNIQUE_ID URI_PARSE_ERROR
    URLENCODED_ERROR USERID XML
  `),
  operator: names(`
    beginsWith contains detectSQLi detectXSS endsWith eq ge geoLookup gt inspectFile
    ipMatch ipMatchF ipMatchFromDataset ipMatchFromFile le lt noMatch pm pmFromDataset
    pmFromFile pmf rbl restpath rx streq strmatch unconditionalMatch validateByteRange
    validateNid validateSchema validateUrlEncoding validateUtf8Encoding within
  `),
  transform: names(`
    base64Decode base64DecodeExt base64Encode cmdLine compressWhitespace cssDecode
    escapeSeqDecode hexDecode hexEncode htmlEntityDecode jsDecode length lowercase md5
    none normalisePath normalisePathWin normalizePath normalizePathWin removeComments
    removeCommentsChar removeNulls removeWhitespace replaceComments replaceNulls sha1
    trim trimLeft trimRight uppercase urlDecode urlDecodeUni urlEncode utf8toUnicode
  `),
  action: names(`
    accuracy allow auditlog block capture chain ctl deny drop expirevar id initcol
    log logdata maturity msg multiMatch noauditlog nolog pass phase redirect rev setenv
    setvar severity skip skipAfter status t tag ver
  `),
  directive: names(`
    SecAction SecArgumentSeparator SecArgumentsLimit SecAuditEngine SecAuditLog
    SecAuditLogDirMode SecAuditLogFileMode SecAuditLogFormat SecAuditLogParts
    SecAuditLogRelevantStatus SecAuditLogStorageDir SecAuditLogType
    SecCollectionTimeout SecComponentSignature SecConnEngine SecConnReadStateLimit
    SecConnWriteStateLimit SecCookieFormat SecDataDir SecDataset SecDebugLog
    SecDebugLogLevel SecDefaultAction SecGsbLookupDb SecHashEngine SecHashKey
    SecHashMethodPm SecHashMethodRx SecHashParam SecHttpBlKey
    SecIgnoreRuleCompilationErrors SecMarker SecPcreMatchLimit
    SecPcreMatchLimitRecursion SecRemoteRules SecRemoteRulesFailAction
    SecRequestBodyAccess SecRequestBodyInMemoryLimit SecRequestBodyJsonDepthLimit
    SecRequestBodyLimit SecRequestBodyLimitAction SecRequestBodyNoFilesLimit
    SecResponseBodyAccess SecResponseBodyJsonDepthLimit SecResponseBodyLimit
    SecResponseBodyLimitAction SecResponseBodyMimeType SecResponseBodyMimeTypesClear
    SecRule SecRuleEngine SecRulePerfTime SecRuleRemoveById SecRuleRemoveByMsg
    SecRuleRemoveByTag SecRuleScript SecRuleUpdateActionById SecRuleUpdateTargetById
    SecRuleUpdateTargetByMsg SecRuleUpdateTargetByTag SecRxPreFilter SecSensorId
    SecServerSignature SecTmpDir SecUnicodeMap SecUploadDir SecUploadFileLimit
    SecUploadFileMode SecUploadKeepFiles SecWebAppId
  `),
};

/* ------------------------------------------------------------------ */
/* ModSecurity: чего нет                                               */
/* ------------------------------------------------------------------ */

/** То, что придумала Coraza: в ModSecurity этих имён нет ни в одной версии. */
const CORAZA_ONLY: Table = {
  variable: names(`
    ARGS_PATH ARGUMENTS_LIMIT_REACHED JSON REQUEST_XML RESPONSE_ARGS
    RESPONSE_XML RES_BODY_ERROR RES_BODY_ERROR_MSG RES_BODY_PROCESSOR
    RES_BODY_PROCESSOR_ERROR RES_BODY_PROCESSOR_ERROR_MSG URI_PARSE_ERROR
  `),
  operator: names('ipMatchFromDataset pmFromDataset restpath validateNid'),
  transform: names(''),
  action: names(''),
  directive: names(`
    SecDataset SecIgnoreRuleCompilationErrors SecResponseBodyJsonDepthLimit
    SecRxPreFilter SecUnicodeMap
  `),
};

/** Есть во второй версии и не перенесено в третью. */
const NOT_IN_V3: Table = {
  variable: names(`
    PERF_ALL PERF_COMBINED PERF_GC PERF_LOGGING PERF_PHASE1 PERF_PHASE2 PERF_PHASE3
    PERF_PHASE4 PERF_PHASE5 PERF_RULES PERF_SREAD PERF_SWRITE SCRIPT_BASENAME
    SCRIPT_FILENAME SCRIPT_GID SCRIPT_GROUPNAME SCRIPT_MODE SCRIPT_UID SCRIPT_USERNAME
    SDBM_DELETE_ERROR STREAM_INPUT_BODY STREAM_OUTPUT_BODY USERAGENT_IP
    WEBSERVER_ERROR_LOG
  `),
  operator: names('gsbLookup rsub validateHash'),
  transform: names(''),
  action: names(`
    append deprecatevar pause prepend proxy sanitiseArg sanitiseMatched
    sanitiseMatchedBytes sanitiseRequestHeader sanitiseResponseHeader sanitizeArg
    sanitizeMatched sanitizeMatchedBytes sanitizeRequestHeader sanitizeResponseHeader
  `),
  directive: names(`
    SecAuditLog2 SecCacheTransformations SecChrootDir SecConnEngine
    SecConnReadStateLimit SecConnWriteStateLimit SecContentInjection
    SecCookieV0Separator SecDisableBackendCompression SecGsbLookupDb SecGuardianLog
    SecHashEngine SecHashKey SecHashMethodPm SecHashMethodRx SecHashParam
    SecInterceptOnError SecPdfProtect SecPdfProtectMethod SecPdfProtectSecret
    SecPdfProtectTimeout SecPdfProtectTokenName SecReadStateLimit
    SecRequestBodyInMemoryLimit SecRuleInheritance
    SecRulePerfTime SecServerSignature SecStreamInBodyInspection
    SecStreamOutBodyInspection SecUnicodeCodePage SecWriteStateLimit
  `),
};

/** Появилось в третьей версии; во второй такого нет. */
const NOT_IN_V2: Table = {
  variable: names(`
    MSC_PCRE_ERROR MSC_PCRE_LIMITS_EXCEEDED MULTIPART_SEMICOLON_MISSING
    REQBODY_PROCESSOR_ERROR REQBODY_PROCESSOR_ERROR_MSG
  `),
  operator: names('rxGlobal verifySVNR'),
  // `t:uppercase` есть в третьей версии и в Coraza; вторая его не знает.
  transform: names('uppercase'),
  action: names(''),
  directive: names(''),
};

/** Операторы Coraza, раскрывающие макросы в аргументе; `@rx` среди них нет. */
const CORAZA_MACROS = names('beginsWith contains endsWith eq ge gt le lt streq strmatch within');

/**
 * Раскроет ли оператор макрос в своём аргументе.
 *
 * `known` — ответ каталога, он записан по ModSecurity. У Coraza список свой
 * и короче: шаблон `@rx` она собирает при загрузке, и `%{tx.word}` в нём
 * остаётся обычными символами.
 */
export function expandsMacros(engine: Engine | undefined, operator: string, known: boolean): boolean {
  return engine === 'coraza' ? CORAZA_MACROS.has(operator.toLowerCase()) : known;
}

/* ------------------------------------------------------------------ */
/* Раскодирование                                                      */
/* ------------------------------------------------------------------ */

export const ENGINES: readonly Engine[] = ['modsecurity2', 'modsecurity3', 'coraza'];

/** Параметры: их раскодирует каждый движок, и `+` у всех становится пробелом. */
const DECODED_EVERYWHERE = names(
  'ARGS ARGS_NAMES ARGS_GET ARGS_GET_NAMES ARGS_POST ARGS_POST_NAMES',
);

/**
 * Путь запроса. ModSecurity 3 и Coraza раскодируют его сразу. Вторая версия
 * берёт его у Apache, а Apache раскодирует путь между первой фазой и второй:
 * в первой `REQUEST_FILENAME` ещё `/p%41th`, со второй — уже `/pAth`.
 */
const DECODED_PATH = names('REQUEST_FILENAME REQUEST_BASENAME');

/**
 * Кто отдаёт переменную уже раскодированной из URL-кодирования (`%41` → `A`).
 *
 * Всё здесь снято со стенда — сценарии `decode-…` и `anchors-…`: справочники
 * об этом молчат, а движки расходятся. `REQUEST_URI` третья версия
 * раскодирует целиком, вместе со строкой параметров (но `+` оставляет), вторая
 * — только путь и только со второй фазы, Coraza не раскодирует вовсе. Как
 * есть отдают все три: `REQUEST_URI_RAW`, `QUERY_STRING`, `REQUEST_LINE`,
 * `REQUEST_BODY`, куки и заголовки. Раскодируют один раз: `%2541` приходит
 * как `%41`; неправильное `%zz` и `%u0041` остаются как были.
 */
export function urlDecodedBy(variable: string, phase: number): Engine[] {
  const key = variable.toLowerCase();
  if (DECODED_EVERYWHERE.has(key)) return [...ENGINES];
  if (DECODED_PATH.has(key)) return phase >= 2 ? [...ENGINES] : ['modsecurity3', 'coraza'];
  if (key === 'request_uri') return phase >= 2 ? ['modsecurity2', 'modsecurity3'] : ['modsecurity3'];
  return [];
}

/**
 * Понимает ли движок это имя.
 *
 * Спрашивать имеет смысл только про имя, которое знает каталог: о
 * незнакомом имени скажет другая проверка, и скажет точнее.
 */
export function engineSupports(engine: Engine, kind: NameKind, name: string): boolean {
  const key = name.toLowerCase();
  if (engine === 'coraza') return CORAZA[kind].has(key);
  if (CORAZA_ONLY[kind].has(key)) return false;
  return !(engine === 'modsecurity3' ? NOT_IN_V3 : NOT_IN_V2)[kind].has(key);
}
