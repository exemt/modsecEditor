import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CODES, lint } from '../seclang';
import { corePhrases, diagnosticParams, translations } from './translations';
import type { Engine } from '../seclang';
import type { TranslationKey } from './translations';

/**
 * Тексты замечаний: словарь редактора против словаря ядра.
 *
 * Замечания находит ядро (`src/seclang`), а говорит о них редактор — на двух
 * языках и своими словами. Что у каждого кода есть перевод, следит сборка:
 * ключ `diag.<код>` типизирован. Здесь — то, чего типы не видят: что перевод
 * подставляет те же значения, что и текст ядра, и что готовые фразы, которые
 * ядро вкладывает в подстановки, не остаются английскими посреди русского
 * текста.
 */

const CASES = join(__dirname, '..', 'seclang', 'cases');

/** Коды, которые редактор выдаёт сам: ядро о них не знает. */
const EDITOR_CODES = ['duplicateIdCrossFile', 'actionNotEditable'];

function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();
}

function caseFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) return caseFiles(path);
    return entry.endsWith('.conf') ? [path] : [];
  });
}

describe('тексты замечаний', () => {
  const codes = Object.keys(CODES) as Array<keyof typeof CODES>;

  /** Текст замечания на языке; пустая строка — перевода нет. */
  const textOf = (locale: 'en' | 'ru', code: string): string =>
    (translations[locale] as Record<string, string | undefined>)[`diag.${code}`] ?? '';

  /**
   * У каждого кода ядра есть текст на обоих языках.
   *
   * Сборка следит за этим и сама — ключ перевода типизирован. Но тест
   * называет недостающие коды поимённо, а не одной ошибкой про несовместимые
   * объединения строк, и это первое, что стоит прочесть тому, кто добавил в
   * ядро новую проверку: `src/i18n/translations.ts`, оба словаря.
   */
  it('есть на обоих языках у каждого кода ядра', () => {
    const missing = [...codes, ...EDITOR_CODES].flatMap((code) =>
      (['en', 'ru'] as const)
        .filter((locale) => textOf(locale, code) === '')
        .map((locale) => `${locale}: diag.${code}`),
    );
    expect(missing).toEqual([]);
  });

  it('русский текст подставляет те же значения, что и английский', () => {
    for (const code of [...codes, ...EDITOR_CODES]) {
      expect({ code, used: placeholders(textOf('ru', code)) }).toEqual({
        code,
        used: placeholders(textOf('en', code)),
      });
    }
  });

  /**
   * Перевод не просит значений, которых ядро не даёт.
   *
   * Английский текст редактора для старых кодов — свой, не из ядра, и мог
   * разойтись с ним в именах подстановок. Подстановка, которой нет в данных
   * замечания, осталась бы в тексте фигурными скобками.
   */
  it('не просит у ядра подстановок, которых то не отдаёт', () => {
    for (const code of codes) {
      const offered = new Set(placeholders(CODES[code].message));
      const asked = placeholders(textOf('en', code));
      expect({ code, extra: asked.filter((name) => !offered.has(name)) }).toEqual({
        code,
        extra: [],
      });
    }
  });

  it('не хранит переводов для кодов, которых больше нет', () => {
    const known = new Set<string>([...codes, ...EDITOR_CODES]);
    const stale = Object.keys(translations.en)
      .filter((key) => key.startsWith('diag.'))
      .map((key) => key.slice('diag.'.length))
      .filter((code) => !known.has(code));

    expect(stale).toEqual([]);
  });
});

describe('фразы ядра в подстановках', () => {
  const identity = (key: TranslationKey) => translations.ru[key];

  it('в английском словаре фраза записана слово в слово как в ядре', () => {
    // По этому тексту фраза и узнаётся: разойдись он с ядром — перевод
    // молча перестал бы находиться.
    for (const [phrase, key] of corePhrases()) {
      expect([key, translations.en[key]]).toEqual([key, phrase]);
    }
  });

  it('переводит фразу и не трогает значения из файла', () => {
    expect(
      diagnosticParams({ name: 'phase', value: '9', expected: 'a positive whole number' }, identity),
    ).toEqual({ name: 'phase', value: '9', expected: 'целое положительное число' });

    // Действие по имени `tag` — значение из файла, а не фраза «тегом».
    expect(diagnosticParams({ name: 'tag' }, identity)).toEqual({ name: 'tag' });
    expect(diagnosticParams(undefined, identity)).toBeUndefined();
  });

  it('в списке возможностей шаблона переводит каждую', () => {
    expect(
      diagnosticParams({ feature: 'lookahead, backreferences', engine: 'Coraza' }, identity),
    ).toEqual({ feature: 'просмотр вперёд, обратные ссылки', engine: 'Coraza' });
  });

  /**
   * Каждая фраза, которую ядро на деле отдаёт, переведена.
   *
   * Перечня фраз у ядра нет — они записаны прямо в проверках. Зато есть
   * размеченные правила, на которых показан каждый код: всё, что на них
   * попадает в подстановки-фразы, обязано найтись в словаре.
   */
  it('знает все фразы, которые встречаются на размеченных правилах ядра', () => {
    const engines: Array<Engine | undefined> = [undefined, 'modsecurity2', 'modsecurity3', 'coraza'];
    const names = ['expected', 'actual', 'missing', 'kind', 'what', 'part'];
    const known = corePhrases();
    const unknown = new Set<string>();
    let seen = 0;

    for (const path of caseFiles(CASES)) {
      const source = readFileSync(path, 'utf8');
      for (const engine of engines) {
        for (const diagnostic of lint(source, { engine })) {
          for (const name of names) {
            const value = diagnostic.data?.[name];
            if (value === undefined) continue;
            seen++;
            if (!known.has(value)) unknown.add(`${diagnostic.code}.${name}: ${value}`);
          }
          // Возможности шаблона ядро склеивает запятыми: после перевода от
          // английских названий не должно остаться ничего.
          const feature = diagnostic.data?.feature;
          if (feature !== undefined) {
            seen++;
            const translated = diagnosticParams({ feature }, identity)?.feature ?? '';
            if (/[a-z]{4,}/.test(translated.replace(/PCRE|name/g, ''))) {
              unknown.add(`${diagnostic.code}.feature: ${feature}`);
            }
          }
        }
      }
    }

    expect([...unknown]).toEqual([]);
    // Проверка не пустая: фразы на размеченных правилах действительно есть.
    expect(seen).toBeGreaterThan(10);
  });
});
