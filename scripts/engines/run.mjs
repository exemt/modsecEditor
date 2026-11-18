#!/usr/bin/env node
/**
 * Стенд: линтер против настоящих движков.
 *
 *     node scripts/engines/run.mjs load        # что движки отказываются загружать
 *     node scripts/engines/run.mjs behaviour   # как они ведут себя на запросе
 *     node scripts/engines/run.mjs all --write # всё вместе, с записью вердиктов
 *
 * Всё, что линтер утверждает о движке, взято из его исходников. Стенд
 * проверяет, что прочитано верно: те же правила отдаются ModSecurity 2
 * (Apache), ModSecurity 3 (nginx) и Coraza, и их ответ сравнивается с тем,
 * что предсказал линтер.
 *
 * Нужен Docker. Образы: `owasp/modsecurity-crs:apache`, `…:nginx` и
 * `golang` — в нём из `coraza/main.go` собирается загрузчик на библиотеке
 * Coraza. С ключом `--write` вердикты движков записываются в
 * `src/seclang/stand/verdicts.json`: по ним `stand.test.ts` сверяет линтер
 * уже без Docker.
 *
 * Вердикт о блоке правил хранится по отпечатку его текста. Поправили блок —
 * отпечаток другой, и старый вердикт к нему больше не относится: тест
 * скажет, что стенд пора перезапустить, а не сверит правило с ответом на
 * другое правило.
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { MODULE, seclang } from '../lib/load-seclang.mjs';

const { lint } = seclang;

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINES = ['modsecurity2', 'modsecurity3', 'coraza'];

const IMAGES = {
  modsecurity2: 'owasp/modsecurity-crs:apache',
  modsecurity3: 'owasp/modsecurity-crs:nginx',
  coraza: 'golang:1.25-alpine',
};

/* ------------------------------------------------------------------ */
/* Аргументы и рабочая папка                                           */
/* ------------------------------------------------------------------ */

const args = process.argv.slice(2);
const write = args.includes('--write');
/** Значение ключа вида `--work папка`; `null` — ключа нет. */
function option(name) {
  const at = args.indexOf(name);
  return at === -1 ? null : args[at + 1];
}

const valued = ['--work', '--scenarios'].map((name) => args.indexOf(name)).filter((at) => at !== -1);
const WORK = option('--work') ?? join(tmpdir(), 'seclang-engines');
// Свой файл сценариев — чтобы спросить движки о чём-то, не трогая записанное.
const SCENARIOS = option('--scenarios');
const words = args.filter((arg, index) => !arg.startsWith('-') && !valued.includes(index - 1));
const mode = words[0] ?? 'all';

if (!['load', 'behaviour', 'names', 'all', 'probe'].includes(mode) || (mode === 'probe' && words.length < 2)) {
  process.stderr.write(
    'usage: run.mjs [load|behaviour|names|all] [--write] [--work <directory>]\n' +
      '       run.mjs behaviour --scenarios <file.json> [--work <directory>]\n' +
      '       run.mjs probe <directory with *.conf> [--work <directory>]\n',
  );
  process.exit(2);
}
if (SCENARIOS !== null && write) {
  process.stderr.write('--scenarios is for asking, not for recording: drop --write\n');
  process.exit(2);
}

function fresh(directory) {
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
}

/**
 * Запускает сценарий оболочки в контейнере; рабочая папка видна как `/work`.
 *
 * Сценарий передаётся файлом, а не аргументом `-c`: у командной строки
 * Windows предел в 32 тысячи знаков, и сценарий на шесть десятков запросов
 * в него уже не помещается — запуск падает с `ENAMETOOLONG`.
 */
function inContainer(engine, script, extra = []) {
  mkdirSync(WORK, { recursive: true });
  writeFileSync(join(WORK, 'run.sh'), `${script}\n`);
  const result = spawnSync(
    'docker',
    ['run', '--rm', '--user', 'root', '-v', `${WORK}:/work`, ...extra, '--entrypoint', 'sh', IMAGES[engine], '/work/run.sh'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  return { stdout: result.stdout, stderr: result.stderr, status: result.status };
}

/** Какие именно движки отвечали: образ и версия, как их называет сам движок. */
function versions() {
  const first = (engine, script, extra = []) => inContainer(engine, script, extra).stdout.trim().split('\n').pop();
  return {
    modsecurity2: {
      image: IMAGES.modsecurity2,
      version: first(
        'modsecurity2',
        'grep -a -o "ModSecurity for Apache/[0-9.]*" /usr/local/apache2/modules/mod_security2.so | head -1',
      ),
    },
    modsecurity3: {
      image: IMAGES.modsecurity3,
      version: first('modsecurity3', 'ls /usr/local/modsecurity/lib | grep -o "libmodsecurity.so.[0-9]*\\.[0-9]*\\.[0-9]*" | head -1'),
    },
    coraza: {
      image: IMAGES.coraza,
      version: first('coraza', 'grep -o "corazawaf/coraza/v3 v[0-9.]*" /work/coraza/go.mod | head -1'),
    },
  };
}

/** Строки `имя \t итог \t сообщение` → словарь по имени. */
function table(text) {
  const rows = new Map();
  for (const line of text.split('\n')) {
    const [name, outcome, ...rest] = line.split('\t');
    if (name === undefined || outcome === undefined || !name.endsWith('.conf')) continue;
    rows.set(name, { outcome, message: rest.join(' ').trim() });
  }
  return rows;
}

/** Кэш модулей Go: без него Coraza скачивается при каждом запуске. */
function goCache() {
  const cache = join(WORK, 'gocache');
  mkdirSync(join(cache, 'mod'), { recursive: true });
  mkdirSync(join(cache, 'build'), { recursive: true });
  return ['-v', `${cache}/mod:/go/pkg/mod`, '-v', `${cache}/build:/root/.cache/go-build`, '-e', 'GOFLAGS=-mod=mod'];
}

function prepare() {
  mkdirSync(WORK, { recursive: true });
  for (const part of ['apache', 'nginx', 'coraza']) {
    cpSync(join(HERE, part), join(WORK, part), { recursive: true });
  }
}

/* ------------------------------------------------------------------ */
/* Загрузка: блоки из размеченных примеров                             */
/* ------------------------------------------------------------------ */

const EXPECT = /^#\s*expect:(.*)$/;
const PROBE = /^#\s*probe:(.*)$/;

/** Отпечаток текста блока: по нему вердикт находит свой блок. */
function fingerprint(source) {
  return createHash('sha1').update(source).digest('hex').slice(0, 16);
}

/**
 * Блоки файла: от строки-пометки до следующей такой же. Пометка в блок не
 * входит, хвостовые пустые строки — тоже. Тем же способом блоки режет
 * `stand.test.ts`: отпечатки обязаны сойтись.
 */
function blocksOf(path, marker, label) {
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const found = [];
  lines.forEach((text, index) => {
    const match = marker.exec(text);
    if (match === null) return;
    if (found.length > 0) found[found.length - 1].end = index;
    found.push({ line: index + 1, name: match[1].trim(), start: index + 1, end: lines.length });
  });
  return found.map((block) => {
    const source = `${lines.slice(block.start, block.end).join('\n').trimEnd()}\n`;
    const where = label(block);
    return {
      id: `${where.replace(/[^A-Za-z0-9_.-]/g, '_')}.conf`,
      file: where.split(':')[0],
      line: block.line,
      where,
      source,
      hash: fingerprint(source),
    };
  });
}

function allBlocks() {
  const cases = readdirSync(join(MODULE, 'cases'))
    .filter((name) => name.endsWith('.conf') && name !== 'equivalent.conf')
    .sort()
    .flatMap((file) =>
      blocksOf(join(MODULE, 'cases', file), EXPECT, (block) => `${file}:${String(block.line).padStart(4, '0')}`),
    );
  const probes = blocksOf(join(MODULE, 'stand', 'probes.conf'), PROBE, (block) => `probe:${block.name}`);
  return [...cases, ...probes];
}

/** Файлы данных, на которые ссылаются примеры: движку они нужны на диске. */
function dataFiles(blocks, directory) {
  const names = new Set();
  for (const { source } of blocks) {
    for (const match of source.matchAll(/@(?:pmFromFile|pmf|ipMatchFromFile|ipMatchF)\s+([^"']+)/gi)) {
      for (const name of match[1].trim().split(/\s+/)) {
        if (!/^https?:/i.test(name) && !name.includes('%{')) names.add(name);
      }
    }
  }
  for (const name of names) {
    writeFileSync(join(directory, name), /\.txt$/.test(name) ? '192.0.2.1\n' : 'placeholder\n');
  }
}

/** Сценарий оболочки: загрузить каждый `*.conf` папки и сказать, вышло ли. */
const LOAD_SCRIPTS = {
  modsecurity2: (folder) => `
    mkdir -p /var/cache/modsecurity
    cd /work/${folder}
    for f in *.conf; do
      out=$(httpd -t -f /work/apache/httpd.conf -c "Include /work/${folder}/$f" 2>&1); code=$?
      [ $code -eq 0 ] && verdict=OK || verdict=ERR
      printf '%s\\t%s\\t%s\\n' "$f" "$verdict" "$(printf '%s' "$out" | tr '\\n\\t' '  ')"
    done`,
  modsecurity3: (folder) => `
    cd /work/${folder}
    for f in *.conf; do
      sed "s#@RULES@#/work/${folder}/$f#" /work/nginx/nginx.conf > /tmp/nginx.conf
      out=$(nginx -t -c /tmp/nginx.conf 2>&1); code=$?
      [ $code -eq 0 ] && verdict=OK || verdict=ERR
      printf '%s\\t%s\\t%s\\n' "$f" "$verdict" "$(printf '%s' "$out" | tr '\\n\\t' '  ')"
    done`,
  coraza: (folder) => `
    cd /work/coraza && go mod tidy >/dev/null 2>&1
    go build -o /tmp/check . || exit 1
    /tmp/check load /work/${folder}`,
};

/** Грузит все `*.conf` папки в каждый движок: имя файла → вердикт по движкам. */
function loadFolder(folder, count) {
  const verdicts = {};
  for (const engine of ENGINES) {
    process.stderr.write(`${folder}: ${engine} (${count} files)…\n`);
    const result = inContainer(engine, LOAD_SCRIPTS[engine](folder), engine === 'coraza' ? goCache() : []);
    const rows = table(result.stdout);
    if (rows.size !== count) {
      process.stderr.write(result.stderr.slice(-2000));
      throw new Error(`${engine}: ${rows.size} verdicts for ${count} files`);
    }
    verdicts[engine] = rows;
  }
  return verdicts;
}

function runLoad() {
  const directory = join(WORK, 'cases');
  fresh(directory);
  const blocks = allBlocks();
  for (const block of blocks) writeFileSync(join(directory, block.id), block.source);
  dataFiles(blocks, directory);

  const verdicts = loadFolder('cases', blocks.length);

  return blocks.map((block) => {
    const entry = {
      id: block.id,
      file: block.file,
      line: block.line,
      where: block.where,
      hash: block.hash,
      source: block.source,
      engines: {},
    };
    for (const engine of ENGINES) {
      const row = verdicts[engine].get(block.id);
      // Пометки `# seclang-ignore` — разговор автора с линтером; движку до
      // них дела нет, и сверка их не слушает.
      const found = lint(block.source, { engine, comments: false });
      entry.engines[engine] = {
        loads: row.outcome === 'OK',
        message: row.message,
        errors: found.filter((d) => d.severity === 'error').map((d) => d.code),
        others: found.filter((d) => d.severity !== 'error').map((d) => d.code),
      };
    }
    return entry;
  });
}

/** Самое существенное из сообщения движка: без путей и служебных слов. */
function gist(message) {
  return message
    .replace(/\/work\/[^\s:]+/g, '…')
    .replace(/AH\d+: /g, '')
    .replace(/nginx: (?:\[emerg\] |configuration file \S+ test failed)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function reportLoad(entries) {
  const out = [];
  for (const engine of ENGINES) {
    const silent = [];
    const loud = [];
    for (const entry of entries) {
      const verdict = entry.engines[engine];
      const { where } = entry;
      if (!verdict.loads && verdict.errors.length === 0) {
        silent.push(`  ${where}  [${verdict.others.join(', ') || '—'}]\n      ${gist(verdict.message)}`);
      }
      if (verdict.loads && verdict.errors.length > 0) {
        loud.push(`  ${where}  [${verdict.errors.join(', ')}]`);
      }
    }
    const refused = entries.filter((entry) => !entry.engines[engine].loads).length;
    out.push(`== ${engine}: refused ${refused} of ${entries.length} blocks`);
    out.push(`-- refused by the engine, no error from the linter (${silent.length}):`);
    out.push(...silent);
    out.push(`-- error from the linter, loaded by the engine (${loud.length}):`);
    out.push(...loud, '');
  }
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* Поведение: сценарии с запросом                                      */
/* ------------------------------------------------------------------ */

function scenarios() {
  const file = SCENARIOS ?? join(HERE, 'scenarios.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
}

function curlOf(request) {
  const parts = ['curl', '-s', '-o', '/dev/null', '-w', "'%{http_code}'", '-X', request.method];
  for (const [name, value] of request.headers ?? []) parts.push('-H', `'${name}: ${value}'`);
  if (request.body) parts.push('--data-raw', `'${request.body}'`);
  parts.push(`'http://127.0.0.1:8080${request.uri}'`);
  return parts.join(' ');
}

const SERVERS = {
  modsecurity2: {
    start: (rules) => `httpd -f /work/apache/httpd.conf -c "Include ${rules}" -k start >/tmp/start.log 2>&1`,
    stop: 'httpd -f /work/apache/httpd.conf -k stop >/dev/null 2>&1; sleep 0.3; rm -f /tmp/httpd.pid',
  },
  modsecurity3: {
    start: (rules) =>
      `sed "s#@RULES@#${rules}#" /work/nginx/nginx.conf > /tmp/nginx.conf; nginx -c /tmp/nginx.conf >/tmp/start.log 2>&1`,
    stop: 'nginx -c /tmp/nginx.conf -s quit >/dev/null 2>&1; sleep 0.3',
  },
};

function behaviourScript(engine, list) {
  const server = SERVERS[engine];
  const lines = ['mkdir -p /var/cache/modsecurity'];
  for (const scenario of list) {
    const rules = `/work/scenarios/${scenario.name}.conf`;
    lines.push(
      `${server.start(rules)}`,
      'if [ $? -ne 0 ]; then',
      `  printf '%s\\tERR\\t%s\\n' '${scenario.name}.conf' "$(tr '\\n\\t' '  ' </tmp/start.log)"`,
      'else',
      '  sleep 0.4',
      `  printf '%s\\t%s\\t\\n' '${scenario.name}.conf' "$(${curlOf(scenario.request)})"`,
      `  ${server.stop}`,
      'fi',
    );
  }
  return lines.join('\n');
}

function runBehaviour() {
  const list = scenarios();
  const directory = join(WORK, 'scenarios');
  fresh(directory);
  for (const scenario of list) {
    writeFileSync(join(directory, `${scenario.name}.conf`), `${scenario.rules.join('\n')}\n`);
    writeFileSync(join(directory, `${scenario.name}.json`), JSON.stringify(scenario.request));
  }

  const outcomes = {};
  for (const engine of ENGINES) {
    process.stderr.write(`behaviour: ${engine} (${list.length} scenarios)…\n`);
    const result =
      engine === 'coraza'
        ? inContainer(
            engine,
            'cd /work/coraza && go mod tidy >/dev/null 2>&1; go build -o /tmp/check . || exit 1; /tmp/check run /work/scenarios',
            goCache(),
          )
        : inContainer(engine, behaviourScript(engine, list));
    outcomes[engine] = table(result.stdout);
    if (outcomes[engine].size !== list.length) process.stderr.write(result.stderr.slice(-2000));
  }

  return list.map((scenario) => {
    const entry = { name: scenario.name, claim: scenario.claim, expect: scenario.expect, actual: {}, messages: {} };
    for (const engine of ENGINES) {
      const row = outcomes[engine].get(`${scenario.name}.conf`);
      entry.actual[engine] = row === undefined ? 'missing' : outcomeOf(row.outcome);
      if (row !== undefined && row.outcome === 'ERR') entry.messages[engine] = gist(row.message);
    }
    return entry;
  });
}

/**
 * Исход запроса: `ERR` — правила не загрузились, код — запрос остановлен
 * правилом с этим кодом, `pass` — дошёл до сервера. Что сервер ответил на
 * пропущенный запрос (200, 404, 405), зависит от него самого, а не от
 * движка: сценарии останавливают запрос только кодами 402 и 403.
 */
function outcomeOf(status) {
  if (status === 'ERR') return 'ERR';
  return status === '402' || status === '403' ? status : 'pass';
}

function reportBehaviour(entries) {
  const out = [];
  let wrong = 0;
  for (const entry of entries) {
    const cells = ENGINES.map((engine) => {
      const expected = String(entry.expect[engine]);
      const actual = entry.actual[engine];
      const ok = actual === expected;
      if (!ok) wrong++;
      return `${engine}=${actual}${ok ? '' : ` (expected ${expected})`}`;
    });
    out.push(`${cells.some((cell) => cell.includes('expected')) ? 'MISMATCH' : 'ok      '} ${entry.name}: ${cells.join('  ')}`);
    for (const engine of ENGINES) {
      if (entry.messages[engine] !== undefined) out.push(`           ${engine}: ${entry.messages[engine]}`);
    }
  }
  out.push('', `${entries.length} scenarios, ${wrong} mismatching cells`);
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* Проба: что движки скажут о произвольных файлах                      */
/* ------------------------------------------------------------------ */

/**
 * Грузит каждый `*.conf` указанной папки во все движки и печатает таблицу:
 * файл и вердикт каждого движка. Остальные файлы папки копируются рядом —
 * это данные, на которые правила ссылаются. Подробности, вместе с тем, что
 * о каждом файле сказал линтер, остаются в `probe.json` рабочей папки.
 */
function runProbe(source) {
  const directory = join(WORK, 'probe');
  fresh(directory);
  cpSync(source, directory, { recursive: true });
  const names = readdirSync(directory)
    .filter((name) => name.endsWith('.conf'))
    .sort();
  const verdicts = loadFolder('probe', names.length);

  const rows = names.map((name) => {
    const text = readFileSync(join(directory, name), 'utf8');
    const row = { name, source: text.trimEnd(), engines: {} };
    for (const engine of ENGINES) {
      const verdict = verdicts[engine].get(name);
      const found = lint(text, { engine });
      row.engines[engine] = {
        loads: verdict.outcome === 'OK',
        message: gist(verdict.message),
        errors: found.filter((d) => d.severity === 'error').map((d) => d.code),
        codes: found.map((d) => d.code),
      };
    }
    return row;
  });
  writeFileSync(join(WORK, 'probe.json'), JSON.stringify(rows, null, 2));

  for (const row of rows) {
    const cells = ENGINES.map((engine) => (row.engines[engine].loads ? 'ok ' : 'ERR'));
    process.stdout.write(`${cells.join(' ')}  ${row.name}\n`);
    for (const engine of ENGINES) {
      const verdict = row.engines[engine];
      if (!verdict.loads) process.stdout.write(`      ${engine}: ${verdict.message}\n`);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Имена: каталог против движков                                       */
/* ------------------------------------------------------------------ */

/** Значение, с которым действие заведомо записано верно. */
const ACTION_SAMPLES = {
  accuracy: '1',
  append: "'x'",
  ctl: 'ruleEngine=On',
  deprecatevar: 'ip.a=1/60',
  exec: '/bin/true',
  expirevar: 'ip.a=60',
  initcol: 'ip=%{REMOTE_ADDR}',
  logdata: "'x'",
  maturity: '1',
  msg: "'x'",
  pause: '1',
  prepend: "'x'",
  proxy: 'http://127.0.0.1/',
  redirect: 'http://127.0.0.1/',
  rev: '1',
  sanitisearg: 'x',
  sanitizearg: 'x',
  sanitiserequestheader: 'x',
  sanitizerequestheader: 'x',
  sanitiseresponseheader: 'x',
  sanitizeresponseheader: 'x',
  setenv: 'a=b',
  setrsc: 'x',
  setsid: 'x',
  setuid: 'x',
  setvar: 'tx.a=1',
  severity: '2',
  skip: '1',
  skipafter: 'END',
  tag: "'x'",
  ver: "'x'",
  xmlns: 'a=http://example.com/',
};

/** Аргумент, с которым оператор заведомо записан верно. */
const OPERATOR_SAMPLES = {
  none: '',
  string: ' abc',
  regex: ' a',
  number: ' 1',
  ipList: ' 10.0.0.1',
  phrases: ' a b',
  file: ' names.data',
  byteRange: ' 32-126',
};

/** Самое малое правило или директива, в которых встречается только это имя. */
function sampleOf(kind, name) {
  const { variableSpec, operatorSpec, actionSpec, directiveSpec } = seclang;
  const tail = '"id:1,phase:2,pass,nolog"';

  if (kind === 'variable') {
    const spec = variableSpec(name);
    return `SecRule ${name}${spec.selector === 'required' ? ':x' : ''} "@rx a" ${tail}`;
  }
  if (kind === 'operator') {
    return `SecRule ARGS "@${name}${OPERATOR_SAMPLES[operatorSpec(name).arg]}" ${tail}`;
  }
  if (kind === 'transform') {
    return `SecRule ARGS "@rx a" "id:1,phase:2,pass,nolog,t:${name}"`;
  }
  if (kind === 'action') {
    const spec = actionSpec(name);
    const key = name.toLowerCase();
    if (key === 'id' || key === 'phase' || key === 'pass' || key === 'nolog') return 'SecAction "id:1,phase:2,pass,nolog"';
    if (key === 't') return 'SecRule ARGS "@rx a" "id:1,phase:2,pass,nolog,t:none"';
    if (key === 'chain') return 'SecRule ARGS "@rx a" "id:1,phase:2,pass,nolog,chain"\nSecRule ARGS "@rx b"';
    if (key === 'status') return 'SecAction "id:1,phase:2,deny,status:403,nolog"';
    if (key === 'capture') return 'SecRule ARGS "@rx (a)" "id:1,phase:2,pass,nolog,capture"';
    if (key === 'skipafter') return 'SecAction "id:1,phase:2,pass,nolog,skipAfter:END"\nSecMarker END';
    const value = ACTION_SAMPLES[key];
    const written = spec.value === 'none' || value === undefined ? name : `${name}:${value}`;
    const reaction = spec.exclusive === 'disruptive' ? '' : 'pass,';
    const log = spec.exclusive === 'log' ? '' : ',nolog';
    return `SecAction "id:1,phase:2,${reaction}${written}${log}"`;
  }

  const spec = directiveSpec(name);
  if (spec === null) return null;
  switch (spec.kind) {
    case 'choice':
      return `${name} ${spec.values[0]}`;
    case 'number':
      return `${name} 1000`;
    case 'level':
      return `${name} 3`;
    case 'mode':
      return `${name} 0600`;
    case 'parts':
      return `${name} ABCFHZ`;
    case 'none':
      return name;
    default:
      // Значение свободное: чем его заполнить, знает только сама директива.
      return null;
  }
}

/**
 * Спрашивает каждый движок про каждое имя каталога и сравнивает ответ с
 * таблицами `engines.ts`. Расхождение — либо ошибка в таблице, либо имя,
 * которое движок принимает и молча пропускает; что из двух, решает человек.
 */
function runNames() {
  const { variableNames, operatorNames, actionNames, transformNames, directiveNames, engineSupports } = seclang;
  const directory = join(WORK, 'names');
  fresh(directory);
  writeFileSync(join(directory, 'names.data'), '10.0.0.1\n');

  const kinds = {
    variable: variableNames(),
    operator: operatorNames(),
    transform: transformNames(),
    action: actionNames(),
    directive: directiveNames(),
  };
  const probes = [];
  for (const [kind, names] of Object.entries(kinds)) {
    for (const name of names) {
      const sample = sampleOf(kind, name);
      if (sample === null) continue;
      const file = `${kind}-${name.replace(/[^A-Za-z0-9_]/g, '_')}.conf`;
      writeFileSync(join(directory, file), `${sample}\n`);
      probes.push({ kind, name, file, sample });
    }
  }

  const verdicts = loadFolder('names', probes.length);
  const rows = probes.map((probe) => {
    const row = { ...probe, engines: {} };
    for (const engine of ENGINES) {
      const verdict = verdicts[engine].get(probe.file);
      row.engines[engine] = {
        loads: verdict.outcome === 'OK',
        supported: engineSupports(engine, probe.kind, probe.name),
        message: gist(verdict.message),
      };
    }
    return row;
  });
  writeFileSync(join(WORK, 'names.json'), JSON.stringify(rows, null, 2));

  for (const engine of ENGINES) {
    const strict = rows.filter((row) => row.engines[engine].loads && !row.engines[engine].supported);
    const generous = rows.filter((row) => !row.engines[engine].loads && row.engines[engine].supported);
    process.stdout.write(`== ${engine}: ${rows.length} names\n`);
    process.stdout.write(`-- the table says "not supported", the engine loads it (${strict.length}):\n`);
    for (const row of strict) process.stdout.write(`  ${row.kind} ${row.name}\n`);
    process.stdout.write(`-- the table says "supported", the engine refuses it (${generous.length}):\n`);
    for (const row of generous) {
      process.stdout.write(`  ${row.kind} ${row.name}: ${row.engines[engine].message}\n`);
    }
    process.stdout.write('\n');
  }
  return rows;
}

/* ------------------------------------------------------------------ */

prepare();
const record = {};

if (mode === 'names' || mode === 'all') {
  const rows = runNames();
  record.names = Object.fromEntries(
    rows.map((row) => [
      `${row.kind}:${row.name}`,
      Object.fromEntries(ENGINES.map((engine) => [engine, row.engines[engine].loads])),
    ]),
  );
}

if (mode === 'probe') {
  runProbe(words[1]);
  process.exit(0);
}

if (mode === 'load' || mode === 'all') {
  const entries = runLoad();
  writeFileSync(join(WORK, 'load.json'), JSON.stringify(entries, null, 2));
  process.stdout.write(`${reportLoad(entries)}\n`);
  record.load = Object.fromEntries(
    entries.map((entry) => [
      entry.hash,
      { where: entry.where, ...Object.fromEntries(ENGINES.map((engine) => [engine, entry.engines[engine].loads])) },
    ]),
  );
}

if (mode === 'behaviour' || mode === 'all') {
  const entries = runBehaviour();
  writeFileSync(join(WORK, 'behaviour.json'), JSON.stringify(entries, null, 2));
  process.stdout.write(`${reportBehaviour(entries)}\n`);
  record.behaviour = Object.fromEntries(entries.map((entry) => [entry.name, entry.actual]));
}

if (write) {
  const target = join(MODULE, 'stand', 'verdicts.json');
  const known = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : {};
  writeFileSync(target, `${JSON.stringify({ ...known, engines: versions(), ...record }, null, 2)}\n`);
  process.stderr.write(`verdicts written to ${target}\n`);
}
