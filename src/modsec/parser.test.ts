import { parseModsec, parseActions, parseVariables, parseOperator } from './parser';
import type { SecRuleStatement } from './types';

describe('parseModsec', () => {
  it('splits a SecRule into variables, operator and actions', () => {
    const doc = parseModsec(
      'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:1001,phase:1,deny,status:403,msg:\'Bad bot detected\'"',
    );

    expect(doc.rules).toHaveLength(1);
    const rule = doc.rules[0];

    expect(rule.variables).toEqual([
      {
        raw: 'REQUEST_HEADERS:User-Agent',
        name: 'REQUEST_HEADERS',
        selector: 'User-Agent',
        count: false,
        exclusion: false,
      },
    ]);
    expect(rule.operator).toMatchObject({
      name: 'contains',
      argument: 'badbot',
      negated: false,
      implicit: false,
    });
    expect(rule.id).toBe('1001');
    expect(rule.phase).toBe('1');
    expect(rule.msg).toBe('Bad bot detected');
  });

  it('joins physical lines continued with a trailing backslash', () => {
    const src = 'SecRule ARGS "@rx (?i:union(.*?)select)" \\\n    "id:2001,phase:2,block,t:none,t:lowercase"';
    const doc = parseModsec(src);

    expect(doc.rules).toHaveLength(1);
    expect(doc.rules[0].span).toEqual({ startLine: 1, endLine: 2 });
    expect(doc.rules[0].operator.argument).toBe('(?i:union(.*?)select)');
    expect(doc.rules[0].actions.filter((a) => a.name === 't')).toHaveLength(2);
  });

  it('classifies comments, blanks and generic directives', () => {
    const doc = parseModsec('# hello\n\nSecRuleEngine On');
    expect(doc.statements.map((s) => s.kind)).toEqual([
      'comment',
      'blank',
      'directive',
    ]);
    expect(doc.statements[0]).toMatchObject({ kind: 'comment', text: 'hello' });
    expect(doc.statements[2]).toMatchObject({
      kind: 'directive',
      name: 'SecRuleEngine',
      args: ['On'],
    });
  });

  it('parses SecAction and detects chaining', () => {
    const doc = parseModsec(
      'SecRule ARGS "@rx a" "id:1,phase:2,chain"\nSecAction "id:2,pass,nolog"',
    );
    const rule = doc.statements[0] as SecRuleStatement;
    expect(rule.chained).toBe(true);
    expect(doc.statements[1]).toMatchObject({ kind: 'SecAction', id: '2' });
  });
});

describe('parseVariables', () => {
  it('handles exclusion, count and multiple targets', () => {
    expect(parseVariables('ARGS|!ARGS:token|&REQUEST_HEADERS')).toEqual([
      { raw: 'ARGS', name: 'ARGS', selector: undefined, count: false, exclusion: false },
      { raw: '!ARGS:token', name: 'ARGS', selector: 'token', count: false, exclusion: true },
      { raw: '&REQUEST_HEADERS', name: 'REQUEST_HEADERS', selector: undefined, count: true, exclusion: false },
    ]);
  });
});

describe('parseOperator', () => {
  it('defaults to an implicit rx operator', () => {
    expect(parseOperator('foobar')).toMatchObject({
      name: 'rx',
      argument: 'foobar',
      implicit: true,
    });
  });

  it('reads a negated operator', () => {
    expect(parseOperator('!@eq 0')).toMatchObject({
      name: 'eq',
      argument: '0',
      negated: true,
      implicit: false,
    });
  });
});

describe('parseActions', () => {
  it('keeps macros and quoted values intact', () => {
    const actions = parseActions("id:4000,pass,initcol:ip=%{REMOTE_ADDR},msg:'hi, there'");
    expect(actions.map((a) => a.name)).toEqual(['id', 'pass', 'initcol', 'msg']);
    expect(actions[2].value).toBe('ip=%{REMOTE_ADDR}');
    expect(actions[3]).toMatchObject({ value: 'hi, there', quoted: true });
  });
});

/*
 * Дальше — то, что документ редактора добавляет к дереву ядра. Сам разбор
 * проверен в `src/seclang/parser.test.ts`; здесь проверяется проекция: что
 * из дерева получается документ, которым конструктор может править файл.
 */

describe('документ как проекция дерева', () => {
  const round = (source: string) =>
    parseModsec(source)
      .statements.map((s) => s.raw)
      .join('\n');

  /**
   * Склейка строк утверждений возвращает исходник символ в символ.
   *
   * На этом держится вся правка из конструктора: нетронутые утверждения
   * уходят в файл своим `raw`, и потеряй документ хоть пустую строку —
   * правка одного правила молча переписала бы соседние.
   */
  it('возвращает исходник символ в символ', () => {
    for (const source of [
      '',
      '\n',
      'SecRuleEngine On',
      'SecRuleEngine On\n',
      '\n\n# c\n\n  SecMarker A  \n\n',
      'SecRule ARGS "@rx a" \\\n    "id:1,\\\n    phase:2,deny"\n\n# tail',
      'SecRule ARGS "@rx a" "id:1"\r\n\r\nSecMarker A\r\n',
      '﻿SecRuleEngine On\n',
      'SecRule ARGS "@rx a" \\',
      '   \\\n\nSecMarker A',
    ]) {
      expect(round(source)).toBe(source);
    }
  });

  it('пустые строки, которых в дереве нет, отдаёт утверждениями', () => {
    const doc = parseModsec('\n# c\n\n\nSecMarker A\n');

    expect(doc.statements.map((s) => s.kind)).toEqual([
      'blank',
      'comment',
      'blank',
      'blank',
      'SecMarker',
      'blank',
    ]);
    expect(doc.statements.map((s) => s.span.startLine)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('многострочный комментарий показывает одной строкой, с пробелом на месте переноса', () => {
    const [comment] = parseModsec('# SecRule ARGS "@rx a" \\\n#   "id:1"').statements;

    expect(comment).toMatchObject({
      kind: 'comment',
      text: 'SecRule ARGS "@rx a"  #   "id:1"',
      span: { startLine: 1, endLine: 2 },
    });
  });

  it('умолчания, исключения и правило на Lua отдаёт директивами с аргументами', () => {
    const doc = parseModsec(
      [
        'SecDefaultAction "phase:2,log,\\\n    pass"',
        'SecRuleRemoveById 1 "2-3" 4',
        'SecRuleUpdateTargetById 942100 "!ARGS:a|!ARGS:b" ARGS',
        'SecRuleScript /opt/check.lua "id:1,phase:2,pass"',
      ].join('\n'),
    );

    expect(
      doc.statements.map((s) => (s.kind === 'directive' ? [s.name, s.args] : s.kind)),
    ).toEqual([
      ['SecDefaultAction', ['phase:2,log,    pass']],
      ['SecRuleRemoveById', ['1', '2-3', '4']],
      ['SecRuleUpdateTargetById', ['942100', '!ARGS:a|!ARGS:b', 'ARGS']],
      ['SecRuleScript', ['/opt/check.lua', 'id:1,phase:2,pass']],
    ]);
  });

  it('правило без оператора и действий достраивает тем, что подразумевает движок', () => {
    const [rule] = parseModsec('SecRule ARGS').rules;

    expect(rule.variables.map((v) => v.name)).toEqual(['ARGS']);
    expect(rule.operator).toEqual({
      raw: '',
      name: 'rx',
      negated: false,
      argument: '',
      implicit: true,
    });
    expect(rule.actions).toEqual([]);
    expect(rule.chained).toBe(false);
  });
});

describe('запись читается так же, как движком', () => {
  /**
   * Имена приводятся к принятому написанию.
   *
   * Движок регистр в именах не различает, а формы конструктора ищут имя в
   * своих таблицах буква в букву. `t:compressWhiteSpace` — не выдумка: так
   * оно сто раз записано в CRS 2, и это то же преобразование.
   */
  it('приводит имена к принятому написанию, а исходник не трогает', () => {
    const source = 'secrule args "@RX ^a" "ID:1,PHASE:2,Deny,T:compressWhiteSpace,Chain"';
    const [rule] = parseModsec(source).rules;

    expect(rule.kind).toBe('SecRule');
    expect(rule.variables[0].name).toBe('ARGS');
    expect(rule.operator.name).toBe('rx');
    expect(rule.actions.map((a) => [a.name, a.value])).toEqual([
      ['id', '1'],
      ['phase', '2'],
      ['deny', undefined],
      ['t', 'compressWhitespace'],
      ['chain', undefined],
    ]);
    expect(rule.id).toBe('1');
    expect(rule.chained).toBe(true);
    // Написанное остаётся в `raw`: пока правило не правили, в файл уходит оно.
    expect(rule.raw).toBe(source);
    expect(rule.actions[3].raw).toBe('T:compressWhiteSpace');
  });

  it('незнакомое имя оставляет как написано', () => {
    const [rule] = parseModsec('SecRule Nope "@Zzz a" "id:1,Zap,t:Wat"').rules;

    expect(rule.variables[0].name).toBe('Nope');
    expect(rule.operator.name).toBe('Zzz');
    expect(rule.actions.map((a) => [a.name, a.value])).toEqual([
      ['id', '1'],
      ['Zap', undefined],
      ['t', 'Wat'],
    ]);
  });

  it('имя директивы приводит к принятому, а чужую оставляет как есть', () => {
    const doc = parseModsec('secruleengine On\nInclude rules/*.conf\nSECMARKER End');

    expect(doc.statements[0]).toMatchObject({ kind: 'directive', name: 'SecRuleEngine' });
    expect(doc.statements[1]).toMatchObject({ kind: 'directive', name: 'Include' });
    expect(doc.statements[2]).toMatchObject({ kind: 'SecMarker', label: 'End' });
  });

  it('перенос внутри кавычек исчезает бесследно, а не становится пробелом', () => {
    const [rule] = parseModsec(
      'SecRule ARGS "@pm alpha be\\\nta" "id:1,msg:\'two wo\\\nrds\'"',
    ).rules;

    expect(rule.operator.argument).toBe('alpha beta');
    expect(rule.msg).toBe('two words');
  });

  /**
   * Пробел в конце шаблона — часть шаблона.
   *
   * В CRS так записаны правила на веб-шеллы: `<title>lostDC - ` с пробелом
   * в конце. Срежь его разбор — и первая же правка этого правила в
   * конструкторе молча расширила бы шаблон.
   */
  it('пробел в конце аргумента оператора остаётся его частью', () => {
    const [rule] = parseModsec('SecRule RESPONSE_BODY "@rx <title>lostDC - " "id:1"').rules;
    expect(rule.operator.argument).toBe('<title>lostDC - ');
  });

  it('пробел перед «@» делает запись шаблоном, как у движка', () => {
    const [rule] = parseModsec('SecRule ARGS " @contains admin" "id:1"').rules;

    expect(rule.operator).toMatchObject({
      name: 'rx',
      implicit: true,
      argument: ' @contains admin',
    });
  });

  it('строку с пробелом после переноса читает одним правилом, как задумал автор', () => {
    const doc = parseModsec('SecRule ARGS "@rx a" \\ \n    "id:1,phase:2,deny"');

    expect(doc.statements).toHaveLength(1);
    expect(doc.rules[0]).toMatchObject({ id: '1', span: { startLine: 1, endLine: 2 } });
  });

  it('запись части правила отдаёт без переносов и экранирования строки', () => {
    const [rule] = parseModsec(
      'SecRule "ARGS:a|\\\n    ARGS:b" "@rx \\"x\\"" "id:1,\\\n    msg:\'m\'"',
    ).rules;

    expect(rule.variables.map((v) => v.raw)).toEqual(['ARGS:a', 'ARGS:b']);
    expect(rule.operator.raw).toBe('@rx "x"');
    expect(rule.actions.map((a) => a.raw)).toEqual(['id:1', "msg:'m'"]);
  });
});
