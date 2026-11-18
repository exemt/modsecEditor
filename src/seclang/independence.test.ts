import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

/**
 * Модуль обещает ничего не знать о редакторе. Обещание проверяется здесь:
 * ни один его файл, кроме тестов, не импортирует ничего снаружи своей
 * папки — ни соседних частей приложения, ни пакетов.
 */

const ROOT = __dirname;

function sources(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry) ? [path] : [];
  });
}

function imports(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

describe('самодостаточность модуля', () => {
  const files = sources(ROOT);

  it('состоит из файлов, которые тест действительно нашёл', () => {
    expect(files.length).toBeGreaterThan(8);
  });

  it.each(files.map((file) => [relative(ROOT, file).split(sep).join('/'), file]))(
    '%s импортирует только соседей по папке',
    (_name, file) => {
      for (const specifier of imports(file)) {
        expect(specifier.startsWith('.')).toBe(true);
        const target = resolve(dirname(file), specifier);
        expect(relative(ROOT, target).startsWith('..')).toBe(false);
      }
    },
  );
});
