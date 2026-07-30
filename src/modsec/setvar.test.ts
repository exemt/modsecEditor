import { freeVarName, makeSetvar, readSetvar, readSetvarTarget, writeSetvar } from './setvar';

/** Обход через форму: запись → поля → запись. */
function roundtrip(raw: string): string | null {
  const parsed = readSetvar(raw);
  return parsed === null ? null : writeSetvar(parsed);
}

describe('разбор присваивания', () => {
  it('читает установку значения', () => {
    expect(readSetvar('tx.block_flag=1')).toEqual({
      collection: 'tx',
      name: 'block_flag',
      op: 'set',
      value: '1',
      separator: '.',
    });
  });

  // Один символ и целый смысл: прибавление к накопленному счёту против
  // затирания его единицей.
  it('отличает прибавление от установки', () => {
    expect(readSetvar('tx.score=+1')?.op).toBe('add');
    expect(readSetvar('tx.score=1')?.op).toBe('set');
    expect(readSetvar('tx.score=-1')?.op).toBe('sub');
  });

  it('читает удаление', () => {
    expect(readSetvar('!ip.dos_counter')).toEqual({
      collection: 'ip',
      name: 'dos_counter',
      op: 'delete',
      value: '',
      separator: '.',
    });
  });

  it('оставляет макрос в значении значением', () => {
    const parsed = readSetvar('tx.anomaly_score=+%{tx.critical_anomaly_score}');
    expect(parsed?.op).toBe('add');
    expect(parsed?.value).toBe('%{tx.critical_anomaly_score}');
  });

  // Значение с `=` внутри — не редкость: так передают строку запроса.
  it('делит по первому знаку равенства', () => {
    expect(readSetvar('tx.query=a=b')?.value).toBe('a=b');
  });
});

describe('чего форма не показывает', () => {
  it('отказывается от макроса в имени', () => {
    expect(readSetvar('tx.%{rule.id}_flag=1')).toBeNull();
  });

  it('отказывается от коллекции, в которую не пишут', () => {
    expect(readSetvar('geo.country_code=RU')).toBeNull();
  });

  it('отказывается от записи без значения', () => {
    expect(readSetvar('tx.flag')).toBeNull();
  });

  // `!tx.score=0` — это не «удалить и положить нуль»: о смысле такой записи
  // по ней самой не сказать, и поля показали бы не её.
  it('отказывается от удаления со значением', () => {
    expect(readSetvar('!tx.score=0')).toBeNull();
  });
});

describe('сборка обратно', () => {
  it('возвращает ту же запись', () => {
    for (const raw of [
      'tx.score=+1',
      'tx.score=-1',
      'tx.score=0',
      'tx.msg=%{rule.msg}',
      '!ip.dos_counter',
      'session.score=+10',
      'tx.query=a=b',
      'tx.flag=',
    ]) {
      expect(roundtrip(raw)).toBe(raw);
    }
  });

  // Правка соседнего поля не должна менять написание того, которого
  // не касались.
  it('сохраняет разделитель, каким он написан', () => {
    expect(roundtrip('tx:score=1')).toBe('tx:score=1');
  });
});

describe('коллекция записи, разбор которой не сошёлся', () => {
  it('называет коллекцию даже при макросе в имени', () => {
    expect(readSetvarTarget('tx.%{rule.id}_flag=1')).toEqual({
      collection: 'tx',
      name: '%{rule.id}_flag',
    });
  });

  it('читает удаление и запись без значения', () => {
    expect(readSetvarTarget('!ip.dos_counter')?.name).toBe('dos_counter');
    expect(readSetvarTarget('tx.flag')?.name).toBe('flag');
  });

  it('молчит там, где коллекции нет вовсе', () => {
    expect(readSetvarTarget('nonsense')).toBeNull();
  });
});

describe('заготовка новой переменной', () => {
  it('берёт незанятое имя', () => {
    expect(freeVarName([])).toBe('var');
    expect(freeVarName(['var'])).toBe('var_2');
    expect(freeVarName(['var', 'var_2'])).toBe('var_3');
  });

  // ModSecurity различает переменные без учёта регистра: `TX.Var` — то же
  // самое имя, и вторая запись переписала бы первую.
  it('считает занятым имя в любом регистре', () => {
    expect(freeVarName(['VAR'])).toBe('var_2');
  });

  it('заготовка работает сразу и читается формой', () => {
    expect(makeSetvar('var')).toBe('tx.var=1');
    expect(readSetvar(makeSetvar('var'))?.op).toBe('set');
  });
});
