import { modsecExamples } from '../data/modsecExamples';
import { parseModsec } from './parser';
import { compileDocument } from './compile';
import { analyzeDocument, createLinter, inspectWorkspace, syncLinter } from './inspect';
import type { Diagnostic } from './diagnostics';
import type { WorkspaceUnit } from './workspace';

/** Все замечания об одиноком документе. */
function inspect(source: string): Diagnostic[] {
  return analyzeDocument(parseModsec(source)).diagnostics;
}

/** Файл набора: имя нужно для замечаний, называющих чужой файл. */
function unit(name: string, source: string): WorkspaceUnit {
  const doc = parseModsec(source);
  return { id: name, name, blocks: compileDocument(doc, name).blocks, statements: doc.statements };
}

/** Замечания по набору файлов, читаемому в этом порядке. */
function workspace(...sources: [string, string][]): Diagnostic[] {
  const linter = createLinter();
  syncLinter(
    linter,
    sources.map(([id, source]) => ({ id, source })),
  );
  return inspectWorkspace(
    sources.map(([name, source]) => unit(name, source)),
    linter,
  );
}

const CLEAN = "id:1001,phase:2,deny,msg:'x'";

describe('проход по документу', () => {
  it('видит то, что видно только по всему файлу', () => {
    const codes = inspect(
      [
        'SecRuleEngine DetectionOnly',
        `SecRule ARGS "@rx \\d+" "${CLEAN}"`,
        'SecRule TX:missing "@gt 5" "id:1002,phase:2,pass,nolog"',
      ].join('\n'),
    ).map((d) => d.code);

    // Первое — про файл целиком, второе — про переменную, которую никто не
    // выставил: ни то, ни другое из одной строки не выводится.
    expect(codes).toContain('engineNotEnforcing');
    expect(codes).toContain('txNeverSet');
  });

  it('у одинокого документа файла не называет', () => {
    const [found] = inspect('SecRule ARGS "@rx foo" "phase:2,deny"');
    expect(found.code).toBe('missingId');
    expect(found.file).toBeUndefined();
  });

  it('отдаёт замечания сверху вниз по строкам', () => {
    const lines = inspect(
      [
        'SecRule ARGS "@nope x" "id:1001,phase:2,deny"',
        `SecRule ARGS "@rx \\d+" "id:1002,phase:2,deny,msg:'y',t:lowercase,t:uppercase"`,
        'SecAction "id:1003,phase:2,pass,nolog,initcol:ip=%{REMOTE_ADDR}"',
      ].join('\n'),
    ).map((d) => d.line ?? 0);

    expect(lines.length).toBeGreaterThan(2);
    expect([...lines]).toEqual([...lines].sort((a, b) => a - b));
  });

  it('считает ошибки, предупреждения и советы по всему списку', () => {
    const all = analyzeDocument(
      parseModsec(
        [
          'SecRule ARGS "@nope x" "id:1001,phase:2,deny"',
          `SecRule ARGS "@rx \\d+" "id:1002,phase:2,deny,msg:'y',t:lowercase,t:uppercase"`,
        ].join('\n'),
      ),
    );

    expect(all.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['unknownOperator', 'conflictingCaseTransforms']),
    );
    expect(all.errorCount).toBeGreaterThan(0);
    expect(all.warningCount).toBeGreaterThan(0);
    expect(all.errorCount + all.warningCount + all.adviceCount).toBe(all.diagnostics.length);
    expect(all.ok).toBe(false);
  });

  /**
   * Всё, что закрывает конструктор, есть и в полном списке.
   *
   * Компиляция спрашивает о файле сразу и в одиночку, проход по набору
   * приходит следом. Потеряй он замечание, из-за которого вкладка закрыта, —
   * она оставалась бы закрытой без единого слова о том, почему.
   */
  it('называет всё, из-за чего закрыт конструктор', () => {
    const broken = [
      'SecRule "" "@nope x" "id:1,phase:2,deny"',
      'SecRule ARGS "@rx (" "id:2,phase:2,deny,chain"',
      'SecAction "id:3,phase:9,skipAfter:NOWHERE"',
      'SecRule ARGS "@rx x" "id:3,phase:2,deny,t:nosuch,zzz"',
    ].join('\n');

    for (const source of [broken, ...modsecExamples.map((e) => e.code)]) {
      const doc = parseModsec(source);
      const mark = (d: Diagnostic) => `${d.code}@${d.line}`;
      const all = new Set(analyzeDocument(doc).diagnostics.map(mark));
      const blocking = compileDocument(doc).diagnostics.map(mark);

      expect(blocking.filter((item) => !all.has(item))).toEqual([]);
    }
    expect(compileDocument(parseModsec(broken)).diagnostics.length).toBeGreaterThan(2);
  });
});

describe('место замечания в конструкторе', () => {
  it('привязывает замечание к правилу и к части правила', () => {
    const found = inspect(`SecRule ARGS "@rx \\d+" "${CLEAN},t:lowercase,t:uppercase"`).find(
      (d) => d.code === 'conflictingCaseTransforms',
    );

    expect(found?.anchor).toEqual({ ruleKey: 'rule-0', slot: 'transforms' });
    expect(found?.line).toBe(1);
  });

  it('различает области проверки, оператор и действия', () => {
    const slots = new Map(
      inspect(
        'SecRule ARGS|ARGS "@streq POST" "id:1001,phase:2,pass,status:403,t:lowercase"',
      ).map((d) => [d.code, d.anchor?.slot]),
    );

    expect(slots.get('duplicateTarget')).toBe('targets');
    expect(slots.get('caseNeverMatches')).toBe('operator');
    expect(slots.get('statusWithoutBlock')).toBe('actions');
  });

  it('называет звено цепочки, а у правила без цепочки — нет', () => {
    const chained = inspect(
      [
        `SecRule ARGS "@rx \\d+" "${CLEAN},chain"`,
        'SecRule REQUEST_METHOD "@streq post" "t:uppercase"',
      ].join('\n'),
    ).find((d) => d.code === 'caseNeverMatches');
    expect(chained?.anchor).toEqual({ ruleKey: 'rule-0', condition: 2, slot: 'operator' });
    // Строка — та, где стоит само звено: по ней переходят в текст.
    expect(chained?.line).toBe(2);

    const single = inspect(`SecRule REQUEST_METHOD "@streq post" "${CLEAN},t:uppercase"`).find(
      (d) => d.code === 'caseNeverMatches',
    );
    expect(single?.anchor?.condition).toBeUndefined();
  });

  it('замечание о правиле целиком оставляет без части', () => {
    const found = inspect('SecRule ARGS "@rx foo" "phase:2,deny"').find(
      (d) => d.code === 'missingId',
    );
    expect(found?.anchor).toEqual({ ruleKey: 'rule-0' });
  });

  it('области проверки, которых нет, относит к областям проверки', () => {
    const found = inspect('SecRule "" "@rx foo" "id:1,phase:2,deny"').find(
      (d) => d.code === 'emptyTargets',
    );
    expect(found?.anchor?.slot).toBe('targets');
  });

  it('привязывает замечание к директиве, метке и безусловному действию', () => {
    const found = inspect(
      [
        'SecRuleEngine Yes',
        'SecMarker UNUSED',
        'SecAction "id:1,phase:9,pass,nolog"',
      ].join('\n'),
    );
    const keyOf = (code: string) => found.find((d) => d.code === code)?.anchor?.ruleKey;

    expect(keyOf('directiveBadValue')).toBe('directive-0');
    expect(keyOf('unusedMarker')).toBe('marker-1');
    expect(keyOf('invalidActionValue')).toBe('action-2');
  });

  it('замечание о строке многострочного правила называет строку узла', () => {
    const found = inspect(
      [
        'SecRule ARGS "@rx foo" \\',
        '    "id:1001,\\',
        '    phase:2,\\',
        '    pass,\\',
        '    status:403"',
      ].join('\n'),
    ).find((d) => d.code === 'statusWithoutBlock');

    expect(found?.line).toBe(5);
    expect(found?.anchor?.ruleKey).toBe('rule-0');
  });

  it('помнит границы замечания в исходнике: по ним ядро выводит исправление', () => {
    const source = 'SecRule ARGS "@rx foo" "id:1001,phase:2,deny,t:lowercase,t:lowercase"';
    const found = inspect(source).find((d) => d.code === 'duplicateTransform');

    expect(found?.range).toBeDefined();
    expect(source.slice(found?.range?.start, found?.range?.end)).toBe('t:lowercase');
  });
});

describe('оговорки редактора', () => {
  it('говорит о действии, для которого в форме нет поля', () => {
    const found = inspect(
      `SecRule ARGS "@rx foo" "${CLEAN},initcol:ip=%{REMOTE_ADDR}"\nSecDataDir /tmp`,
    ).find((d) => d.code === 'actionNotEditable');

    expect(found).toMatchObject({
      severity: 'warning',
      topic: 'structure',
      params: { name: 'initcol' },
      line: 1,
      anchor: { ruleKey: 'rule-0', slot: 'actions' },
    });
    // Чинить в тексте здесь нечего — границ у оговорки нет.
    expect(found?.range).toBeUndefined();
  });

  it('об исключении ctl молчит: его конструктор правит полями', () => {
    const codes = inspect(
      [
        `SecRule ARGS "@rx foo" "${CLEAN}"`,
        'SecRule REQUEST_URI "@beginsWith /api" "id:1002,phase:1,pass,nolog,ctl:ruleRemoveById=1001"',
      ].join('\n'),
    ).map((d) => d.code);

    expect(codes).not.toContain('actionNotEditable');
  });

  it('о незнакомом действии говорит ядро, и говорит один раз', () => {
    const codes = inspect(`SecRule ARGS "@rx foo" "${CLEAN},zzz"`).map((d) => d.code);

    expect(codes).toContain('unknownAction');
    expect(codes).not.toContain('actionNotEditable');
  });
});

describe('пометки в тексте', () => {
  const RULE = 'SecRule REQUEST_METHOD "@streq GET" "id:1004,phase:1,pass,t:lowercase"';

  it('снимают замечание из списка', () => {
    expect(inspect(RULE).map((d) => d.code)).toContain('caseNeverMatches');
    expect(
      inspect(`# seclang-ignore: caseNeverMatches\n${RULE}`).map((d) => d.code),
    ).not.toContain('caseNeverMatches');
  });

  /**
   * Пометка снимает замечание, а не чинит запись.
   *
   * Правило без номера ModSecurity не загрузит, сколько бы пометок над ним ни
   * стояло, — и конструктор обязан остаться закрытым.
   */
  it('не открывают конструктор: запись от пометки целее не становится', () => {
    const doc = parseModsec('# seclang-ignore\nSecRule ARGS "@rx foo" "phase:2,deny"');

    expect(analyzeDocument(doc).diagnostics.map((d) => d.code)).not.toContain('missingId');
    expect(compileDocument(doc).ok).toBe(false);
    expect(compileDocument(doc).diagnostics.map((d) => d.code)).toEqual(['missingId']);
  });
});

describe('проход по набору файлов', () => {
  it('называет файл замечания', () => {
    const found = workspace(
      ['setup.conf', 'SecRuleEngine On'],
      ['rules.conf', 'SecRule ARGS "@rx foo" "phase:2,deny"'],
    ).find((d) => d.code === 'missingId');

    expect(found?.file).toBe('rules.conf');
    expect(found?.anchor?.ruleKey).toBe('rule-0');
  });

  it('отдаёт замечания по файлам в порядке включения', () => {
    const files = workspace(
      ['b.conf', 'SecRule ARGS "@rx foo" "phase:2,deny"'],
      ['a.conf', 'SecRule ARGS "@rx foo" "phase:2,deny"'],
    ).map((d) => d.file);

    expect(files[0]).toBe('b.conf');
    expect(files[files.length - 1]).toBe('a.conf');
    expect(files).toEqual([...files].sort((x, y) => (x === y ? 0 : x === 'b.conf' ? -1 : 1)));
  });

  it('не ругается на метку из другого файла', () => {
    const codes = workspace(
      ['rules.conf', 'SecAction "id:1,phase:2,pass,nolog,skipAfter:END_OF_BLOCK"'],
      ['tail.conf', 'SecMarker END_OF_BLOCK'],
    ).map((d) => d.code);

    expect(codes).not.toContain('missingMarker');
  });

  it('видит переменную, выставленную в файле, читаемом позже', () => {
    const codes = workspace(
      ['rules.conf', 'SecRule TX:score "@gt 5" "id:1,phase:2,deny,msg:\'x\'"'],
      ['setup.conf', 'SecAction "id:2,phase:1,pass,nolog,setvar:tx.score=0"'],
    ).map((d) => d.code);

    expect(codes).not.toContain('txNeverSet');
  });

  it('считает движок по настроечному файлу и называет его', () => {
    const found = workspace(
      ['setup.conf', 'SecRuleEngine DetectionOnly'],
      ['rules.conf', `SecRule ARGS "@rx x" "${CLEAN}"`],
    ).find((d) => d.code === 'engineNotEnforcing');

    expect(found?.file).toBe('setup.conf');
    expect(found?.line).toBe(1);
  });

  it('отсчитывает skip по набору, а не по файлу', () => {
    const codes = workspace(
      ['rules.conf', 'SecAction "id:1,phase:2,pass,nolog,skip:2"'],
      [
        'more.conf',
        [
          `SecRule ARGS "@rx a" "id:2,phase:2,deny,msg:'x'"`,
          `SecRule ARGS "@rx b" "id:3,phase:2,deny,msg:'y'"`,
        ].join('\n'),
      ],
    ).map((d) => d.code);

    expect(codes).not.toContain('skipBeyondEnd');
  });

  /**
   * Промах через границу файлов — отдельное замечание.
   *
   * «Стоит выше правила» здесь не про строку: строка у директивы может быть
   * любой, а читается её файл всё равно раньше — и чинят это перестановкой
   * файлов, а не переносом строки.
   */
  it('отличает исключение в файле, читаемом раньше, от промаха по строке', () => {
    const found = workspace(
      ['exclusions.conf', 'SecRuleRemoveById 942100'],
      ['rules.conf', `SecRule ARGS "@rx x" "id:942100,phase:2,deny,msg:'x'"`],
    ).find((d) => d.code === 'exclusionInEarlierFile');

    expect(found?.file).toBe('exclusions.conf');
    expect(found?.params).toMatchObject({ id: '942100' });
  });

  it('внутри одного файла говорит о строке, а не о порядке файлов', () => {
    const codes = workspace([
      'one.conf',
      ['SecRuleRemoveById 942100', `SecRule ARGS "@rx x" "id:942100,phase:2,deny,msg:'x'"`].join(
        '\n',
      ),
    ]).map((d) => d.code);

    expect(codes).toContain('exclusionBeforeRule');
    expect(codes).not.toContain('exclusionInEarlierFile');
  });
});

describe('номер правила, занятый дважды', () => {
  it('через файлы — называет, где он занят впервые', () => {
    const found = workspace(
      ['first.conf', `# описание\nSecRule ARGS "@rx a" "${CLEAN}"`],
      ['second.conf', `SecRule ARGS "@rx b" "${CLEAN}"`],
    ).filter((d) => d.code === 'duplicateId' || d.code === 'duplicateIdCrossFile');

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: 'duplicateIdCrossFile',
      severity: 'error',
      topic: 'structure',
      file: 'second.conf',
      params: { id: '1001', file: 'first.conf', line: '2' },
      anchor: { ruleKey: 'rule-0' },
    });
  });

  it('внутри файла — остаётся повтором этого файла', () => {
    const codes = workspace([
      'one.conf',
      [`SecRule ARGS "@rx a" "${CLEAN}"`, `SecRule ARGS "@rx b" "${CLEAN}"`].join('\n'),
    ]).map((d) => d.code);

    expect(codes).toContain('duplicateId');
    expect(codes).not.toContain('duplicateIdCrossFile');
  });

  /**
   * Повтор через файлы конструктор не закрывает.
   *
   * Компиляция спрашивает о файле в одиночку и о чужом номере не знает; а
   * замечание набора получает свой код именно затем, чтобы список не говорил
   * «ошибка этого файла» там, где какой из двух править, выбирает человек.
   */
  it('через файлы — не закрывает конструктор второго файла', () => {
    const second = `SecRule ARGS "@rx b" "${CLEAN}"`;
    expect(compileDocument(parseModsec(second), 'second.conf').ok).toBe(true);
  });

  it('и там и там — второе правило файла повторяет своё же первое', () => {
    const found = workspace(
      ['first.conf', `SecRule ARGS "@rx a" "${CLEAN}"`],
      [
        'second.conf',
        [`SecRule ARGS "@rx b" "${CLEAN}"`, `SecRule ARGS "@rx c" "${CLEAN}"`].join('\n'),
      ],
    )
      .filter((d) => d.file === 'second.conf' && /^duplicateId/.test(d.code))
      .map((d) => [d.code, d.line]);

    expect(found).toEqual([
      ['duplicateIdCrossFile', 1],
      ['duplicateId', 2],
    ]);
  });
});

describe('набор для ядра', () => {
  it('держит те же файлы в том же порядке', () => {
    const linter = createLinter();
    syncLinter(linter, [
      { id: 'a', source: 'SecRuleEngine On' },
      { id: 'b', source: 'SecMarker X' },
    ]);
    expect(linter.names()).toEqual(['a', 'b']);

    // Файл убрали, порядок сменили, один добавили.
    syncLinter(linter, [
      { id: 'c', source: 'SecMarker Y' },
      { id: 'a', source: 'SecRuleEngine On' },
    ]);
    expect(linter.names()).toEqual(['c', 'a']);
  });

  it('не разбирает заново файл, текст которого не менялся', () => {
    const linter = createLinter();
    syncLinter(linter, [
      { id: 'a', source: 'SecRuleEngine On' },
      { id: 'b', source: 'SecMarker X' },
    ]);
    const before = linter.tree('a');

    syncLinter(linter, [
      { id: 'a', source: 'SecRuleEngine On' },
      { id: 'b', source: 'SecMarker Z' },
    ]);
    expect(linter.tree('a')).toBe(before);
    expect(linter.tree('b')?.source).toBe('SecMarker Z');
  });
});
