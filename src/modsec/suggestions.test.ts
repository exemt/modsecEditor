import { compileDocument } from './compile';
import { parseModsec } from './parser';
import { VARIABLE_NAMES } from './semantics';
import {
  MACRO_SUGGESTIONS,
  SETVAR_SUGGESTIONS,
  STATUS_SUGGESTIONS,
  TAG_SUGGESTIONS,
  VARIABLE_SUGGESTIONS,
  operatorValueSuggestions,
  sampleValueHint,
  selectorSuggestions,
  setvarNameSuggestions,
  tagSuggestions,
} from './suggestions';
import { indexWorkspaceExclusions } from './exclusions';
import { emptyTagIndex, indexWorkspaceTags } from './tags';
import { emptyVariableIndex, indexWorkspaceVariables } from './variables';
import type { Suggestion } from './suggestions';
import type { TargetLike } from './semantics';
import type { WorkspaceUnit } from './workspace';

function target(name: string, extra: Partial<TargetLike> = {}): TargetLike {
  return { name, count: false, mode: 'only', params: [], ...extra };
}

function values(suggestions: Suggestion[]): string[] {
  return suggestions.map((item) => item.value);
}

describe('варианты областей проверки', () => {
  it('показывают все известные переменные', () => {
    expect(values(VARIABLE_SUGGESTIONS).sort()).toEqual([...VARIABLE_NAMES].sort());
  });

  it('несут человеческое название как пояснение', () => {
    const args = VARIABLE_SUGGESTIONS.find((item) => item.value === 'ARGS');
    expect(args?.hint.ru).toBe('Параметры запроса');
  });

  it('идут группами, и одна группа не разрывается другой', () => {
    const order = VARIABLE_SUGGESTIONS.map((item) => item.group?.en ?? '');
    const seen = new Set<string>();
    let previous = '';

    for (const group of order) {
      if (group !== previous) {
        expect(seen.has(group)).toBe(false);
        seen.add(group);
        previous = group;
      }
    }
  });
});

describe('варианты параметра', () => {
  it('для заголовков предлагают имена заголовков', () => {
    expect(values(selectorSuggestions('REQUEST_HEADERS'))).toContain('User-Agent');
  });

  it('для Cookie предлагают имена Cookie, а не заголовков', () => {
    const cookies = values(selectorSuggestions('REQUEST_COOKIES'));
    expect(cookies).toContain('PHPSESSID');
    expect(cookies).not.toContain('User-Agent');
  });

  it('для TX предлагают счётчики CRS', () => {
    expect(values(selectorSuggestions('TX'))).toContain('anomaly_score');
  });

  it('молчат там, где параметра нет вовсе', () => {
    expect(selectorSuggestions('REQUEST_METHOD')).toEqual([]);
  });

  it('молчат про незнакомую переменную, а не выдумывают', () => {
    expect(selectorSuggestions('CUSTOM_THING')).toEqual([]);
  });
});

describe('варианты значения оператора', () => {
  it('зависят от проверяемой переменной', () => {
    const methods = values(
      operatorValueSuggestions('streq', [target('REQUEST_METHOD')], 'string'),
    );
    expect(methods).toContain('POST');
    expect(methods).not.toContain('sqlmap');
  });

  it('учитывают параметр переменной, а не только её имя', () => {
    const agents = values(
      operatorValueSuggestions(
        'contains',
        [target('REQUEST_HEADERS', { params: ['User-Agent'] })],
        'string',
      ),
    );
    expect(agents).toContain('sqlmap');
  });

  it('не зависят от регистра параметра', () => {
    const lower = operatorValueSuggestions(
      'contains',
      [target('REQUEST_HEADERS', { params: ['user-agent'] })],
      'string',
    );
    const upper = operatorValueSuggestions(
      'contains',
      [target('REQUEST_HEADERS', { params: ['User-Agent'] })],
      'string',
    );
    expect(values(lower)).toEqual(values(upper));
  });

  // Список проверяет разные вещи сразу, и подсказки по первой из них
  // уводили бы в сторону: у Referer со сканерами ничего общего.
  it('не уточняют подсказки, когда параметров несколько', () => {
    const several = values(
      operatorValueSuggestions(
        'contains',
        [target('REQUEST_HEADERS', { params: ['User-Agent', 'Referer'] })],
        'string',
      ),
    );
    expect(several).not.toContain('sqlmap');
  });

  it('для regex добавляют типовые шаблоны к вариантам переменной', () => {
    const patterns = values(
      operatorValueSuggestions('rx', [target('REQUEST_METHOD')], 'string'),
    );
    expect(patterns).toContain('GET');
    expect(patterns).toContain('^$');
  });

  it('для списка адресов предлагают сети, что бы ни проверялось', () => {
    expect(
      values(operatorValueSuggestions('ipMatch', [target('REMOTE_ADDR')], 'string')),
    ).toContain('10.0.0.0/8');
  });

  it('для файла фраз предлагают файлы данных CRS', () => {
    expect(
      values(operatorValueSuggestions('pmFromFile', [target('ARGS')], 'string')),
    ).toContain('scanners-user-agents.data');
  });

  it('оператору без аргумента подсказывать нечего', () => {
    expect(operatorValueSuggestions('detectSQLi', [target('ARGS')], 'string')).toEqual([]);
  });

  it('подсчёту подсказывать нечего — любое число тут своё', () => {
    expect(operatorValueSuggestions('gt', [target('ARGS', { count: true })], 'number')).toEqual(
      [],
    );
  });

  // Размеры из таблицы — про содержимое файлов, а считаются здесь сами файлы.
  it('подсчёт молчит и там, где у области есть числовые варианты', () => {
    expect(
      operatorValueSuggestions('gt', [target('FILES_SIZES', { count: true })], 'number'),
    ).toEqual([]);
  });

  it('числу без известного смысла подсказывать нечего', () => {
    expect(operatorValueSuggestions('gt', [target('TX', { params: ['n'] })], 'number')).toEqual(
      [],
    );
  });

  it('код ответа сравнивают с кодами ответа', () => {
    expect(
      values(operatorValueSuggestions('eq', [target('RESPONSE_STATUS')], 'number')),
    ).toContain('404');
  });

  it('размер тела сравнивают с размерами', () => {
    expect(
      values(operatorValueSuggestions('gt', [target('REQUEST_BODY_LENGTH')], 'number')),
    ).toContain('1048576');
  });

  it('исключающая цель не подменяет собой положительную', () => {
    const suggestions = operatorValueSuggestions(
      'streq',
      [target('ARGS', { excludeOnly: true }), target('REQUEST_METHOD')],
      'string',
    );
    expect(values(suggestions)).toContain('GET');
  });
});

describe('подсказка примера значения', () => {
  it('берёт аргумент сравнения с текстом — его и проверяют', () => {
    expect(sampleValueHint({ name: 'streq', argument: 'POST' }, [target('REQUEST_METHOD')])).toBe(
      'POST',
    );
  });

  it('регулярку самой собой не проверяют — подсказывает область проверки', () => {
    expect(
      sampleValueHint({ name: 'rx', argument: '(?i)(?:sqlmap|nikto)' }, [
        target('REQUEST_HEADERS', { params: ['User-Agent'] }),
      ]),
    ).toBe('sqlmap');
  });

  it('не подставляет ни файл, ни список сетей, ни диапазон байтов', () => {
    const targets = [target('ARGS')];
    expect(sampleValueHint({ name: 'pmFromFile', argument: 'unix-shell.data' }, targets)).toBe('');
    expect(sampleValueHint({ name: 'ipMatch', argument: '10.0.0.0/8' }, targets)).toBe('');
    expect(sampleValueHint({ name: 'validateByteRange', argument: '32-126' }, targets)).toBe('');
  });

  it('макрос значением не считает — что в нём, знает только движок', () => {
    expect(
      sampleValueHint({ name: 'streq', argument: '%{tx.expected}' }, [target('REQUEST_METHOD')]),
    ).toBe('GET');
  });

  it('числовой области подсказывает число, а не текст', () => {
    expect(sampleValueHint({ name: 'rx', argument: '^4' }, [target('RESPONSE_STATUS')])).toBe(
      '200',
    );
  });

  it('молчит там, где о значении ничего не известно', () => {
    expect(sampleValueHint({ name: 'rx', argument: 'anything' }, [target('ARGS')])).toBe('');
  });
});

describe('варианты действий', () => {
  it('коды блокировки начинаются с 403', () => {
    expect(STATUS_SUGGESTIONS[0].value).toBe('403');
  });

  it('готовая строка лога стоит раньше отдельных подстановок', () => {
    const ready = MACRO_SUGGESTIONS.findIndex((item) => item.value.includes('Matched Data'));
    const single = MACRO_SUGGESTIONS.findIndex((item) => item.value === '%{MATCHED_VAR}');
    expect(ready).toBeGreaterThanOrEqual(0);
    expect(ready).toBeLessThan(single);
  });

  it('setvar предлагает счёт аномалий CRS', () => {
    expect(values(SETVAR_SUGGESTIONS)).toContain(
      'tx.anomaly_score=+%{tx.critical_anomaly_score}',
    );
  });

  it('метки предлагают типы атак', () => {
    expect(values(TAG_SUGGESTIONS)).toContain('attack-sqli');
  });

  it('у каждого варианта есть пояснение на обоих языках', () => {
    const all = [
      ...VARIABLE_SUGGESTIONS,
      ...STATUS_SUGGESTIONS,
      ...MACRO_SUGGESTIONS,
      ...SETVAR_SUGGESTIONS,
      ...TAG_SUGGESTIONS,
      ...selectorSuggestions('REQUEST_HEADERS'),
      ...operatorValueSuggestions('rx', [target('ARGS')], 'string'),
    ];

    for (const item of all) {
      expect(item.hint.en).not.toBe('');
      expect(item.hint.ru).not.toBe('');
    }
  });
});

/** Индекс переменных одного файла — для меню имён setvar. */
function varIndex(source: string) {
  const doc = parseModsec(source);
  const unit: WorkspaceUnit = {
    id: 'rules.conf',
    name: 'rules.conf',
    blocks: compileDocument(doc, 'rules.conf').blocks,
    statements: doc.statements,
  };
  return indexWorkspaceVariables([unit]);
}

describe('имена переменных setvar', () => {
  it('ставит занятые имена первыми и помечает числом мест', () => {
    const suggestions = setvarNameSuggestions(
      'tx',
      varIndex(`
        SecAction "id:1,phase:1,pass,nolog,setvar:tx.own_flag=1"
        SecRule TX:own_flag "@eq 1" "id:2,phase:2,pass,nolog"
      `),
    );

    expect(suggestions[0].value).toBe('own_flag');
    expect(suggestions[0].group?.en).toBe('Already in the set');
    expect(suggestions[0].badge).toBe(2);
    expect(suggestions[0].hint.ru).toMatch(/Пишет 1 · читает 1/);
  });

  it('у своего имени без читателей говорит об этом прямо', () => {
    const own = setvarNameSuggestions(
      'tx',
      varIndex('SecAction "id:1,phase:1,pass,nolog,setvar:tx.lonely=1"'),
    ).find((item) => item.value === 'lonely');

    expect(own?.hint.ru).toBe('Пишет 1, никто не читает');
    expect(own?.badge).toBe(1);
  });

  it('у известного занятого имени оставляет пояснение CRS и ставит badge', () => {
    const score = setvarNameSuggestions(
      'tx',
      varIndex('SecAction "id:1,phase:1,pass,nolog,setvar:tx.anomaly_score=+1"'),
    ).find((item) => item.value === 'anomaly_score');

    expect(score?.group?.en).toBe('Already in the set');
    expect(score?.hint.ru).toBe('Счёт, накопленный входящими правилами');
    expect(score?.badge).toBe(1);
  });

  it('неиспользованное известное имя идёт без badge ниже занятых', () => {
    const suggestions = setvarNameSuggestions(
      'tx',
      varIndex('SecAction "id:1,phase:1,pass,nolog,setvar:tx.own_flag=1"'),
    );
    const threshold = suggestions.find(
      (item) => item.value === 'inbound_anomaly_score_threshold',
    );

    expect(threshold?.badge).toBeUndefined();
    expect(threshold?.group?.en).toBe('Anomaly score (CRS)');
    expect(values(suggestions).indexOf('own_flag')).toBeLessThan(
      values(suggestions).indexOf('inbound_anomaly_score_threshold'),
    );
  });

  it('пустой набор предлагает только известные имена', () => {
    const suggestions = setvarNameSuggestions('tx', emptyVariableIndex());
    expect(suggestions.every((item) => item.badge === undefined)).toBe(true);
    expect(suggestions.some((item) => item.group?.en === 'Already in the set')).toBe(false);
    expect(values(suggestions)).toContain('anomaly_score');
  });

  // CRS пишет `tx.942130_matched_var_name` буквально — формой такое имя не
  // набрать (цифра в начале), и в меню выбора ему делать нечего.
  it('не предлагает служебные имена CRS с цифры в начале', () => {
    const suggestions = setvarNameSuggestions(
      'tx',
      varIndex(`
        SecAction "id:1,phase:1,pass,nolog,setvar:tx.anomaly_score=+1"
        SecRule ARGS "@rx 1=1" "id:942130,phase:2,pass,nolog,setvar:tx.942130_matched_var_name=%{matched_var_name}"
      `),
    );

    expect(values(suggestions)).toContain('anomaly_score');
    expect(values(suggestions)).not.toContain('942130_matched_var_name');
  });
});

/** Индекс тегов одного файла — для меню ярлыков. */
function tagIndex(source: string) {
  const doc = parseModsec(source);
  const unit: WorkspaceUnit = {
    id: 'rules.conf',
    name: 'rules.conf',
    blocks: compileDocument(doc, 'rules.conf').blocks,
    statements: doc.statements,
  };
  const units = [unit];
  return indexWorkspaceTags(units, indexWorkspaceExclusions(units));
}

describe('меню тегов', () => {
  it('ставит занятые теги первыми и помечает числом правил', () => {
    const suggestions = tagSuggestions(
      tagIndex(`
        SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:'own-tag'"
        SecRule ARGS "@rx b" "id:2,phase:2,deny,tag:'own-tag'"
      `),
    );

    expect(suggestions[0].value).toBe('own-tag');
    expect(suggestions[0].group?.en).toBe('Already in the set');
    expect(suggestions[0].badge).toBe(2);
    expect(suggestions[0].hint.ru).toBe('У 2 правил');
  });

  it('у известного занятого тега оставляет пояснение каталога и ставит badge', () => {
    const sqli = tagSuggestions(
      tagIndex('SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:\'attack-sqli\'"'),
    ).find((item) => item.value === 'attack-sqli');

    expect(sqli?.group?.en).toBe('Already in the set');
    expect(sqli?.hint.ru).toBe('SQL-инъекция');
    expect(sqli?.badge).toBe(1);
  });

  it('у своего тега со снятием говорит об исключениях', () => {
    const own = tagSuggestions(
      tagIndex(`
        SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:'own-tag'"
        SecRuleRemoveByTag own-tag
      `),
    ).find((item) => item.value === 'own-tag');

    expect(own?.hint.ru).toBe('У 1 правила · снимают 1');
  });

  it('неиспользованный известный тег идёт без badge ниже занятых', () => {
    const suggestions = tagSuggestions(
      tagIndex('SecRule ARGS "@rx a" "id:1,phase:2,deny,tag:\'own-tag\'"'),
    );
    const xss = suggestions.find((item) => item.value === 'attack-xss');

    expect(xss?.badge).toBeUndefined();
    expect(xss?.group?.en).toBe('Attack type');
    expect(values(suggestions).indexOf('own-tag')).toBeLessThan(
      values(suggestions).indexOf('attack-xss'),
    );
  });

  it('пустой набор предлагает только каталог', () => {
    const suggestions = tagSuggestions(emptyTagIndex());
    expect(suggestions.every((item) => item.badge === undefined)).toBe(true);
    expect(suggestions.some((item) => item.group?.en === 'Already in the set')).toBe(false);
    expect(values(suggestions)).toContain('attack-sqli');
  });
});
