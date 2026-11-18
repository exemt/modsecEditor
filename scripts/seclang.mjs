#!/usr/bin/env node
/**
 * Проверка правил ModSecurity из командной строки.
 *
 *     node scripts/seclang.mjs rules/                    # папка целиком
 *     node scripts/seclang.mjs modsecurity.conf          # файл и всё, что он подключает
 *     node scripts/seclang.mjs --engine coraza rules/    # глазами другого движка
 *     node scripts/seclang.mjs --fix rules/              # починить то, что чинится само
 *
 * Настройки проекта лежат в `seclang.config.json` — в текущей папке или выше
 * по дереву; ключи командной строки сильнее файла. Движок, уровни замечаний,
 * ServerRoot второй версии — то, что иначе пришлось бы повторять при каждом
 * запуске.
 *
 * Сборка не нужна: модуль `src/seclang` Node исполняет как есть — как именно,
 * описано в `lib/load-seclang.mjs`. Нужен Node 22.15 или новее.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import process from 'node:process';
import { seclang } from './lib/load-seclang.mjs';

const { CODES, FIXABLE, createWorkspace, fixesFor, applyFixes } = seclang;

/* ------------------------------------------------------------------ */
/* Аргументы                                                           */
/* ------------------------------------------------------------------ */

const HELP = `Usage: seclang [options] <file or directory>...

Checks ModSecurity / Coraza rule files: what will not load, what will never
match, what is redundant.

Options:
  --engine <name>        modsecurity2, modsecurity3 or coraza: also report what
                         that engine does not support
  --min-severity <lvl>   advice (default), warning or error
  --only <codes>         report only these codes (comma-separated)
  --off <codes>          do not report these codes (comma-separated)
  --format <fmt>         text (default) or json
  --fix                  rewrite the files, applying every automatic fix
  --no-include           do not follow Include / IncludeOptional
  --no-files             do not check that @pmFromFile / @ipMatchFromFile data
                         files exist
  --no-comments          ignore "# seclang-ignore" comments in the files
  --server-root <dir>    resolve relative Include paths from this folder, as
                         Apache does for ModSecurity 2 (default: the folder of
                         the file with the Include)
  --config <file>        read settings from this file instead of looking for
                         seclang.config.json
  --no-config            do not read seclang.config.json
  --list-codes           print every diagnostic code and exit
  -h, --help             print this help

A directory is read recursively (*.conf, sorted by name). Files are checked
together, in load order: markers, rule ids, variables and SecDefaultAction
are resolved across all of them.

Project settings: seclang.config.json in the current folder or any folder
above it. Keys: engine, minSeverity, only, off, codes ({"code": "off" |
"advice" | "warning" | "error"}), topics (the same by topic), include, files,
comments, serverRoot (relative to the config file). Options on the command
line win over the file.

Exit status: 0 — no errors, 1 — errors found, 2 — bad usage.`;

const ENGINES = ['modsecurity2', 'modsecurity3', 'coraza'];
const SEVERITIES = ['advice', 'warning', 'error'];

function fail(message) {
  process.stderr.write(`seclang: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const settings = {
    paths: [],
    engine: undefined,
    minSeverity: undefined,
    only: undefined,
    off: [],
    format: 'text',
    fix: false,
    include: true,
    files: true,
    comments: true,
    serverRoot: undefined,
    config: undefined,
    useConfig: true,
    codes: {},
    topics: {},
  };
  /** Что задано ключами: файл настроек этого не перекрывает. */
  const given = new Set();

  const codeList = (flag, value) => {
    const names = value.split(',').map((name) => name.trim()).filter(Boolean);
    for (const name of names) {
      if (!(name in CODES)) fail(`${flag}: there is no code "${name}" (see --list-codes)`);
    }
    return names;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) fail(`${arg} needs a value`);
      return next;
    };

    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(`${HELP}\n`);
        process.exit(0);
        break;
      case '--list-codes':
        for (const [code, spec] of Object.entries(CODES)) {
          const fixable = FIXABLE.includes(code) ? ' (fixable)' : '';
          process.stdout.write(`${spec.severity.padEnd(8)} ${spec.topic.padEnd(12)} ${code}${fixable}\n`);
        }
        process.exit(0);
        break;
      case '--engine':
        given.add('engine');
        settings.engine = value();
        if (!ENGINES.includes(settings.engine)) fail(`--engine: expected one of ${ENGINES.join(', ')}`);
        break;
      case '--min-severity':
        given.add('minSeverity');
        settings.minSeverity = value();
        if (!SEVERITIES.includes(settings.minSeverity)) {
          fail(`--min-severity: expected one of ${SEVERITIES.join(', ')}`);
        }
        break;
      case '--only':
        given.add('only');
        settings.only = codeList(arg, value());
        break;
      case '--off':
        settings.off.push(...codeList(arg, value()));
        break;
      case '--format':
        settings.format = value();
        if (settings.format !== 'text' && settings.format !== 'json') fail('--format: expected text or json');
        break;
      case '--fix':
        settings.fix = true;
        break;
      case '--no-include':
        given.add('include');
        settings.include = false;
        break;
      case '--no-files':
        given.add('files');
        settings.files = false;
        break;
      case '--no-comments':
        given.add('comments');
        settings.comments = false;
        break;
      case '--server-root':
        given.add('serverRoot');
        settings.serverRoot = resolve(value());
        break;
      case '--config':
        settings.config = value();
        break;
      case '--no-config':
        settings.useConfig = false;
        break;
      default:
        if (arg.startsWith('-')) fail(`unknown option ${arg} (see --help)`);
        settings.paths.push(arg);
    }
  }

  if (settings.paths.length === 0) fail('nothing to check: name a file or a directory (see --help)');
  if (settings.useConfig) applyConfig(settings, given, codeList);
  return settings;
}

/* ------------------------------------------------------------------ */
/* Файл настроек проекта                                               */
/* ------------------------------------------------------------------ */

const CONFIG_NAME = 'seclang.config.json';
const CONFIG_KEYS = new Set([
  'engine',
  'minSeverity',
  'only',
  'off',
  'codes',
  'topics',
  'include',
  'files',
  'comments',
  'serverRoot',
]);
const LEVELS = ['off', 'advice', 'warning', 'error'];
const TOPICS = ['structure', 'logic', 'environment', 'style', 'coverage', 'logging', 'performance'];

/** `seclang.config.json` в текущей папке или ближайшей выше; `null` — нет нигде. */
function findConfig(from) {
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const candidate = join(dir, CONFIG_NAME);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) return null;
  }
}

/**
 * Дополняет настройки файлом проекта. Ключ командной строки сильнее: файл
 * задаёт только то, чего ключами не назвали. Ошибка в файле — ошибка
 * запуска: молча проверить не тем движком хуже, чем не проверить.
 */
function applyConfig(settings, given, codeList) {
  const path = settings.config ?? findConfig(process.cwd());
  if (path === null) return;
  if (!existsSync(path)) fail(`--config: ${path}: no such file`);
  let config;
  try {
    config = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${path}: not valid JSON (${error.message})`);
  }
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    fail(`${path}: expected an object`);
  }
  const where = (key) => `${path}: "${key}"`;
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) fail(`${where(key)} is not a setting (expected ${[...CONFIG_KEYS].join(', ')})`);
  }

  const take = (key) => config[key] !== undefined && !given.has(key);
  const flag = (key) => {
    if (typeof config[key] !== 'boolean') fail(`${where(key)}: expected true or false`);
    return config[key];
  };
  const list = (key) => {
    const value = config[key];
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
      fail(`${where(key)}: expected a list of codes`);
    }
    return codeList(where(key), value.join(','));
  };
  const levels = (key, known, what) => {
    const value = config[key];
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${where(key)}: expected an object`);
    for (const [name, level] of Object.entries(value)) {
      if (!known(name)) fail(`${where(key)}: there is no ${what} "${name}"`);
      if (!LEVELS.includes(level)) fail(`${where(key)}: "${name}" should be one of ${LEVELS.join(', ')}`);
    }
    return value;
  };

  if (take('engine')) {
    if (!ENGINES.includes(config.engine)) fail(`${where('engine')}: expected one of ${ENGINES.join(', ')}`);
    settings.engine = config.engine;
  }
  if (take('minSeverity')) {
    if (!SEVERITIES.includes(config.minSeverity)) {
      fail(`${where('minSeverity')}: expected one of ${SEVERITIES.join(', ')}`);
    }
    settings.minSeverity = config.minSeverity;
  }
  if (take('only')) settings.only = list('only');
  // `off` из файла и из ключей складываются: выключить можно и там, и там.
  if (config.off !== undefined) settings.off.push(...list('off'));
  if (config.codes !== undefined) settings.codes = levels('codes', (name) => name in CODES, 'code');
  if (config.topics !== undefined) settings.topics = levels('topics', (name) => TOPICS.includes(name), 'topic');
  if (take('include')) settings.include = flag('include');
  if (take('files')) settings.files = flag('files');
  if (take('comments')) settings.comments = flag('comments');
  if (take('serverRoot')) {
    if (typeof config.serverRoot !== 'string') fail(`${where('serverRoot')}: expected a path`);
    settings.serverRoot = resolve(dirname(resolve(path)), config.serverRoot);
  }
}

/* ------------------------------------------------------------------ */
/* Файлы: папки и Include                                              */
/* ------------------------------------------------------------------ */

/** `*.conf` папки и её подпапок, по именам — так их подключил бы `Include`. */
function confFiles(directory) {
  const found = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) found.push(...confFiles(path));
    else if (name.endsWith('.conf')) found.push(path);
  }
  return found;
}

/** Шаблон имени файла (`*.conf`, `REQUEST-9??-*.conf`) → регулярное выражение. */
function globToRegex(pattern) {
  const body = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${body}$`);
}

/**
 * Что подключает `Include path`: файлы, по именам. Шаблон — только в имени.
 *
 * Относительный путь Apache отсчитывает от ServerRoot, а ModSecurity 3 и
 * Coraza — от папки файла. Если ServerRoot назван, путь считается от него.
 */
function includeTargets(target, from, serverRoot) {
  const base = serverRoot ?? dirname(from);
  const path = isAbsolute(target) ? target : resolve(base, target);
  if (!/[*?]/.test(path)) {
    if (!existsSync(path)) return [];
    return statSync(path).isDirectory() ? confFiles(path) : [path];
  }
  const directory = dirname(path);
  if (!existsSync(directory) || /[*?]/.test(directory)) return [];
  const matches = globToRegex(basename(path));
  return readdirSync(directory)
    .sort()
    .filter((name) => matches.test(name))
    .map((name) => join(directory, name))
    .filter((file) => statSync(file).isFile());
}

/**
 * Кладёт файл и всё, что он подключает, в набор — в порядке загрузки.
 *
 * Порядок приближённый: подключённые файлы встают сразу за подключившим,
 * а не в ту его строку, где стоит `Include`. Для обычной раскладки (файл
 * настройки, в конце которого подключаются правила) разницы нет.
 */
function load(path, workspace, settings, seen, missing) {
  const file = resolve(path);
  if (seen.has(file)) return;
  seen.add(file);

  // Имя — путь от текущей папки, с прямыми слэшами на любой системе.
  const name = (relative(process.cwd(), file) || file).split(sep).join('/');
  workspace.set(name, readFileSync(file, 'utf8'));
  if (!settings.include) return;

  for (const statement of workspace.tree(name).statements) {
    if (statement.kind !== 'Directive' || statement.args.length === 0) continue;
    const directive = statement.name.toLowerCase();
    if (directive !== 'include' && directive !== 'includeoptional') continue;

    const target = statement.args[0].value;
    const targets = includeTargets(target, file, settings.serverRoot);
    if (targets.length === 0 && directive === 'include' && !/[*?]/.test(target)) {
      missing.push({ name, line: statement.line, target });
    }
    for (const included of targets) load(included, workspace, settings, seen, missing);
  }
}

/* ------------------------------------------------------------------ */
/* Проверка и вывод                                                    */
/* ------------------------------------------------------------------ */

function lintOptions(settings) {
  const options = { comments: settings.comments };
  if (settings.engine !== undefined) options.engine = settings.engine;
  if (settings.minSeverity !== undefined) options.minSeverity = settings.minSeverity;
  if (settings.only !== undefined) options.only = settings.only;
  const codes = { ...settings.codes, ...Object.fromEntries(settings.off.map((code) => [code, 'off'])) };
  if (Object.keys(codes).length > 0) options.codes = codes;
  if (Object.keys(settings.topics).length > 0) options.topics = settings.topics;
  if (settings.files) {
    // Относительный путь движок отсчитывает от файла правил.
    options.files = (path, from) =>
      existsSync(isAbsolute(path) || from === undefined ? path : resolve(dirname(from), path));
  }
  return options;
}

/** Применяет исправления, пока они находятся: одно может открыть другое. */
function fixAll(workspace, options) {
  let total = 0;
  for (let pass = 0; pass < 10; pass++) {
    let applied = 0;
    for (const { name, diagnostics } of workspace.lint(options)) {
      const tree = workspace.tree(name);
      const result = applyFixes(tree.source, fixesFor(tree, diagnostics));
      if (result.applied.length === 0) continue;
      writeFileSync(resolve(name), result.source);
      workspace.set(name, result.source);
      applied += result.applied.length;
    }
    if (applied === 0) break;
    total += applied;
  }
  return total;
}

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`;
}

function printText(results, missing, fixed) {
  const counts = { error: 0, warning: 0, advice: 0 };
  let files = 0;

  for (const { name, diagnostics } of results) {
    if (diagnostics.length === 0) continue;
    files++;
    process.stdout.write(`${name}\n`);
    for (const d of diagnostics) {
      counts[d.severity]++;
      const where = `${d.line}:${d.column}`.padEnd(9);
      process.stdout.write(`  ${where} ${d.severity.padEnd(8)} ${d.message}  ${d.code}\n`);
    }
    process.stdout.write('\n');
  }

  for (const { name, line, target } of missing) {
    process.stderr.write(`${name}:${line}: Include target "${target}" does not exist\n`);
  }

  const found = counts.error + counts.warning + counts.advice;
  const summary =
    found === 0
      ? `No findings in ${plural(results.length, 'file')}.`
      : `${plural(counts.error, 'error')}, ${plural(counts.warning, 'warning')}, ${counts.advice} advice ` +
        `in ${plural(files, 'file')} (${results.length} checked).`;
  const fixes = fixed > 0 ? ` ${plural(fixed, 'fix', 'fixes')} applied.` : '';
  process.stdout.write(`${summary}${fixes}\n`);
  return counts.error;
}

function printJson(results, missing, fixed) {
  const files = results.map(({ name, diagnostics }) => ({ file: name, diagnostics }));
  process.stdout.write(`${JSON.stringify({ files, missingIncludes: missing, fixed }, null, 2)}\n`);
  return results.reduce(
    (errors, { diagnostics }) => errors + diagnostics.filter((d) => d.severity === 'error').length,
    0,
  );
}

function main() {
  const settings = parseArgs(process.argv.slice(2));
  const workspace = createWorkspace();
  const seen = new Set();
  const missing = [];

  for (const path of settings.paths) {
    if (!existsSync(path)) fail(`${path}: no such file or directory`);
    const files = statSync(path).isDirectory() ? confFiles(path) : [path];
    for (const file of files) load(file, workspace, settings, seen, missing);
  }
  if (workspace.names().length === 0) fail('no *.conf files found');

  const options = lintOptions(settings);
  const fixed = settings.fix ? fixAll(workspace, options) : 0;
  const results = workspace.lint(options);

  const errors =
    settings.format === 'json' ? printJson(results, missing, fixed) : printText(results, missing, fixed);
  process.exitCode = errors > 0 ? 1 : 0;
}

main();
