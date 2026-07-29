import { parseActions, parseModsec } from './parser';
import {
  AUDIT_LOG_PARTS,
  DIRECTIVE_FORM_NAMES,
  DIRECTIVE_META,
  canonicalDirectiveName,
  directiveMeta,
  emitDirective,
  isPanelArg,
  isSingleArg,
  makeDirectiveForm,
  readDirective,
} from './directives';
import { directiveChoices, directiveValueChoices } from './choices';
import { exclusionDirectiveKind } from './exclusions';
import { modsecExamples } from '../data/modsecExamples';
import type { DirectiveForm } from './directives';
import type { DirectiveStatement } from './types';

/** Разбирает одну строку как директиву конфигурации. */
function statementOf(line: string): DirectiveStatement {
  const [statement] = parseModsec(line).statements;
  if (statement.kind !== 'directive') {
    throw new Error(`не директива: ${line}`);
  }
  return statement;
}

/** Форма для строки, как её видит конструктор. */
function formOf(line: string): DirectiveForm | null {
  return readDirective(statementOf(line));
}

/** Строка → форма → строка: то, что происходит при правке поля. */
function roundTrip(line: string): string {
  const form = formOf(line);
  if (form === null) throw new Error(`формы нет: ${line}`);
  return emitDirective(form);
}

describe('таблица директив', () => {
  it('покрывает все директивы, кроме правил, меток и SecRuleScript', () => {
    // Список тот же, что у подсветки: расходись они, у одной и той же
    // строки имя было бы известным в тексте и неизвестным в конструкторе.
    expect(DIRECTIVE_FORM_NAMES).toHaveLength(49);
    expect(DIRECTIVE_META.SecRule).toBeUndefined();
    expect(DIRECTIVE_META.SecAction).toBeUndefined();
    expect(DIRECTIVE_META.SecMarker).toBeUndefined();
    // Путь плюс список действий — вид ради одной директивы; она остаётся
    // строкой, и это записано здесь, а не только в комментарии.
    expect(DIRECTIVE_META.SecRuleScript).toBeUndefined();
  });

  it('у каждой записи есть подпись, пояснение и раздел на двух языках', () => {
    for (const name of DIRECTIVE_FORM_NAMES) {
      const meta = DIRECTIVE_META[name];
      for (const text of [meta.label, meta.note, meta.group]) {
        expect(text.en.length).toBeGreaterThan(0);
        expect(text.ru.length).toBeGreaterThan(0);
      }
    }
  });

  it('перечисления и переключатели знают свои значения, остальные — нет', () => {
    for (const name of DIRECTIVE_FORM_NAMES) {
      const meta = DIRECTIVE_META[name];
      const closed = meta.arg === 'toggle' || meta.arg === 'enum';
      expect(meta.values !== undefined).toBe(closed);

      for (const value of Object.values(meta.values ?? {})) {
        expect(value.label.ru.length).toBeGreaterThan(0);
        expect(value.note.ru.length).toBeGreaterThan(0);
      }
    }
  });

  it('делит виды на однострочные и раскрывающиеся без остатка', () => {
    for (const name of DIRECTIVE_FORM_NAMES) {
      const { arg } = DIRECTIVE_META[name];
      // Директива без аргументов не поле и не панель: строка с одним именем.
      expect(isSingleArg(arg) || isPanelArg(arg) || arg === 'none').toBe(true);
      expect(isSingleArg(arg) && isPanelArg(arg)).toBe(false);
    }
  });

  it('раскрывает всё, что не ручается за высоту одной строки', () => {
    expect(isPanelArg('flags')).toBe(true);
    expect(isPanelArg('list')).toBe(true);
    expect(isPanelArg('actions')).toBe(true);
    expect(isPanelArg('exclusion')).toBe(true);
    expect(isPanelArg('toggle')).toBe(false);
  });

  it('находит имя, написанное в другом регистре', () => {
    expect(canonicalDirectiveName('secruleengine')).toBe('SecRuleEngine');
    expect(canonicalDirectiveName('SECRULEENGINE')).toBe('SecRuleEngine');
    expect(canonicalDirectiveName('SecRuleScript')).toBeNull();

    const form = formOf('secruleengine On');
    expect(form).toEqual({ arg: 'toggle', name: 'SecRuleEngine', value: 'On' });
    // Имя уходит в файл каноничным: конструктор показал его таким же.
    expect(emitDirective(form!)).toBe('SecRuleEngine On');
  });
});

describe('разбор директивы в форму', () => {
  it('читает переключатель, число, путь и текст', () => {
    expect(formOf('SecRuleEngine DetectionOnly')).toEqual({
      arg: 'toggle',
      name: 'SecRuleEngine',
      value: 'DetectionOnly',
    });
    expect(formOf('SecRequestBodyLimit 13107200')).toEqual({
      arg: 'number',
      name: 'SecRequestBodyLimit',
      value: '13107200',
    });
    expect(formOf('SecTmpDir /tmp/modsecurity/tmp')).toEqual({
      arg: 'path',
      name: 'SecTmpDir',
      value: '/tmp/modsecurity/tmp',
    });
    expect(formOf('SecComponentSignature "OWASP_CRS/3.3.4"')).toEqual({
      arg: 'text',
      name: 'SecComponentSignature',
      value: 'OWASP_CRS/3.3.4',
    });
  });

  it('разбирает слипшуюся строку частей журнала на буквы', () => {
    expect(formOf('SecAuditLogParts ABIJDEFHZ')).toEqual({
      arg: 'flags',
      name: 'SecAuditLogParts',
      parts: ['A', 'B', 'I', 'J', 'D', 'E', 'F', 'H', 'Z'],
    });
  });

  it('читает список типов ответа как несколько аргументов', () => {
    expect(formOf('SecResponseBodyMimeType text/plain text/html')).toEqual({
      arg: 'list',
      name: 'SecResponseBodyMimeType',
      items: ['text/plain', 'text/html'],
    });
  });

  it('читает директиву без аргументов', () => {
    expect(formOf('SecResponseBodyMimeTypesClear')).toEqual({
      arg: 'none',
      name: 'SecResponseBodyMimeTypesClear',
    });
  });

  it('раскладывает SecDefaultAction на действия', () => {
    const form = formOf('SecDefaultAction "phase:2,log,auditlog,pass"');
    expect(form?.arg).toBe('actions');
    expect(form?.arg === 'actions' && form.actions.map((a) => a.name)).toEqual([
      'phase',
      'log',
      'auditlog',
      'pass',
    ]);
  });

  it('раскладывает все семь директив-исключений', () => {
    expect(formOf('SecRuleRemoveById 942100')).toEqual({
      arg: 'exclusion',
      name: 'SecRuleRemoveById',
      pick: '942100',
      payload: '',
      replaced: '',
    });
    // Номеров бывает сколько угодно, и все они — одна выборка.
    expect(formOf('SecRuleRemoveById 1 2 942190-942200')).toMatchObject({
      pick: '1 2 942190-942200',
    });
    expect(formOf('SecRuleUpdateTargetById 942100 "!ARGS:comment"')).toEqual({
      arg: 'exclusion',
      name: 'SecRuleUpdateTargetById',
      pick: '942100',
      payload: '!ARGS:comment',
      replaced: '',
    });
    expect(formOf('SecRuleUpdateTargetByTag "attack-xss" "!ARGS:bio" "ARGS"')).toMatchObject({
      pick: 'attack-xss',
      payload: '!ARGS:bio',
      replaced: 'ARGS',
    });
    expect(formOf('SecRuleUpdateActionById 942100 "pass,status:200"')).toMatchObject({
      pick: '942100',
      payload: 'pass,status:200',
    });
  });

  it('показывает незаполненную директиву формой, а не строкой', () => {
    // Дописать недостающее в поле проще, чем в строке, и о пустом значении
    // диагностика скажет отдельно.
    expect(formOf('SecRuleEngine')).toEqual({
      arg: 'toggle',
      name: 'SecRuleEngine',
      value: '',
    });
    expect(formOf('SecRuleRemoveById')).toMatchObject({ pick: '' });
  });
});

describe('отказ от формы', () => {
  it('не даёт формы незнакомому имени', () => {
    expect(formOf('SecFuture On')).toBeNull();
  });

  it('не даёт формы директиве, у которой формы нет и не заведено', () => {
    expect(formOf('SecRuleScript /opt/rules/check.lua "id:1,phase:2"')).toBeNull();
  });

  it('не даёт формы, когда аргументов больше, чем вид вмещает', () => {
    // Показать форму значило бы потерять хвост при первой же правке.
    expect(formOf('SecRuleEngine On лишнее')).toBeNull();
    expect(formOf('SecResponseBodyMimeTypesClear text/html')).toBeNull();
    expect(formOf('SecRuleRemoveByTag "attack-xss" лишнее')).toBeNull();
    expect(formOf('SecRuleUpdateActionById 1 "pass" лишнее')).toBeNull();
  });

  it('не даёт формы значению с макросом', () => {
    // `%{tx.limit}` раскрывает движок, а поле показало бы его текстом.
    expect(formOf('SecRequestBodyLimit %{tx.limit}')).toBeNull();
  });

  it('не даёт формы частям журнала, записанным чужим синтаксисом', () => {
    // Плюс и минус понимает `ctl:auditLogParts`, а не сама директива.
    expect(formOf('SecAuditLogParts +E')).toBeNull();
  });
});

describe('гарантия обхода', () => {
  it('возвращает канонически записанную строку побайтово той же', () => {
    const lines = [
      'SecRuleEngine On',
      'SecRuleEngine DetectionOnly',
      'SecRequestBodyAccess Off',
      'SecRequestBodyLimit 13107200',
      'SecUploadFileMode 0600',
      'SecTmpDir /tmp/modsecurity/tmp',
      'SecAuditLogParts ABIJDEFHZ',
      'SecAuditLogRelevantStatus "^(?:5|4(?!04))"',
      'SecComponentSignature "OWASP_CRS/3.3.4"',
      'SecResponseBodyMimeType text/plain text/html',
      'SecResponseBodyMimeTypesClear',
      'SecDefaultAction "phase:2,log,auditlog,pass"',
      'SecRuleRemoveById 942100',
      'SecRuleRemoveById 1 2 942190-942200',
      'SecRuleRemoveByTag "attack-xss"',
      'SecRuleUpdateTargetById 942100 "!ARGS:comment"',
      'SecRuleUpdateTargetByTag "attack-xss" "!ARGS:bio" "ARGS"',
      'SecRuleUpdateActionById 942100 "pass,status:200"',
      'SecDebugLogLevel 9',
    ];

    for (const line of lines) {
      expect(roundTrip(line)).toBe(line);
    }
  });

  it('даёт ту же форму после сборки — по всей таблице', () => {
    for (const name of DIRECTIVE_FORM_NAMES) {
      const meta = directiveMeta(name);
      if (meta === null) throw new Error(name);

      // Заготовка пуста, поэтому у каждого вида берётся значение, которое
      // в такой директиве и пишут: пустую форму обход прошёл бы, ничего
      // не проверив про кавычки.
      const filled = fill(name, meta.arg);
      const emitted = emitDirective(filled);
      expect(readDirective(statementOf(emitted))).toEqual(filled);
    }
  });

  it('переживает аргумент с пробелом внутри', () => {
    // Без кавычек путь распался бы на два аргумента, и формы бы не стало.
    const line = 'SecAuditLog "/var/log/my logs/audit.log"';
    expect(roundTrip(line)).toBe(line);
    expect(formOf(line)).toMatchObject({ value: '/var/log/my logs/audit.log' });
  });

  it('переживает кавычку внутри значения', () => {
    const form = formOf('SecComponentSignature "a \\"quoted\\" name"');
    expect(form).toMatchObject({ value: 'a "quoted" name' });
    expect(readDirective(statementOf(emitDirective(form!)))).toEqual(form);
  });

  it('не переписывает директивы примеров во что-то другое', () => {
    let seen = 0;

    for (const example of modsecExamples) {
      for (const statement of parseModsec(example.code).statements) {
        if (statement.kind !== 'directive') continue;
        const form = readDirective(statement);
        if (form === null) continue;

        seen++;
        // Пересобранная строка обязана читаться в ту же форму. Совпадения
        // с исходником не требуем: автор примера мог написать метку без
        // кавычек, и расставить их — не потеря, а приведение к общему виду.
        expect(readDirective(statementOf(emitDirective(form)))).toEqual(form);
      }
    }

    expect(seen).toBeGreaterThan(0);
  });
});

/** Заполненная форма для вида аргумента — то, что в такой директиве пишут. */
function fill(name: string, arg: DirectiveForm['arg']): DirectiveForm {
  switch (arg) {
    case 'none':
      return { arg, name };
    case 'flags':
      return { arg, name, parts: ['A', 'B', 'Z'] };
    case 'list':
      return { arg, name, items: ['text/plain', 'text/html'] };
    // Действия строит парсер, а не тест: у разобранного действия есть ещё
    // и `raw`, и собранный руками он разошёлся бы с прочитанным.
    case 'actions':
      return { arg, name, actions: parseActions('phase:2,log,pass') };
    // У исключения содержимое задаёт имя: `remove` берёт одну выборку,
    // `update*` — ещё и то, что правилу приписывают.
    case 'exclusion': {
      const kind = exclusionDirectiveKind(name);
      const pick = kind?.selector === 'id' ? '942100' : 'attack-xss';
      const payload =
        kind?.op === 'remove' ? '' : kind?.op === 'updateAction' ? 'pass' : '!ARGS:comment';
      return { arg, name, pick, payload, replaced: '' };
    }
    case 'toggle':
    case 'enum': {
      const values = Object.keys(directiveMeta(name)?.values ?? {});
      return { arg, name, value: values[values.length - 1] };
    }
    case 'number':
      return { arg, name, value: '1024' };
    case 'mode':
      return { arg, name, value: '0600' };
    case 'path':
      return { arg, name, value: '/var/log/modsec.log' };
    case 'text':
      return { arg, name, value: 'signature' };
    case 'regex':
      return { arg, name, value: '^(?:5|4(?!04))' };
  }
}

describe('сборка формы для нового имени', () => {
  it('делает пустую форму по виду аргумента', () => {
    expect(makeDirectiveForm('SecAuditLogParts')).toEqual({
      arg: 'flags',
      name: 'SecAuditLogParts',
      parts: [],
    });
    expect(makeDirectiveForm('SecRuleScript')).toBeNull();
  });

  // Заготовка пустая у любого вида: значение подставить нечем, а собранная
  // строка обязана остаться той директивой, которую просили.
  it('собирает по заготовке одно имя без аргумента', () => {
    for (const name of DIRECTIVE_FORM_NAMES) {
      const form = makeDirectiveForm(name);
      expect(form).not.toBeNull();
      expect(emitDirective(form!)).toBe(name);
    }
  });
});

describe('списки выбора', () => {
  it('предлагает все директивы таблицы, разложенные по разделам', () => {
    const choices = directiveChoices('SecRuleEngine');
    expect(choices).toHaveLength(DIRECTIVE_FORM_NAMES.length);
    expect(new Set(choices.map((choice) => choice.group.ru)).size).toBeGreaterThan(1);
    expect(choices.some((choice) => choice.common)).toBe(true);
  });

  it('дописывает незнакомое имя отдельной строкой, а не теряет его', () => {
    const choices = directiveChoices('SecFuture');
    expect(choices).toHaveLength(DIRECTIVE_FORM_NAMES.length + 1);
    expect(choices[choices.length - 1].value).toBe('SecFuture');
  });

  it('предлагает значения переключателя одним разделом', () => {
    const choices = directiveValueChoices('SecRuleEngine', 'On');
    expect(choices.map((choice) => choice.value)).toEqual(['On', 'Off', 'DetectionOnly']);
    expect(new Set(choices.map((choice) => choice.group.ru)).size).toBe(1);
  });

  it('оставляет значение не из набора в списке с пометкой', () => {
    const choices = directiveValueChoices('SecRuleEngine', 'Yes');
    expect(choices[choices.length - 1].value).toBe('Yes');
  });

  it('не предлагает значений там, где список открыт', () => {
    expect(directiveValueChoices('SecRequestBodyLimit', '')).toEqual([]);
  });
});

describe('части журнала аудита', () => {
  it('расшифровывает каждую букву, которую пишут в SecAuditLogParts', () => {
    expect(Object.keys(AUDIT_LOG_PARTS).join('')).toBe('ABCDEFGHIJKZ');
    for (const part of Object.values(AUDIT_LOG_PARTS)) {
      expect(part.label.ru.length).toBeGreaterThan(0);
      expect(part.note.ru.length).toBeGreaterThan(0);
    }
  });
});
