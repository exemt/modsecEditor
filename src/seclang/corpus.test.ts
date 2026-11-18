import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { analyzeAll, lintWorkspace, parse, walk } from './index';
import type { FileNode, Node } from './ast';
import type { Engine } from './index';

/**
 * Чужие правила как тест.
 *
 * В папке `corpus` лежат публичные наборы правил в том виде, в каком их
 * выпустили авторы (что и откуда — в `corpus/README.md`). Это не примеры,
 * написанные под парсер, а то, что люди на самом деле загружают в
 * ModSecurity: три поколения OWASP CRS и рекомендованные конфигурации
 * трёх движков. Около двух мегабайт, две с лишним тысячи правил.
 *
 * Проверяется три вещи. Что парсер читает всё это без единой оговорки и
 * его дерево сходится с исходником. Что результат совпадает с независимым
 * от него источником — подсчётом прямо по тексту. И что линтер говорит об
 * этих правилах ровно то, что записано ниже: каждое его замечание здесь
 * разобрано и названо по имени.
 *
 * Раньше была и вторая сверка — с парсером редактора. Её больше нет вместе
 * с ним: редактор читает правила этим же модулем, и сверять стало не с чем.
 */

const CORPUS = join(__dirname, 'corpus');

interface CorpusFile {
  /** Путь внутри набора: `rules/REQUEST-901-INITIALIZATION.conf`. */
  name: string;
  source: string;
}

const isConfig = (name: string) => /\.conf$|\.example$|-recommended$/.test(name);

/**
 * Файлы набора в порядке загрузки: настройка из корня, потом папки с
 * правилами, внутри папки — по имени. Так их подключает и `Include *.conf`.
 */
function configs(directory: string): string[] {
  const entries = readdirSync(directory).sort();
  const isFolder = (entry: string) => statSync(join(directory, entry)).isDirectory();
  return [
    ...entries.filter((entry) => !isFolder(entry) && isConfig(entry)).map((e) => join(directory, e)),
    ...entries.filter(isFolder).flatMap((entry) => configs(join(directory, entry))),
  ];
}

function loadSet(set: string): CorpusFile[] {
  const root = join(CORPUS, set);
  return configs(root).map((path) => ({
    name: relative(root, path).split(sep).join('/'),
    // Файлы хранятся с LF; CRLF может появиться только от настроек git на
    // чужой машине, и номера строк от него не меняются.
    source: readFileSync(path, 'utf8'),
  }));
}

const SETS = readdirSync(CORPUS)
  .filter((entry) => statSync(join(CORPUS, entry)).isDirectory())
  .sort();

/* ------------------------------------------------------------------ */
/* Известные находки линтера                                           */
/* ------------------------------------------------------------------ */

/**
 * Всё, что линтер говорит о корпусе: `файл:строка код`.
 *
 * Каждая запись разобрана руками и оставлена, потому что это правда о
 * чужом правиле, а не промах линтера. Промахи — а их корпус показал
 * несколько — исправлены, и теперь список работает в обе стороны: новое
 * замечание на этих правилах почти наверняка ложное, а пропавшее —
 * проверка, которая перестала работать.
 *
 * Записи сгруппированы по смыслу, а не по порядку файлов: сравниваются
 * они как множество.
 */
const KNOWN: Record<string, string[]> = {
  // Рекомендованные конфигурации включают движок в режиме наблюдения:
  // правила в них уже блокирующие, но до переключения только пишут в журнал.
  'coraza-v3.8.1': ['coraza.conf-recommended:8 engineNotEnforcing'],
  'modsecurity-v2': ['modsecurity.conf-recommended:7 engineNotEnforcing'],
  'modsecurity-v3': ['modsecurity.conf-recommended:7 engineNotEnforcing'],

  'crs-v4.30.0': [
    // Валидаторы с `^…$` там, где в значении бывает перевод строки. В
    // третьей версии и Coraza их обходит лишняя строка: 942200 и соседнее
    // правило проверяют `MATCHED_VARS` (сценарий `anchors-negated-in-chain`),
    // 920275 — заголовки после `t:urlDecodeUni` (`anchors-header-after-decode`).
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:1935 anchorsMatchLines',
    'rules/REQUEST-942-APPLICATION-ATTACK-SQLI.conf:863 anchorsMatchLines',
    'rules/REQUEST-942-APPLICATION-ATTACK-SQLI.conf:1395 anchorsMatchLines',
    // Здесь значения — имена файлов и типы частей тела — на деле в одну
    // строку, но этого линтер знать не может.
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:108 anchorsMatchLines',
    'rules/REQUEST-922-MULTIPART-ATTACK.conf:110 anchorsMatchLines',
    // `!@within HTTP/2 HTTP/2.0 …` ищет протокол внутри строки. Безвредно:
    // протокол клиент выбирает не произвольно.
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:240 withinSubstring',
    // Правило 921160: шаблон ищет `originating-IP` после `t:lowercase`.
    // Заглавных букв во входе уже нет, и эта ветка не совпадёт никогда.
    // В ветке разработки CRS это уже исправлено.
    'rules/REQUEST-921-PROTOCOL-ATTACK.conf:190 caseNeverMatches',
    // Правила 933130 и 933131: `t:normalizePath` стоит раньше
    // `t:urlDecodeUni`, и `..%2f` сворачивать ещё рано.
    'rules/REQUEST-933-APPLICATION-ATTACK-PHP.conf:156 decodeAfterNormalise',
    'rules/REQUEST-933-APPLICATION-ATTACK-PHP.conf:778 decodeAfterNormalise',
    // Метки, на которые сам набор не прыгает: они оставлены для плагинов.
    'rules/REQUEST-949-BLOCKING-EVALUATION.conf:205 unusedMarker',
    'rules/RESPONSE-959-BLOCKING-EVALUATION.conf:135 unusedMarker',
    // `capture` рядом с `@streq` и `@contains`: эти операторы ничего не
    // захватывают ни в одном из трёх движков, и `%{TX.0}` в журнале пуст.
    'rules/REQUEST-921-PROTOCOL-ATTACK.conf:350 captureWithoutRegex',
    'rules/REQUEST-941-APPLICATION-ATTACK-XSS.conf:954 captureWithoutRegex',
    'rules/RESPONSE-955-WEB-SHELLS.conf:431 captureWithoutRegex',
    'rules/RESPONSE-955-WEB-SHELLS.conf:560 captureWithoutRegex',
    // `initcol` без `SecDataDir`: каталог задают в настройке сервера, а её
    // среди файлов набора нет. Совет — один на файл.
    'rules/REQUEST-901-INITIALIZATION.conf:365 persistentWithoutDataDir',
  ],

  'crs-v3.3.10': [
    // Исключения WordPress снимают правила по `ARGS:action` с `^…$`: в
    // третьей версии и Coraza их включает `action=x%0aedit` (сценарий
    // `anchors-exclusion-trigger`). То же в плагине для CRS 4.
    'rules/REQUEST-903.9002-WORDPRESS-EXCLUSION-RULES.conf:196 anchorsMatchLines',
    'rules/REQUEST-903.9002-WORDPRESS-EXCLUSION-RULES.conf:449 anchorsMatchLines',
    'rules/REQUEST-903.9002-WORDPRESS-EXCLUSION-RULES.conf:516 anchorsMatchLines',
    'rules/REQUEST-922-MULTIPART-ATTACK.conf:80 anchorsMatchLines',
    // Исключение 9006240 снимает `ARGS:q` с правила 921151, а то проверяет
    // `ARGS_GET`: не снимается ничего (сценарий `exclusion-args-for-args-get`).
    'rules/REQUEST-903.9006-XENFORO-EXCLUSION-RULES.conf:245 exclusionTargetNotInRule',
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:222 withinSubstring',
    // Исключения для приложений смотрят параметр строки запроса через
    // `ARGS` в первой фазе. Работает, но тело запроса туда ещё не попало.
    'rules/REQUEST-901-INITIALIZATION.conf:360 persistentWithoutDataDir',
    // `@geoLookup` без `SecGeoLookupDb`: база задаётся в настройке сервера.
    'rules/REQUEST-910-IP-REPUTATION.conf:77 geoLookupWithoutDb',
    // Два слэша подряд в шаблоне: Apache отдаёт второй версии движка один,
    // третья версия и Coraza получают оба. `[a-z]:\\\\inetpub` у второй —
    // диск, двоеточие и слэш, у третьей — два слэша; `[\\/]` у второй — одна
    // косая черта. В CRS 4 такие места переписаны через `\x5c`.
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:1658 backslashPair',
    'rules/REQUEST-930-APPLICATION-ATTACK-LFI.conf:53 backslashPair',
    'rules/REQUEST-932-APPLICATION-ATTACK-RCE.conf:236 backslashPair',
    'rules/REQUEST-932-APPLICATION-ATTACK-RCE.conf:275 backslashPair',
    'rules/REQUEST-932-APPLICATION-ATTACK-RCE.conf:616 backslashPair',
    'rules/REQUEST-932-APPLICATION-ATTACK-RCE.conf:697 backslashPair',
    'rules/REQUEST-933-APPLICATION-ATTACK-PHP.conf:47 backslashPair',
    'rules/REQUEST-941-APPLICATION-ATTACK-XSS.conf:206 backslashPair',
    'rules/REQUEST-941-APPLICATION-ATTACK-XSS.conf:786 backslashPair',
    'rules/REQUEST-942-APPLICATION-ATTACK-SQLI.conf:1189 backslashPair',
    'rules/REQUEST-942-APPLICATION-ATTACK-SQLI.conf:827 backslashPair',
    'rules/RESPONSE-954-DATA-LEAKAGES-IIS.conf:24 backslashPair',
    'rules/REQUEST-903.9002-WORDPRESS-EXCLUSION-RULES.conf:111 phasePartial',
    'rules/REQUEST-903.9002-WORDPRESS-EXCLUSION-RULES.conf:140 phasePartial',
    'rules/REQUEST-903.9004-DOKUWIKI-EXCLUSION-RULES.conf:169 phasePartial',
    'rules/REQUEST-903.9006-XENFORO-EXCLUSION-RULES.conf:387 phasePartial',
    // То же правило 921160, что и в четвёртой версии.
    'rules/REQUEST-921-PROTOCOL-ATTACK.conf:175 caseNeverMatches',
    // `t:cmdLine` сам приводит к нижнему регистру.
    'rules/REQUEST-932-APPLICATION-ATTACK-RCE.conf:314 redundantTransform',
    'rules/REQUEST-932-APPLICATION-ATTACK-RCE.conf:486 redundantTransform',
    'rules/REQUEST-933-APPLICATION-ATTACK-PHP.conf:147 decodeAfterNormalise',
    'rules/REQUEST-933-APPLICATION-ATTACK-PHP.conf:587 decodeAfterNormalise',
    // Правила 920500 и 921190 пишут в журнал `%{TX.0}`, а `capture` в них
    // нет. В четвёртой версии это исправлено.
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:1070 captureMissing',
    'rules/REQUEST-921-PROTOCOL-ATTACK.conf:208 captureMissing',
    // Правило 920220 проверяет кодирование в `REQUEST_URI`, а его третья
    // версия раскодирует целиком, вторая — путь со второй фазы. Верное `%25`
    // там становится голым `%` и правило срабатывает (стенд,
    // `decode-validate-uri…`). В четвёртой версии правила нет.
    'rules/REQUEST-920-PROTOCOL-ENFORCEMENT.conf:372 validateDecodedInput',
    // Необязательные настройки: выставляют их в `crs-setup.conf`, где эти
    // строки закомментированы. Пока их не включили, читать нечего.
    'rules/REQUEST-910-IP-REPUTATION.conf:61 txNeverSet',
    'rules/REQUEST-910-IP-REPUTATION.conf:181 txNeverSet',
    'rules/REQUEST-910-IP-REPUTATION.conf:205 txNeverSet',
    'rules/REQUEST-910-IP-REPUTATION.conf:229 txNeverSet',
    'rules/REQUEST-910-IP-REPUTATION.conf:253 txNeverSet',
    'rules/REQUEST-912-DOS-PROTECTION.conf:204 txNeverSet',
    'rules/REQUEST-912-DOS-PROTECTION.conf:221 txNeverSet',
    'rules/REQUEST-912-DOS-PROTECTION.conf:265 txNeverSet',
    'rules/REQUEST-903.9003-NEXTCLOUD-EXCLUSION-RULES.conf:414 unusedMarker',
    // Одно и то же исключение записано в правиле дважды.
    'rules/REQUEST-903.9002-WORDPRESS-EXCLUSION-RULES.conf:368 exclusionDuplicate',
    // Защита от перегрузки рвёт соединение молча: ни сообщения, ни записи.
    'rules/REQUEST-912-DOS-PROTECTION.conf:135 blockWithoutMsg',
    'rules/REQUEST-912-DOS-PROTECTION.conf:137 blockWithoutLog',
  ],

  'crs-v2.2.9': [
    // 981087: `!@within HEAD GET POST …` пропустит метод `ET`.
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:38 withinSubstring',
    // Ловушка `DEBUG=false`: без параметра правило молчит — и так задумано.
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.9_honeytrap.conf:16 negatedOnMissing',
    // `!REQUEST_COOKIES:/__utm/` перечислен дважды.
    'base_rules/modsecurity_crs_41_sql_injection_attacks.conf:157 duplicateTarget',
    // Два `t:none` в одном списке действий.
    'base_rules/modsecurity_crs_42_tight_security.conf:20 duplicateTransform',
    'base_rules/modsecurity_crs_47_common_exceptions.conf:26 duplicateTransform',
    'experimental_rules/modsecurity_crs_11_brute_force.conf:54 duplicateTransform',
    'experimental_rules/modsecurity_crs_11_dos_protection.conf:37 duplicateTransform',
    // Лишний `chain` в конце правила 981063 пристёгивает к его цепочке
    // правило 981064 целиком — с номером, фазой и реакцией. Единственные
    // ошибки на весь корпус, и ошибки настоящие.
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:51 chainLinkHeadAction',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:51 chainLinkHeadAction',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:51 chainLinkHeadAction',
    // `tx.hpp_data` читает правило из `crs_20`, а собирает её правило из
    // `crs_40` — в той же фазе, но ниже. К чтению она ещё пуста.
    'base_rules/modsecurity_crs_20_protocol_violations.conf:537 txReadBeforeSet',
    // То же, что 920220 в третьей версии: кодирование проверяется в
    // `REQUEST_URI`, который к этому времени уже раскодирован.
    'base_rules/modsecurity_crs_20_protocol_violations.conf:462 validateDecodedInput',
    // `%{TX.0}` без `capture`: в журнал и в переменные уходит то, что
    // захватило какое-то правило выше.
    'base_rules/modsecurity_crs_40_generic_attacks.conf:236 captureMissing',
    'base_rules/modsecurity_crs_41_sql_injection_attacks.conf:108 groupFromEarlierRule',
    'experimental_rules/modsecurity_crs_25_cc_track_pan.conf:15 captureMissing',
    'experimental_rules/modsecurity_crs_25_cc_track_pan.conf:18 captureMissing',
    'experimental_rules/modsecurity_crs_25_cc_track_pan.conf:21 captureMissing',
    'experimental_rules/modsecurity_crs_48_bayes_analysis.conf:15 groupFromEarlierRule',
    'experimental_rules/modsecurity_crs_55_response_profiling.conf:22 groupFromEarlierRule',
    'experimental_rules/modsecurity_crs_55_response_profiling.conf:23 groupFromEarlierRule',
    'experimental_rules/modsecurity_crs_55_response_profiling.conf:24 groupFromEarlierRule',
    'experimental_rules/modsecurity_crs_55_response_profiling.conf:25 groupFromEarlierRule',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:25 captureMissing',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:35 groupFromEarlierRule',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:36 groupFromEarlierRule',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:37 groupFromEarlierRule',
    'optional_rules/modsecurity_crs_42_comment_spam.conf:42 captureMissing',
    'optional_rules/modsecurity_crs_46_av_scanning.conf:17 groupFromEarlierRule',
    // Переменные, которые кладут сценарии на Lua и внешние программы:
    // в файлах правил записи действительно нет.
    'base_rules/modsecurity_crs_49_inbound_blocking.conf:20 variableNeverSet',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:46 variableNeverSet',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:54 variableNeverSet',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:56 variableNeverSet',
    'experimental_rules/modsecurity_crs_46_scanner_integration.conf:20 variableNeverSet',
    'experimental_rules/modsecurity_crs_46_scanner_integration.conf:24 variableNeverSet',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:29 variableNeverSet',
    // Шаблон «что угодно» как способ спросить, есть ли такая переменная
    // вообще: `SecRule TX:/^\d+-/ "(.*)"`. Приём, но проверкой его не назвать.
    'base_rules/modsecurity_crs_49_inbound_blocking.conf:29 matchesEverything',
    'base_rules/modsecurity_crs_59_outbound_blocking.conf:26 matchesEverything',
    'experimental_rules/modsecurity_crs_11_brute_force.conf:39 matchesEverything',
    'experimental_rules/modsecurity_crs_48_bayes_analysis.conf:13 matchesEverything',
    'experimental_rules/modsecurity_crs_61_ip_forensics.conf:23 matchesEverything',
    // Метки, расставленные «на будущее»: переходов на них нет.
    'base_rules/modsecurity_crs_21_protocol_anomalies.conf:26 unusedMarker',
    'base_rules/modsecurity_crs_21_protocol_anomalies.conf:44 unusedMarker',
    'base_rules/modsecurity_crs_21_protocol_anomalies.conf:63 unusedMarker',
    'base_rules/modsecurity_crs_35_bad_robots.conf:29 unusedMarker',
    'base_rules/modsecurity_crs_40_generic_attacks.conf:198 unusedMarker',
    'base_rules/modsecurity_crs_40_generic_attacks.conf:207 unusedMarker',
    'base_rules/modsecurity_crs_40_generic_attacks.conf:215 unusedMarker',
    'base_rules/modsecurity_crs_40_generic_attacks.conf:223 unusedMarker',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:22 unusedMarker',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:66 unusedMarker',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:72 unusedMarker',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:126 unusedMarker',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_3.0_end.conf:11 unusedMarker',
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:22 unusedMarker',
    // Действие записано дважды: `logdata`, `nolog`, `capture`.
    'base_rules/modsecurity_crs_30_http_policy.conf:31 duplicateAction',
    'base_rules/modsecurity_crs_41_sql_injection_attacks.conf:91 duplicateAction',
    'base_rules/modsecurity_crs_50_outbound.conf:62 duplicateAction',
    // `!REQUEST_HEADERS:via` вычитается из списка, в котором заголовков нет.
    'base_rules/modsecurity_crs_41_sql_injection_attacks.conf:139 excludeWithoutBase',
    'experimental_rules/modsecurity_crs_11_brute_force.conf:28 blockWithoutMsg',
    'experimental_rules/modsecurity_crs_11_brute_force.conf:28 blockWithoutLog',
    'experimental_rules/modsecurity_crs_11_dos_protection.conf:16 blockWithoutMsg',
    'experimental_rules/modsecurity_crs_11_dos_protection.conf:16 blockWithoutLog',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.1_request_exception.conf:46 captureWithoutRegex',
    // Следствие того же лишнего `chain`: в склеенной цепочке два одинаковых звена.
    'optional_rules/modsecurity_crs_16_session_hijacking.conf:51 duplicateCondition',
    // `status:404` рядом с `pass`: отвечать этим кодом некому.
    'optional_rules/modsecurity_crs_42_comment_spam.conf:31 statusWithoutBlock',
    // Счётчик аномалий растёт в голове цепочки — то есть и тогда, когда
    // остальные звенья не совпали. В CRS 3 такие `setvar` перенесены в
    // последнее звено. У 981036 и 981044 это задумано: считаются запросы,
    // пришедшие во время блокировки.
    'base_rules/modsecurity_crs_20_protocol_violations.conf:430 setvarInChainHead',
    'experimental_rules/modsecurity_crs_11_brute_force.conf:23 setvarInChainHead',
    'experimental_rules/modsecurity_crs_11_dos_protection.conf:11 setvarInChainHead',
    'experimental_rules/modsecurity_crs_40_http_parameter_pollution.conf:36 setvarInChainHead',
    'optional_rules/modsecurity_crs_42_comment_spam.conf:31 setvarInChainHead',
    'experimental_rules/modsecurity_crs_40_appsensor_detection_point_2.0_setup.conf:35 persistentWithoutDataDir',
    'modsecurity_crs_10_setup.conf.example:421 persistentWithoutDataDir',
    'optional_rules/modsecurity_crs_55_application_defects.conf:169 persistentWithoutDataDir',
    'base_rules/modsecurity_crs_35_bad_robots.conf:28 backslashPair',
    'base_rules/modsecurity_crs_40_generic_attacks.conf:220 backslashPair',
    'base_rules/modsecurity_crs_41_sql_injection_attacks.conf:237 backslashPair',
    'base_rules/modsecurity_crs_41_sql_injection_attacks.conf:49 backslashPair',
    'base_rules/modsecurity_crs_41_xss_attacks.conf:504 backslashPair',
    'base_rules/modsecurity_crs_41_xss_attacks.conf:514 backslashPair',
    'base_rules/modsecurity_crs_50_outbound.conf:48 backslashPair',
    // Список действий без кавычек: так умеет только вторая версия движка —
    // под неё этот набор и писался. Третья версия и Coraza такое не грузят.
    'base_rules/modsecurity_crs_49_inbound_blocking.conf:20 unquotedArgument',
    'base_rules/modsecurity_crs_49_inbound_blocking.conf:27 unquotedArgument',
    'base_rules/modsecurity_crs_49_inbound_blocking.conf:28 unquotedArgument',
    'base_rules/modsecurity_crs_59_outbound_blocking.conf:25 unquotedArgument',
    'optional_rules/modsecurity_crs_42_comment_spam.conf:38 unquotedArgument',
    // Звено без списка действий, а следующая строка не пуста: третья версия
    // прочитала бы её как недостающие действия.
    'experimental_rules/modsecurity_crs_11_brute_force.conf:40 linkWithoutActions',
    // `setvar:'tx.hpp_data=%{tx.hpp_data},%{tx.2}'`: запятая внутри кавычек —
    // третья версия оборвала бы действие на ней.
    'experimental_rules/modsecurity_crs_40_http_parameter_pollution.conf:41 suspiciousActionValue',
  ],

  'crs-wordpress-plugin': [
    // Те же исключения по `ARGS:action` и `ARGS:rest_route`, что в CRS 3.
    'plugins/wordpress-rule-exclusions-before.conf:186 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:350 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:433 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:713 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:728 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:922 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:976 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:1019 anchorsMatchLines',
    'plugins/wordpress-rule-exclusions-before.conf:1416 anchorsMatchLines',
    // `ctl:ruleRemoveTargetById=930121;REQUEST_HEADERS:Referer`: третья
    // версия сравнивает имя буква в букву, а по HTTP/2 заголовок приходит
    // как `referer`.
    'plugins/wordpress-rule-exclusions-before.conf:808 exclusionCtlHeaderCase',
    'plugins/wordpress-rule-exclusions-before.conf:292 phasePartial',
    'plugins/wordpress-rule-exclusions-before.conf:707 phasePartial',
    // Плагин включают переменной из своего файла настройки, где эта строка
    // закомментирована.
    'plugins/wordpress-rule-exclusions-before.conf:20 txNeverSet',
  ],
};

/**
 * Замечания о записи шаблона — числом, а не поимённо.
 *
 * `^POST$` вместо `@streq POST`, захватывающая группа без `capture`,
 * вложенные кванторы: таких в CRS десятки, они однотипны, и список из них
 * заслонил бы всё остальное. Число при этом ловит то же самое: проверка,
 * которая начала срабатывать чаще или реже, изменит его.
 */
const COUNTED = new Set([
  'anchoredLiteralRegex',
  'multibyteInClass',
  'captureUnused',
  'capturingGroupUnused',
  'exclusionTooBroad',
  'noNormalisation',
  'possibleRedos',
  'rblOnHotPath',
  'redundantLeadingWildcard',
  'regexIsPlainText',
  'singlePhraseList',
  'xmlWithoutProcessor',
]);

const KNOWN_COUNTS: Record<string, Record<string, number>> = {
  'crs-v4.30.0': {
    anchoredLiteralRegex: 4,
    captureUnused: 2,
    capturingGroupUnused: 1,
    exclusionTooBroad: 3,
    noNormalisation: 1,
    possibleRedos: 6,
    redundantLeadingWildcard: 3,
    regexIsPlainText: 5,
    singlePhraseList: 1,
    // `XML:/*` читают десятки правил, а обработчик XML включает правило из
    // `modsecurity.conf`, которого в наборе нет: по разу на файл.
    xmlWithoutProcessor: 10,
  },
  'crs-v3.3.10': {
    anchoredLiteralRegex: 6,
    captureUnused: 4,
    // `[\"'`´’‘]` в правилах 942: для ModSecurity это класс из шести байтов,
    // и «—» считается в нём двумя спецсимволами. В CRS 4 этих знаков нет.
    multibyteInClass: 5,
    capturingGroupUnused: 1,
    exclusionTooBroad: 7,
    // Исключения для приложений сравнивают путь буквально и без
    // преобразований: `REQUEST_FILENAME "@endsWith /wp-admin/…"`.
    noNormalisation: 6,
    possibleRedos: 9,
    rblOnHotPath: 1,
    redundantLeadingWildcard: 3,
    regexIsPlainText: 2,
    singlePhraseList: 3,
    xmlWithoutProcessor: 9,
  },
  'crs-v2.2.9': {
    anchoredLiteralRegex: 9,
    // `captureUnused` здесь нет, и не потому, что лишних `capture` в наборе
    // нет: ниже них стоят правила, которые читают `%{TX.0}`, сами его не
    // заполняя, — так что сказать «группы никто не читает» было бы неправдой.
    capturingGroupUnused: 17,
    // Те же `´’‘` в классах правил SQL-инъекций.
    multibyteInClass: 16,
    noNormalisation: 6,
    possibleRedos: 5,
    rblOnHotPath: 1,
    redundantLeadingWildcard: 1,
    regexIsPlainText: 5,
    singlePhraseList: 1,
  },
  'crs-wordpress-plugin': {
    exclusionTooBroad: 1,
  },
};

/**
 * Чего в наборе не поймёт каждый из движков: `род:имя` и сколько раз.
 *
 * Таблица проверяет не столько наборы, сколько сами сведения о движках
 * (`engines.ts`). Рекомендованная конфигурация движка обязана проходить
 * для него без замечаний, а CRS 4 — для всех трёх: он под них и написан.
 * Если здесь появилась строка, которой быть не должно, врёт таблица.
 *
 * Чего нет в списке, того в наборе для этого движка не найдено.
 */
/** Коды из `KNOWN`, которые без названного движка выдаются ошибками. */
const ERRORS = ['chainLinkHeadAction', 'unquotedArgument'];

const NOT_IN_ENGINE: Record<string, Partial<Record<Engine, Record<string, number>>>> = {
  'coraza-v3.8.1': {
    // Собственные имена Coraza: ModSecurity их не знает ни в одной версии.
    modsecurity2: {
      'Directive:SecRxPreFilter': 1,
      'Directive:SecResponseBodyJsonDepthLimit': 1,
      'Variable:URI_PARSE_ERROR': 1,
      'Variable:ARGUMENTS_LIMIT_REACHED': 2,
    },
    modsecurity3: {
      'Directive:SecRxPreFilter': 1,
      'Directive:SecResponseBodyJsonDepthLimit': 1,
      'Variable:URI_PARSE_ERROR': 1,
      'Variable:ARGUMENTS_LIMIT_REACHED': 2,
      // «As of ModSecurity version 3.0, SecRequestBodyInMemoryLimit is no
      // longer supported» — и это не предупреждение, а отказ загрузиться.
      'Directive:SecRequestBodyInMemoryLimit': 1,
    },
  },
  // У Coraza эта директива называется `SecUnicodeMap`.
  'modsecurity-v2': {
    modsecurity3: { 'Directive:SecRequestBodyInMemoryLimit': 1 },
    coraza: { 'Directive:SecUnicodeMapFile': 1, 'Directive:SecStatusEngine': 1 },
  },
  'modsecurity-v3': {
    coraza: { 'Directive:SecUnicodeMapFile': 1, 'Directive:SecStatusEngine': 1 },
  },
  // Вторая версия CRS писалась под вторую версию движка — и только под неё.
  'crs-v2.2.9': {
    modsecurity3: {
      'Action:append': 1,
      'Action:sanitiseMatched': 7,
      'Directive:SecContentInjection': 1,
      'Directive:SecReadStateLimit': 1,
      'Operator:rsub': 1,
      'Variable:STREAM_OUTPUT_BODY': 1,
      'Variable:WEBSERVER_ERROR_LOG': 1,
      // Блоки Apache в файле правил: у третьей версии и Coraza разбор свой.
      'Apache block:IfModule': 1,
      'Apache block:LocationMatch': 1,
    },
    coraza: {
      'Action:append': 1,
      'Action:sanitiseMatched': 7,
      'Action:setsid': 2,
      'Action:setuid': 1,
      'Directive:SecContentInjection': 1,
      'Directive:SecGeoLookupDb': 2,
      'Directive:SecReadStateLimit': 1,
      'Operator:containsWord': 11,
      'Operator:rsub': 1,
      'Operator:verifyCC': 16,
      'Variable:GLOBAL': 25,
      'Variable:RESOURCE': 24,
      'Variable:SESSION': 9,
      'Variable:STREAM_OUTPUT_BODY': 1,
      'Variable:WEBSERVER_ERROR_LOG': 1,
      'Variable:MULTIPART_SEMICOLON_MISSING': 1,
      'Apache block:IfModule': 1,
      'Apache block:LocationMatch': 1,
      // Долгоживущих коллекций у Coraza нет: ни прочитать, ни записать — и
      // макрос с такой переменной она тоже не грузит.
      'Variable:IP': 20,
      'Writing to collection:global': 24,
      'Writing to collection:ip': 21,
      'Writing to collection:resource': 11,
      'Writing to collection:session': 5,
      // `exec` с путём к программе Coraza не принимает.
      'Action:exec': 5,
    },
  },
  // Защита от DoS в CRS 3 считает запросы в коллекции `IP`; в CRS 4 этих
  // правил уже нет.
  'crs-v3.3.10': {
    coraza: { 'Variable:IP': 18, 'Writing to collection:ip': 36 },
  },
};

/**
 * Сколько шаблонов набора не соберётся в Coraza: в регулярных выражениях
 * Go нет просмотров, обратных ссылок и запрета возврата. В CRS 4 таких
 * шаблонов нет вовсе — его нарочно переписали под RE2.
 */
const REGEX_NOT_IN_CORAZA: Record<string, number> = {
  // К прежним добавился `\Z` в шаблоне SQL-инъекций: в RE2 такого якоря нет.
  'crs-v2.2.9': 22,
  'crs-v3.3.10': 5,
  // `SecAuditLogRelevantStatus "^(?:5|4(?!04))"` из рекомендованной
  // конфигурации ModSecurity: просмотра вперёд в RE2 нет. У Coraza в своей
  // конфигурации тот же шаблон записан без него.
  'modsecurity-v2': 1,
  'modsecurity-v3': 1,
};

const ENGINES: Engine[] = ['modsecurity2', 'modsecurity3', 'coraza'];

/* ------------------------------------------------------------------ */
/* Независимый подсчёт по тексту                                       */
/* ------------------------------------------------------------------ */

/**
 * Что в файле написано — по самому тексту, без парсера.
 *
 * Строки склеиваются по переносу, и у каждой смотрится только первое
 * слово. Этого мало, чтобы разобрать правило, но достаточно, чтобы
 * пересчитать утверждения — а счёт, полученный двумя разными способами,
 * сходится только если оба верны.
 */
function logicalLines(source: string): string[] {
  const lines = source.split('\n');
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let logical = lines[i].replace(/\r$/, '');
    while (/(?:^|[^\\])(?:\\\\)*\\$/.test(logical) && i + 1 < lines.length) {
      logical = logical.slice(0, -1) + lines[++i].replace(/\r$/, '');
    }
    if (logical.trim() !== '') result.push(logical.trim());
  }
  return result;
}

function countByText(source: string): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const text of logicalLines(source)) {
    const word = text.startsWith('#') ? '#' : /^\S+/.exec(text)![0].replace(/"/g, '').toLowerCase();
    const kind =
      word === '#'
        ? 'Comment'
        : word === 'secrule'
          ? 'SecRule'
          : word === 'secaction'
            ? 'SecAction'
            : word === 'secrulescript'
              ? 'SecRuleScript'
            : word === 'secdefaultaction'
              ? 'SecDefaultAction'
              : word === 'secmarker'
                ? 'SecMarker'
                : /^secrule(?:remove|update(?:target|action))by(?:id|msg|tag)$/.test(word)
                  ? 'Exclusion'
                  : 'Directive';
    counts[kind] = (counts[kind] ?? 0) + 1;
  }
  return counts;
}

function countByTree(file: FileNode): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const statement of file.statements) {
    counts[statement.kind] = (counts[statement.kind] ?? 0) + 1;
  }
  return counts;
}

/**
 * Номера правил по тексту: всё, что записано как действие `id`.
 *
 * Комментарий берётся целиком, со строками-продолжениями: в настройке
 * CRS 2.2.9 закомментирована только первая строка правила (`#SecAction \`),
 * а остальные идут без решётки — и всё равно остаются комментарием.
 */
function idsByText(source: string): string[] {
  const found: string[] = [];
  for (const line of logicalLines(source)) {
    if (line.startsWith('#')) continue;
    for (const match of line.matchAll(/(?:^|[\s",])id:\s*'?(\d+)'?(?=[\s",\\]|$)/g)) {
      found.push(match[1]);
    }
  }
  return found;
}

function idsByTree(file: FileNode): string[] {
  const found: string[] = [];
  walk(file, (node) => {
    if (node.kind === 'Action' && node.name === 'id' && node.value !== null) {
      found.push(node.value.value);
    }
  });
  return found;
}

/* ------------------------------------------------------------------ */
/* Дерево против исходника                                             */
/* ------------------------------------------------------------------ */

/** Нарушения в дереве файла; пусто — дерево сходится с исходником. */
function treeProblems(file: FileNode): string[] {
  const { source } = file;
  const problems: string[] = [];
  const text = (node: { start: number; end: number }) => source.slice(node.start, node.end);
  const fail = (node: Node, what: string) =>
    problems.push(`${node.kind}@${node.start}: ${what}: «${text(node).slice(0, 50)}»`);

  let previousEnd = -1;
  let previousParent: Node | null = null;

  walk(file, (node, parent) => {
    if (node.start > node.end) fail(node, 'начало после конца');
    if (parent !== null) {
      if (node.start < parent.start || node.end > parent.end) fail(node, 'выходит за родителя');
      if (parent === previousParent && node.start < previousEnd) fail(node, 'налезает на соседа');
    }
    previousEnd = node.end;
    previousParent = parent;

    switch (node.kind) {
      case 'SecRule':
        if (node.variables === null || node.variables.items.length === 0) fail(node, 'нет областей');
        if (node.operator === null) fail(node, 'нет оператора');
        if (source.slice(node.start, node.nameEnd) !== node.name) fail(node, 'имя директивы');
        break;
      case 'Variable':
        if (source.slice(node.nameStart, node.nameEnd) !== node.name) fail(node, 'имя переменной');
        if (!/^[!&]{0,2}[A-Za-z_]/.test(text(node))) fail(node, 'начало терма');
        break;
      case 'Operator':
        if (!node.implicit && source.slice(node.nameStart, node.nameEnd) !== `@${node.name}`) {
          fail(node, 'имя оператора');
        }
        break;
      case 'Action':
      case 'Transform':
      case 'Setvar':
      case 'Ctl':
        if (source.slice(node.nameStart, node.nameEnd) !== node.name) fail(node, 'имя действия');
        if (!/^[A-Za-z]+$/.test(node.name)) fail(node, 'странное имя действия');
        if (node.kind === 'Transform' && !/^[A-Za-z0-9]+$/.test(node.transform)) {
          fail(node, 'имя преобразования');
        }
        break;
      case 'Macro':
        if (!text(node).startsWith('%{') || !text(node).endsWith('}')) fail(node, 'границы макроса');
        break;
      default:
        break;
    }
  });

  return problems;
}

/** Сводка по файлу: по ней видно, что разбор изменился, даже если тесты выше прошли. */
function summary(file: FileNode): string {
  const kinds: Record<string, number> = {};
  walk(file, (node) => {
    kinds[node.kind] = (kinds[node.kind] ?? 0) + 1;
  });
  const order = [
    'SecRule',
    'SecAction',
    'SecRuleScript',
    'SecMarker',
    'SecDefaultAction',
    'Exclusion',
    'Directive',
    'Comment',
    'Variable',
    'Selector',
    'Action',
    'Transform',
    'Setvar',
    'Ctl',
    'Macro',
  ];
  return order
    .filter((kind) => kinds[kind] !== undefined)
    .map((kind) => `${kind} ${kinds[kind]}`)
    .join(', ');
}

/* ------------------------------------------------------------------ */

describe('корпус', () => {
  it('у каждого набора записано, что о нём говорит линтер', () => {
    expect(Object.keys(KNOWN).sort()).toEqual(SETS);
  });
});

describe.each(SETS)('корпус: %s', (set) => {
  const files = loadSet(set);
  const trees = files.map((file) => parse(file.source));

  it('состоит из файлов с правилами', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const tree of trees) expect(tree.statements.length).toBeGreaterThan(0);
  });

  it('ни один шаблон не объявлен некорректным', () => {
    // В корпусе тысячи шаблонов, и все они рабочие: движок их принимает.
    // Любое «некорректно» здесь — промах перевода из PCRE, а не правила.
    const invalid = lintWorkspace(files, { only: ['invalidRegex', 'invalidSelectorPattern'] });
    expect(invalid.flatMap((file) => file.diagnostics.map((d) => `${file.name}:${d.line}`))).toEqual(
      [],
    );
  });

  it('парсер читает его без оговорок', () => {
    const issues = trees.flatMap((tree, index) =>
      tree.issues.map((issue) => `${files[index].name}@${issue.start} ${issue.code}`),
    );
    expect(issues).toEqual([]);
  });

  it('дерево сходится с исходником', () => {
    const problems = trees.flatMap((tree, index) =>
      treeProblems(tree).map((problem) => `${files[index].name}: ${problem}`),
    );
    expect(problems).toEqual([]);
  });

  it('утверждений каждого вида столько же, сколько в тексте', () => {
    for (let i = 0; i < files.length; i++) {
      expect({ file: files[i].name, ...countByTree(trees[i]) }).toEqual({
        file: files[i].name,
        ...countByText(files[i].source),
      });
    }
  });

  it('номера правил те же, что в тексте', () => {
    for (let i = 0; i < files.length; i++) {
      expect({ file: files[i].name, ids: idsByTree(trees[i]) }).toEqual({
        file: files[i].name,
        ids: idsByText(files[i].source),
      });
    }
  });

  it('цепочки собраны: звеньев столько, сколько объявлено', () => {
    const models = analyzeAll(trees);
    for (let i = 0; i < files.length; i++) {
      let declared = 0;
      walk(trees[i], (node) => {
        if (node.kind === 'Action' && node.name === 'chain') declared++;
      });
      const links = models[i].rules.reduce(
        (total, rule) => total + Math.max(0, rule.conditions.length - 1),
        0,
      );
      const dangling = models[i].rules.filter((rule) => rule.dangling).length;
      expect({ file: files[i].name, links: links + dangling }).toEqual({
        file: files[i].name,
        links: declared,
      });
    }
  });

  it('состав дерева не изменился', () => {
    expect(files.map((file, index) => `${file.name}: ${summary(trees[index])}`)).toMatchSnapshot();
  });

  it('линтер говорит о нём только то, что записано', () => {
    const found: string[] = [];
    const counts: Record<string, number> = {};
    for (const { name, diagnostics } of lintWorkspace(files)) {
      for (const d of diagnostics) {
        if (COUNTED.has(d.code)) counts[d.code] = (counts[d.code] ?? 0) + 1;
        else found.push(`${name}:${d.line} ${d.code}`);
      }
    }
    expect(found.sort()).toEqual([...KNOWN[set]].sort());
    expect(counts).toEqual(KNOWN_COUNTS[set] ?? {});
  });

  it('ошибок нет нигде, кроме известных', () => {
    const errors = lintWorkspace(files).flatMap(({ name, diagnostics }) =>
      diagnostics.filter((d) => d.severity === 'error').map((d) => `${name}:${d.line} ${d.code}`),
    );
    // Движок не назван — ошибкой считается то, что не грузят хотя бы два
    // движка из трёх. У набора, написанного под один движок, такое есть.
    const known = KNOWN[set].filter((entry) => ERRORS.some((code) => entry.endsWith(` ${code}`)));
    expect(errors.sort()).toEqual(known.sort());
  });

  it.each(ENGINES)('для %s не хватает только того, что записано', (engine) => {
    const names: Record<string, number> = {};
    let patterns = 0;
    const only = ['notInEngine', 'regexNotInEngine'] as const;
    for (const { diagnostics } of lintWorkspace(files, { engine, only })) {
      for (const d of diagnostics) {
        if (d.code === 'regexNotInEngine') {
          patterns++;
        } else {
          const key = `${d.data?.kind}:${d.data?.name}`;
          names[key] = (names[key] ?? 0) + 1;
        }
      }
    }
    expect(names).toEqual(NOT_IN_ENGINE[set]?.[engine] ?? {});
    expect(patterns).toBe(engine === 'coraza' ? (REGEX_NOT_IN_CORAZA[set] ?? 0) : 0);
  });

  it('проверка всего набора укладывается в разумное время', () => {
    // Указатели набора сопоставляют записи и чтения между файлами; порог
    // ловит не замедление, а сопоставление, ставшее квадратичным.
    const started = performance.now();
    lintWorkspace(files);
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
