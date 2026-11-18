/**
 * Загрузка модуля `src/seclang` в Node без сборки.
 *
 * Модуль написан так, что Node исполняет его как есть: в нём нет ничего,
 * кроме стираемых типов. Единственное, чего Node не умеет сам, — дописать
 * `.ts` к пути импорта; это делает перехватчик ниже, и только для файлов
 * самого модуля.
 *
 * Нужен Node 22.15 или новее.
 */

import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Папка модуля — для тех, кому нужны его файлы примеров. */
export const MODULE = join(HERE, '..', '..', 'src', 'seclang');
const MODULE_URL = pathToFileURL(MODULE).href;

// Исполнение TypeScript «как есть» в части версий Node ещё помечено
// опытным; предупреждение об этом к проверке правил отношения не имеет.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  if (String(warning).includes('Type Stripping')) return;
  emitWarning.call(process, warning, ...rest);
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const local = specifier.startsWith('./') || specifier.startsWith('../');
    const ours = context.parentURL !== undefined && context.parentURL.startsWith(MODULE_URL);
    if (local && ours && !/\.[cm]?[jt]s$/.test(specifier)) {
      for (const suffix of ['.ts', '/index.ts']) {
        try {
          return nextResolve(specifier + suffix, context);
        } catch {
          // Не файл — значит, папка с `index.ts`; пробуем следующий вариант.
        }
      }
    }
    return nextResolve(specifier, context);
  },
});

/** Всё, что модуль отдаёт наружу. */
export const seclang = await import(pathToFileURL(join(MODULE, 'index.ts')).href);
