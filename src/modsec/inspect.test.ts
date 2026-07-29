import { modsecExamples } from '../data/modsecExamples';
import { parseModsec } from './parser';
import { analyzeDocument, compileDocument } from './compile';
import { inspectDocument, inspectSlices } from './inspect';
import type { Diagnostic } from './diagnostics';

/** Смысловые замечания документа: то, что даёт отложенный проход. */
function semantic(source: string): Diagnostic[] {
  const doc = parseModsec(source);
  return inspectDocument(compileDocument(doc).blocks, doc.statements);
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
    for (const slice of inspectSlices(blocks, doc.statements)) sliced.push(...slice);

    expect(sliced).toEqual(inspectDocument(blocks, doc.statements));
  });

  it('отдаёт по выдаче на исполняемый блок и ещё одну — про файл', () => {
    const doc = parseModsec(source);
    const blocks = compileDocument(doc).blocks;
    const executable = blocks.filter((b) => b.kind === 'rule' || b.kind === 'action').length;

    expect([...inspectSlices(blocks, doc.statements)]).toHaveLength(executable + 1);
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
    const slices = [...inspectSlices(compileDocument(doc).blocks, doc.statements)];

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
    const compiled = compileDocument(doc);
    const slices = [...inspectSlices(compiled.blocks, doc.statements, compiled.exclusions)];

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
    const slices = inspectSlices(compileDocument(doc).blocks, doc.statements);

    // Взяли одну выдачу и бросили: сообщения только про первое правило.
    const first = slices.next();
    expect(first.done).toBe(false);
    for (const diagnostic of first.value ?? []) {
      expect(diagnostic.anchor?.ruleKey ?? 'rule-1').toBe('rule-1');
    }
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
