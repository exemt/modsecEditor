/**
 * Символы, которых в конфигурации не ждут: метка порядка байтов в начале
 * файла, неразрывный пробел, типографские кавычки, символы нулевой ширины.
 *
 * Почти всегда это следы копирования — из блога, документа, мессенджера.
 * Глазом их не отличить от обычного пробела и обычной кавычки, а движок
 * читает их как часть слова: `SecRule ARGS` с неразрывным пробелом для него
 * одна незнакомая директива. Так ведут себя все три движка — пробы `w1`–`w9`
 * в `stand/probes.conf`. Разница одна: неразрывный пробел между аргументами в
 * кавычках третья версия пропускает как обычный.
 *
 * Внутри значения — в тексте `msg`, в шаблоне — типографская кавычка и
 * неразрывный пробел законны, их пишут нарочно. Невидимый символ — нет: в
 * сообщении он мусор, а шаблон с ним не найдёт того, что в нём видно
 * (сценарий `zero-width-in-pattern`).
 */

import { nodePathAt } from '../../ast';
import { REFUSED } from '../codes';
import type { Check } from '../engine';

/** Символы нулевой ширины: их не видно вовсе. */
const INVISIBLE = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x00ad]);

/** Пробелы, которые пробелом для движка не считаются. */
function isOddSpace(code: number): boolean {
  return (
    code === 0x00a0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

/** Кавычки, которые кавычками для движка не считаются. */
const ODD_QUOTES = new Set([0x2018, 0x2019, 0x201a, 0x201b, 0x201c, 0x201d, 0x201e, 0x201f, 0x00ab, 0x00bb]);

function codeOf(code: number): string {
  return `U+${code.toString(16).toUpperCase().padStart(4, '0')}`;
}

export const characters: Check = {
  name: 'characters',
  create({ file, report }) {
    const { source } = file;

    /** Стоит ли смещение внутри значения — текста действия или аргумента оператора. */
    const insideValue = (offset: number): boolean => {
      const path = nodePathAt(file, offset);
      return path.length > 0 && path[path.length - 1].kind === 'Text';
    };

    return {
      File() {
        // Метка порядка байтов в начале файла — или в начале строки, когда
        // склеили файлы, сохранённые с ней. Разборщик считает её пробелом,
        // движки — частью первого слова.
        for (let at = source.indexOf('\ufeff'); at !== -1; at = source.indexOf('\ufeff', at + 1)) {
          if (at === 0 || source[at - 1] === '\n') report('byteOrderMark', { start: at, end: at + 1 });
        }

        for (const statement of file.statements) {
          if (statement.kind === 'Comment') continue;
          let quoted = false;
          for (let at = statement.start; at < statement.end; at++) {
            const code = source.charCodeAt(at);
            if (code === 0x22 /* " */) {
              let slashes = 0;
              for (let back = at - 1; back >= statement.start && source.charCodeAt(back) === 0x5c; back--) {
                slashes++;
              }
              if (slashes % 2 === 0) quoted = !quoted;
              continue;
            }
            if (code < 0x80) continue;
            if (code === 0xfeff && (at === 0 || source[at - 1] === '\n')) continue;

            const range = { start: at, end: at + 1 };
            if (INVISIBLE.has(code) && quoted && insideValue(at)) {
              report('invisibleCharacter', range, { code: codeOf(code) });
              continue;
            }
            if (!INVISIBLE.has(code) && !isOddSpace(code) && !ODD_QUOTES.has(code)) continue;
            if (!INVISIBLE.has(code) && quoted && insideValue(at)) continue;
            // Неразрывный пробел между двумя аргументами в кавычках третья
            // версия читает как обычный (проба `w3-nbsp-before-actions`).
            const between =
              isOddSpace(code) && source[at - 1] === '"' && source[at + 1] === '"' && !quoted;
            report('strayCharacter', range, { code: codeOf(code) }, between ? REFUSED.V2_CORAZA : REFUSED.ALL);
            // Одного замечания на утверждение хватит: остальное в нём —
            // следствие того же копирования, и разобрано оно всё равно не так.
            break;
          }
        }
      },
    };
  },
};
