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
} from './suggestions';
import type { Suggestion } from './suggestions';
import type { TargetLike } from './semantics';

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
