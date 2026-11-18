/**
 * Разбор шаблонов PCRE переехал в независимый модуль: `src/seclang/regex.ts`.
 *
 * Здесь остался только адрес. Редактору шаблоны нужны в нескольких местах —
 * в проверках, в исключениях, в поле ввода, — и менять путь во всех сразу
 * незачем: логика одна, и живёт она теперь там, где от редактора не зависит.
 */

export { regexReason, reviewRegex, translateRegex } from '../seclang/regex';
export type { RegexReview, RegexRewrite, RegexTranslation } from '../seclang/regex';
