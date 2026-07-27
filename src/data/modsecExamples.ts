import type { TranslationKey } from '../i18n/translations';

/**
 * Учебный набор правил.
 *
 * Примеры идут не по алфавиту и не по красоте, а по порядку изучения: от
 * одного правила из трёх частей до накопительной оценки и переходов через
 * блок. Каждый раздел отвечает на свой вопрос — «где стоит проверка»,
 * «что именно проверяем», «как правила связаны друг с другом», — поэтому
 * пример из середины списка можно читать, только прочитав его раздел.
 *
 * Последний раздел устроен наоборот: правила в нём сломаны намеренно. Это
 * не небрежность и не заготовка — панель диагностик умеет объяснять почти
 * все ошибки этого редактора, но проверить это на исправном наборе нельзя.
 */

export const EXAMPLE_SECTIONS = [
  'basics',
  'attacks',
  'policy',
  'logic',
  'state',
  'flow',
  'mistakes',
] as const;

export type ExampleSection = (typeof EXAMPLE_SECTIONS)[number];

export interface ModsecExample {
  id: string;
  section: ExampleSection;
  labelKey: TranslationKey;
  /** Одна строка о том, ради чего пример стоит открыть. */
  noteKey: TranslationKey;
  code: string;
}

export const modsecExamples: ModsecExample[] = [
  /* ---------------------------------------------------------------- */
  /* Основы                                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'first-rule',
    section: 'basics',
    labelKey: 'examples.first-rule',
    noteKey: 'examples.first-rule.note',
    code: `# Правило состоит из трёх частей: что проверяем, чем проверяем и что
# делаем при совпадении. Номер (id) и фаза (phase) обязательны.
SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\
    "id:1001,phase:1,t:lowercase,deny,status:403,\\
    msg:'Bad bot detected',severity:WARNING,tag:'attack-reputation'"
`,
  },
  {
    id: 'phases',
    section: 'basics',
    labelKey: 'examples.phases',
    noteKey: 'examples.phases.note',
    code: `# Фаза — это момент запроса, в который правило смотрит на данные.
# Раньше времени смотреть некуда: в первой фазе тела запроса ещё нет,
# а в третьей уже поздно менять то, что ушло на сервер приложения.

# Фаза 1: заголовки запроса.
SecRule REQUEST_HEADERS:User-Agent "@contains curl/" \\
    "id:1101,phase:1,t:lowercase,pass,log,msg:'Phase 1: headers are here'"

# Фаза 2: разобранные параметры и тело запроса.
SecRule ARGS:comment "@contains http://" \\
    "id:1102,phase:2,t:none,t:urlDecodeUni,t:lowercase,pass,log,\\
    msg:'Phase 2: parameters are parsed'"

# Фаза 3: заголовки ответа.
SecRule RESPONSE_HEADERS:Server "@contains apache" \\
    "id:1103,phase:3,t:lowercase,pass,log,msg:'Phase 3: response headers'"

# Фаза 5: только журнал — прерывать уже нечего.
SecAction \\
    "id:1105,phase:5,pass,nolog,setvar:tx.request_seen=1"
`,
  },
  {
    id: 'targets',
    section: 'basics',
    labelKey: 'examples.targets',
    noteKey: 'examples.targets.note',
    code: `# Области проверки перечисляются через | и это ИЛИ: правило срабатывает,
# как только совпало хотя бы одно значение из перечисленных.
SecRule ARGS:q|ARGS:search|ARGS:query "@contains <script" \\
    "id:1201,phase:2,t:none,t:urlDecodeUni,t:lowercase,\\
    deny,status:403,msg:'Tag in a search field',severity:CRITICAL"

# Восклицательный знак вычитает: вся коллекция, кроме исключений.
# Так делают точечные послабления, не отключая проверку целиком.
SecRule ARGS|!ARGS:csrf_token|!ARGS:signature "@contains union select" \\
    "id:1202,phase:2,t:none,t:urlDecodeUni,t:lowercase,t:compressWhitespace,\\
    block,msg:'SQL keywords outside the token fields',severity:CRITICAL"
`,
  },
  {
    id: 'transforms',
    section: 'basics',
    labelKey: 'examples.transforms',
    noteKey: 'examples.transforms.note',
    code: `# Преобразования применяются по порядку, и порядок здесь важнее списка.
# t:none сбрасывает то, что пришло из SecDefaultAction, дальше сначала
# раскрываем кодирование и только потом сворачиваем путь: /admin/%2e%2e/
# заметит лишь тот конвейер, где urlDecodeUni стоит раньше normalizePath.
SecRule REQUEST_FILENAME "@beginsWith /admin" \\
    "id:1301,phase:1,t:none,t:urlDecodeUni,t:lowercase,t:normalizePath,\\
    deny,status:403,msg:'Admin area',severity:NOTICE,tag:'policy-admin'"
`,
  },
  {
    id: 'logging',
    section: 'basics',
    labelKey: 'examples.logging',
    noteKey: 'examples.logging.note',
    code: `# msg — причина срабатывания, logdata — то, что реально совпало.
# capture раскладывает группы шаблона по TX:1…TX:9, и на любую из них
# можно сослаться в журнале.
SecRule ARGS:redirect_to "@rx ^https?://([^/]+)" \\
    "id:1401,phase:2,capture,t:none,t:urlDecodeUni,t:lowercase,\\
    deny,status:403,msg:'Open redirect attempt',logdata:'Host: %{TX.1}',\\
    severity:CRITICAL,tag:'attack-redirect'"
`,
  },

  /* ---------------------------------------------------------------- */
  /* Атаки                                                             */
  /* ---------------------------------------------------------------- */
  {
    id: 'sqli',
    section: 'attacks',
    labelKey: 'examples.sqli',
    noteKey: 'examples.sqli.note',
    code: `# @detectSQLi — это разборщик SQL, а не шаблон: он видит комментарии,
# склейку строк и другие приёмы, под которые регулярное выражение
# приходится дописывать бесконечно.
SecRule ARGS|ARGS_NAMES|REQUEST_COOKIES "@detectSQLi" \\
    "id:2001,phase:2,t:none,t:utf8toUnicode,t:urlDecodeUni,t:removeNulls,\\
    block,msg:'SQL injection',severity:CRITICAL,tag:'attack-sqli'"
`,
  },
  {
    id: 'xss',
    section: 'attacks',
    labelKey: 'examples.xss',
    noteKey: 'examples.xss.note',
    code: `# Разметку прячут за кодированием, поэтому проверке предшествует целый
# конвейер: сначала снимаем все слои, и только потом ищем скрипт.
SecRule ARGS|ARGS_NAMES|REQUEST_HEADERS:Referer "@detectXSS" \\
    "id:2101,phase:2,t:none,t:utf8toUnicode,t:urlDecodeUni,\\
    t:htmlEntityDecode,t:jsDecode,\\
    block,msg:'XSS attempt',severity:CRITICAL,tag:'attack-xss'"
`,
  },
  {
    id: 'traversal',
    section: 'attacks',
    labelKey: 'examples.traversal',
    noteKey: 'examples.traversal.note',
    code: `# Обход каталога: две точки как отдельный участок пути. Проверяем сырой
# URI — в нормализованном пути этих двух точек уже не будет.
SecRule REQUEST_URI_RAW|ARGS "@rx (?:^|/)\\.\\.(?:/|$)" \\
    "id:2201,phase:2,t:none,t:utf8toUnicode,t:urlDecodeUni,\\
    deny,status:403,msg:'Path traversal',severity:CRITICAL,tag:'attack-lfi'"
`,
  },
  {
    id: 'rce',
    section: 'attacks',
    labelKey: 'examples.rce',
    noteKey: 'examples.rce.note',
    code: `# Список фраз проверяется одним проходом — это дешевле десятка отдельных
# правил. t:cmdLine разбирает приёмы вида c""url и c\\url, которыми
# прячут имя утилиты от простого поиска подстроки.
SecRule ARGS|REQUEST_BODY "@pm /bin/sh /bin/bash wget curl nslookup powershell" \\
    "id:2301,phase:2,t:none,t:urlDecodeUni,t:cmdLine,\\
    deny,status:403,msg:'Command execution attempt',severity:CRITICAL,\\
    tag:'attack-rce'"
`,
  },
  {
    id: 'log4shell',
    section: 'attacks',
    labelKey: 'examples.log4shell',
    noteKey: 'examples.log4shell.note',
    code: `# Log4Shell (CVE-2021-44228): подстановка JNDI в любом текстовом поле.
# Заголовки здесь не менее важны, чем параметры: строку отправляли и
# в User-Agent, и в X-Api-Version.
SecRule REQUEST_HEADERS|ARGS|REQUEST_BODY "@rx \\$\\{jndi:(?:ldaps?|rmi|dns|iiop|nis|corba)://" \\
    "id:2401,phase:2,t:none,t:urlDecodeUni,t:lowercase,\\
    deny,status:403,msg:'JNDI lookup in a request',severity:CRITICAL,\\
    tag:'attack-rce'"
`,
  },
  {
    id: 'wrappers',
    section: 'attacks',
    labelKey: 'examples.wrappers',
    noteKey: 'examples.wrappers.note',
    code: `# Подключение файла подменяют схемой: php:// читает исходники,
# data:// приносит код прямо в параметре.
SecRule ARGS "@rx (?:php|data|expect|zip|glob|phar)://" \\
    "id:2501,phase:2,t:none,t:urlDecodeUni,t:lowercase,\\
    deny,status:403,msg:'PHP stream wrapper in a parameter',\\
    severity:CRITICAL,tag:'attack-lfi'"
`,
  },
  {
    id: 'scanner',
    section: 'attacks',
    labelKey: 'examples.scanner',
    noteKey: 'examples.scanner.note',
    code: `# Сканеры обычно не скрываются и честно пишут своё имя в User-Agent.
# drop рвёт соединение молча — для автоматики это дороже вежливого 403.
SecRule REQUEST_HEADERS:User-Agent "@pm nikto sqlmap nessus acunetix nmap arachni zgrab" \\
    "id:2601,phase:1,t:lowercase,\\
    drop,msg:'Security scanner detected',severity:CRITICAL,\\
    tag:'attack-reputation-scanner'"
`,
  },
  {
    id: 'upload',
    section: 'attacks',
    labelKey: 'examples.upload',
    noteKey: 'examples.upload.note',
    code: `# Разрешительный список: отрицание оператора читается как «ни одно из
# перечисленных расширений не подошло». Так новый вид файла закрыт
# по умолчанию, а не до первого инцидента.
SecRule FILES "!@rx \\.(?:png|jpe?g|gif|pdf|docx?)$" \\
    "id:2701,phase:2,t:lowercase,\\
    deny,status:403,msg:'Unexpected upload type',logdata:'File: %{MATCHED_VAR}',\\
    severity:WARNING,tag:'policy-upload'"
`,
  },

  /* ---------------------------------------------------------------- */
  /* Политика и лимиты                                                 */
  /* ---------------------------------------------------------------- */
  {
    id: 'limits',
    section: 'policy',
    labelKey: 'examples.limits',
    noteKey: 'examples.limits.note',
    code: `# Числовые переменные сравниваются числовыми операторами.
SecRule REQUEST_BODY_LENGTH "@gt 1048576" \\
    "id:3001,phase:2,deny,status:413,msg:'Request body is too large',\\
    severity:WARNING"

SecRule ARGS_COMBINED_SIZE "@gt 65536" \\
    "id:3002,phase:2,deny,status:413,msg:'Parameters are too large',\\
    severity:WARNING"

# У строки числа нет, поэтому длину сначала получают преобразованием —
# после t:length вход становится числом, и оператор тоже числовой.
SecRule ARGS:comment "@gt 4096" \\
    "id:3003,phase:2,t:length,deny,status:413,\\
    msg:'Comment is too long',severity:NOTICE"
`,
  },
  {
    id: 'methods',
    section: 'policy',
    labelKey: 'examples.methods',
    noteKey: 'examples.methods.note',
    code: `# Разрешено то, что перечислено; всё остальное — отказ. Такую политику
# не нужно дописывать при каждом новом методе.
SecRule REQUEST_METHOD "!@within GET HEAD POST OPTIONS" \\
    "id:3101,phase:1,deny,status:405,msg:'Method is not allowed',\\
    severity:WARNING,tag:'policy-method'"

# HTTP/1.0 без Host — почти всегда автоматика, а не браузер.
# Цепочка проверяет оба условия сразу.
SecRule REQUEST_PROTOCOL "@streq HTTP/1.0" \\
    "id:3102,phase:1,chain,deny,status:400,\\
    msg:'HTTP/1.0 request without Host',severity:NOTICE"
SecRule &REQUEST_HEADERS:Host "@eq 0"
`,
  },
  {
    id: 'leak',
    section: 'policy',
    labelKey: 'examples.leak',
    noteKey: 'examples.leak.note',
    code: `# Проверять можно и ответ: страница с ошибкой любит показывать
# трассировку стека вместе с путями и версиями библиотек.
SecRule RESPONSE_STATUS "@eq 500" \\
    "id:3201,phase:4,chain,pass,log,\\
    msg:'Stack trace in an error response',severity:ERROR,tag:'leakage'"
SecRule RESPONSE_BODY "@contains stack trace" \\
    "t:lowercase"
`,
  },

  /* ---------------------------------------------------------------- */
  /* Логика                                                            */
  /* ---------------------------------------------------------------- */
  {
    id: 'chain',
    section: 'logic',
    labelKey: 'examples.chain',
    noteKey: 'examples.chain.note',
    code: `# Цепочка — это И: правило сработает, только если совпали все звенья.
# Номер, фаза и реакция живут в головном звене, остальные только
# проверяют. Последнее звено — без chain, им цепочка и заканчивается.
SecRule REQUEST_FILENAME "@beginsWith /admin" \\
    "id:4001,phase:2,t:lowercase,t:normalizePath,chain,\\
    deny,status:403,msg:'Admin area from an unknown address',\\
    severity:WARNING,tag:'policy-admin'"
SecRule REQUEST_METHOD "@streq POST" \\
    "chain"
SecRule REMOTE_ADDR "!@ipMatch 10.0.0.0/8,192.168.0.0/16"
`,
  },
  {
    id: 'counting',
    section: 'logic',
    labelKey: 'examples.counting',
    noteKey: 'examples.counting.note',
    code: `# Амперсанд перед областью проверки означает «сколько», а не «что».
# Вход становится числом, поэтому преобразования здесь бессмысленны,
# а оператор — числовой.
SecRule &ARGS "@gt 32" \\
    "id:4101,phase:2,deny,status:400,msg:'Too many parameters',\\
    severity:NOTICE"

# Ноль — это «такого заголовка в запросе нет вообще».
SecRule &REQUEST_HEADERS:User-Agent "@eq 0" \\
    "id:4102,phase:1,deny,status:403,msg:'Request without User-Agent',\\
    severity:NOTICE"
`,
  },
  {
    id: 'negation',
    section: 'logic',
    labelKey: 'examples.negation',
    noteKey: 'examples.negation.note',
    code: `# Отрицание бывает двух видов, и путать их дорого.

# Перед оператором — «проверка не совпала»: адрес не из доверенной сети.
SecRule REMOTE_ADDR "!@ipMatch 127.0.0.1,10.0.0.0/8" \\
    "id:4201,phase:1,pass,log,\\
    msg:'Request from outside the trusted network',severity:NOTICE"

# Перед областью проверки — «это не проверять»: коллекция целиком,
# кроме одного параметра, которому ссылка разрешена по делу.
SecRule ARGS|!ARGS:redirect_to "@contains http://" \\
    "id:4202,phase:2,t:none,t:urlDecodeUni,t:lowercase,pass,log,\\
    msg:'A URL in a parameter that should not carry one',severity:NOTICE"
`,
  },

  /* ---------------------------------------------------------------- */
  /* Состояние                                                         */
  /* ---------------------------------------------------------------- */
  {
    id: 'scoring',
    section: 'state',
    labelKey: 'examples.scoring',
    noteKey: 'examples.scoring.note',
    code: `# Так устроен OWASP CRS: отдельное подозрение никого не блокирует, оно
# добавляет баллы в переменную транзакции. Решение принимается один раз,
# когда сумма перевалила через порог, — ложное срабатывание одной
# проверки при этом не стоит клиенту доступа.
SecRule ARGS "@detectSQLi" \\
    "id:5001,phase:2,t:none,t:urlDecodeUni,pass,log,\\
    msg:'SQLi signal',severity:CRITICAL,tag:'attack-sqli',\\
    setvar:tx.anomaly_score=+5"

SecRule ARGS "@detectXSS" \\
    "id:5002,phase:2,t:none,t:urlDecodeUni,t:htmlEntityDecode,pass,log,\\
    msg:'XSS signal',severity:CRITICAL,tag:'attack-xss',\\
    setvar:tx.anomaly_score=+5"

SecRule ARGS_NAMES "@rx ^(?:_|\\$)" \\
    "id:5003,phase:2,t:none,t:urlDecodeUni,pass,log,\\
    msg:'Suspicious parameter name',severity:NOTICE,\\
    setvar:tx.anomaly_score=+2"

SecRule TX:anomaly_score "@ge 10" \\
    "id:5010,phase:2,deny,status:403,\\
    msg:'Inbound anomaly score exceeded',logdata:'Score: %{TX.anomaly_score}',\\
    severity:CRITICAL"
`,
  },
  {
    id: 'rate-limit',
    section: 'state',
    labelKey: 'examples.rate-limit',
    noteKey: 'examples.rate-limit.note',
    code: `# Счётчик живёт между запросами, поэтому коллекцию сначала открывают
# ключом — здесь адресом клиента. expirevar задаёт окно: через минуту
# счётчик обнулится сам.
SecAction \\
    "id:5101,phase:1,pass,nolog,initcol:ip=%{REMOTE_ADDR}"

SecRule REQUEST_FILENAME "@beginsWith /login" \\
    "id:5102,phase:1,pass,nolog,t:lowercase,\\
    setvar:ip.login_attempts=+1,expirevar:ip.login_attempts=60"

SecRule IP:login_attempts "@gt 10" \\
    "id:5103,phase:1,deny,status:429,\\
    msg:'Too many login attempts',logdata:'Attempts: %{IP.login_attempts}',\\
    severity:WARNING,tag:'policy-rate-limit'"
`,
  },

  /* ---------------------------------------------------------------- */
  /* Поток и настройки                                                 */
  /* ---------------------------------------------------------------- */
  {
    id: 'skip-marker',
    section: 'flow',
    labelKey: 'examples.skip-marker',
    noteKey: 'examples.skip-marker.note',
    code: `# Исключение для одного пути удобнее сделать переходом, чем повторять
# отрицание в каждом правиле блока: один раз убедились, что запрос
# доверенный, и перескочили весь блок до метки.
SecRule REQUEST_FILENAME "@beginsWith /webhooks/github" \\
    "id:6001,phase:1,pass,nolog,t:lowercase,skipAfter:END_STRICT_CHECKS"

SecRule REQUEST_HEADERS:Content-Type "!@beginsWith application/json" \\
    "id:6002,phase:1,t:lowercase,deny,status:415,\\
    msg:'Only JSON is accepted here',severity:NOTICE"

SecRule ARGS "@detectSQLi" \\
    "id:6003,phase:2,t:none,t:urlDecodeUni,block,\\
    msg:'SQL injection',severity:CRITICAL,tag:'attack-sqli'"

SecMarker END_STRICT_CHECKS
`,
  },
  {
    id: 'ctl',
    section: 'flow',
    labelKey: 'examples.ctl',
    noteKey: 'examples.ctl.note',
    code: `# ctl меняет поведение движка только для текущего запроса. Так снимают
# одну проверку с одного адреса, не отключая набор правил целиком —
# и не оставляя дыру во всём остальном приложении.
SecRule REQUEST_FILENAME "@beginsWith /api/import" \\
    "id:6101,phase:1,pass,nolog,t:lowercase,\\
    ctl:requestBodyAccess=On,ctl:ruleRemoveTargetById=2001;ARGS:payload"

# Ту же настройку можно задать всему файлу сразу — но тогда она
# действует на каждый запрос, и это уже другое решение.
SecRequestBodyAccess On
SecRequestBodyLimit 13107200
`,
  },

  /* ---------------------------------------------------------------- */
  /* Учебные ошибки                                                    */
  /* ---------------------------------------------------------------- */
  {
    id: 'never-matches',
    section: 'mistakes',
    labelKey: 'examples.never-matches',
    noteKey: 'examples.never-matches.note',
    code: `# Три правила, каждое из которых безупречно по форме и бесполезно
# по смыслу. Панель диагностик внизу объясняет каждое.

# Вход приводится к нижнему регистру, а сравнивается с POST:
# совпадения не будет ни при каком запросе.
SecRule REQUEST_METHOD "@streq POST" \\
    "id:9001,phase:1,t:lowercase,deny,status:405,\\
    msg:'POST is not allowed',severity:WARNING"

# Подсчёт даёт число, а оператор ищет подстроку.
SecRule &ARGS "@contains admin" \\
    "id:9002,phase:2,deny,status:403,msg:'Admin parameter',severity:NOTICE"

# Шаблон подходит к любому значению, включая пустое: это уже не
# проверка, а отказ всем.
SecRule ARGS "@rx .*" \\
    "id:9003,phase:2,deny,status:403,msg:'Suspicious parameter',\\
    severity:NOTICE"
`,
  },
  {
    id: 'mistakes',
    section: 'mistakes',
    labelKey: 'examples.mistakes',
    noteKey: 'examples.mistakes.note',
    code: `# В каждом правиле ровно одна ошибка — из тех, что находятся не при
# чтении, а на разборе инцидента через полгода.

# Порядок конвейера: свернуть путь до раскодирования нельзя, ..%2f
# не похож на ../, пока %2f остаётся тремя символами.
SecRule REQUEST_URI "@contains ../" \\
    "id:9101,phase:1,t:normalizePath,t:urlDecodeUni,\\
    deny,status:403,msg:'Path traversal',severity:CRITICAL"

# Код ответа рядом с drop: соединение рвётся, отдать 403 уже некому.
SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\
    "id:9102,phase:1,t:lowercase,drop,status:403,msg:'Bad bot'"

# Блокируем и молчим: о срабатывании не узнает никто.
SecRule ARGS "@detectSQLi" \\
    "id:9103,phase:2,t:none,t:urlDecodeUni,deny,status:403,nolog,\\
    msg:'SQL injection'"

# Фаза раньше, чем появятся данные: тела ответа в первой фазе нет.
SecRule RESPONSE_BODY "@contains stack trace" \\
    "id:9104,phase:1,t:lowercase,pass,log,msg:'Stack trace'"

# Группа в шаблоне без capture: разбор дороже, а результат никому
# не нужен — здесь достаточно (?:…).
SecRule ARGS "@rx (union|select).{0,40}from" \\
    "id:9105,phase:2,t:none,t:urlDecodeUni,t:lowercase,block,\\
    msg:'SQL keywords',severity:CRITICAL"
`,
  },
  {
    id: 'detection-only',
    section: 'mistakes',
    labelKey: 'examples.detection-only',
    noteKey: 'examples.detection-only.note',
    code: `# Режим наблюдения: правила считаются и пишутся в журнал, но запрос
# не прерывается. Полезно при внедрении набора — и опасно, если про
# него забыли: deny ниже выглядит защитой, которой нет.
SecRuleEngine DetectionOnly

SecRule ARGS|ARGS_NAMES "@detectSQLi" \\
    "id:9201,phase:2,t:none,t:urlDecodeUni,\\
    deny,status:403,msg:'SQL injection',severity:CRITICAL,tag:'attack-sqli'"
`,
  },
];
