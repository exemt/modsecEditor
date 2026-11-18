import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { applyFixes, fixesFor, lint, parse } from '../index';
import type { Statement } from '../index';

/**
 * Исправления на настоящих правилах.
 *
 * Тесты рядом проверяют исправления на примерах, написанных под них. Здесь
 * они выпускаются на корпус — на правила, которые писали другие люди и не
 * для линтера. Обещание у исправления одно: оно не делает хуже. Не ломает
 * шаблон, не теряет правило, не меняет того, что правило делает.
 *
 * Именно этот прогон нашёл, что из `.*?(…)` исправление убирало `.*` и
 * оставляло висящий `?`, а `@rx ^500$` заменяло на `@streq 500` в правиле с
 * `capture`, которому после этого нечего захватывать.
 */

const CORPUS = join(__dirname, '..', 'corpus');

function configs(directory: string): string[] {
  return readdirSync(directory)
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return configs(path);
      return /\.conf(?:\.example|-recommended)?$/.test(name) ? [path] : [];
    });
}

/** О совместимости с окружением здесь не спрашиваем: файл проверяется один. */
const OPTIONS = { codes: { txNeverSet: 'off' } } as const;

/** Чинит всё, что чинится, пока есть что чинить. */
function fixAll(source: string): { source: string; applied: number } {
  let current = source;
  let applied = 0;
  for (let pass = 0; pass < 10; pass++) {
    const result = applyFixes(current, fixesFor(parse(current), lint(current, OPTIONS)));
    if (result.applied.length === 0) break;
    applied += result.applied.length;
    current = result.source;
  }
  return { source: current, applied };
}

/** Что в правиле значимо для движка, кроме того, что исправления вправе менять. */
function shape(statement: Statement): string {
  if (statement.kind === 'Comment') return 'comment';
  if (statement.kind !== 'SecRule' && statement.kind !== 'SecAction') return statement.kind;
  const actions = (statement.actions?.items ?? [])
    // Повторы действий и преобразований исправление убирает — на то оно и
    // исправление; всё остальное обязано остаться.
    .filter((action) => action.kind !== 'Transform')
    .map((action) => `${action.name.toLowerCase()}:${action.value?.value ?? ''}`);
  return `${statement.kind} ${[...new Set(actions)].join(',')}`;
}

const files = configs(CORPUS).map((path) => ({
  name: relative(CORPUS, path).split(sep).join('/'),
  source: readFileSync(path, 'utf8'),
}));

describe('исправления на корпусе', () => {
  const results = files.map((file) => ({ ...file, fixed: fixAll(file.source) }));

  it('корпус на месте, и чинить в нём есть что', () => {
    expect(files.length).toBeGreaterThan(80);
    const applied = results.reduce((sum, file) => sum + file.fixed.applied, 0);
    expect(applied).toBeGreaterThan(30);
  });

  it('после исправлений не появляется ни одной новой ошибки', () => {
    const worse: string[] = [];
    for (const file of results) {
      if (file.fixed.applied === 0) continue;
      const errors = (source: string) =>
        lint(source, OPTIONS)
          .filter((d) => d.severity === 'error')
          .map((d) => d.code)
          .sort()
          .join(',');
      const before = errors(file.source);
      const after = errors(file.fixed.source);
      if (before !== after) worse.push(`${file.name}: было [${before}], стало [${after}]`);
    }
    expect(worse).toEqual([]);
  });

  it('ни один шаблон после исправлений не перестал собираться', () => {
    const broken: string[] = [];
    for (const file of results) {
      if (file.fixed.applied === 0) continue;
      const invalid = (source: string) => lint(source, { only: ['invalidRegex'] }).length;
      if (invalid(file.fixed.source) > invalid(file.source)) broken.push(file.name);
    }
    expect(broken).toEqual([]);
  });

  it('правила остались теми же: ни одно не пропало и не изменило действий', () => {
    const changed: string[] = [];
    for (const file of results) {
      if (file.fixed.applied === 0) continue;
      const before = parse(file.source);
      const after = parse(file.fixed.source);
      expect(after.issues).toEqual(before.issues.map((issue) => expect.objectContaining({ code: issue.code })));
      const was = before.statements.map(shape);
      const now = after.statements.map(shape);
      if (was.join('\n') !== now.join('\n')) changed.push(file.name);
    }
    expect(changed).toEqual([]);
  });

  it('правило с capture остаётся с оператором, который умеет захватывать', () => {
    for (const file of results) {
      if (file.fixed.applied === 0) continue;
      const count = (source: string) => lint(source, { only: ['captureWithoutRegex'] }).length;
      expect({ file: file.name, added: count(file.fixed.source) - count(file.source) }).toEqual({
        file: file.name,
        added: 0,
      });
    }
  });

  it('второй заход ничего не находит: исправления сходятся', () => {
    for (const file of results) {
      if (file.fixed.applied === 0) continue;
      expect({ file: file.name, again: fixAll(file.fixed.source).applied }).toEqual({
        file: file.name,
        again: 0,
      });
    }
  });
});
