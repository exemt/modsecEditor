import { FIXABLE, parse } from '../seclang';
import { parseModsec } from './parser';
import { compileDocument } from './compile';
import { analyzeDocument } from './inspect';
import { applyRule } from './emit';
import { TEXT_FIX_KINDS, quickFixFor } from './fixes';
import type { DiagnosticCode } from './diagnostics';
import type { FixKind, QuickFix } from './fixes';

/**
 * Применяет правку к первому сообщению с таким кодом и возвращает новый текст.
 *
 * Путь тот же, что и в редакторе: правка текста переписывает исходник сама,
 * а для правки модели нужно найти правило по адресу диагностики, переписать
 * модель и собрать текст заново.
 */
function applyFix(
  source: string,
  code: DiagnosticCode,
): { text: string; kind: FixKind; via: QuickFix['via'] } {
  const doc = parseModsec(source);
  const compiled = analyzeDocument(doc);
  const diagnostic = compiled.diagnostics.find((d) => d.code === code);
  if (!diagnostic) throw new Error(`нет диагностики ${code}`);

  const fix = quickFixFor(diagnostic, parse(source));
  if (!fix) throw new Error(`нет правки для ${code}`);
  if (fix.via === 'text') return { text: fix.apply(), kind: fix.kind, via: fix.via };

  const block = compiled.model?.blocks.find((b) => b.key === diagnostic.anchor?.ruleKey);
  if (block?.kind !== 'rule') throw new Error(`нет правила для ${code}`);
  return { text: applyRule(doc, fix.apply(block.rule)), kind: fix.kind, via: fix.via };
}

/** Правка чинит именно то, на что жаловались, и не ломает остального. */
function expectFixed(source: string, code: DiagnosticCode): string {
  const { text } = applyFix(source, code);
  const before = analyzeDocument(parseModsec(source));
  const after = analyzeDocument(parseModsec(text));

  expect(after.diagnostics.map((d) => d.code)).not.toContain(code);
  // Чинить одно ценой другого нельзя: ни закрыть конструктор, ни добавить
  // ошибку, которой до правки не было.
  expect(after.ok).toBe(true);
  expect(after.errorCount).toBeLessThanOrEqual(before.errorCount);
  return text;
}

const CLEAN = "id:1001,phase:2,deny,msg:'x'";

describe('правки текста: исправления ядра', () => {
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

  it('убирает ведущее «.*»', () => {
    const text = expectFixed(
      `SecRule ARGS "@rx .*select.+" "${CLEAN}"`,
      'redundantLeadingWildcard',
    );
    expect(text).toContain('@rx select.+');
  });

  it('убирает преобразование, которое уже ничего не меняет', () => {
    const text = expectFixed(
      `SecRule ARGS "@contains foo" "${CLEAN},t:removeWhitespace,t:trim"`,
      'redundantTransform',
    );
    expect(text).toContain('t:removeWhitespace');
    expect(text).not.toContain('t:trim');
  });

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

  it('убирает действие, записанное дважды', () => {
    const text = expectFixed(`SecRule ARGS "@rx \\d+" "${CLEAN},capture,capture"`, 'duplicateAction');
    expect(text.match(/capture/g)).toHaveLength(1);
  });

  /**
   * Правка текста трогает только то место, о котором сказано.
   *
   * Правило CRS записано по действию на строку, и после правки оно обязано
   * остаться записанным так же: пересобери редактор правило из модели — и
   * вместе с лишним шагом пропала бы вся авторская раскладка.
   */
  it('не трогает раскладку правила вокруг исправленного места', () => {
    const source = [
      '# Описание правила',
      'SecRule ARGS "@rx \\d+" \\',
      '    "id:1001,\\',
      '    phase:2,\\',
      '    deny,\\',
      '    t:lowercase,\\',
      '    t:lowercase,\\',
      "    msg:'x'\"",
      '',
      'SecMarker END',
    ].join('\n');

    const { text, via } = applyFix(source, 'duplicateTransform');

    expect(via).toBe('text');
    expect(text).toBe(
      [
        '# Описание правила',
        'SecRule ARGS "@rx \\d+" \\',
        '    "id:1001,\\',
        '    phase:2,\\',
        '    deny,\\',
        '    t:lowercase,\\',
        "    msg:'x'\"",
        '',
        'SecMarker END',
      ].join('\n'),
    );
  });

  /**
   * Правке текста модель не нужна — и это не мелочь.
   *
   * Пробел после переноса закрывает конструктор: запись читается не так, как
   * написана. Правка, которой нужна модель, здесь была бы недоступна ровно
   * тогда, когда она нужнее всего.
   */
  it('работает там, где конструктор закрыт, и открывает его', () => {
    const source = `SecRule ARGS "@rx \\d+" \\ \n    "${CLEAN}"`;
    expect(compileDocument(parseModsec(source)).ok).toBe(false);

    const { text, via } = applyFix(source, 'continuationSpace');

    expect(via).toBe('text');
    expect(text).toBe(`SecRule ARGS "@rx \\d+" \\\n    "${CLEAN}"`);
    expect(compileDocument(parseModsec(text)).ok).toBe(true);
  });

  it('без дерева файла правку текста не предлагает', () => {
    const diagnostic = analyzeDocument(
      parseModsec(`SecRule ARGS "@rx foo" "${CLEAN}"`),
    ).diagnostics.find((d) => d.code === 'regexIsPlainText');

    expect(quickFixFor(diagnostic!)).toBeNull();
  });

  /**
   * У каждого исправления ядра есть подпись кнопки.
   *
   * Список того, что ядро умеет чинить, растёт вместе с ним. Исправление без
   * записи здесь не появилось бы в редакторе вовсе — молча.
   */
  it('подписывает каждое исправление, которое умеет ядро', () => {
    expect(Object.keys(TEXT_FIX_KINDS).sort()).toEqual([...FIXABLE].sort());
  });
});

describe('правки модели: оператор', () => {
  it('приводит значение к регистру, в который его переводит конвейер', () => {
    const { text, via } = applyFix(
      `SecRule REQUEST_METHOD "@streq POST" "${CLEAN},t:lowercase"`,
      'caseNeverMatches',
    );
    expect(via).toBe('model');
    expect(text).toContain('@streq post');
  });

  it('в шаблоне приводит буквы, а экранированные классы не трогает', () => {
    // `\D` в нижнем регистре — уже другой класс: шаблон искал бы не то.
    const text = applyFix(
      `SecRule REQUEST_METHOD "@rx ^POST\\D" "${CLEAN},t:lowercase"`,
      'caseNeverMatches',
    ).text;
    expect(text).toContain('@rx ^post\\D');
  });

  it('экранирует точку, которая совпадала с любым символом', () => {
    const text = expectFixed(
      `SecRule REQUEST_FILENAME "@rx admin.php" "${CLEAN}"`,
      'unescapedDot',
    );
    expect(text).toContain('admin\\.php');
  });
});

describe('правки модели: конвейер', () => {
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

describe('правки модели: цели и действия', () => {
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

  // `capture` действует на оператор того звена, в котором записан: в голове
  // он шаблону звена не поможет, и замечание после такой «правки» осталось бы.
  it('ставит захват звену, которое находит группу, а не голове', () => {
    const text = expectFixed(
      [
        `SecRule REQUEST_METHOD "@streq POST" "${CLEAN},chain"`,
        '    SecRule ARGS "@rx ^(a)" "t:none,setvar:tx.found=%{TX.1}"',
      ].join('\n'),
      'captureMissing',
    );
    const [head, link] = text.split(/\n(?=\s*SecRule)/);
    expect(head).not.toContain('capture');
    expect(link).toContain('capture');
  });

  it('снимает захват с того звена, где он записан', () => {
    const text = expectFixed(
      [
        `SecRule REQUEST_METHOD "@streq POST" "${CLEAN},chain"`,
        '    SecRule ARGS "@rx ^(?:a)" "t:none,capture"',
      ].join('\n'),
      'captureUnused',
    );
    expect(text).not.toContain('capture');
    expect(text).toContain('t:none');
  });
});

describe('границы применимости', () => {
  it('не предлагает правку там, где выбор за автором правила', () => {
    const source = 'SecRule ARGS "@rx \\d+" "id:1001,phase:2,msg:\'x\'"';
    const compiled = analyzeDocument(parseModsec(source));
    const noReaction = compiled.diagnostics.find((d) => d.code === 'noDisruptive');

    expect(noReaction).toBeDefined();
    expect(quickFixFor(noReaction!, parse(source))).toBeNull();
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
