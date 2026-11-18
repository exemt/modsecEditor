/**
 * Набор файлов, который проверяют много раз.
 *
 * `lintWorkspace` каждый раз разбирает все файлы заново — для разовой
 * проверки это честно и просто. Но у редактора набор живёт долго, а
 * меняется в нём один файл за раз: разбирать ради одной буквы весь CRS
 * незачем.
 *
 * Здесь разбор хранится по файлам и повторяется только для того, чей текст
 * изменился. Модель набора при этом строится заново: метки, номера и
 * переменные связывают файлы между собой, и правка одного меняет то, что
 * сказано о других. Она дешевле разбора и линейна по числу правил.
 */

import { analyzeAll } from '../analyze';
import { parse } from '../parser';
import { lintFile } from './engine';
import type { FileNode } from '../ast';
import type { Check, FileDiagnostics, LintOptions } from './engine';

export interface Workspace {
  /**
   * Кладёт файл в набор или заменяет его текст. Новый файл встаёт в конец
   * порядка загрузки; заменённый остаётся на своём месте.
   */
  set(name: string, source: string): void;
  /** Убирает файл; `false` — такого не было. */
  delete(name: string): boolean;
  /** Задаёт порядок загрузки. Файлы, которых в списке нет, идут следом. */
  reorder(names: readonly string[]): void;
  /** Имена файлов в порядке загрузки. */
  names(): string[];
  /** Дерево файла — то же, по которому считаются замечания. */
  tree(name: string): FileNode | null;
  /** Замечания по файлам, в порядке загрузки. */
  lint(options?: LintOptions): FileDiagnostics[];
}

interface Entry {
  source: string;
  tree: FileNode;
}

/** Создаёт набор; `checks` — проверки, которыми его будут проверять. */
export function createWorkspaceWith(checks: readonly Check[], defaults: LintOptions = {}): Workspace {
  const entries = new Map<string, Entry>();

  return {
    set(name, source) {
      const known = entries.get(name);
      // Тот же текст — то же дерево: именно ради этого набор и хранится.
      if (known !== undefined && known.source === source) return;
      const entry = { source, tree: parse(source) };
      // Замена значения в `Map` место ключа сохраняет: порядок загрузки
      // от правки файла не меняется.
      entries.set(name, entry);
    },

    delete(name) {
      return entries.delete(name);
    },

    reorder(names) {
      const next = new Map<string, Entry>();
      for (const name of names) {
        const entry = entries.get(name);
        if (entry !== undefined) next.set(name, entry);
      }
      for (const [name, entry] of entries) {
        if (!next.has(name)) next.set(name, entry);
      }
      entries.clear();
      for (const [name, entry] of next) entries.set(name, entry);
    },

    names() {
      return [...entries.keys()];
    },

    tree(name) {
      return entries.get(name)?.tree ?? null;
    },

    lint(options) {
      const merged = options === undefined ? defaults : { ...defaults, ...options };
      const names = [...entries.keys()];
      const trees = names.map((name) => (entries.get(name) as Entry).tree);
      const models = analyzeAll(trees, names);
      return names.map((name, index) => ({
        name,
        diagnostics: lintFile(trees[index], merged.checks ?? checks, merged, models[index]),
      }));
    },
  };
}
