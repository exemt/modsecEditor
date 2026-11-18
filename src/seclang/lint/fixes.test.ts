import {
  CODES,
  FIXABLE,
  applyFixes,
  createWorkspace,
  fixFor,
  fixesFor,
  lint,
  lintWorkspace,
  parse,
} from '../index';
import type { LintOptions } from '../index';

/**
 * Исправления и набор с кэшем разбора.
 *
 * Главное свойство исправления — оно снимает своё замечание и не приносит
 * новых. Проверяется именно оно: текст после правки проверяется заново.
 */

/** Чинит всё, что чинится, пока есть что чинить; возвращает итог и число правок. */
function fixAll(source: string, options: LintOptions = {}): { source: string; applied: number } {
  let current = source;
  let applied = 0;
  for (let pass = 0; pass < 10; pass++) {
    const result = applyFixes(current, fixesFor(parse(current), lint(current, options)));
    if (result.applied.length === 0) break;
    applied += result.applied.length;
    current = result.source;
  }
  return { source: current, applied };
}

describe('исправления: по одному', () => {
  const QUIET = { codes: { txNeverSet: 'off' } } as const;

  it.each([
    [
      'пробел после переноса',
      'SecRule ARGS "@rx ^a\\d" \\ \n    "id:1,phase:2,pass"',
      'SecRule ARGS "@rx ^a\\d" \\\n    "id:1,phase:2,pass"',
    ],
    [
      'повтор преобразования',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,t:lowercase,t:lowercase"',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,t:lowercase"',
    ],
    [
      'преобразование, которое ничего не меняет, — в середине списка',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,t:removeWhitespace,t:trim,pass"',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,t:removeWhitespace,pass"',
    ],
    [
      'повтор действия',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,nolog,nolog"',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,nolog"',
    ],
    [
      'повтор области проверки',
      'SecRule ARGS:a|ARGS:b|ARGS:a "@rx ^a\\d" "id:1,phase:2,pass"',
      'SecRule ARGS:a|ARGS:b "@rx ^a\\d" "id:1,phase:2,pass"',
    ],
    [
      'двоеточие в макросе',
      "SecAction \"id:1,phase:1,pass,msg:'%{REQUEST_HEADERS:Host}'\"",
      "SecAction \"id:1,phase:1,pass,msg:'%{REQUEST_HEADERS.Host}'\"",
    ],
    [
      'имя параметра с пробелом',
      'SecRule "ARGS:\'my param\'" "@rx ^a\\d" "id:1,phase:2,pass"',
      'SecRule "ARGS:/^my\\x20param$/" "@rx ^a\\d" "id:1,phase:2,pass"',
    ],
    [
      'пробел перед оператором',
      'SecRule ARGS " @rx ^a\\d" "id:1,phase:2,pass"',
      'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass"',
    ],
    [
      'потерянная запятая',
      "SecRule ARGS \"@rx ^a\\d\" \"id:1,phase:2,pass,msg:'a'tag:'b'\"",
      "SecRule ARGS \"@rx ^a\\d\" \"id:1,phase:2,pass,msg:'a',tag:'b'\"",
    ],
    [
      'шаблон-слово с якорями',
      'SecRule REQUEST_METHOD "@rx ^POST$" "id:1,phase:1,pass"',
      'SecRule REQUEST_METHOD "@streq POST" "id:1,phase:1,pass"',
    ],
    [
      'неявный оператор: шаблон без спецсимволов',
      'SecRule REQUEST_METHOD "POST" "id:1,phase:1,pass"',
      'SecRule REQUEST_METHOD "@contains POST" "id:1,phase:1,pass"',
    ],
    [
      'лишнее `.*` в начале',
      'SecRule REQUEST_METHOD "@rx .*P\\w+" "id:1,phase:1,pass"',
      'SecRule REQUEST_METHOD "@rx P\\w+" "id:1,phase:1,pass"',
    ],
    [
      'слэш в конце комментария',
      '# Заметка на полях \\\nSecAction "id:1,phase:1,pass"',
      '# Заметка на полях \nSecAction "id:1,phase:1,pass"',
    ],
  ])('%s', (_title, before, after) => {
    const fixed = fixAll(before, QUIET);
    expect(fixed.source).toBe(after);
    expect(fixed.applied).toBeGreaterThan(0);
    // То, что исправление чинило, после него не возвращается.
    const left = lint(fixed.source, QUIET).map((d) => d.code);
    for (const code of left) expect(FIXABLE).not.toContain(code);
  });

  it('действие на собственной строке уходит вместе со строкой', () => {
    const before = [
      'SecRule ARGS "@rx ^a\\d" \\',
      '    "id:1,\\',
      '    phase:2,\\',
      '    pass,\\',
      '    t:lowercase,\\',
      '    t:lowercase,\\',
      "    msg:'m'\"",
    ].join('\n');
    const after = [
      'SecRule ARGS "@rx ^a\\d" \\',
      '    "id:1,\\',
      '    phase:2,\\',
      '    pass,\\',
      '    t:lowercase,\\',
      "    msg:'m'\"",
    ].join('\n');
    expect(fixAll(before).source).toBe(after);
  });

  it('последнее действие списка забирает с собой запятую слева', () => {
    const before = 'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,t:lowercase,t:lowercase"';
    const fixed = fixAll(before).source;
    expect(fixed.endsWith('t:lowercase"')).toBe(true);
    expect(fixed).not.toContain(',"');
  });

  it('`^.*` уходит вместе с якорем: точка совпадает и с переводом строки', () => {
    // Все три движка собирают `@rx` так, что точка берёт и перевод строки
    // (стенд, `anchors-leading-wildcard-spans-lines`): `^.*P\w+` находит то
    // же, что `P\w+`, на любой строке значения.
    const source = 'SecRule ARGS "@rx ^.*P\\w+" "id:1,phase:2,pass"';
    expect(fixAll(source).source).toBe('SecRule ARGS "@rx P\\w+" "id:1,phase:2,pass"');
  });

  it('с capture ведущее `.*` не убирают: в TX.0 его доля', () => {
    const source = "SecRule ARGS \"@rx .*P\\w+\" \"id:1,phase:2,pass,capture,log,logdata:'%{TX.0}'\"";
    const found = lint(source).filter((d) => d.code === 'redundantLeadingWildcard');
    expect(found).toHaveLength(1);
    expect(fixFor(parse(source), found[0])).toBeNull();
  });

  it('там, где нужен выбор, исправления нет', () => {
    // Какую из двух реакций оставить, знает только автор.
    const source = "SecRule ARGS \"@rx ^a\\d\" \"id:1,phase:2,deny,pass,msg:'m'\"";
    const found = lint(source);
    expect(found.map((d) => d.code)).toEqual(['conflictingActions']);
    expect(fixesFor(parse(source), found)).toEqual([]);
  });
});

describe('исправления: чего они не должны делать', () => {
  // Оба случая нашлись, когда исправления выпустили на настоящий CRS.

  it('ленивое `.*?` уходит целиком, а не оставляет висящий квантор', () => {
    const before = 'SecRule REQUEST_BASENAME "@rx .*?(\\.[a-z0-9]{1,10})?$" "id:1,phase:1,pass"';
    const fixed = fixAll(before).source;
    expect(fixed).toBe('SecRule REQUEST_BASENAME "@rx (\\.[a-z0-9]{1,10})?$" "id:1,phase:1,pass"');
    expect(lint(fixed, { only: ['invalidRegex'] })).toEqual([]);
  });

  it('`.*+` не лишнее: без возврата оно забирает всё значение', () => {
    // `.*+a\d` не совпадает ни с чем — стенд, сценарий
    // `leading-possessive-wildcard-never-matches`. Убрать `.*+` значило бы
    // превратить правило, которое молчит, в работающее.
    const source = 'SecRule ARGS "@rx .*+a\\d" "id:1,phase:2,pass"';
    expect(lint(source, { only: ['redundantLeadingWildcard'] })).toEqual([]);
    expect(fixAll(source).source).toBe(source);
  });

  it('правилу с capture оператор на буквальный не меняют', () => {
    // `@streq` и `@contains` ничего не захватывают: после замены `%{TX.0}`
    // в журнале остался бы пустым.
    const anchored =
      "SecRule RESPONSE_STATUS \"@rx ^500$\" \"id:1,phase:3,pass,capture,log,logdata:'%{TX.0}'\"";
    expect(fixAll(anchored).source).toBe(anchored);
    const plain = "SecRule ARGS \"@rx admin\" \"id:1,phase:2,pass,capture,log,logdata:'%{TX.0}'\"";
    expect(fixAll(plain).source).toBe(plain);
    // Без capture замена остаётся.
    expect(fixAll('SecRule RESPONSE_STATUS "@rx ^500$" "id:1,phase:3,pass"').source).toContain('@streq 500');
  });
});

describe('исправления: вместе', () => {
  it('соседние правки не портят друг друга', () => {
    // Три повтора подряд делят между собой запятые.
    const source = 'SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,nolog,nolog,nolog,t:trim,t:trim"';
    const fixed = fixAll(source);
    expect(fixed.source).toBe('SecRule ARGS "@rx ^a\\d" "id:1,phase:2,pass,nolog,t:trim"');
    expect(lint(fixed.source)).toEqual([]);
  });

  it('задевшее уже исправленное место откладывается, а не теряется', () => {
    const source = 'abcdef';
    const fixes = [
      { code: 'duplicateAction' as const, title: 'a', edits: [{ start: 1, end: 3, text: '' }] },
      { code: 'duplicateAction' as const, title: 'b', edits: [{ start: 2, end: 4, text: '' }] },
      { code: 'duplicateAction' as const, title: 'c', edits: [{ start: 5, end: 6, text: 'F' }] },
    ];
    const result = applyFixes(source, fixes);
    expect(result.source).toBe('adeF');
    expect(result.applied.map((fix) => fix.title)).toEqual(['a', 'c']);
    expect(result.skipped.map((fix) => fix.title)).toEqual(['b']);
  });

  it('исправление не меняет того, что правило проверяет', () => {
    // Дерево до и после отличается только там, где было замечание.
    const before = 'SecRule ARGS|ARGS "@rx ^a\\d" \\ \n    "id:1,phase:2,pass,t:trim,t:trim"';
    const after = fixAll(before).source;
    const shape = (source: string) => {
      const [statement] = parse(source).statements;
      if (statement.kind !== 'SecRule') return null;
      return {
        variables: [...new Set(statement.variables?.items.map((v) => v.name))],
        operator: [statement.operator?.name, statement.operator?.argument.value],
        actions: [...new Set(statement.actions?.items.map((a) => `${a.name}:${a.value?.value}`))],
      };
    };
    expect(shape(after)).toEqual(shape(before));
  });

  it('у каждого исправимого кода есть запись в словаре', () => {
    expect(FIXABLE.length).toBeGreaterThan(8);
    for (const code of FIXABLE) expect(CODES[code]).toBeDefined();
  });
});

describe('набор с кэшем разбора', () => {
  const setup = 'SecAction "id:100,phase:1,pass,nolog,setvar:tx.level=1"';
  const rules = 'SecRule TX:level "@lt 2" "id:200,phase:1,pass,nolog,skipAfter:END"';
  const tail = 'SecMarker END';

  it('говорит то же, что разовая проверка тех же файлов', () => {
    const files = [
      { name: 'setup.conf', source: setup },
      { name: 'rules.conf', source: rules },
      { name: 'tail.conf', source: tail },
    ];
    const workspace = createWorkspace();
    for (const file of files) workspace.set(file.name, file.source);
    expect(workspace.lint()).toEqual(lintWorkspace(files));
    expect(workspace.names()).toEqual(['setup.conf', 'rules.conf', 'tail.conf']);
  });

  it('файл с тем же текстом не разбирается заново', () => {
    const workspace = createWorkspace();
    workspace.set('rules.conf', rules);
    const tree = workspace.tree('rules.conf');
    workspace.set('rules.conf', rules);
    expect(workspace.tree('rules.conf')).toBe(tree);
    workspace.set('rules.conf', `${rules}\n`);
    expect(workspace.tree('rules.conf')).not.toBe(tree);
  });

  it('правка одного файла меняет то, что сказано о другом', () => {
    const workspace = createWorkspace();
    workspace.set('rules.conf', rules);
    workspace.set('tail.conf', tail);
    const codes = () => workspace.lint().map((file) => file.diagnostics.map((d) => d.code));

    expect(codes()).toEqual([['txNeverSet'], []]);
    // Метку переименовали — переход в соседнем файле остался без неё.
    workspace.set('tail.conf', 'SecMarker OTHER');
    expect(codes()).toEqual([['txNeverSet', 'missingMarker'], ['unusedMarker']]);
    // Файл с настройкой добавили — и встал он в конец, после чтения.
    workspace.set('setup.conf', setup);
    expect(codes()[0]).toEqual(['txReadBeforeSet', 'missingMarker']);
    workspace.reorder(['setup.conf']);
    expect(workspace.names()).toEqual(['setup.conf', 'rules.conf', 'tail.conf']);
    expect(codes()[1]).toEqual(['missingMarker']);
  });

  it('замена текста места файла в порядке загрузки не меняет', () => {
    const workspace = createWorkspace();
    workspace.set('a.conf', setup);
    workspace.set('b.conf', rules);
    workspace.set('a.conf', `${setup}\n`);
    expect(workspace.names()).toEqual(['a.conf', 'b.conf']);
    expect(workspace.delete('a.conf')).toBe(true);
    expect(workspace.delete('a.conf')).toBe(false);
    expect(workspace.names()).toEqual(['b.conf']);
    expect(workspace.tree('a.conf')).toBeNull();
  });

  it('настройки набора действуют, пока проверке не дали свои', () => {
    const workspace = createWorkspace({ codes: { txNeverSet: 'off' } });
    workspace.set('rules.conf', rules);
    workspace.set('tail.conf', tail);
    expect(workspace.lint().flatMap((file) => file.diagnostics)).toEqual([]);
    expect(
      workspace.lint({ codes: {} }).flatMap((file) => file.diagnostics.map((d) => d.code)),
    ).toEqual(['txNeverSet']);
  });
});

describe('файлы данных', () => {
  const source = 'SecRule ARGS "@pmFromFile words.data extra.data" "id:1,phase:2,pass,t:lowercase"';

  it('без настройки ссылки на файлы не проверяются', () => {
    expect(lint(source)).toEqual([]);
  });

  it('список: чего в нём нет, того нет', () => {
    const found = lint(source, { files: ['words.data'] });
    expect(found.map((d) => [d.code, d.data])).toEqual([['fileNotFound', { path: 'extra.data' }]]);
    expect(lint(source, { files: ['words.data', 'extra.data'] })).toEqual([]);
  });

  it('функции приходит и путь, и имя файла правил', () => {
    const asked: Array<[string, string | undefined]> = [];
    const files = (path: string, from: string | undefined) => {
      asked.push([path, from]);
      return true;
    };
    lintWorkspace([{ name: 'rules/a.conf', source }], { files });
    expect(asked).toEqual([
      ['words.data', 'rules/a.conf'],
      ['extra.data', 'rules/a.conf'],
    ]);
  });

  it('адрес в сети и макрос — не файл на диске', () => {
    const remote = 'SecRule ARGS "@pmFromFile https://example.com/words.data" "id:1,phase:2,pass,t:lowercase"';
    expect(lint(remote, { files: [] })).toEqual([]);
    const addresses = 'SecRule REMOTE_ADDR "@ipMatchFromFile blocklist.txt" "id:1,phase:1,pass"';
    expect(lint(addresses, { files: [] }).map((d) => d.code)).toEqual(['fileNotFound']);
  });
});
