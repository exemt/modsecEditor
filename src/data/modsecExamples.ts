import type { TranslationKey } from '../i18n/translations';

export interface ModsecExample {
  id: string;
  labelKey: TranslationKey;
  code: string;
}

export const modsecExamples: ModsecExample[] = [
  {
    id: 'bad-bot',
    labelKey: 'examples.bad-bot',
    code: `# Блокируем известного зловредного User-Agent
SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\
    "id:1001,phase:1,deny,status:403,msg:'Bad bot detected'"
`,
  },
  {
    id: 'sqli',
    labelKey: 'examples.sqli',
    code: `# Простейшее обнаружение SQL-инъекции в аргументах запроса
SecRule ARGS "@rx (?i:union(.*?)select)" \\
    "id:2001,phase:2,block,t:none,t:lowercase,\\
    msg:'Possible SQL Injection',severity:CRITICAL,tag:'attack-sqli'"
`,
  },
  {
    id: 'xss',
    labelKey: 'examples.xss',
    code: `# Обнаружение попытки XSS через тег <script>
SecRule ARGS|ARGS_NAMES "@rx <script[^>]*>" \\
    "id:3001,phase:2,deny,status:403,t:none,t:htmlEntityDecode,\\
    msg:'XSS attempt',severity:CRITICAL,tag:'attack-xss'"
`,
  },
  {
    id: 'chained',
    labelKey: 'examples.chained',
    code: `# Подозрительный POST в админку мимо доверенных адресов
SecRule REQUEST_FILENAME|REQUEST_URI "@beginsWith /admin" \\
    "id:5001,phase:2,deny,status:403,t:lowercase,t:normalizePath,\\
    msg:'Suspicious admin access',severity:WARNING,tag:'admin',chain"
SecRule REQUEST_METHOD "@streq POST" \\
    "chain"
SecRule REQUEST_HEADERS:X-Forwarded-For|!REQUEST_HEADERS:Host "!@ipMatch 10.0.0.0/8"
`,
  },
  {
    id: 'rate-limit',
    labelKey: 'examples.rate-limit',
    code: `# Считаем запросы по IP и блокируем при превышении лимита
SecAction "id:4000,phase:1,pass,nolog,initcol:ip=%{REMOTE_ADDR}"

SecRule IP:requests "@gt 100" \\
    "id:4001,phase:1,deny,status:429,msg:'Rate limit exceeded'"
`,
  },
];
