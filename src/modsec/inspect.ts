/**
 * Проход по набору: все замечания о конфигурации целиком.
 *
 * Идёт он по набору файлов, а не по одному: метка для `skipAfter` бывает в
 * соседнем файле, `SecRuleEngine` — в настроечном, а номер правила занят
 * ровно один раз на всю конфигурацию. Считать это по одному файлу значило бы
 * ругаться на то, что в наборе как раз в порядке.
 *
 * Сами проверки живут в независимом ядре (`src/seclang`). Набор для него
 * держит {@link Linter}: разбор файла повторяется, только когда изменился его
 * текст, а смысл набора строится заново на каждый проход — правка одного
 * файла меняет сказанное о других. Здесь его ответ переводится на язык
 * редактора: к замечанию приписываются файл, блок конструктора и часть
 * правила, а к ним добавляется то немногое, что редактор говорит сам.
 *
 * Отделён проход от компиляции по цене: компиляция нужна к первому же кадру
 * и считается по файлу, а этот проход на большом наборе стоит десятки
 * миллисекунд и ни на что не влияет немедленно — предупреждение, появившееся
 * на кадр позже, никому ничего не испортит.
 */

import { createWorkspace } from '../seclang';
import { byLine, editorNotes, markCrossFileIds, toDiagnostics } from './diagnostics';
import { compileTree, sourceOf } from './compile';
import { LONE_FILE, fileMark } from './workspace';
import type { Workspace as Linter } from '../seclang';
import type { CompileResult } from './compile';
import type { Diagnostic, IdHolder } from './diagnostics';
import type { ParsedDocument } from './types';
import type { WorkspaceUnit } from './workspace';

export type { Linter };

/** Набор файлов для ядра: его заводят один раз и дальше только обновляют. */
export function createLinter(): Linter {
  return createWorkspace();
}

/**
 * Приводит набор ядра к файлам редактора: те же тексты в том же порядке.
 *
 * Файл называется идентификатором, а не именем: имена в наборе повторяются,
 * а замечание должно вернуться ровно в тот файл, о котором сказано. Текст,
 * который не менялся, ядро заново не разбирает — ради этого набор и хранится.
 */
export function syncLinter(
  linter: Linter,
  files: ReadonlyArray<{ id: string; source: string }>,
): void {
  const ids = new Set(files.map((file) => file.id));
  for (const name of linter.names()) {
    if (!ids.has(name)) linter.delete(name);
  }
  for (const file of files) linter.set(file.id, file.source);
  linter.reorder(files.map((file) => file.id));
}

/**
 * Кто в наборе держит каждый номер правила первым — и какие блоки повторяют
 * номер, уже занятый выше в их же файле.
 *
 * По этому повтор номера делится на два случая: внутри файла и через файлы
 * (см. `markCrossFileIds`). Файлы читаются в порядке включения — лишним
 * ядро считает то правило, что загружено позже.
 */
function idHolders(units: readonly WorkspaceUnit[]): {
  first: Map<string, IdHolder>;
  local: Map<string, Set<string>>;
} {
  const first = new Map<string, IdHolder>();
  const local = new Map<string, Set<string>>();

  for (const unit of units) {
    const seenHere = new Set<string>();
    const repeated = new Set<string>();

    for (const block of unit.blocks) {
      if (block.kind !== 'rule' && block.kind !== 'action') continue;
      const actions = block.kind === 'rule' ? block.rule.actions : block.actions;
      const id = actions.id.trim();
      if (id === '') continue;

      if (seenHere.has(id)) repeated.add(block.key);
      seenHere.add(id);

      if (!first.has(id)) {
        const index = block.kind === 'rule' ? block.rule.headIndex : block.statementIndex;
        first.set(id, {
          file: unit.id,
          name: unit.name,
          line: unit.statements[index]?.span.startLine,
        });
      }
    }
    local.set(unit.id, repeated);
  }

  return { first, local };
}

const NO_KEYS: ReadonlySet<string> = new Set();

/**
 * Все замечания набора, по файлам в порядке включения.
 *
 * `linter` должен держать те же файлы, что и `units`: об этом заботится
 * {@link syncLinter}. Файл, которого у ядра нет, пропускается — сказать о
 * нём нечего.
 */
export function inspectWorkspace(units: readonly WorkspaceUnit[], linter: Linter): Diagnostic[] {
  const found = new Map(linter.lint().map((result) => [result.name, result.diagnostics]));
  const holders = idHolders(units);
  const all: Diagnostic[] = [];

  for (const unit of units) {
    const tree = linter.tree(unit.id);
    if (tree === null) continue;

    const view = {
      file: fileMark(unit.id),
      tree,
      statements: unit.statements,
      blocks: unit.blocks,
    };
    const fromCore = markCrossFileIds(
      toDiagnostics(found.get(unit.id) ?? [], view),
      unit.id,
      holders.first,
      holders.local.get(unit.id) ?? NO_KEYS,
    );
    // Оговорки редактора встают после замечаний ядра о той же строке: сперва
    // то, что не так с правилом, потом то, что не так с его показом.
    all.push(...byLine([...fromCore, ...editorNotes(view)]));
  }

  return all;
}

/** Компиляция документа вместе со всеми замечаниями о нём. */
export interface DocumentAnalysis extends CompileResult {
  errorCount: number;
  warningCount: number;
  /** Советы считаются отдельно: они не должны красить сводку. */
  adviceCount: number;
}

/**
 * Полный ответ об одиноком документе: компиляция и проход по набору из
 * одного файла, разом и до конца.
 *
 * Приложение так не делает: набор у него живёт долго, обновляется по файлу,
 * а проход по большому набору ждёт паузы. Но там, где нужен ответ о тексте
 * целиком — в тестах и в разборе примеров, — дробить его не на что, а
 * заводить набор руками каждый раз незачем.
 *
 * `diagnostics` здесь — все замечания, а не только ошибки загрузки, как у
 * самой компиляции.
 */
export function analyzeDocument(doc: ParsedDocument | null): DocumentAnalysis {
  const linter = createLinter();
  if (doc !== null) linter.set(LONE_FILE, sourceOf(doc));
  const tree = linter.tree(LONE_FILE);

  const compiled: CompileResult =
    doc === null || tree === null
      ? { ok: false, model: null, blocks: [], diagnostics: [] }
      : compileTree(tree, doc);
  const diagnostics =
    doc === null
      ? []
      : inspectWorkspace(
          [{ id: LONE_FILE, name: '', blocks: compiled.blocks, statements: doc.statements }],
          linter,
        );
  const count = (severity: Diagnostic['severity']) =>
    diagnostics.filter((d) => d.severity === severity).length;

  return {
    ...compiled,
    diagnostics,
    errorCount: count('error'),
    warningCount: count('warning'),
    adviceCount: count('advice'),
  };
}
