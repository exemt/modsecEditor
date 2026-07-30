import type { ModsecExample } from './modsecExamples';
import type { NewFile } from '../store/filesSlice';

/**
 * Пример как файл набора.
 *
 * Имя складывается из идентификатора примера, а не из его названия: название
 * переводится, а имя файла уходит в выгрузку — `first-rule.conf` читается
 * одинаково в любом языке и не меняется при смене языка под руками.
 */
export function exampleFile(example: ModsecExample): NewFile {
  return { name: `${example.id}.conf`, source: example.code, exampleId: example.id };
}
