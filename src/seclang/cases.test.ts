import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CODES, lint, lintWorkspace, parse } from './index';
import type { ActionNode, Statement } from './ast';
import type { Diagnostic, LintOptions } from './index';

/**
 * Размеченные примеры из папки `cases`.
 *
 * Тест здесь — сами файлы правил: чтобы добавить случай, достаточно
 * дописать в `.conf` блок с пометкой, что о нём должен сказать линтер.
 * Формат пометок описан в шапке каждого файла.
 */

const CASES = join(__dirname, 'cases');

function read(name: string): string {
  // Файлы хранятся с LF, но на чужой машине git может выдать CRLF —
  // пометки от этого зависеть не должны.
  return readFileSync(join(CASES, name), 'utf8').replace(/\r\n/g, '\n');
}

/** Блоки файла: строка пометки, её текст и строки, которые блок занимает. */
interface Block {
  line: number;
  label: string;
  endLine: number;
}

function blocks(source: string, marker: RegExp): Block[] {
  const lines = source.split('\n');
  const found: Block[] = [];
  lines.forEach((text, index) => {
    const match = marker.exec(text);
    if (match === null) return;
    if (found.length > 0) found[found.length - 1].endLine = index;
    found.push({ line: index + 1, label: match[1].trim(), endLine: lines.length });
  });
  return found;
}

/** Первая строка блока, которая не комментарий: по ней блок узнают в отчёте. */
function title(source: string, block: Block): string {
  const lines = source.split('\n').slice(block.line, block.endLine);
  const first = lines.find((text) => text.trim() !== '' && !text.trim().startsWith('#'));
  return `${block.line}: ${(first ?? '').trim().slice(0, 70)}`;
}

/* ------------------------------------------------------------------ */
/* Линтер: что сказано о каждом блоке                                  */
/* ------------------------------------------------------------------ */

const EXPECT = /^#\s*expect:(.*)$/;

/**
 * Настройки линтера для файла: строка `# options: {"engine":"coraza"}`.
 *
 * Нужна примерам, которые без настройки не показать: замечания о
 * совместимости с движком появляются, только когда движок назван.
 */
function optionsOf(source: string): LintOptions {
  const match = /^#\s*options:\s*(\{.*\})\s*$/m.exec(source);
  return match === null ? {} : (JSON.parse(match[1]) as LintOptions);
}

interface Expectation {
  file: string;
  title: string;
  expected: string[];
  actual: string[];
}

function expectations(file: string, found?: Diagnostic[]): Expectation[] {
  const source = read(file);
  const diagnostics = found ?? lint(source, optionsOf(source));

  return blocks(source, EXPECT).map((block) => ({
    file,
    title: title(source, block),
    expected: block.label === '-' ? [] : block.label.split(/[\s,]+/).sort(),
    actual: diagnostics
      .filter((d) => d.line > block.line && d.line <= block.endLine)
      .map((d) => d.code)
      .sort(),
  }));
}

/** Файлы с пометками `# expect:`; первый — правила без замечаний. */
const ANNOTATED = [
  'clean.conf',
  'findings.conf',
  'reactions.conf',
  'captures.conf',
  'security.conf',
  'exclusions.conf',
  'environment.conf',
  'files.conf',
  'coraza.conf',
  'modsecurity3.conf',
];
const FINDINGS = ANNOTATED.slice(1);

describe.each(ANNOTATED)('размеченные правила: %s', (file) => {
  const all = expectations(file);

  it('в файле есть блоки, и вне блоков правил нет', () => {
    expect(all.length).toBeGreaterThan(5);

    const source = read(file);
    const first = blocks(source, EXPECT)[0].line;
    const before = parse(source).statements.filter((s) => s.kind !== 'Comment' && s.line < first);
    expect(before).toEqual([]);
  });

  it.each(all.map((item) => [item.title, item]))('%s', (_title, item) => {
    expect(item.actual).toEqual(item.expected);
  });
});

/**
 * Набор из нескольких файлов: папка `workspace`, файлы в порядке имён.
 *
 * Часть замечаний в одном файле не показать: они о том, что указатель и то,
 * на что он указывает, лежат в разных файлах. Формат пометок тот же, но
 * проверяются файлы вместе — как их подключил бы `Include`.
 */
const WORKSPACE = 'workspace';

function workspaceExpectations(): Expectation[] {
  const names = readdirSync(join(CASES, WORKSPACE))
    .sort()
    .map((name) => `${WORKSPACE}/${name}`);
  const results = lintWorkspace(names.map((name) => ({ name, source: read(name) })));
  return results.flatMap((result) => expectations(result.name, result.diagnostics));
}

describe('размеченные правила: набор из нескольких файлов', () => {
  const all = workspaceExpectations();

  it('в наборе несколько файлов, и в каждом есть блоки', () => {
    const files = new Set(all.map((item) => item.file));
    expect(files.size).toBeGreaterThan(2);
  });

  it.each(all.map((item) => [`${item.file} › ${item.title}`, item]))('%s', (_title, item) => {
    expect(item.actual).toEqual(item.expected);
  });

  it('по одному эти файлы читаются иначе: набор — не сумма файлов', () => {
    // Фаза и реакция правил второго файла приходят из умолчаний первого;
    // без него правилу их взять неоткуда.
    const alone = lint(read(`${WORKSPACE}/20-rules.conf`)).map((d) => d.code);
    expect(alone).toEqual(expect.arrayContaining(['missingPhase']));
  });
});

describe('размеченные правила: полнота', () => {
  const everything = [...FINDINGS.flatMap((file) => expectations(file)), ...workspaceExpectations()];

  it('каждый код замечания показан хотя бы одним примером', () => {
    const shown = new Set(everything.flatMap((item) => item.expected));
    const missing = Object.keys(CODES).filter((code) => !shown.has(code));
    expect(missing).toEqual([]);
  });

  it('в пометках нет кодов, которых не существует', () => {
    const known = new Set(Object.keys(CODES));
    const unknown = everything.flatMap((item) => item.expected).filter((code) => !known.has(code));
    expect(unknown).toEqual([]);
  });

  it('все файлы папки проверяются каким-нибудь тестом', () => {
    expect(readdirSync(CASES).sort()).toEqual([...ANNOTATED, 'equivalent.conf', WORKSPACE].sort());
  });
});

/* ------------------------------------------------------------------ */
/* Парсер: разная запись — один разбор                                 */
/* ------------------------------------------------------------------ */

const GROUP = /^#\s*group:(.*)$/;

function actionShape(action: ActionNode): unknown[] {
  const base = [action.kind, action.name, action.value?.value ?? null];
  switch (action.kind) {
    case 'Transform':
      return [...base, action.transform];
    case 'Setvar':
      return [...base, action.collection, action.key, action.op, action.operand];
    case 'Ctl':
      return [...base, action.option, action.operand];
    default:
      return base;
  }
}

/** Всё, что в утверждении значимо, и ничего о том, как оно записано. */
function shape(statement: Statement): unknown {
  switch (statement.kind) {
    case 'SecRule':
      return {
        kind: statement.kind,
        variables: (statement.variables?.items ?? []).map((v) => [
          v.name,
          v.exclude,
          v.count,
          v.selector?.value ?? null,
        ]),
        operator: statement.operator && [
          statement.operator.name,
          statement.operator.negated,
          statement.operator.argument.value,
        ],
        actions: (statement.actions?.items ?? []).map(actionShape),
      };
    case 'SecRuleScript':
      return {
        kind: statement.kind,
        script: statement.script?.value ?? null,
        actions: (statement.actions?.items ?? []).map(actionShape),
      };
    case 'SecAction':
    case 'SecDefaultAction':
      return {
        kind: statement.kind,
        actions: (statement.actions?.items ?? []).map(actionShape),
      };
    case 'SecMarker':
      return { kind: statement.kind, label: statement.label?.value ?? null };
    case 'Directive':
      return { kind: statement.kind, name: statement.name, args: statement.args.map((a) => a.value) };
    default:
      return { kind: statement.kind };
  }
}

describe('эквивалентные записи: equivalent.conf', () => {
  const source = read('equivalent.conf');
  const file = parse(source);
  const groups = blocks(source, GROUP).map((block) => ({
    label: block.label,
    statements: file.statements.filter(
      (s) => s.kind !== 'Comment' && s.line > block.line && s.line <= block.endLine,
    ),
  }));

  it('разбирается без замечаний парсера', () => {
    expect(file.issues).toEqual([]);
    expect(groups.length).toBeGreaterThan(5);
  });

  it.each(groups.map((group) => [group.label, group]))('%s', (_label, group) => {
    expect(group.statements.length).toBeGreaterThan(1);
    const [first, ...rest] = group.statements.map(shape);
    for (const other of rest) expect(other).toEqual(first);
  });

  it('границы каждого утверждения — ровно его текст', () => {
    for (const statement of file.statements) {
      const text = source.slice(statement.start, statement.end);
      expect(text).toBe(text.trim());
      if (statement.kind !== 'Comment') {
        expect(text.toLowerCase().startsWith(statement.name.toLowerCase())).toBe(true);
      }
    }
  });
});
