import { compileDocument } from './compile';
import { parseModsec } from './parser';
import {
  collectionVariables,
  indexWorkspaceVariables,
  lookupVariable,
  readBeforeSet,
} from './variables';
import type { WorkspaceUnit } from './workspace';

/** Файл набора: имя нужно местам записей, называющим чужой файл. */
function unit(name: string, source: string): WorkspaceUnit {
  const doc = parseModsec(source);
  return { id: name, name, blocks: compileDocument(doc, name).blocks, statements: doc.statements };
}

/** Индекс по набору файлов, читаемому в этом порядке. */
function index(...sources: [string, string][]) {
  return indexWorkspaceVariables(sources.map(([name, source]) => unit(name, source)));
}

/** Индекс одного файла. */
function one(source: string) {
  return index(['rules.conf', source]);
}

describe('где переменная выставляется', () => {
  it('находит присваивание и называет строку с правилом', () => {
    const found = lookupVariable(one('SecAction "id:1,phase:1,pass,nolog,setvar:tx.score=0"'), 'tx', 'score');

    expect(found?.writes).toHaveLength(1);
    expect(found?.writes[0]).toMatchObject({
      file: 'rules.conf',
      id: '1',
      line: 1,
      phase: 1,
      use: 'set',
      text: 'setvar:tx.score=0',
    });
  });

  it('различает установку, прибавление, вычитание и удаление', () => {
    const found = one(
      [
        'SecAction "id:1,phase:1,pass,nolog,setvar:tx.score=0"',
        'SecAction "id:2,phase:1,pass,nolog,setvar:tx.score=+1"',
        'SecAction "id:3,phase:1,pass,nolog,setvar:tx.score=-1"',
        'SecAction "id:4,phase:5,pass,nolog,setvar:!tx.score"',
      ].join('\n'),
    );

    expect(lookupVariable(found, 'tx', 'score')?.writes.map((w) => w.use)).toEqual([
      'set',
      'add',
      'sub',
      'delete',
    ]);
  });

  // Срок жизни назначают переменной, которая уже есть, и запись о сроке
  // сама переменной не заводит — но местом её остаётся.
  it('считает срок жизни записью о переменной', () => {
    const found = lookupVariable(
      one('SecAction "id:1,phase:1,pass,nolog,setvar:ip.block=1,expirevar:ip.block=600"'),
      'ip',
      'block',
    );

    expect(found?.writes.map((w) => w.use)).toEqual(['set', 'expire']);
  });

  it('видит присваивание из звена цепочки, а не только из головы', () => {
    const found = lookupVariable(
      one(
        [
          'SecRule ARGS "@rx a" "id:1,phase:2,pass,nolog,chain"',
          '    SecRule ARGS "@rx b" "setvar:tx.both=1"',
        ].join('\n'),
      ),
      'tx',
      'both',
    );

    expect(found?.writes).toHaveLength(1);
    expect(found?.writes[0].line).toBe(2);
  });

  it('запоминает, где коллекцию открывают', () => {
    const found = one('SecAction "id:1,phase:1,pass,nolog,initcol:ip=%{remote_addr}"');
    expect(found.inits.get('ip')).toHaveLength(1);
    expect(found.inits.get('session')).toBeUndefined();
  });

  it('считает открытием коллекции и setsid', () => {
    const found = one('SecAction "id:1,phase:1,pass,nolog,setsid:%{args.token}"');
    expect(found.inits.get('session')).toHaveLength(1);
  });
});

describe('где переменная читается', () => {
  it('видит чтение целью правила', () => {
    const found = lookupVariable(
      one('SecRule TX:score "@gt 5" "id:1,phase:2,deny,msg:\'over\'"'),
      'tx',
      'score',
    );

    expect(found?.reads).toHaveLength(1);
    expect(found?.reads[0].text).toBe('TX:score');
  });

  it('видит чтение макросом в сообщении и в аргументе оператора', () => {
    const found = one(
      [
        'SecRule TX:a "@gt %{tx.threshold}" "id:1,phase:2,deny,msg:\'score %{tx.score}\'"',
      ].join('\n'),
    );

    expect(lookupVariable(found, 'tx', 'threshold')?.reads).toHaveLength(1);
    expect(lookupVariable(found, 'tx', 'score')?.reads[0].text).toBe('%{tx.score}');
  });

  // Захваченные группы и шаблоны выставляет не `setvar`, и искать их среди
  // присвоений бессмысленно.
  it('не считает чтением захваченную группу и шаблон', () => {
    const found = one(
      'SecRule TX:1|TX:/^score_/ "@gt 5" "id:1,phase:2,deny,msg:\'x\'"',
    );

    expect(found.byName.size).toBe(0);
  });

  it('не считает чтением вычитание цели', () => {
    const found = one('SecRule TX|!TX:score "@gt 5" "id:1,phase:2,deny,msg:\'x\'"');
    expect(lookupVariable(found, 'tx', 'score')).toBeNull();
  });
});

describe('набор файлов', () => {
  it('сводит запись из одного файла с чтением из другого', () => {
    const found = lookupVariable(
      index(
        ['setup.conf', 'SecAction "id:1,phase:1,pass,nolog,setvar:tx.score=0"'],
        ['rules.conf', 'SecRule TX:score "@gt 5" "id:2,phase:2,deny,msg:\'x\'"'],
      ),
      'tx',
      'score',
    );

    expect(found?.writes[0].file).toBe('setup.conf');
    expect(found?.reads[0].file).toBe('rules.conf');
  });

  it('называет имена файлов набора', () => {
    expect(index(['a.conf', ''], ['b.conf', '']).names.get('b.conf')).toBe('b.conf');
  });
});

describe('чтение раньше записи', () => {
  // Порядок исполнения — не порядок файла: фаза идёт первой.
  it('считает по фазе, а не по строке', () => {
    const late = one(
      [
        'SecRule TX:flag "@eq 1" "id:1,phase:1,deny,msg:\'x\'"',
        'SecAction "id:2,phase:2,pass,nolog,setvar:tx.flag=1"',
      ].join('\n'),
    );

    expect(readBeforeSet(lookupVariable(late, 'tx', 'flag')!)).toBe(true);
  });

  it('молчит, когда запись стоит раньше в той же фазе', () => {
    const fine = one(
      [
        'SecAction "id:1,phase:2,pass,nolog,setvar:tx.flag=1"',
        'SecRule TX:flag "@eq 1" "id:2,phase:2,deny,msg:\'x\'"',
      ].join('\n'),
    );

    expect(readBeforeSet(lookupVariable(fine, 'tx', 'flag')!)).toBe(false);
  });

  // Накопительный счёт этим не задевается: прибавление — тоже запись.
  it('молчит о накопительном счёте с порогом ниже', () => {
    const crs = one(
      [
        'SecRule ARGS "@rx attack" "id:1,phase:2,pass,nolog,setvar:tx.score=+5"',
        'SecRule TX:score "@ge 5" "id:2,phase:2,deny,msg:\'over\'"',
      ].join('\n'),
    );

    expect(readBeforeSet(lookupVariable(crs, 'tx', 'score')!)).toBe(false);
  });

  it('молчит там, где переменную только читают или только пишут', () => {
    const readOnly = one('SecRule TX:flag "@eq 1" "id:1,phase:2,deny,msg:\'x\'"');
    expect(readBeforeSet(lookupVariable(readOnly, 'tx', 'flag')!)).toBe(false);
  });
});

describe('имена коллекции', () => {
  it('перечисляет по алфавиту то, что встречается в наборе', () => {
    const found = one(
      [
        'SecAction "id:1,phase:1,pass,nolog,setvar:tx.score=0,setvar:tx.block=0"',
        'SecAction "id:2,phase:1,pass,nolog,setvar:ip.counter=0"',
      ].join('\n'),
    );

    expect(collectionVariables(found, 'tx')).toEqual(['block', 'score']);
    expect(collectionVariables(found, 'ip')).toEqual(['counter']);
  });
});
