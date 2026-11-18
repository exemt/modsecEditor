/**
 * Правила записи значений в списках ModSecurity переехали в независимый
 * модуль: `src/seclang/quoting.ts`. Здесь остался только адрес — как и у
 * `regex.ts`.
 */

export {
  decodeQuoted,
  encodeQuoted,
  isPatternSelector,
  needsQuotes,
  selectorIssue,
  selectorPattern,
} from '../seclang/quoting';
export type { SelectorIssue } from '../seclang/quoting';
