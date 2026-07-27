import { parseModsec } from './parser';
import { compileDocument } from './compile';
import { DIAGNOSTIC_CATALOG } from './diagnostics';
import type { DiagnosticCode } from './diagnostics';

function codes(source: string): DiagnosticCode[] {
  return compileDocument(parseModsec(source)).diagnostics.map((d) => d.code);
}

/** Действия, с которыми правило само по себе не порождает замечаний. */
const CLEAN = "id:1001,phase:2,deny,msg:'x'";

describe('проверка не сработает никогда', () => {
  it('ловит аргумент в верхнем регистре после t:lowercase', () => {
    expect(
      codes(`SecRule REQUEST_METHOD "@streq POST" "${CLEAN},t:lowercase"`),
    ).toContain('caseNeverMatches');
  });

  it('молчит, когда аргумент уже приведён к нижнему регистру', () => {
    expect(
      codes(`SecRule REQUEST_METHOD "@streq post" "${CLEAN},t:lowercase"`),
    ).not.toContain('caseNeverMatches');
  });

  // `(?i)` снимает вопрос о регистре: шаблон совпадёт с любым написанием.
  it('не придирается к регистру в шаблоне без учёта регистра', () => {
    expect(
      codes(`SecRule ARGS "@rx (?i)SELECT" "${CLEAN},t:lowercase"`),
    ).not.toContain('caseNeverMatches');
  });

  it('ловит пробел в аргументе после t:removeWhitespace', () => {
    expect(
      codes(`SecRule ARGS "@contains union select" "${CLEAN},t:removeWhitespace"`),
    ).toContain('whitespaceNeverMatches');
  });

  it('ловит сравнение сырого хеша с текстом', () => {
    expect(codes(`SecRule ARGS "@streq abc" "${CLEAN},t:md5"`)).toContain(
      'hashWithoutHexEncode',
    );
  });

  it('молчит, когда хеш переведён в шестнадцатеричный вид', () => {
    expect(codes(`SecRule ARGS "@streq abc" "${CLEAN},t:md5,t:hexEncode"`)).not.toContain(
      'hashWithoutHexEncode',
    );
  });

  it('ловит взаимно отменяющие приведения регистра', () => {
    expect(
      codes(`SecRule ARGS "@contains foo" "${CLEAN},t:lowercase,t:uppercase"`),
    ).toContain('conflictingCaseTransforms');
  });

  it('ловит несовместимые числовые сравнения одной цели в цепочке', () => {
    expect(
      codes(
        [
          `SecRule &ARGS "@gt 10" "${CLEAN},chain"`,
          'SecRule &ARGS "@lt 5" ""',
        ].join('\n'),
      ),
    ).toContain('impossibleNumericRange');
  });

  it('молчит, когда промежутки пересекаются', () => {
    expect(
      codes(
        [
          `SecRule &ARGS "@gt 5" "${CLEAN},chain"`,
          'SecRule &ARGS "@lt 10" ""',
        ].join('\n'),
      ),
    ).not.toContain('impossibleNumericRange');
  });

  it('ловит шаблон, записанный в буквальном операторе', () => {
    expect(codes(`SecRule REQUEST_FILENAME "@beginsWith ^/admin" "${CLEAN}"`)).toContain(
      'literalWithRegexSyntax',
    );
  });

  it('ловит отрицание шаблона, подходящего ко всему', () => {
    expect(codes(`SecRule ARGS "!@rx .*" "${CLEAN}"`)).toContain('negationMatchesNothing');
  });

  it('ловит сравнение количества с отрицательным числом', () => {
    expect(codes(`SecRule &ARGS "@lt 0" "${CLEAN}"`)).toContain('neverTrueComparison');
  });
});

describe('проверка срабатывает всегда', () => {
  it('ловит шаблон, подходящий к любому значению', () => {
    expect(codes(`SecRule ARGS "@rx .*" "${CLEAN}"`)).toContain('matchesEverything');
  });

  it('ловит сравнение количества с нулём снизу', () => {
    expect(codes(`SecRule &ARGS "@ge 0" "${CLEAN}"`)).toContain('alwaysTrueComparison');
  });
});

describe('покрытие', () => {
  it('ловит декодирование после нормализации пути', () => {
    expect(
      codes(
        `SecRule REQUEST_FILENAME "@contains /etc" "${CLEAN},t:normalizePath,t:urlDecodeUni"`,
      ),
    ).toContain('decodeAfterNormalise');
  });

  it('молчит, когда декодирование стоит первым', () => {
    expect(
      codes(
        `SecRule REQUEST_FILENAME "@contains /etc" "${CLEAN},t:urlDecodeUni,t:normalizePath"`,
      ),
    ).not.toContain('decodeAfterNormalise');
  });

  it('советует нормализацию для проверки текста от клиента', () => {
    expect(codes(`SecRule ARGS "@contains admin" "${CLEAN}"`)).toContain('noNormalisation');
  });

  it('ловит вложенную коллекцию рядом с объемлющей', () => {
    expect(codes(`SecRule ARGS|ARGS_GET "@rx \\d+" "${CLEAN}"`)).toContain(
      'overlappingTargets',
    );
  });

  it('ловит повтор одной и той же области проверки', () => {
    expect(codes(`SecRule ARGS|ARGS "@rx \\d+" "${CLEAN}"`)).toContain('duplicateTarget');
  });
});

describe('окружение файла', () => {
  it('ловит проверку тела запроса при выключенном разборе', () => {
    expect(
      codes(`SecRequestBodyAccess Off\nSecRule REQUEST_BODY "@rx \\d+" "${CLEAN}"`),
    ).toContain('requestBodyAccessOff');
  });

  it('молчит, когда про разбор тела в файле ничего не сказано', () => {
    expect(codes(`SecRule REQUEST_BODY "@rx \\d+" "${CLEAN}"`)).not.toContain(
      'requestBodyAccessOff',
    );
  });

  it('ловит блокировку в фазе логирования', () => {
    expect(codes('SecRule RESPONSE_STATUS "@eq 500" "id:1,phase:5,deny"')).toContain(
      'disruptiveInLoggingPhase',
    );
  });

  it('ловит переход к несуществующей метке', () => {
    expect(codes(`SecRule ARGS "@rx \\d+" "${CLEAN},skipAfter:END"`)).toContain(
      'missingMarker',
    );
  });

  it('молчит, когда метка в файле есть', () => {
    expect(
      codes(`SecRule ARGS "@rx \\d+" "${CLEAN},skipAfter:END"\nSecMarker END`),
    ).not.toContain('missingMarker');
  });

  it('предупреждает, что в режиме наблюдения deny не сработает', () => {
    expect(codes(`SecRuleEngine DetectionOnly\nSecRule ARGS "@rx \\d+" "${CLEAN}"`)).toContain(
      'engineNotEnforcing',
    );
  });

  it('ловит переменную транзакции, которую никто не выставляет', () => {
    expect(codes('SecRule TX:score "@gt 5" "id:1,phase:2,deny,msg:\'x\'"')).toContain(
      'txNeverSet',
    );
  });

  it('молчит, когда переменную выставляет правило того же файла', () => {
    expect(
      codes(
        [
          "SecAction \"id:1,phase:1,pass,nolog,setvar:tx.score=0\"",
          "SecRule TX:score \"@gt 5\" \"id:2,phase:2,deny,msg:'x'\"",
        ].join('\n'),
      ),
    ).not.toContain('txNeverSet');
  });
});

describe('логи и отладка', () => {
  it('ловит ссылку на захват без действия capture', () => {
    expect(codes(`SecRule ARGS "@rx (\\d+)" "${CLEAN},logdata:'%{TX.1}'"`)).toContain(
      'captureMissing',
    );
  });

  it('ловит capture там, где захватывать нечего', () => {
    expect(codes(`SecRule ARGS "@streq foo" "${CLEAN},capture"`)).toContain(
      'captureWithoutRegex',
    );
  });

  it('ловит блокировку без записи в лог', () => {
    expect(codes(`SecRule ARGS "@rx \\d+" "${CLEAN},nolog"`)).toContain('blockWithoutLog');
  });

  it('ловит блокировку без сообщения', () => {
    expect(codes('SecRule ARGS "@rx \\d+" "id:1,phase:2,deny"')).toContain('blockWithoutMsg');
  });
});

describe('адрес перенаправления', () => {
  it('ловит redirect без адреса', () => {
    expect(codes(`SecRule ARGS "@rx \\d+" "id:1,phase:2,redirect,msg:'x'"`)).toContain(
      'destinationMissing',
    );
  });

  it('молчит, когда адрес указан', () => {
    expect(
      codes(`SecRule ARGS "@rx \\d+" "id:1,phase:2,redirect:/blocked.html,msg:'x'"`),
    ).not.toContain('destinationMissing');
  });

  it('ловит адрес у реакции, которая его не принимает', () => {
    expect(codes(`SecRule ARGS "@rx \\d+" "id:1,phase:2,deny:/blocked,msg:'x'"`)).toContain(
      'destinationUnexpected',
    );
  });

  it('не жалуется на обычный deny', () => {
    expect(codes(`SecRule ARGS "@rx \\d+" "${CLEAN}"`)).not.toContain(
      'destinationUnexpected',
    );
  });
});

describe('цена исполнения и запись', () => {
  it('ловит вложенные кванторы', () => {
    expect(codes(`SecRule ARGS "@rx (a+)+b" "${CLEAN}"`)).toContain('possibleRedos');
  });

  it('предлагает точное сравнение вместо закреплённого шаблона', () => {
    expect(codes(`SecRule REQUEST_METHOD "@rx ^POST$" "${CLEAN}"`)).toContain(
      'anchoredLiteralRegex',
    );
  });

  it('замечает преобразования перед оператором, который не смотрит на значение', () => {
    expect(
      codes(`SecRule ARGS "@unconditionalMatch" "${CLEAN},t:lowercase"`),
    ).toContain('transformsWithoutCheck');
  });

  // Аргумента у `@detectSQLi` нет, но значение он разбирает: без
  // декодирования инъекция в процентном кодировании пройдёт мимо.
  it('не считает лишними преобразования перед детектором атак', () => {
    expect(
      codes(`SecRule ARGS "@detectSQLi" "${CLEAN},t:urlDecodeUni"`),
    ).not.toContain('transformsWithoutCheck');
  });

  it('замечает список из одной фразы', () => {
    expect(codes(`SecRule ARGS "@pm select" "${CLEAN}"`)).toContain('singlePhraseList');
  });

  it('замечает номер из диапазона CRS', () => {
    expect(codes('SecRule ARGS "@rx \\d+" "id:942100,phase:2,deny,msg:\'x\'"')).toContain(
      'idInReservedRange',
    );
  });

  it('замечает второе правило с той же проверкой', () => {
    expect(
      codes(
        [
          `SecRule ARGS "@rx \\d+" "${CLEAN}"`,
          "SecRule ARGS \"@rx \\d+\" \"id:1002,phase:2,deny,msg:'x'\"",
        ].join('\n'),
      ),
    ).toContain('duplicateRule');
  });
});

describe('каталог диагностик', () => {
  // Уровень и тема заданы в каталоге один раз: если проверка начнёт
  // выдавать код с другим уровнем, разойдётся весь фильтр по темам.
  it('выдаёт уровень и тему строго из каталога', () => {
    const source = `SecRule ARGS "@rx .*" "${CLEAN},t:lowercase,t:uppercase"`;
    for (const diagnostic of compileDocument(parseModsec(source)).diagnostics) {
      const [severity, topic] = DIAGNOSTIC_CATALOG[diagnostic.code];
      expect(diagnostic.severity).toBe(severity);
      expect(diagnostic.topic).toBe(topic);
    }
  });

  it('привязывает сообщение к звену цепочки и к полю правила', () => {
    const result = compileDocument(
      parseModsec(
        [
          `SecRule ARGS "@rx \\d+" "${CLEAN},chain"`,
          'SecRule REQUEST_METHOD "@streq POST" "t:lowercase"',
        ].join('\n'),
      ),
    );
    const caseIssue = result.diagnostics.find((d) => d.code === 'caseNeverMatches');
    expect(caseIssue?.anchor).toMatchObject({ condition: 2, slot: 'operator' });
    expect(caseIssue?.line).toBe(2);
  });
});
