import { parseModsec } from './parser';
import { analyzeDocument } from './compile';
import { DIAGNOSTIC_CATALOG } from './diagnostics';
import type { DiagnosticCode } from './diagnostics';

function codes(source: string): DiagnosticCode[] {
  return analyzeDocument(parseModsec(source)).diagnostics.map((d) => d.code);
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

describe('список IP-адресов', () => {
  it('ловит опечатку в адресе', () => {
    expect(codes(`SecRule REMOTE_ADDR "@ipMatch 192.168.1.999" "${CLEAN}"`)).toContain(
      'invalidIpEntry',
    );
  });

  it('молчит про обычную сеть CIDR', () => {
    expect(
      codes(`SecRule REMOTE_ADDR "@ipMatch 10.0.0.0/8,2001:db8::/32" "${CLEAN}"`),
    ).not.toContain('invalidIpEntry');
  });

  it('молчит про макрос — что в нём окажется, знает только движок', () => {
    expect(
      codes(`SecRule REMOTE_ADDR "@ipMatch %{tx.allowed_ips}" "${CLEAN}"`),
    ).not.toContain('invalidIpEntry');
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

describe('действия, которых нет в форме', () => {
  // «Нет поля в конструкторе» и «такого действия не существует» — разные
  // новости: первая про редактор, вторая про правило, которое ModSecurity
  // не загрузит. Одно сообщение на оба случая прятало ошибку среди оговорок.
  it('отличает действие без поля от опечатки в имени', () => {
    expect(codes(`SecRule ARGS "@rx \\d+" "${CLEAN},ctl:auditEngine=Off"`)).toContain(
      'actionNotEditable',
    );
    expect(codes(`SecRule ARGS "@rx \\d+" "${CLEAN},msgg:'x'"`)).toContain('unknownAction');
  });

  it('молчит о метаданных набора правил: для них поля есть', () => {
    const notes = codes(
      `SecRule ARGS "@rx \\d+" "${CLEAN},ver:'OWASP_CRS/4.0.0',rev:'2',maturity:'9',accuracy:'9'"`,
    );
    expect(notes).not.toContain('actionNotEditable');
    expect(notes).not.toContain('unknownAction');
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

describe('исключения', () => {
  /** Правило, к которому исключения обращаются в этих тестах. */
  const RULE = `SecRule ARGS "@rx attack" "id:1001,phase:2,deny,msg:'SQL Injection',tag:'attack-sqli'"`;

  it('требует обязательный аргумент', () => {
    expect(codes([RULE, 'SecRuleUpdateTargetById 1001'].join('\n'))).toContain(
      'exclusionNoTarget',
    );
  });

  it('не принимает за номер то, что номером не является', () => {
    expect(codes([RULE, 'SecRuleRemoveById 1001 нет'].join('\n'))).toContain('exclusionBadId');
  });

  it('говорит об исключении, которое стоит выше своей цели', () => {
    expect(codes(['SecRuleRemoveById 1001', RULE].join('\n'))).toContain('exclusionBeforeRule');
  });

  it('молчит, когда исключение стоит ниже правила', () => {
    expect(codes([RULE, 'SecRuleRemoveById 1001'].join('\n'))).not.toContain(
      'exclusionBeforeRule',
    );
  });

  it('замечает цель без «!»: она заменяет список, а не вычитает из него', () => {
    expect(codes([RULE, 'SecRuleUpdateTargetById 1001 "ARGS:comment"'].join('\n'))).toContain(
      'exclusionUpdateTargetNotExclusion',
    );
  });

  it('не придирается к замене одной цели другой', () => {
    expect(
      codes([RULE, 'SecRuleUpdateTargetById 1001 "ARGS:comment" "ARGS"'].join('\n')),
    ).not.toContain('exclusionUpdateTargetNotExclusion');
  });

  it('замечает попытку сменить метаданные правила', () => {
    expect(codes([RULE, 'SecRuleUpdateActionById 1001 "phase:1"'].join('\n'))).toContain(
      'exclusionUpdateActionMetadata',
    );
  });

  it('замечает правку правила, которое уже снято целиком', () => {
    expect(
      codes(
        [RULE, 'SecRuleRemoveById 1001', 'SecRuleUpdateTargetById 1001 "!ARGS:comment"'].join(
          '\n',
        ),
      ),
    ).toContain('exclusionRemovedThenUpdated');
  });

  it('не считает правку напрасной, пока хоть одно её правило на месте', () => {
    const source = [
      RULE,
      `SecRule ARGS "@rx x" "id:1002,phase:2,deny,msg:'y',tag:'attack-sqli'"`,
      'SecRuleRemoveById 1001',
      'SecRuleUpdateTargetByTag "attack-sqli" "!ARGS:comment"',
    ].join('\n');
    expect(codes(source)).not.toContain('exclusionRemovedThenUpdated');
  });

  it('замечает перевёрнутый диапазон', () => {
    expect(codes([RULE, 'SecRuleRemoveById 1200-1100'].join('\n'))).toContain(
      'exclusionEmptyRange',
    );
  });

  it('советует проверить выборку, которая никого не нашла', () => {
    expect(codes([RULE, 'SecRuleRemoveById 999999'].join('\n'))).toContain('exclusionNoMatch');
  });

  // Файл без своих правил — надстройка над чужим набором: ссылка «в пустоту»
  // там обычное дело, и говорить о ней значило бы ругать нормальную работу.
  it('молчит о промахе в файле, где своих правил нет', () => {
    expect(codes('SecRuleRemoveById 942100')).not.toContain('exclusionNoMatch');
  });

  it('замечает повтор того же исключения', () => {
    expect(
      codes([RULE, 'SecRuleRemoveById 1001', 'SecRuleRemoveById 1001'].join('\n')),
    ).toContain('exclusionDuplicate');
  });

  it('говорит о выборке по тексту сообщения', () => {
    expect(codes([RULE, 'SecRuleRemoveByMsg "SQL Injection"'].join('\n'))).toContain(
      'exclusionByMsgFragile',
    );
  });

  it('считает широким удаление, снявшее десятки правил', () => {
    const rules = Array.from(
      { length: 12 },
      (_, i) => `SecRule ARGS "@rx x" "id:${2000 + i},phase:2,deny,msg:'y',tag:'attack-dos'"`,
    );
    const found = codes([...rules, 'SecRuleRemoveByTag "attack-dos"'].join('\n'));
    expect(found).toContain('exclusionTooBroad');
  });

  it('относит сообщение к строке исключения, а не затронутого правила', () => {
    const result = analyzeDocument(
      parseModsec(['SecRuleRemoveById 1001', RULE].join('\n')),
    );
    const found = result.diagnostics.find((d) => d.code === 'exclusionBeforeRule');
    expect(found?.line).toBe(1);
    // Чинить придётся директиву, а правило может быть и из чужого набора,
    // поэтому адреса в модели конструктора у сообщения нет.
    expect(found?.anchor).toBeUndefined();
  });
});

describe('исключения через ctl', () => {
  /** Правило-цель: вторая фаза, тег и сообщение — есть чем выбирать. */
  const RULE = `SecRule ARGS "@detectXSS" "id:941100,phase:2,block,msg:'XSS',tag:'attack-xss'"`;

  /** Носитель: первая фаза, ничего не прерывает — исключение доживёт до цели. */
  const carrier = (ctl: string) =>
    `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:1,pass,nolog,${ctl}"`;

  it('говорит о `ctl`, который выполняется позже своей цели', () => {
    const late = `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:2,pass,nolog,ctl:ruleRemoveById=941100"`;
    expect(codes([RULE, late].join('\n'))).toContain('exclusionCtlAfterRule');
  });

  // Порядок исполнения решает фаза, а не строка: у директивы на том же месте
  // было бы замечание, а здесь исключение работает.
  it('молчит о `ctl` из более ранней фазы, где бы он ни стоял', () => {
    expect(codes([RULE, carrier('ctl:ruleRemoveById=941100')].join('\n'))).not.toContain(
      'exclusionCtlAfterRule',
    );
  });

  it('не путает порядок `ctl` с порядком директивы', () => {
    expect(codes([carrier('ctl:ruleRemoveById=941100'), RULE].join('\n'))).not.toContain(
      'exclusionBeforeRule',
    );
  });

  it('замечает выборку, которую `ctl` прочитает одной строкой', () => {
    const found = codes([carrier('ctl:ruleRemoveById=941100 941110'), RULE].join('\n'));
    expect(found).toContain('exclusionCtlBadId');
    // Конфигурация от этого не падает — ошибкой это назвать нельзя.
    expect(found).not.toContain('exclusionBadId');
  });

  it('замечает снятие цели, у которого цели нет', () => {
    expect(codes([carrier('ctl:ruleRemoveTargetById=941100'), RULE].join('\n'))).toContain(
      'exclusionCtlNoTarget',
    );
  });

  // Всё после `;` ModSecurity читает одним именем с параметром, поэтому
  // список целей в одной записи не снимает даже первую.
  it('замечает список целей в одной записи', () => {
    expect(
      codes([carrier('ctl:ruleRemoveTargetById=941100;ARGS:a|ARGS:b'), RULE].join('\n')),
    ).toContain('exclusionCtlTargetList');
  });

  // Снимаемую цель движок сравнивает по имени и параметру: вычитание и
  // подсчёт в неё не входят, и такая запись молчит.
  it('замечает вычитание и подсчёт в снимаемой цели', () => {
    expect(codes([carrier('ctl:ruleRemoveTargetById=941100;!ARGS:a'), RULE].join('\n'))).toContain(
      'exclusionCtlDeadTarget',
    );
    expect(codes([carrier('ctl:ruleRemoveTargetById=941100;&ARGS'), RULE].join('\n'))).toContain(
      'exclusionCtlDeadTarget',
    );
  });

  it('молчит о простой цели из имени и параметра', () => {
    expect(
      codes([carrier('ctl:ruleRemoveTargetById=941100;ARGS:a'), RULE].join('\n')),
    ).not.toContain('exclusionCtlDeadTarget');
  });

  it('замечает носителя, который сам обрывает транзакцию', () => {
    const blocking = `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:1,deny,msg:'x',ctl:ruleRemoveById=941100"`;
    expect(codes([blocking, RULE].join('\n'))).toContain('exclusionCtlCarrierStops');
  });

  it('молчит о носителе, который лишь пропускает запрос дальше', () => {
    expect(codes([carrier('ctl:ruleRemoveById=941100'), RULE].join('\n'))).not.toContain(
      'exclusionCtlCarrierStops',
    );
  });

  it('замечает `ctl`, снимающий правило, снятое директивой насовсем', () => {
    const source = [carrier('ctl:ruleRemoveById=941100'), RULE, 'SecRuleRemoveById 941100'].join(
      '\n',
    );
    expect(codes(source)).toContain('exclusionCtlAlreadyRemoved');
  });

  it('не считает повтором два одинаковых `ctl` в разных правилах', () => {
    const source = [
      carrier('ctl:ruleRemoveById=941100'),
      `SecRule REQUEST_FILENAME "@streq /web" "id:1001,phase:1,pass,nolog,ctl:ruleRemoveById=941100"`,
      RULE,
    ].join('\n');
    expect(codes(source)).not.toContain('exclusionDuplicate');
  });

  it('считает повтором два одинаковых `ctl` в одном списке действий', () => {
    const source = [
      carrier('ctl:ruleRemoveById=941100,ctl:ruleRemoveById=941100'),
      RULE,
    ].join('\n');
    expect(codes(source)).toContain('exclusionDuplicate');
  });

  // У директивы адреса в модели нет: чинить надо строку. У `ctl` он есть — он
  // написан внутри правила, и его карточка как раз то место, где о нём говорят.
  it('относит сообщение о `ctl` к карточке носителя', () => {
    const late = `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:2,pass,nolog,ctl:ruleRemoveById=941100"`;
    const result = analyzeDocument(parseModsec([RULE, late].join('\n')));
    const found = result.diagnostics.find((d) => d.code === 'exclusionCtlAfterRule');

    expect(found?.line).toBe(2);
    expect(found?.anchor).toEqual({ ruleKey: 'rule-1', slot: 'actions' });
  });
});

describe('каталог диагностик', () => {
  // Уровень и тема заданы в каталоге один раз: если проверка начнёт
  // выдавать код с другим уровнем, разойдётся весь фильтр по темам.
  it('выдаёт уровень и тему строго из каталога', () => {
    const source = `SecRule ARGS "@rx .*" "${CLEAN},t:lowercase,t:uppercase"`;
    for (const diagnostic of analyzeDocument(parseModsec(source)).diagnostics) {
      const [severity, topic] = DIAGNOSTIC_CATALOG[diagnostic.code];
      expect(diagnostic.severity).toBe(severity);
      expect(diagnostic.topic).toBe(topic);
    }
  });

  it('привязывает сообщение к звену цепочки и к полю правила', () => {
    const result = analyzeDocument(
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
