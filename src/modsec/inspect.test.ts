import { modsecExamples } from '../data/modsecExamples';
import { parseModsec } from './parser';
import { analyzeDocument, compileDocument } from './compile';
import { inspectDocument, inspectSlices, inspectWorkspace, readWorkspaceContext } from './inspect';
import { indexWorkspaceExclusions } from './exclusions';
import { loneUnit } from './workspace';
import type { Diagnostic } from './diagnostics';
import type { WorkspaceUnit } from './workspace';

/** Смысловые замечания документа: то, что даёт отложенный проход. */
function semantic(source: string): Diagnostic[] {
  const doc = parseModsec(source);
  return inspectDocument(compileDocument(doc).blocks, doc.statements);
}

/** Файл набора: имя нужно для замечаний, называющих чужой файл. */
function unit(name: string, source: string): WorkspaceUnit {
  const doc = parseModsec(source);
  return { id: name, name, blocks: compileDocument(doc, name).blocks, statements: doc.statements };
}

/** Замечания по набору файлов, читаемому в этом порядке. */
function workspace(...sources: [string, string][]): Diagnostic[] {
  const units = sources.map(([name, source]) => unit(name, source));
  return inspectWorkspace(units, indexWorkspaceExclusions(units));
}

const CLEAN = "id:1001,phase:2,deny,msg:'x'";

describe('смысловой проход', () => {
  it('видит то, что видно только по всему файлу', () => {
    const codes = semantic(
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

  it('привязывает замечание к правилу, а не только к строке', () => {
    const found = semantic(`SecRule ARGS "@rx \\d+" "${CLEAN},t:lowercase,t:uppercase"`).find(
      (d) => d.code === 'conflictingCaseTransforms',
    );
    expect(found?.anchor?.ruleKey).toBe('rule-0');
    expect(found?.line).toBe(1);
  });

  /**
   * Ошибок здесь не бывает — и это не наблюдение, а требование.
   *
   * Доступность визуальной вкладки решается по `ok`, а `ok` считается сразу,
   * без этого прохода. Появись здесь ошибка — вкладка открывалась бы и через
   * мгновение блокировалась, причём тем позже, чем больше файл.
   */
  it('не выдаёт ошибок: от него не зависит доступность конструктора', () => {
    const broken = [
      'SecRule "" "@nope x" "id:1,phase:2,deny"',
      'SecRule ARGS "@rx (" "id:2,phase:2,deny,chain"',
      'SecAction "id:3,phase:9,skipAfter:NOWHERE"',
      'SecRule ARGS "@rx x" "id:3,phase:2,deny,t:nosuch,zzz"',
    ].join('\n');

    for (const source of [broken, ...modsecExamples.map((e) => e.code)]) {
      expect(semantic(source).filter((d) => d.severity === 'error')).toEqual([]);
    }
  });
});

describe('проход по частям', () => {
  const source = [
    'SecRuleEngine DetectionOnly',
    `SecRule ARGS "@rx \\d+" "${CLEAN},t:lowercase,t:uppercase"`,
    'SecAction "id:1002,phase:1,pass,nolog,setvar:tx.score=0"',
    'SecRule TX:score "@gt 5" "id:1003,phase:2,deny,msg:\'y\'"',
    'SecRule REQUEST_URI "@contains .." "id:1004,phase:1,deny,nolog"',
  ].join('\n');

  it('по частям даёт то же, что целиком', () => {
    const doc = parseModsec(source);
    const blocks = compileDocument(doc).blocks;

    const sliced: Diagnostic[] = [];
    for (const slice of inspectSlices([loneUnit(blocks, doc.statements)])) sliced.push(...slice);

    expect(sliced).toEqual(inspectDocument(blocks, doc.statements));
  });

  it('отдаёт по выдаче на исполняемый блок и ещё одну — про файл', () => {
    const doc = parseModsec(source);
    const blocks = compileDocument(doc).blocks;
    const executable = blocks.filter((b) => b.kind === 'rule' || b.kind === 'action').length;

    expect([...inspectSlices([loneUnit(blocks, doc.statements)])]).toHaveLength(executable + 1);
  });

  /**
   * Замечание об уровне файла приходит последним.
   *
   * Иначе прерванный на середине проход выдавал бы его по неполным данным:
   * `engineNotEnforcing` зависит от того, нашлась ли ниже хоть одна
   * блокирующая реакция.
   */
  it('оставляет замечания о файле на последнюю выдачу', () => {
    const doc = parseModsec(source);
    const slices = [...inspectSlices([loneUnit(compileDocument(doc).blocks, doc.statements)])];

    const last = slices[slices.length - 1].map((d) => d.code);
    expect(last).toContain('engineNotEnforcing');
    expect(slices.slice(0, -1).flat().map((d) => d.code)).not.toContain('engineNotEnforcing');
  });

  /**
   * Исключения — тоже уровень файла: пока проход не дошёл до конца, неизвестно,
   * найдётся ли ниже правило, к которому директива обращается.
   */
  it('оставляет замечания об исключениях на последнюю выдачу', () => {
    const doc = parseModsec(
      [`SecRule ARGS "@rx x" "${CLEAN}"`, 'SecRuleRemoveById 999999'].join('\n'),
    );
    const only = loneUnit(compileDocument(doc).blocks, doc.statements);
    const slices = [...inspectSlices([only], indexWorkspaceExclusions([only]))];

    expect(slices[slices.length - 1].map((d) => d.code)).toContain('exclusionNoMatch');
  });

  it('считает индекс исключений сам, когда его не передали', () => {
    const doc = parseModsec(
      [`SecRule ARGS "@rx x" "${CLEAN}"`, 'SecRuleRemoveById 999999'].join('\n'),
    );

    expect(
      inspectDocument(compileDocument(doc).blocks, doc.statements).map((d) => d.code),
    ).toContain('exclusionNoMatch');
  });

  it('прерванный проход не выдумывает того, чего не проверил', () => {
    const doc = parseModsec(source);
    const slices = inspectSlices([loneUnit(compileDocument(doc).blocks, doc.statements)]);

    // Взяли одну выдачу и бросили: сообщения только про первое правило.
    const first = slices.next();
    expect(first.done).toBe(false);
    for (const diagnostic of first.value ?? []) {
      expect(diagnostic.anchor?.ruleKey ?? 'rule-1').toBe('rule-1');
    }
  });
});

describe('проход по набору файлов', () => {
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

  it('ловит один номер, занятый в двух файлах, и называет первый', () => {
    const found = workspace(
      ['first.conf', `SecRule ARGS "@rx a" "${CLEAN}"`],
      ['second.conf', `SecRule ARGS "@rx b" "${CLEAN}"`],
    ).find((d) => d.code === 'duplicateIdCrossFile');

    expect(found?.file).toBe('second.conf');
    expect(found?.params).toMatchObject({ id: '1001', file: 'first.conf' });
  });

  it('тот же номер в одном файле межфайловым повтором не считает', () => {
    const codes = workspace(
      ['one.conf', [`SecRule ARGS "@rx a" "${CLEAN}"`, `SecRule ARGS "@rx b" "${CLEAN}"`].join('\n')],
    ).map((d) => d.code);

    expect(codes).not.toContain('duplicateIdCrossFile');
  });

  it('отсчитывает skip по набору, а не по файлу', () => {
    const codes = workspace(
      ['rules.conf', 'SecAction "id:1,phase:2,pass,nolog,skip:2"'],
      ['more.conf', [`SecRule ARGS "@rx a" "id:2,phase:2,deny,msg:'x'"`, `SecRule ARGS "@rx b" "id:3,phase:2,deny,msg:'y'"`].join('\n')],
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
    expect(found?.params).toMatchObject({ id: '942100', file: 'rules.conf' });
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

  it('собирает контекст по всем файлам в порядке включения', () => {
    const context = readWorkspaceContext([
      unit('setup.conf', 'SecRuleEngine On'),
      unit('later.conf', 'SecRuleEngine DetectionOnly\nSecMarker HERE'),
    ]);

    // У переключателя побеждает последний прочитанный — так его читает и сам
    // ModSecurity.
    expect(context.engine).toBe('DetectionOnly');
    expect(context.engineFile).toBe('later.conf');
    expect(context.markers.has('HERE')).toBe(true);
  });
});

describe('полный разбор', () => {
  it('складывает структуру и смысл в один список по порядку строк', () => {
    const source = [
      'SecRule ARGS "@nope x" "id:1001,phase:2,deny"',
      `SecRule ARGS "@rx \\d+" "id:1002,phase:2,deny,msg:'y',t:lowercase,t:uppercase"`,
    ].join('\n');

    const all = analyzeDocument(parseModsec(source));
    expect(all.diagnostics.map((d) => d.code)).toEqual(
      expect.arrayContaining(['unknownOperator', 'conflictingCaseTransforms']),
    );

    const lines = all.diagnostics.map((d) => d.line ?? 0);
    expect([...lines]).toEqual([...lines].sort((a, b) => a - b));
    // Счётчики считают весь список, а не одну его половину.
    expect(all.errorCount).toBe(1);
    expect(all.warningCount).toBeGreaterThan(0);
  });
});
