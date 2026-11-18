import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Командная строка: `scripts/seclang.mjs`.
 *
 * Проверяется то, чего у модуля самого по себе нет: чтение папок и
 * `Include`, файлы данных на диске, перезапись при `--fix`, код возврата.
 * Скрипт запускается отдельным процессом — так же, как его запустит человек.
 */

const SCRIPT = resolve(__dirname, '..', '..', 'scripts', 'seclang.mjs');

/** Скрипту нужен Node, который исполняет TypeScript без сборки. */
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 15);
const suite = supported ? describe : describe.skip;

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(cwd: string, ...args: string[]): Run {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

suite('командная строка', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'seclang-cli-'));
    mkdirSync(join(root, 'rules'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const write = (name: string, text: string) => writeFileSync(join(root, name), text);

  it('чистый набор: ноль замечаний и нулевой код возврата', () => {
    write('rules/10-a.conf', 'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass"\n');
    const result = run(root, 'rules');
    expect(result.stdout).toContain('No findings in 1 file.');
    expect(result.status).toBe(0);
  });

  it('ошибка даёт код возврата 1, предупреждение — нет', () => {
    write('rules/10-a.conf', 'SecRule ARGS "@rx ^a\\d" "phase:2,pass"\n');
    const failed = run(root, 'rules');
    expect(failed.stdout).toContain('rules/10-a.conf');
    expect(failed.stdout).toContain('missingId');
    expect(failed.stdout).toContain('1 error, 0 warnings');
    expect(failed.status).toBe(1);

    write('rules/10-a.conf', 'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,nolog,nolog"\n');
    const warned = run(root, 'rules');
    expect(warned.stdout).toContain('duplicateAction');
    expect(warned.status).toBe(0);
  });

  it('файлы папки проверяются вместе, в порядке имён', () => {
    write('rules/10-jump.conf', 'SecAction "id:1,phase:1,pass,nolog,skipAfter:END"\n');
    write('rules/20-marker.conf', 'SecMarker END\n');
    expect(run(root, 'rules').stdout).toContain('No findings in 2 files.');
    // По одному метки не видно.
    expect(run(root, 'rules/10-jump.conf').stdout).toContain('missingMarker');
  });

  it('Include подключает файлы по шаблону; пропавший файл назван отдельно', () => {
    write('main.conf', 'SecRuleEngine On\nInclude rules/*.conf\nInclude gone.conf\nIncludeOptional maybe.conf\n');
    write('rules/10-jump.conf', 'SecAction "id:1,phase:1,pass,nolog,skipAfter:END"\n');
    write('rules/20-marker.conf', 'SecMarker END\n');

    // Относительный путь здесь законен: командная строка считает от файла.
    const followed = run(root, '--off', 'includeRelative', 'main.conf');
    expect(followed.stdout).toContain('No findings in 3 files.');
    expect(followed.stderr).toContain('main.conf:3: Include target "gone.conf" does not exist');
    expect(followed.stderr).not.toContain('maybe.conf');

    const alone = run(root, '--no-include', '--off', 'includeRelative', 'main.conf');
    expect(alone.stdout).toContain('No findings in 1 file.');
  });

  it('--server-root: относительный Include считается от ServerRoot, как у Apache', () => {
    mkdirSync(join(root, 'conf'));
    mkdirSync(join(root, 'apache', 'rules'), { recursive: true });
    write('conf/main.conf', 'Include rules/a.conf\n');
    write('apache/rules/a.conf', 'SecMarker END\n');
    const fromFile = run(root, '--off', 'includeRelative', 'conf/main.conf');
    expect(fromFile.stderr).toContain('Include target "rules/a.conf" does not exist');
    const fromRoot = run(root, '--off', 'includeRelative', '--server-root', 'apache', 'conf/main.conf');
    expect(fromRoot.stderr).toBe('');
    expect(fromRoot.stdout).toContain('unusedMarker');
  });

  it('seclang.config.json задаёт настройки, ключи сильнее файла', () => {
    write('rules/10-a.conf', 'SecRule ARGS "@rx ^(?!a)\\d" "id:1,phase:2,pass,nolog,nolog"\n');
    write('seclang.config.json', JSON.stringify({ engine: 'coraza', codes: { duplicateAction: 'off' } }));
    const configured = run(root, 'rules').stdout;
    expect(configured).toContain('regexNotInEngine');
    expect(configured).not.toContain('duplicateAction');
    // Ключ сильнее файла.
    expect(run(root, '--engine', 'modsecurity2', 'rules').stdout).not.toContain('regexNotInEngine');
    // Без файла — как раньше.
    expect(run(root, '--no-config', 'rules').stdout).toContain('duplicateAction');
  });

  it('ошибка в файле настроек — ошибка запуска', () => {
    write('rules/10-a.conf', 'SecMarker END\n');
    write('seclang.config.json', JSON.stringify({ engin: 'coraza' }));
    const result = run(root, 'rules');
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"engin" is not a setting');
    write('seclang.config.json', JSON.stringify({ codes: { nope: 'off' } }));
    expect(run(root, 'rules').stderr).toContain('there is no code "nope"');
  });

  it('файлы данных ищутся рядом с файлом правил', () => {
    write('rules/10-a.conf', 'SecRule ARGS "@pmFromFile words.data" "id:1,phase:2,pass,t:lowercase"\n');
    expect(run(root, 'rules').stdout).toContain('fileNotFound');
    expect(run(root, '--no-files', 'rules').stdout).toContain('No findings');
    write('rules/words.data', 'admin\n');
    expect(run(root, 'rules').stdout).toContain('No findings');
  });

  it('--engine, --off и --only меняют то, что сказано', () => {
    write('rules/10-a.conf', 'SecRule ARGS "@rx ^(?!a)\\d" "id:1,phase:2,pass,nolog,nolog"\n');
    expect(run(root, 'rules').stdout).not.toContain('regexNotInEngine');
    expect(run(root, '--engine', 'coraza', 'rules').stdout).toContain('regexNotInEngine');
    expect(run(root, '--off', 'duplicateAction', 'rules').stdout).toContain('No findings');
    const only = run(root, '--engine', 'coraza', '--only', 'duplicateAction', 'rules').stdout;
    expect(only).toContain('duplicateAction');
    expect(only).not.toContain('regexNotInEngine');
  });

  it('--fix переписывает файл и больше о починенном не говорит', () => {
    const before = 'SecRule ARGS "@rx ^a\\d" \\ \n    "id:1,phase:2,pass,nolog,nolog"\n';
    write('rules/10-a.conf', before);

    const result = run(root, '--fix', 'rules');
    expect(result.stdout).toContain('No findings in 1 file. 2 fixes applied.');
    expect(result.status).toBe(0);
    expect(readFileSync(join(root, 'rules/10-a.conf'), 'utf8')).toBe(
      'SecRule ARGS "@rx ^a\\d" \\\n    "id:1,phase:2,pass,nolog"\n',
    );
  });

  it('--format json отдаёт те же замечания данными', () => {
    write('rules/10-a.conf', 'SecRule ARGS "@rx ^a\\d" "phase:2,pass"\n');
    const result = run(root, '--format', 'json', 'rules');
    const report = JSON.parse(result.stdout) as {
      files: Array<{ file: string; diagnostics: Array<{ code: string; line: number }> }>;
    };
    expect(report.files).toHaveLength(1);
    expect(report.files[0].file).toBe('rules/10-a.conf');
    expect(report.files[0].diagnostics.map((d) => [d.code, d.line])).toEqual([['missingId', 1]]);
    expect(result.status).toBe(1);
  });

  it('ошибка в самих аргументах — код возврата 2 и ни слова о правилах', () => {
    const cases: string[][] = [
      [],
      ['--engine', 'nginx', 'rules'],
      ['--off', 'noSuchCode', 'rules'],
      ['--frobnicate', 'rules'],
      ['missing-directory'],
    ];
    for (const args of cases) {
      const result = run(root, ...args);
      expect({ args, status: result.status }).toEqual({ args, status: 2 });
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('seclang:');
    }
  });

  it('--list-codes перечисляет коды и помечает исправимые', () => {
    const result = run(root, '--list-codes');
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/^error\s+structure\s+missingId$/m);
    expect(result.stdout).toMatch(/duplicateAction \(fixable\)/);
  });
});
