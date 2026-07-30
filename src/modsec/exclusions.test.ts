import { parseModsec } from './parser';
import { compileDocument } from './compile';
import { LONE_FILE, blockRef } from './workspace';
import {
  collectExclusions,
  ctlExclusionActions,
  exclusionList,
  exclusionRecordText,
  exclusionSelectorText,
  exclusionSignature,
  exclusionTargetText,
  excludeRuleLine,
  excludeTargetLine,
  indexExclusions,
  indexWorkspaceExclusions,
  isExclusionCtl,
  makeExclusionTarget,
  readCtlExclusionRuns,
  readExclusionTargets,
  readExclusions,
  writeExclusionTargets,
} from './exclusions';
import { targetsToVariables } from './model';
import { serializeVariable } from './serialize';
import type { CtlExclusion, ExclusionEntry, ExclusionIndex, RuleEffect } from './exclusions';
import type { WorkspaceUnit } from './workspace';

/** Индекс исключений документа: то, с чем работают проверки и конструктор. */
function index(source: string): ExclusionIndex {
  const doc = parseModsec(source);
  return collectExclusions(compileDocument(doc).blocks, doc.statements);
}

/** Директивы индекса в порядке файла. */
function entriesOf(found: ExclusionIndex): ExclusionEntry[] {
  return exclusionList(found);
}

/**
 * Что исключения сделали с правилом одинокого документа.
 *
 * Ключ индекса — файл вместе с ключом блока: в наборе `rule-0` есть у каждого
 * файла, и без имени файла спрашивать было бы не о чем.
 */
function effectOf(found: ExclusionIndex, key: string): RuleEffect | undefined {
  return found.byRule.get(blockRef(LONE_FILE, key));
}

/** Файл набора: имя нужно там, где отметка называет чужой файл. */
function unit(name: string, source: string): WorkspaceUnit {
  const doc = parseModsec(source);
  return { id: name, name, blocks: compileDocument(doc, name).blocks, statements: doc.statements };
}

/** Индекс исключений набора файлов, читаемого в этом порядке. */
function workspace(...sources: [string, string][]): ExclusionIndex {
  return indexWorkspaceExclusions(sources.map(([name, source]) => unit(name, source)));
}

const RULE = `SecRule ARGS "@rx attack" "id:942100,phase:2,deny,msg:'SQL Injection',tag:'attack-sqli'"`;

describe('разбор директив исключений', () => {
  it('раскладывает семь директив по осям «что» и «как»', () => {
    const parsed = readExclusions(
      parseModsec(
        [
          'SecRuleRemoveById 942100',
          'SecRuleRemoveByMsg "SQL Injection"',
          'SecRuleRemoveByTag "attack-dos"',
          'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
          'SecRuleUpdateTargetByMsg "XSS Attack" "!ARGS:bio"',
          'SecRuleUpdateTargetByTag "attack-xss" "!ARGS:article_body"',
          'SecRuleUpdateActionById 942100 "pass,status:200"',
        ].join('\n'),
      ).statements,
    );

    expect(parsed.map((d) => `${d.op}/${d.selector}`)).toEqual([
      'remove/id',
      'remove/msg',
      'remove/tag',
      'updateTarget/id',
      'updateTarget/msg',
      'updateTarget/tag',
      'updateAction/id',
    ]);
    expect(parsed.every((d) => !d.incomplete)).toBe(true);
  });

  it('читает отдельные номера и диапазоны, а прочее откладывает отдельно', () => {
    const [removal] = readExclusions(
      parseModsec('SecRuleRemoveById 942100 942190-942200 abc').statements,
    );

    expect(removal.ids).toEqual([
      { from: 942100, to: 942100 },
      { from: 942190, to: 942200 },
    ]);
    expect(removal.badIds).toEqual(['abc']);
    expect(exclusionSelectorText(removal)).toBe('942100 942190-942200 abc');
  });

  it('у обновления цели номер занимает только первый аргумент', () => {
    const [update] = readExclusions(
      parseModsec('SecRuleUpdateTargetById 942100 "!ARGS:comment" "ARGS"').statements,
    );

    expect(update.ids).toEqual([{ from: 942100, to: 942100 }]);
    expect(update.targets.map((t) => t.raw)).toEqual(['!ARGS:comment']);
    expect(update.replaced).toBe('ARGS');
  });

  it('видит директиву без обязательного аргумента', () => {
    const parsed = readExclusions(
      parseModsec(
        [
          'SecRuleRemoveById',
          'SecRuleUpdateTargetById 942100',
          'SecRuleUpdateActionById 942100',
          'SecRuleRemoveByTag ""',
        ].join('\n'),
      ).statements,
    );

    expect(parsed.map((d) => d.incomplete)).toEqual([true, true, true, true]);
  });

  it('имя директивы читает без учёта регистра, а хранит как написано', () => {
    const [removal] = readExclusions(parseModsec('secruleremovebyid 942100').statements);
    expect(removal.op).toBe('remove');
    expect(removal.name).toBe('secruleremovebyid');
  });

  it('на файле без исключений не собирает ничего', () => {
    const empty = index(RULE);
    expect(entriesOf(empty)).toEqual([]);
    expect(empty.byRule.size).toBe(0);
  });
});

describe('сведение исключений с правилами', () => {
  it('находит правило по номеру, сообщению и тегу', () => {
    const found = index(
      [
        RULE,
        'SecRuleRemoveById 942100',
        'SecRuleRemoveByMsg "SQL Injection"',
        'SecRuleRemoveByTag "attack-sqli"',
      ].join('\n'),
    );

    expect(entriesOf(found).map((entry) => entry.matches.map((m) => m.key))).toEqual([
      ['rule-0'],
      ['rule-0'],
      ['rule-0'],
    ]);
    expect(effectOf(found, 'rule-0')?.removedBy).toHaveLength(3);
  });

  it('накрывает диапазоном всё, что в него попало', () => {
    const found = index(
      [
        RULE,
        `SecRule ARGS "@rx x" "id:942110,phase:2,deny,msg:'y'"`,
        `SecRule ARGS "@rx x" "id:943000,phase:2,deny,msg:'z'"`,
        'SecRuleRemoveById 942000-942999',
      ].join('\n'),
    );

    expect(entriesOf(found)[0].matches.map((m) => m.id)).toEqual(['942100', '942110']);
  });

  it('не считает применённой директиву, которая стоит выше правила', () => {
    const found = index(['SecRuleRemoveById 942100', RULE].join('\n'));

    expect(entriesOf(found)[0].matches).toEqual([
      { file: LONE_FILE, key: 'rule-1', id: '942100', applies: false },
    ]);
    // Правило не тронуто: до него исключение не дожило.
    expect(found.byRule.size).toBe(0);
  });

  it('раскладывает правки правила по тому, что именно они меняют', () => {
    const found = index(
      [
        RULE,
        'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
        'SecRuleUpdateActionById 942100 "pass,status:200"',
      ].join('\n'),
    );

    const effect = effectOf(found, 'rule-0');
    expect(effect?.removedBy).toEqual([]);
    expect(effect?.targetEdits).toEqual([
      {
        file: LONE_FILE,
        key: 'directive-1',
        line: 2,
        name: 'SecRuleUpdateTargetById',
        text: 'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
        source: 'directive',
      },
    ]);
    expect(effect?.actionEdits).toEqual([
      {
        file: LONE_FILE,
        key: 'directive-2',
        line: 3,
        name: 'SecRuleUpdateActionById',
        text: 'SecRuleUpdateActionById 942100 "pass,status:200"',
        source: 'directive',
      },
    ]);
  });

  it('снимает `SecAction` так же, как правило', () => {
    const found = index(
      ['SecAction "id:900100,phase:1,pass,nolog"', 'SecRuleRemoveById 900100'].join('\n'),
    );

    expect(entriesOf(found)[0].matches.map((m) => m.key)).toEqual(['action-0']);
  });

  it('не выбирает ничего по шаблону, который не собирается', () => {
    const found = index([RULE, 'SecRuleRemoveByMsg "SQL ("'].join('\n'));
    expect(entriesOf(found)[0].matches).toEqual([]);
  });

  it('различает набор правил и одинокую надстройку', () => {
    expect(index([RULE, 'SecRuleRemoveById 999999'].join('\n')).hasIds).toBe(true);
    expect(index('SecRuleRemoveById 999999').hasIds).toBe(false);
  });

  it('на пустом списке директив не смотрит на правила вовсе', () => {
    const doc = parseModsec(RULE);
    expect(indexExclusions(compileDocument(doc).blocks, [])).toEqual({
      byStatement: new Map(),
      byRule: new Map(),
      names: new Map([[LONE_FILE, '']]),
      hasIds: false,
    });
  });
});

describe('сведение по набору файлов', () => {
  it('дотягивается директивой до правила из файла, читаемого раньше', () => {
    const found = workspace(['rules.conf', RULE], ['exclusions.conf', 'SecRuleRemoveById 942100']);

    expect(entriesOf(found)[0].matches).toEqual([
      { file: 'rules.conf', key: 'rule-0', id: '942100', applies: true },
    ]);
    expect(found.byRule.get(blockRef('rules.conf', 'rule-0'))?.removedBy).toEqual([
      {
        file: 'exclusions.conf',
        key: 'directive-0',
        line: 1,
        name: 'SecRuleRemoveById',
        text: 'SecRuleRemoveById 942100',
        source: 'directive',
      },
    ]);
  });

  it('не даёт директиве дотянуться до правила из файла, читаемого позже', () => {
    const found = workspace(['exclusions.conf', 'SecRuleRemoveById 942100'], ['rules.conf', RULE]);

    expect(entriesOf(found)[0].matches).toEqual([
      { file: 'rules.conf', key: 'rule-0', id: '942100', applies: false },
    ]);
    expect(found.byRule.size).toBe(0);
  });

  // У `ctl` порядок противоположный: он обязан отработать раньше цели, и файл,
  // читаемый раньше, ему как раз подходит.
  it('считает применённым `ctl` из файла, читаемого раньше', () => {
    const found = workspace(
      [
        'carrier.conf',
        'SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:1,pass,nolog,ctl:ruleRemoveById=942100"',
      ],
      ['rules.conf', RULE],
    );

    expect(entriesOf(found)[0].matches).toEqual([
      { file: 'rules.conf', key: 'rule-0', id: '942100', applies: true },
    ]);
    expect(entriesOf(found)[0].carrier?.file).toBe('carrier.conf');
  });

  // Промах выборки в одинокой надстройке — норма: правила приходят из набора,
  // которого здесь нет. А вот рядом с файлом правил это уже опечатка.
  it('считает `hasIds` по всему набору, а не по файлу директивы', () => {
    expect(workspace(['rules.conf', RULE], ['sub.conf', 'SecRuleRemoveById 999999']).hasIds).toBe(
      true,
    );
    expect(workspace(['sub.conf', 'SecRuleRemoveById 999999']).hasIds).toBe(false);
  });

  it('помнит имена файлов набора: их называют отметки и замечания', () => {
    const found = workspace(['rules.conf', RULE], ['exclusions.conf', 'SecRuleRemoveById 942100']);
    expect(found.names.get('rules.conf')).toBe('rules.conf');
  });
});

describe('исключения времени запроса', () => {
  /** Правило, которое снимают исключения в этих тестах: вторая фаза. */
  const TARGET = `SecRule ARGS "@detectXSS" "id:941100,phase:2,block,msg:'XSS',tag:'attack-xss'"`;

  /** Носитель исключения: правило первой фазы, ничего не прерывающее. */
  const carrier = (ctl: string) =>
    `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:1,pass,nolog,${ctl}"`;

  it('раскладывает шесть значений `ctl` по тем же осям, что директивы', () => {
    const parsed = readExclusions(
      parseModsec(
        [
          carrier('ctl:ruleRemoveById=941100'),
          carrier('ctl:ruleRemoveByMsg=XSS'),
          carrier('ctl:ruleRemoveByTag=attack-xss'),
          carrier('ctl:ruleRemoveTargetById=941100;ARGS:body'),
          carrier('ctl:ruleRemoveTargetByMsg=XSS;ARGS:body'),
          carrier('ctl:ruleRemoveTargetByTag=attack-xss;ARGS:body'),
        ].join('\n'),
      ).statements,
    );

    expect(parsed.map((d) => `${d.op}/${d.selector}`)).toEqual([
      'remove/id',
      'remove/msg',
      'remove/tag',
      'removeTarget/id',
      'removeTarget/msg',
      'removeTarget/tag',
    ]);
    expect(parsed.every((d) => d.source === 'ctl' && !d.incomplete)).toBe(true);
  });

  it('оставляет прочие настройки `ctl` в покое', () => {
    const parsed = readExclusions(
      parseModsec(carrier('ctl:ruleEngine=Off,ctl:requestBodyProcessor=JSON')).statements,
    );
    expect(parsed).toEqual([]);
  });

  it('делит запись по `=` и первой `;`, а имя хранит как написано', () => {
    const [ctl] = readExclusions(
      parseModsec(carrier('ctl:ruleRemoveTargetById=941100;ARGS:article_body')).statements,
    );

    expect(ctl.name).toBe('ctl:ruleRemoveTargetById');
    expect(ctl.ids).toEqual([{ from: 941100, to: 941100 }]);
    expect(ctl.targets.map((target) => target.raw)).toEqual(['ARGS:article_body']);
  });

  // Выборка по номеру здесь ровно одна. Запятая разделяет действия, а не
  // номера, поэтому список пишут пробелами — и ModSecurity читает его как
  // один диапазон с невозможным именем.
  it('не принимает список номеров за выборку', () => {
    const [ctl] = readExclusions(
      parseModsec(carrier('ctl:ruleRemoveById=941100 941110')).statements,
    );
    expect(ctl.ids).toEqual([]);
    expect(ctl.badIds).toEqual(['941100 941110']);
  });

  it('видит, что цели после «;» нет', () => {
    const [ctl] = readExclusions(
      parseModsec(carrier('ctl:ruleRemoveTargetById=941100')).statements,
    );
    expect(ctl.incomplete).toBe(true);
  });

  it('держит все исключения одного правила, а не последнее из них', () => {
    const found = index(
      [
        carrier('ctl:ruleRemoveById=941100,ctl:ruleRemoveById=941110'),
        TARGET,
        `SecRule ARGS "@detectXSS" "id:941110,phase:2,block,msg:'XSS'"`,
      ].join('\n'),
    );

    expect(entriesOf(found).map((entry) => exclusionSelectorText(entry.directive))).toEqual([
      '941100',
      '941110',
    ]);
  });

  it('находит `ctl`, написанный в звене цепочки', () => {
    const found = index(
      [
        `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:1,pass,nolog,chain"`,
        `    SecRule REQUEST_METHOD "@streq POST" "ctl:ruleRemoveById=941100"`,
        TARGET,
      ].join('\n'),
    );

    const [entry] = entriesOf(found);
    // Носитель — правило целиком: фаза и реакция записаны в его голове.
    expect(entry.carrier).toEqual({
      file: LONE_FILE,
      key: 'rule-0',
      id: '1000',
      phase: 1,
      conditional: true,
      stops: '',
    });
    expect(entry.matches).toEqual([
      { file: LONE_FILE, key: 'rule-2', id: '941100', applies: true },
    ]);
  });

  // Порядок исполнения — сначала фаза, потом строка, — поэтому исключение,
  // написанное выше своей цели, работает: у директивы было бы наоборот.
  it('считает применённым `ctl`, который выполняется раньше правила', () => {
    const found = index([carrier('ctl:ruleRemoveById=941100'), TARGET].join('\n'));

    expect(entriesOf(found)[0].matches).toEqual([
      { file: LONE_FILE, key: 'rule-1', id: '941100', applies: true },
    ]);
    expect(effectOf(found, 'rule-1')?.removedBy).toEqual([
      {
        file: LONE_FILE,
        // Носитель `ctl` — само правило: за исключением отправляют к нему.
        key: 'rule-0',
        line: 1,
        name: 'ctl:ruleRemoveById',
        text: 'ctl:ruleRemoveById=941100',
        source: 'ctl',
      },
    ]);
  });

  it('не считает применённым `ctl`, который выполняется позже правила', () => {
    const found = index(
      [
        TARGET,
        `SecRule REQUEST_FILENAME "@streq /api" "id:1000,phase:2,pass,nolog,ctl:ruleRemoveById=941100"`,
      ].join('\n'),
    );

    expect(entriesOf(found)[0].matches).toEqual([
      { file: LONE_FILE, key: 'rule-0', id: '941100', applies: false },
    ]);
    expect(found.byRule.size).toBe(0);
  });

  // Фаза сильнее строки: правило первой фазы отработает раньше всей второй,
  // где бы оно ни было написано.
  it('ставит фазу выше порядка строк', () => {
    const found = index([TARGET, carrier('ctl:ruleRemoveById=941100')].join('\n'));
    expect(entriesOf(found)[0].matches[0].applies).toBe(true);
  });

  it('отличает безусловного носителя от условного и прерывающего', () => {
    const found = index(
      [
        'SecAction "id:900100,phase:1,pass,nolog,ctl:ruleRemoveById=941100"',
        `SecRule ARGS "@rx x" "id:1001,phase:1,deny,ctl:ruleRemoveById=941100"`,
        TARGET,
      ].join('\n'),
    );

    expect(entriesOf(found).map((entry) => entry.carrier)).toEqual([
      { file: LONE_FILE, key: 'action-0', id: '900100', phase: 1, conditional: false, stops: '' },
      { file: LONE_FILE, key: 'rule-1', id: '1001', phase: 1, conditional: true, stops: 'deny' },
    ]);
  });

  it('берёт фазу по умолчанию, когда её не назвали', () => {
    const found = index(
      [`SecRule ARGS "@rx x" "id:1000,pass,nolog,ctl:ruleRemoveById=941100"`, TARGET].join('\n'),
    );
    expect(entriesOf(found)[0].carrier?.phase).toBe(2);
  });
});

describe('запись исключения целиком', () => {
  /** Запись, собранная из разобранных частей исключения. */
  const record = (source: string) =>
    readExclusions(parseModsec(source).statements).map(exclusionRecordText);

  it('собирает директиву обратно так, как её пишут', () => {
    expect(
      record(
        [
          'SecRuleRemoveById 942100 942190-942200',
          'SecRuleRemoveByTag attack-xss',
          'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
          'SecRuleUpdateTargetByMsg "XSS Attack" "!ARGS:bio" "ARGS"',
          'SecRuleUpdateActionById 942100 "pass,status:200"',
        ].join('\n'),
      ),
    ).toEqual([
      'SecRuleRemoveById 942100 942190-942200',
      'SecRuleRemoveByTag "attack-xss"',
      'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
      'SecRuleUpdateTargetByMsg "XSS Attack" "!ARGS:bio" "ARGS"',
      'SecRuleUpdateActionById 942100 "pass,status:200"',
    ]);
  });

  // У `ctl` границы свои: `=` перед выборкой, `;` перед снимаемой целью.
  it('собирает `ctl` его собственными разделителями', () => {
    expect(
      record(
        `SecRule ARGS "@rx x" "id:1,phase:1,pass,nolog,ctl:ruleRemoveById=942100,ctl:ruleRemoveTargetByTag=attack-xss;ARGS:comment"`,
      ),
    ).toEqual(['ctl:ruleRemoveById=942100', 'ctl:ruleRemoveTargetByTag=attack-xss;ARGS:comment']);
  });

  it('отличает исключение от настройки движка среди действий `ctl`', () => {
    const [statement] = parseModsec(
      `SecRule ARGS "@rx x" "id:1,phase:1,pass,nolog,ctl:requestBodyAccess=Off,ctl:ruleRemoveById=942100,ctl"`,
    ).statements;
    if (statement.kind !== 'SecRule') throw new Error('ожидалось SecRule');

    expect(
      statement.actions.filter((action) => action.name === 'ctl').map(isExclusionCtl),
    ).toEqual([false, true, false]);
  });
});

describe('исключение `ctl` как строка формы', () => {
  /** Действия правила — то, из чего строки формы читаются и во что уходят. */
  const actionsOf = (source: string) => {
    const [statement] = parseModsec(source).statements;
    if (statement.kind !== 'SecRule') throw new Error('ожидалось SecRule');
    return statement.actions;
  };

  const rule = (...ctls: string[]) =>
    actionsOf(`SecRule ARGS "@rx x" "id:1,phase:1,pass,nolog,${ctls.join(',')}"`);

  /** Цели строки формы так, как их пишут в файле. */
  const targetsOf = (value: CtlExclusion) =>
    targetsToVariables(value.targets).map(serializeVariable);

  // Цель в записи одна, а решение снять две — одно, поэтому соседние записи
  // об одной и той же выборке читаются одной строкой формы.
  it('читает соседние записи об одной выборке одной строкой', () => {
    const runs = readCtlExclusionRuns(
      rule('ctl:ruleRemoveTargetById=942100;ARGS:a', 'ctl:ruleRemoveTargetById=942100;ARGS:b'),
    );

    expect(runs).toHaveLength(1);
    expect(runs[0].at).toEqual([4, 5]);
    expect(targetsOf(runs[0].value)).toEqual(['ARGS:a', 'ARGS:b']);
  });

  it('не сливает записи с разной выборкой', () => {
    const runs = readCtlExclusionRuns(
      rule('ctl:ruleRemoveTargetById=942100;ARGS:a', 'ctl:ruleRemoveTargetById=942110;ARGS:b'),
    );

    expect(runs.map((run) => run.value.pick)).toEqual(['942100', '942110']);
  });

  // Строка формы уходит в файл одним отрезком, поэтому чужое действие между
  // записями рвёт её: слитая, она переставила бы то, что стоит между ними.
  it('не сливает записи через чужое действие', () => {
    const runs = readCtlExclusionRuns(
      rule(
        'ctl:ruleRemoveTargetById=942100;ARGS:a',
        'ctl:requestBodyAccess=Off',
        'ctl:ruleRemoveTargetById=942100;ARGS:b',
      ),
    );

    expect(runs.map((run) => targetsOf(run.value))).toEqual([['ARGS:a'], ['ARGS:b']]);
  });

  // Два одинаковых снятия рядом — повтор в файле, а не список формы: слитые,
  // они потеряли бы вторую запись на первой же правке.
  it('не сливает повторное снятие правила целиком', () => {
    const runs = readCtlExclusionRuns(
      rule('ctl:ruleRemoveById=942100', 'ctl:ruleRemoveById=942100'),
    );
    expect(runs).toHaveLength(2);
  });

  it('пишет по записи на каждую цель', () => {
    const [run] = readCtlExclusionRuns(rule('ctl:ruleRemoveTargetById=942100;ARGS:a'));
    const written = ctlExclusionActions({
      ...run.value,
      targets: [
        { name: 'ARGS', count: false, mode: 'only', params: ['a', 'b'] },
        { name: 'REQUEST_HEADERS', count: false, mode: 'only', params: ['Referer'] },
      ],
    });

    expect(written.map((action) => action.value)).toEqual([
      'ruleRemoveTargetById=942100;ARGS:a',
      'ruleRemoveTargetById=942100;ARGS:b',
      'ruleRemoveTargetById=942100;REQUEST_HEADERS:Referer',
    ]);
  });

  // Прочитанное и записанное обратно должно дать то же самое: иначе строка
  // формы разъезжалась бы на записи от каждой правки.
  it('читает записанное тем же списком целей', () => {
    const targets = [
      { name: 'ARGS', count: false, mode: 'except' as const, params: ['a'] },
      { name: 'ARGS_NAMES', count: false, mode: 'only' as const, params: [] },
    ];
    const written = ctlExclusionActions({
      op: 'removeTarget',
      selector: 'tag',
      pick: 'attack-xss',
      targets,
    });

    const [run] = readCtlExclusionRuns(written);
    expect(run.value.targets).toEqual(targets);
  });

  // Пустой хвост ModSecurity прочитал бы мусором в номере правила, поэтому
  // недописанная цель уходит в файл не точкой с запятой, а ничем.
  it('пишет недописанную цель без точки с запятой', () => {
    const written = ctlExclusionActions({
      op: 'removeTarget',
      selector: 'id',
      pick: '942100',
      targets: [{ name: '', count: false, mode: 'only', params: [] }],
    });

    expect(written.map((action) => action.value)).toEqual(['ruleRemoveTargetById=942100']);
  });

  it('не приписывает цель снятию правила целиком', () => {
    const written = ctlExclusionActions({
      op: 'remove',
      selector: 'id',
      pick: '942100',
      targets: [{ name: 'ARGS', count: false, mode: 'only', params: ['a'] }],
    });

    expect(written.map((action) => action.value)).toEqual(['ruleRemoveById=942100']);
  });
});

describe('цели директивы как форма', () => {
  it('сводит параметры одной переменной в одну цель', () => {
    expect(readExclusionTargets('!ARGS:a|!ARGS:b')).toEqual([
      { remove: true, name: 'ARGS', params: ['a', 'b'], count: false },
    ]);
  });

  // Знак — это и есть решение, и разные решения одной строкой формы не
  // показать: одно вычитает цель у правила, другое приписывает ему новую.
  it('не сводит вместе вычитание и приписывание', () => {
    expect(readExclusionTargets('!ARGS:a|ARGS:b')).toEqual([
      { remove: true, name: 'ARGS', params: ['a'], count: false },
      { remove: false, name: 'ARGS', params: ['b'], count: false },
    ]);
  });

  // Голый терм — это вся коллекция, и параметр рядом с ним значит отдельную
  // цель, а не уточнение к ней.
  it('не кладёт параметр в перечень целой коллекции', () => {
    expect(readExclusionTargets('!ARGS|!ARGS:a')).toEqual([
      { remove: true, name: 'ARGS', params: [], count: false },
      { remove: true, name: 'ARGS', params: ['a'], count: false },
    ]);
  });

  it.each([
    '!ARGS',
    '!ARGS:a|!ARGS:b',
    '!REQUEST_COOKIES:sid|ARGS:q',
    '&ARGS|!REQUEST_HEADERS:Referer',
    `!ARGS:'my field'`,
  ])('читает записанное тем же списком целей: %s', (payload) => {
    expect(writeExclusionTargets(readExclusionTargets(payload))).toBe(payload);
  });

  // `!` без имени ModSecurity прочитал бы вычитанием переменной с пустым
  // именем и не нашёл бы по нему ничего.
  it('не пишет безымянную цель', () => {
    expect(writeExclusionTargets([makeExclusionTarget(''), makeExclusionTarget('ARGS')])).toBe(
      '!ARGS',
    );
  });

  // Фраза говорит знак словом, и `!` стоял бы в ней вторым отрицанием.
  it('пересказывает цели без знака', () => {
    expect(exclusionTargetText(readExclusionTargets('!ARGS:a|!ARGS:b'))).toBe('ARGS:a, ARGS:b');
  });
});

describe('новое исключение для правила', () => {
  it('снимает правило по номеру', () => {
    expect(excludeRuleLine('942100')).toBe('SecRuleRemoveById 942100');
  });

  it('вычитает цель, оставляя правило в работе', () => {
    expect(excludeTargetLine('942100', 'ARGS', ['comment'])).toBe(
      'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
    );
    expect(excludeTargetLine('942100', 'REQUEST_COOKIES')).toBe(
      'SecRuleUpdateTargetById 942100 "!REQUEST_COOKIES"',
    );
  });

  // Одна строка снимает столько параметров, сколько в ней перечислено:
  // ModSecurity дописывает к целям правила весь список второго аргумента.
  it('вычитает несколько параметров одной строкой', () => {
    expect(excludeTargetLine('942100', 'ARGS', ['a', 'b'])).toBe(
      'SecRuleUpdateTargetById 942100 "!ARGS:a|!ARGS:b"',
    );
  });

  // Имя с пробелом берёт одинарные кавычки внутри двойных: иначе список
  // переменных распался бы на две записи, а правило значило бы не то.
  it('записывает имя параметра, которое иначе распалось бы', () => {
    expect(excludeTargetLine('942100', 'ARGS', ['my field'])).toBe(
      `SecRuleUpdateTargetById 942100 "!ARGS:'my field'"`,
    );
  });

  it('читается обратно тем же исключением', () => {
    const line = excludeTargetLine('942100', 'ARGS', ['comment', 'bio']);
    const [directive] = readExclusions(parseModsec(line).statements);

    expect(directive.op).toBe('updateTarget');
    expect(directive.ids).toEqual([{ from: 942100, to: 942100 }]);
    expect(directive.targets.map((target) => target.raw)).toEqual(['!ARGS:comment', '!ARGS:bio']);
    expect(exclusionRecordText(directive)).toBe(line);
  });
});

describe('отпечаток директивы', () => {
  it('совпадает у директив, делающих одно и то же', () => {
    const [first, second] = readExclusions(
      parseModsec(['SecRuleRemoveById 942100', 'SecRuleRemoveById 942100'].join('\n')).statements,
    );
    expect(exclusionSignature(first)).toBe(exclusionSignature(second));
  });

  // Директива снимает правило навсегда, `ctl` — на один запрос: одна и та же
  // выборка тут не значит одно и то же дело.
  it('различает директиву и `ctl` с той же выборкой', () => {
    const [directive, ctl] = readExclusions(
      parseModsec(
        [
          'SecRuleRemoveById 942100',
          `SecRule ARGS "@rx x" "id:1,phase:1,pass,nolog,ctl:ruleRemoveById=942100"`,
        ].join('\n'),
      ).statements,
    );
    expect(exclusionSignature(directive)).not.toBe(exclusionSignature(ctl));
  });

  it('различается, когда правки разные', () => {
    const [target, action] = readExclusions(
      parseModsec(
        [
          'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
          'SecRuleUpdateTargetById 942100 "!ARGS:bio"',
        ].join('\n'),
      ).statements,
    );
    expect(exclusionSignature(target)).not.toBe(exclusionSignature(action));
  });
});
