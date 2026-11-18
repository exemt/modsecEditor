import { fixFor, lint, parse } from '../index';
import type { DiagnosticCode, LintOptions } from '../index';

/**
 * Якоря `^` и `$` в буквальном шаблоне: когда `@rx ^admin$` — это `@streq admin`.
 *
 * ModSecurity 2 собирает `@rx` так, что `^` и `$` — края всего значения.
 * ModSecurity 3 и Coraza — в многострочном режиме: у них `^admin$` найдёт и
 * `x\nadmin`, и `admin\n`. Всё это — сценарии `anchors-…` в
 * `scripts/engines/scenarios.json`, там же видно, какие переменные движки
 * раскодируют и где перевод строки поэтому бывает.
 */

const FAMILY: DiagnosticCode[] = ['anchoredLiteralRegex', 'anchoredLiteralLines'];

/** Код замечания о якорях для одного правила; `null` — молчит. */
function code(target: string, transforms = '', options: LintOptions = {}): DiagnosticCode | null {
  const pipeline = transforms === '' ? '' : `,${transforms}`;
  const source = `SecRule ${target} "@rx ^admin$" "id:1,phase:2,pass${pipeline}"`;
  const found = lint(source, { ...options, only: FAMILY });
  return found.length === 0 ? null : found[0].code;
}

describe('якоря: края значения или границы строк', () => {
  it('во второй версии `^…$` — края всего значения, и это `@streq`', () => {
    expect(code('ARGS:user', '', { engine: 'modsecurity2' })).toBe('anchoredLiteralRegex');
  });

  it('в третьей версии и Coraza — ещё и границы строк', () => {
    expect(code('ARGS:user', '', { engine: 'modsecurity3' })).toBe('anchoredLiteralLines');
    expect(code('ARGS:user', '', { engine: 'coraza' })).toBe('anchoredLiteralLines');
    // Движок не назван — правило поведёт себя по-разному, и сказать нужно.
    expect(code('ARGS:user')).toBe('anchoredLiteralLines');
  });

  it('там, где перевода строки не бывает, разницы нет', () => {
    expect(code('REQUEST_METHOD')).toBe('anchoredLiteralRegex');
    expect(code('REQUEST_HEADERS:Content-Length')).toBe('anchoredLiteralRegex');
    expect(code('REQUEST_COOKIES:session')).toBe('anchoredLiteralRegex');
    expect(code('QUERY_STRING')).toBe('anchoredLiteralRegex');
    expect(code('RESPONSE_STATUS')).toBe('anchoredLiteralRegex');
    expect(code('&ARGS')).toBe('anchoredLiteralRegex');
  });

  it('`REQUEST_URI` третья версия раскодирует, `REQUEST_URI_RAW` — нет', () => {
    expect(code('REQUEST_URI')).toBe('anchoredLiteralLines');
    expect(code('REQUEST_URI_RAW')).toBe('anchoredLiteralRegex');
  });

  it('раскодирование возвращает перевод строки, сжатие пробелов его убирает', () => {
    expect(code('REQUEST_METHOD', 't:urlDecodeUni')).toBe('anchoredLiteralLines');
    expect(code('REQUEST_METHOD', 't:lowercase')).toBe('anchoredLiteralRegex');
    expect(code('ARGS', 't:lowercase')).toBe('anchoredLiteralLines');
    expect(code('ARGS', 't:compressWhitespace')).toBe('anchoredLiteralRegex');
    expect(code('ARGS', 't:removeWhitespace')).toBe('anchoredLiteralRegex');
    expect(code('ARGS', 't:trim')).toBe('anchoredLiteralLines');
  });

  it('из нескольких областей однострочными должны быть все', () => {
    expect(code('REQUEST_METHOD|REQUEST_HEADERS:X-Mode')).toBe('anchoredLiteralRegex');
    expect(code('REQUEST_METHOD|ARGS')).toBe('anchoredLiteralLines');
    // Хранилище — что положили, то и лежит.
    expect(code('REQUEST_METHOD|TX:mode')).toBe('anchoredLiteralLines');
  });

  it('с multiMatch оператор видит и значение до преобразований', () => {
    expect(code('ARGS', 't:compressWhitespace,multiMatch')).toBe('anchoredLiteralLines');
  });

  it('правка на `@streq` есть только там, где она ничего не меняет', () => {
    const exact = 'SecRule REQUEST_METHOD "@rx ^TRACE$" "id:1,phase:1,pass"';
    const [same] = lint(exact, { only: FAMILY });
    expect(fixFor(parse(exact), same)?.edits[0].text).toBe('@streq TRACE');

    const lines = 'SecRule ARGS:user "@rx ^admin$" "id:1,phase:2,pass"';
    const [differs] = lint(lines, { only: FAMILY });
    expect(differs.code).toBe('anchoredLiteralLines');
    expect(fixFor(parse(lines), differs)).toBeNull();
  });
});
