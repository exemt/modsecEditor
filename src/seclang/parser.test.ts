import { nodePathAt, walk } from './ast';
import {
  parse,
  parseActionList,
  parseArguments,
  parseOperator,
  parseVariableList,
} from './parser';
import { LineIndex } from './position';
import type { Node, SecRuleNode, SetvarNode, Statement } from './ast';

/** Текст исходника, который узел покрывает: границы проверяются им. */
function slice(source: string, node: { start: number; end: number }): string {
  return source.slice(node.start, node.end);
}

function rule(source: string, index = 0): SecRuleNode {
  const statement = parse(source).statements[index];
  if (statement.kind !== 'SecRule') throw new Error(`не SecRule: ${statement.kind}`);
  return statement;
}

describe('parse: утверждения', () => {
  it('раскладывает SecRule на области, оператор и действия', () => {
    const source =
      'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" "id:1001,phase:1,deny,msg:\'Bad bot\'"';
    const node = rule(source);

    expect(node.name).toBe('SecRule');
    expect(node.argCount).toBe(3);
    expect(node.variables?.items).toHaveLength(1);
    expect(node.variables?.items[0]).toMatchObject({
      kind: 'Variable',
      name: 'REQUEST_HEADERS',
      count: false,
      exclude: false,
      selector: { kind: 'Selector', value: 'User-Agent', quoted: false, pattern: false },
    });
    expect(node.operator).toMatchObject({
      name: 'contains',
      negated: false,
      implicit: false,
      argument: { value: 'badbot' },
    });
    expect(node.actions?.items.map((a) => [a.kind, a.name, a.value?.value ?? null])).toEqual([
      ['Action', 'id', '1001'],
      ['Action', 'phase', '1'],
      ['Action', 'deny', null],
      ['Action', 'msg', 'Bad bot'],
    ]);
  });

  it('различает виды утверждений и не делает узлов из пустых строк', () => {
    const file = parse(
      [
        '# комментарий',
        '',
        'SecRuleEngine On',
        'SecAction "id:1,phase:1,pass,nolog"',
        'SecDefaultAction "phase:2,log,pass,t:lowercase"',
        'SecMarker END_CHECKS',
        'Include other.conf',
      ].join('\n'),
    );

    expect(file.statements.map((s) => [s.kind, s.line])).toEqual([
      ['Comment', 1],
      ['Directive', 3],
      ['SecAction', 4],
      ['SecDefaultAction', 5],
      ['SecMarker', 6],
      ['Directive', 7],
    ]);
    expect(file.statements[0]).toMatchObject({ text: 'комментарий' });
    expect(file.statements[1]).toMatchObject({ name: 'SecRuleEngine', args: [{ value: 'On' }] });
    expect(file.statements[4]).toMatchObject({ label: { value: 'END_CHECKS' } });
    expect(file.issues).toEqual([]);
  });

  it('узнаёт директиву в любом регистре, но имя хранит как написано', () => {
    const node = parse('secrule ARGS "@rx a" "id:1"').statements[0];
    expect(node).toMatchObject({ kind: 'SecRule', name: 'secrule' });
  });

  it('разбирает правило на Lua: путь к сценарию и обычный список действий', () => {
    const source = 'SecRuleScript lua/bayes.lua "phase:2,id:\'900034\',block,setvar:tx.score=+%{tx.weight}"';
    const node = parse(source).statements[0];

    expect(node).toMatchObject({
      kind: 'SecRuleScript',
      argCount: 2,
      script: { kind: 'Argument', value: 'lua/bayes.lua' },
    });
    if (node.kind !== 'SecRuleScript') throw new Error('не SecRuleScript');
    expect(node.actions?.items.map((a) => [a.kind, a.name, a.value?.value])).toEqual([
      ['Action', 'phase', '2'],
      ['Action', 'id', '900034'],
      ['Action', 'block', undefined],
      ['Setvar', 'setvar', 'tx.score=+%{tx.weight}'],
    ]);
    expect(parse('SecRuleScript').statements[0]).toMatchObject({ script: null, actions: null });
  });

  it('оставляет недостающие части пустыми, а не выдумывает их', () => {
    expect(rule('SecRule ARGS')).toMatchObject({ argCount: 1, operator: null, actions: null });
    expect(rule('SecRule ARGS "@rx a"')).toMatchObject({ argCount: 2, actions: null });
    expect(parse('SecAction').statements[0]).toMatchObject({ argCount: 0, actions: null });
  });

  it('читает файл с CRLF и BOM', () => {
    const file = parse('﻿SecRuleEngine On\r\nSecRule ARGS "@rx a" \\\r\n  "id:1"\r\n');
    expect(file.statements.map((s) => s.kind)).toEqual(['Directive', 'SecRule']);
    expect(file.statements[0]).toMatchObject({ name: 'SecRuleEngine', args: [{ value: 'On' }] });
    expect(file.statements[1]).toMatchObject({ line: 2, endLine: 3 });
    expect((file.statements[1] as SecRuleNode).actions?.items[0].value?.value).toBe('1');
  });
});

describe('parse: переносы и кавычки', () => {
  const source = [
    'SecRule ARGS|!ARGS:token "@rx (?i)select" \\',
    '    "id:942100,\\',
    '    phase:2,\\',
    "    msg:'SQL \\\"injection\\\"',\\",
    '    t:none,t:urlDecodeUni"',
    'SecRuleEngine On',
  ].join('\n');

  it('собирает утверждение из нескольких строк и считает строки', () => {
    const file = parse(source);
    expect(file.statements).toHaveLength(2);
    expect(file.statements[0]).toMatchObject({ kind: 'SecRule', line: 1, endLine: 5 });
    expect(file.statements[1]).toMatchObject({ kind: 'Directive', line: 6, endLine: 6 });
  });

  it('снимает переносы и экранирование из значений', () => {
    const actions = rule(source).actions?.items ?? [];
    expect(actions.map((a) => a.name)).toEqual(['id', 'phase', 'msg', 't', 't']);
    expect(actions[2].value).toMatchObject({ value: 'SQL "injection"', quoted: true });
  });

  it('держит границы узлов в исходнике, несмотря на вырезанное', () => {
    const actions = rule(source).actions?.items ?? [];
    expect(slice(source, actions[0])).toBe('id:942100');
    expect(slice(source, actions[1])).toBe('phase:2');
    // Экранированные кавычки вырезаны из значения, но остаются в границах.
    expect(slice(source, actions[2])).toBe("msg:'SQL \\\"injection\\\"'");
    expect(slice(source, actions[4])).toBe('t:urlDecodeUni');
    expect(slice(source, actions[4].value!)).toBe('urlDecodeUni');

    const lines = new LineIndex(source);
    expect(lines.positionAt(actions[1].start)).toEqual({ line: 3, column: 5 });
    expect(lines.positionAt(actions[4].start).line).toBe(5);
  });

  it('пару обратных слэшей не разворачивает', () => {
    const node = rule('SecRule ARGS "@rx a\\\\b\\"c" "id:1"');
    expect(node.operator?.argument.value).toBe('a\\\\b"c');
  });

  it('чётное число слэшей в конце строки переносом не считает', () => {
    const file = parse('SecRule ARGS "@rx a" "id:1,msg:\'x\\\\\'"\nSecRuleEngine On');
    expect(file.statements.map((s) => s.kind)).toEqual(['SecRule', 'Directive']);
  });

  it('сообщает о незакрытой кавычке и всё равно строит узел', () => {
    const text = 'SecRule ARGS "@rx foo "id:1,deny"';
    const file = parse(text);
    expect(file.issues).toEqual([{ code: 'unterminatedQuote', start: 32, end: 33 }]);
    expect(text[32]).toBe('"');
    expect(file.statements[0].kind).toBe('SecRule');
  });
});

describe('parse: области проверки', () => {
  it('читает префиксы, параметры и шаблоны', () => {
    const list = parseVariableList("ARGS|!ARGS:token|&REQUEST_HEADERS:Host|ARGS:/^id_/|TX:'a b'");
    expect(
      list.items.map((v) => [v.name, v.exclude, v.count, v.selector?.value ?? null]),
    ).toEqual([
      ['ARGS', false, false, null],
      ['ARGS', true, false, 'token'],
      ['REQUEST_HEADERS', false, true, 'Host'],
      ['ARGS', false, false, '/^id_/'],
      ['TX', false, false, 'a b'],
    ]);
    expect(list.items[3].selector).toMatchObject({ pattern: true, quoted: false });
    expect(list.items[4].selector).toMatchObject({ pattern: false, quoted: true });
  });

  it('делит и по запятой, но не внутри кавычек и скобок', () => {
    expect(parseVariableList('ARGS:a,ARGS:b').items).toHaveLength(2);
    expect(parseVariableList("ARGS:'a,b'|ARGS:/x{1,3}/").items.map((v) => v.selector?.value)).toEqual([
      'a,b',
      '/x{1,3}/',
    ]);
  });

  it('даёт точные границы имени и параметра', () => {
    const text = '  !&ARGS:token |  XML:/*';
    const [first, second] = parseVariableList(text).items;
    expect(slice(text, first)).toBe('!&ARGS:token');
    expect(text.slice(first.nameStart, first.nameEnd)).toBe('ARGS');
    expect(slice(text, first.selector!)).toBe('token');
    expect(slice(text, second)).toBe('XML:/*');
  });
});

describe('parse: оператор', () => {
  it.each([
    ['@rx foo', 'rx', false, false, 'foo'],
    ['!@eq 0', 'eq', true, false, '0'],
    ['! @streq x', 'streq', true, false, 'x'],
    ['foo', 'rx', false, true, 'foo'],
    ['!bar', 'rx', true, true, 'bar'],
    ['@detectSQLi', 'detectSQLi', false, false, ''],
    ['@pm a b  c', 'pm', false, false, 'a b  c'],
  ])('%s', (text, name, negated, implicit, argument) => {
    expect(parseOperator(text)).toMatchObject({
      name,
      negated,
      implicit,
      argument: { value: argument },
    });
  });

  it('пробел в конце аргумента оставляет, пробел перед @ оператором не считает', () => {
    expect(parseOperator('@streq foo ').argument.value).toBe('foo ');
    expect(parseOperator(' @rx foo')).toMatchObject({ implicit: true, argument: { value: ' @rx foo' } });
  });

  it('находит макросы в аргументе', () => {
    const text = '@gt %{tx.inbound_anomaly_score_threshold}';
    const { argument } = parseOperator(text);
    expect(argument.macros).toHaveLength(1);
    expect(argument.macros[0]).toMatchObject({ name: 'tx', key: 'inbound_anomaly_score_threshold' });
    expect(slice(text, argument.macros[0])).toBe('%{tx.inbound_anomaly_score_threshold}');
  });
});

describe('parse: действия', () => {
  it('выделяет преобразования, присваивания и ctl в свои виды узлов', () => {
    const list = parseActionList(
      "t:none,t:lowercase,setvar:tx.score=+%{tx.critical},setvar:!tx.flag,setvar:'tx.msg=a, b',ctl:ruleRemoveById=942100,capture",
    );
    expect(list.items.map((a) => a.kind)).toEqual([
      'Transform',
      'Transform',
      'Setvar',
      'Setvar',
      'Setvar',
      'Ctl',
      'Action',
    ]);
    expect(list.items[1]).toMatchObject({ transform: 'lowercase' });

    const [add, remove, set] = list.items.slice(2, 5) as SetvarNode[];
    expect(add).toMatchObject({ collection: 'tx', key: 'score', op: 'add', operand: '%{tx.critical}' });
    expect(add.value?.macros[0]).toMatchObject({ name: 'tx', key: 'critical' });
    expect(remove).toMatchObject({ collection: 'tx', key: 'flag', op: 'delete', operand: null });
    expect(set).toMatchObject({ collection: 'tx', key: 'msg', op: 'set', operand: 'a, b' });

    expect(list.items[5]).toMatchObject({ option: 'ruleRemoveById', operand: '942100' });
  });

  it('имена действий сравнивает без учёта регистра', () => {
    expect(parseActionList('T:lowercase,SetVar:tx.a=1').items.map((a) => a.kind)).toEqual([
      'Transform',
      'Setvar',
    ]);
  });

  it('замечает незакрытый макрос', () => {
    const file = parse('SecAction "id:1,msg:\'%{tx.a\'"');
    expect(file.issues.map((i) => i.code)).toEqual(['unterminatedMacro']);
  });
});

describe('parse: аргументы директивы', () => {
  it('режет строку на слова так же, как разбор файла', () => {
    const text = 'SecRuleUpdateTargetById 942100 "!ARGS:a|!ARGS:b" ARGS';

    expect(parseArguments(text).map((arg) => [arg.value, arg.quoted])).toEqual([
      ['SecRuleUpdateTargetById', false],
      ['942100', false],
      ['!ARGS:a|!ARGS:b', true],
      ['ARGS', false],
    ]);
  });

  it('снимает кавычки, экранирование и переносы внутри кавычек', () => {
    const args = parseArguments('SecDefaultAction "phase:2,\\\n  msg:\\"x\\"" \\\n  extra');

    expect(args.map((arg) => arg.value)).toEqual(['SecDefaultAction', 'phase:2,  msg:"x"', 'extra']);
  });

  it('отдаёт то же, что лежит в дереве у обычной директивы', () => {
    const source = 'SecResponseBodyMimeType text/plain "text/html" text/xml';
    const [statement] = parse(source).statements;
    if (statement.kind !== 'Directive') throw new Error(`не Directive: ${statement.kind}`);

    const [name, ...rest] = parseArguments(source);
    expect(name.value).toBe(statement.name);
    expect(rest).toEqual(statement.args);
  });

  it('сдвигает границы, если текст — часть большего', () => {
    const source = '# c\nSecMarker "END"';
    const [, marker] = parse(source).statements;
    const args = parseArguments(source.slice(marker.start, marker.end), marker.start);

    expect(args.map((arg) => slice(source, arg))).toEqual(['SecMarker', '"END"']);
  });

  it('на пустой строке и на пробелах не находит ничего', () => {
    expect(parseArguments('')).toEqual([]);
    expect(parseArguments('   \t ')).toEqual([]);
  });
});

describe('дерево', () => {
  const source = [
    '# rules',
    'SecRule ARGS:id|&ARGS "@rx ^%{tx.pattern}$" \\',
    '    "id:10,phase:2,deny,t:trim,setvar:tx.hits=+1"',
    'SecMarker END',
  ].join('\n');

  it('границы потомка лежат внутри родителя, соседи идут по порядку', () => {
    const file = parse(source);
    let previousEnd = -1;
    let previousParent: Node | null = null;

    walk(file, (node, parent) => {
      expect(node.start).toBeLessThanOrEqual(node.end);
      if (parent !== null) {
        expect(node.start).toBeGreaterThanOrEqual(parent.start);
        expect(node.end).toBeLessThanOrEqual(parent.end);
        if (parent === previousParent) expect(node.start).toBeGreaterThanOrEqual(previousEnd);
      }
      previousEnd = node.end;
      previousParent = parent;
    });
  });

  it('находит узел под смещением вместе с путём к нему', () => {
    const file = parse(source);
    const at = (text: string) => nodePathAt(file, source.indexOf(text) + 1).map((n) => n.kind);

    expect(at('ARGS:id')).toEqual(['File', 'SecRule', 'VariableList', 'Variable']);
    expect(at('tx.pattern')).toEqual(['File', 'SecRule', 'Operator', 'Text', 'Macro']);
    expect(at('trim')).toEqual(['File', 'SecRule', 'ActionList', 'Transform', 'Text']);
    expect(at('END')).toEqual(['File', 'SecMarker', 'Argument']);
    // Перенос между аргументами принадлежит утверждению, но не его частям.
    const kinds = (offset: number) => nodePathAt(file, offset).map((n) => n.kind);
    expect(kinds(source.indexOf('\\'))).toEqual(['File', 'SecRule']);
    expect(kinds(source.length + 10)).toEqual(['File']);
  });
});

describe('устойчивость', () => {
  // Парсер не должен ни падать, ни зацикливаться, ни терять текст — на
  // чём угодно, включая обрывки, которые человек набирает прямо сейчас.
  const fragments = [
    '',
    '\\',
    '"',
    'SecRule',
    'SecRule "',
    'SecRule ARGS "@rx',
    'SecRule ARGS:\'a "@rx x" "id:1',
    'SecRule !& "@" ":"',
    'SecAction ",,,"',
    'SecAction "t:,setvar:,ctl:=,%{"',
    'SecRule ARGS "@rx \\',
    'SecRule ARGS "\\\\\\',
    "SecRule ARGS:'\\",
    '# comment \\',
    '\r\n\r\n',
  ];

  it.each(fragments)('%j', (fragment) => {
    const file = parse(fragment);
    let statement: Statement | undefined;
    for (statement of file.statements) {
      expect(statement.start).toBeLessThanOrEqual(statement.end);
      expect(statement.end).toBeLessThanOrEqual(fragment.length);
    }
  });

  it('любой префикс правила разбирается', () => {
    const full =
      'SecRule ARGS|!ARGS:\'a b\' "!@rx ^(?:%{tx.a}|b)$" \\\n  "id:1,phase:2,t:none,setvar:\'tx.a=+1\',msg:\'x\\\'y\'"\n';
    for (let length = 0; length <= full.length; length++) {
      expect(() => parse(full.slice(0, length))).not.toThrow();
    }
  });
});
