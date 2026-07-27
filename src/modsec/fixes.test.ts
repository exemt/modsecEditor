import { parseModsec } from './parser';
import { compileDocument } from './compile';
import { applyRule } from './emit';
import { quickFixFor } from './fixes';
import { findRule } from './model';
import type { DiagnosticCode } from './diagnostics';
import type { FixKind } from './fixes';

/**
 * Применяет правку к первому сообщению с таким кодом и возвращает новый текст.
 *
 * Путь тот же, что и в редакторе: найти правило по адресу диагностики,
 * переписать модель, собрать текст заново.
 */
function applyFix(source: string, code: DiagnosticCode): { text: string; kind: FixKind } {
  const doc = parseModsec(source);
  const compiled = compileDocument(doc);
  const diagnostic = compiled.diagnostics.find((d) => d.code === code);
  if (!diagnostic) throw new Error(`нет диагностики ${code}`);

  const fix = quickFixFor(diagnostic);
  if (!fix) throw new Error(`нет правки для ${code}`);

  const rule = findRule(compiled.model, diagnostic.anchor?.ruleKey);
  if (!rule) throw new Error(`нет правила для ${code}`);

  return { text: applyRule(doc, fix.apply(rule)), kind: fix.kind };
}

/** Правка чинит именно то, на что жаловались, и не ломает остального. */
function expectFixed(source: string, code: DiagnosticCode): string {
  const { text } = applyFix(source, code);
  const after = compileDocument(parseModsec(text));
  expect(after.diagnostics.map((d) => d.code)).not.toContain(code);
  expect(after.errorCount).toBe(0);
  return text;
}

const CLEAN = "id:1001,phase:2,deny,msg:'x'";

describe('правки оператора', () => {
  it('приводит значение к регистру, в который его переводит конвейер', () => {
    const text = expectFixed(
      `SecRule REQUEST_METHOD "@streq POST" "${CLEAN},t:lowercase"`,
      'caseNeverMatches',
    );
    expect(text).toContain('@streq post');
  });

  it('меняет regex без спецсимволов на поиск подстроки', () => {
    const text = expectFixed(`SecRule ARGS "@rx foo" "${CLEAN}"`, 'regexIsPlainText');
    expect(text).toContain('@contains foo');
  });

  it('меняет закреплённый шаблон на точное сравнение', () => {
    const text = expectFixed(
      `SecRule REQUEST_METHOD "@rx ^POST$" "${CLEAN}"`,
      'anchoredLiteralRegex',
    );
    expect(text).toContain('@streq POST');
  });

  it('экранирует точку, которая совпадала с любым символом', () => {
    const text = expectFixed(
      `SecRule REQUEST_FILENAME "@rx admin.php" "${CLEAN}"`,
      'unescapedDot',
    );
    expect(text).toContain('admin\\.php');
  });

  it('убирает ведущее «.*»', () => {
    const text = expectFixed(
      `SecRule ARGS "@rx .*select.+" "${CLEAN}"`,
      'redundantLeadingWildcard',
    );
    expect(text).toContain('@rx select.+');
  });
});

describe('правки конвейера', () => {
  it('ставит «none» первым', () => {
    const text = expectFixed(
      `SecRule ARGS "@contains foo" "${CLEAN},t:lowercase,t:none"`,
      'transformNoneNotFirst',
    );
    expect(text.indexOf('t:none')).toBeLessThan(text.indexOf('t:lowercase'));
  });

  it('переносит декодирование перед нормализацией пути', () => {
    const text = expectFixed(
      `SecRule REQUEST_FILENAME "@contains /etc" "${CLEAN},t:normalizePath,t:urlDecodeUni"`,
      'decodeAfterNormalise',
    );
    expect(text.indexOf('t:urlDecodeUni')).toBeLessThan(text.indexOf('t:normalizePath'));
  });

  it('добавляет перевод хеша в шестнадцатеричный вид', () => {
    const text = expectFixed(
      `SecRule ARGS "@streq abc" "${CLEAN},t:md5"`,
      'hashWithoutHexEncode',
    );
    expect(text).toContain('t:hexEncode');
  });

  it('убирает преобразование, которое уже ничего не меняет', () => {
    expectFixed(
      `SecRule ARGS "@contains foo" "${CLEAN},t:removeWhitespace,t:trim"`,
      'redundantTransform',
    );
  });

  // Добавить нормализацию мало: не приведи правка и сам аргумент к нижнему
  // регистру, проверка тут же стала бы невыполнимой.
  it('добавляет нормализацию вместе с приведением аргумента', () => {
    const text = expectFixed(
      `SecRule ARGS "@contains Admin" "${CLEAN}"`,
      'noNormalisation',
    );
    expect(text).toContain('t:urlDecodeUni');
    expect(text).toContain('t:lowercase');
    expect(text).toContain('@contains admin');
  });
});

describe('правки целей и действий', () => {
  it('убирает повторную область проверки', () => {
    const text = expectFixed(`SecRule ARGS|ARGS "@rx \\d+" "${CLEAN}"`, 'duplicateTarget');
    expect(text).toContain('SecRule ARGS "');
  });

  it('переводит имя параметра с пробелом в шаблон', () => {
    const text = expectFixed(
      `SecRule "ARGS:'my param'" "@rx evil" "${CLEAN}"`,
      'selectorNeedsQuotes',
    );
    expect(text).toContain('ARGS:/^my\\x20param$/');
  });

  it('убирает коллекцию, которая уже входит в соседнюю', () => {
    const text = expectFixed(
      `SecRule ARGS|ARGS_GET "@rx \\d+" "${CLEAN}"`,
      'overlappingTargets',
    );
    expect(text).not.toContain('ARGS_GET');
  });

  it('подставляет фазу, в которой цель уже заполнена', () => {
    const text = expectFixed(
      'SecRule RESPONSE_BODY "@rx secret" "id:1001,phase:1,deny,msg:\'x\'"',
      'phaseTooEarly',
    );
    expect(text).toContain('phase:4');
  });

  it('подставляет фазу, когда она вовсе не указана', () => {
    const text = expectFixed('SecRule ARGS "@rx \\d+" "id:1001,deny,msg:\'x\'"', 'missingPhase');
    expect(text).toContain('phase:2');
  });

  it('убирает статус, который без блокировки ничего не значит', () => {
    const text = expectFixed(
      'SecRule ARGS "@rx \\d+" "id:1001,phase:2,pass,status:403,msg:\'x\'"',
      'statusWithoutBlock',
    );
    expect(text).not.toContain('status:403');
  });

  it('возвращает запись в лог блокирующему правилу', () => {
    const text = expectFixed(`SecRule ARGS "@rx \\d+" "${CLEAN},nolog"`, 'blockWithoutLog');
    expect(text).not.toContain('nolog');
  });

  it('включает захват там, где на него ссылаются', () => {
    const text = expectFixed(
      `SecRule ARGS "@rx (\\d+)" "${CLEAN},logdata:'%{TX.1}'"`,
      'captureMissing',
    );
    expect(text).toContain('capture');
  });

  it('убирает захват, которому нечего захватывать', () => {
    const text = expectFixed(
      `SecRule ARGS "@streq foo" "${CLEAN},capture"`,
      'captureWithoutRegex',
    );
    expect(text).not.toContain('capture');
  });
});

describe('границы применимости', () => {
  it('не предлагает правку там, где выбор за автором правила', () => {
    const compiled = compileDocument(
      parseModsec('SecRule ARGS "@rx \\d+" "id:1001,phase:2,msg:\'x\'"'),
    );
    const noReaction = compiled.diagnostics.find((d) => d.code === 'noDisruptive');
    expect(noReaction).toBeDefined();
    expect(quickFixFor(noReaction!)).toBeNull();
  });

  it('чинит нужное звено цепочки, а не первое попавшееся', () => {
    const text = applyFix(
      [
        `SecRule ARGS "@rx \\d+" "${CLEAN},chain"`,
        'SecRule REQUEST_METHOD "@streq POST" "t:lowercase"',
      ].join('\n'),
      'caseNeverMatches',
    ).text;

    expect(text).toContain('@rx \\d+');
    expect(text).toContain('@streq post');
  });
});
