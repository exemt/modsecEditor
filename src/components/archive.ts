import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { NewFile } from '../store/filesSlice';

/**
 * Набор файлов одним архивом.
 *
 * Конфигурация ModSecurity — это набор, а не файл, и выносить его из вкладки по
 * одному файлу значит собирать порядок заново руками. Архив уносит набор целиком
 * и приносит обратно тоже целиком.
 *
 * Порядок в архиве не хранится: zip держит имена, а не последовательность, и
 * читатели сортируют записи как им удобнее. Поэтому имена получают числовой
 * префикс — `01-rules.conf`, — и восстановленный набор читается в том же
 * порядке включения, в каком его выгрузили. Префикс при чтении снимается: он
 * свойство архива, а не файла.
 */

/** Имя архива по умолчанию: в него уходит весь набор. */
export const ARCHIVE_NAME = 'modsec-rules.zip';

/** Расширения, которые предлагает выбрать окно открытия архива. */
export const ARCHIVE_ACCEPT = '.zip,application/zip';

/** Файл набора в том виде, в котором его упаковывают. */
export interface ArchiveFile {
  name: string;
  text: string;
}

/** Числовой префикс порядка: `01-`, `02-`. */
const ORDER_PREFIX = /^\d+[-_]/;

/**
 * Служебные записи, которых в наборе быть не должно.
 *
 * Архиваторы macOS кладут рядом с каждым файлом свою копию метаданных, и без
 * этого отбора набор из двух файлов открывался бы четырьмя, из которых половина
 * — двоичный мусор.
 */
function isJunk(path: string): boolean {
  const name = base(path);
  // Каталог приходит записью с пустым содержимым: набору он не файл.
  return path.endsWith('/') || path.startsWith('__MACOSX/') || name === '' || name.startsWith('.');
}

/** Имя файла без каталогов: в наборе путей нет, есть имена. */
function base(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return at < 0 ? path : path.slice(at + 1);
}

/** Ширина префикса: у набора из десяти файлов номера двузначные. */
function pad(count: number): number {
  return String(count).length;
}

/** Набор как содержимое архива: имена с номером порядка. */
export function archiveEntries(files: readonly ArchiveFile[]): Record<string, Uint8Array> {
  const width = pad(files.length);
  const entries: Record<string, Uint8Array> = {};
  files.forEach((file, index) => {
    const order = String(index + 1).padStart(width, '0');
    entries[`${order}-${base(file.name)}`] = strToU8(file.text);
  });
  return entries;
}

/** Архив набора: то, что уходит на диск. */
export function packArchive(files: readonly ArchiveFile[]): Uint8Array {
  // Шестой уровень — обычный компромисс zip: правила сжимаются в разы, а время
  // упаковки на файлах такого размера всё равно неразличимо.
  return zipSync(archiveEntries(files), { level: 6 });
}

/**
 * Файлы набора из архива.
 *
 * Записи сортируются по имени: номер порядка стоит в начале, поэтому
 * лексикографический порядок и есть порядок включения. Архив, собранный не
 * здесь, номеров не имеет — тогда порядок задают сами имена, и это лучшее, что
 * о нём можно узнать.
 *
 * Бросает, если это не архив: молча открытый пустой набор был бы худшим
 * ответом — человек решил бы, что архив принят и оказался пуст.
 */
export function readArchive(data: Uint8Array): NewFile[] {
  const unzipped = unzipSync(data);

  return Object.keys(unzipped)
    .filter((path) => !isJunk(path))
    .sort((a, b) => base(a).localeCompare(base(b)))
    .map((path) => ({
      name: base(path).replace(ORDER_PREFIX, ''),
      source: strFromU8(unzipped[path]),
    }));
}

/** Похоже ли выбранное на архив: по имени, до попытки его разобрать. */
export function looksLikeArchive(name: string): boolean {
  return /\.zip$/i.test(name);
}
