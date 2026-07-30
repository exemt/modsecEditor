import { configureStore } from '@reduxjs/toolkit';
import {
  addFiles,
  applyRuleSource,
  filesReducer,
  freeName,
  markSaved,
  moveFile,
  newFile,
  redo,
  removeFile,
  replaceWorkspace,
  select,
  selectActive,
  selectSource,
  undo,
} from './filesSlice';
import type { FilesState } from './filesSlice';

/**
 * Своё хранилище на каждый тест.
 *
 * Общее пришлось бы чистить между тестами, а история отмены и окно коалесинга
 * от чистки не сбрасываются: один прогон подкладывал бы работу следующему.
 */
function freshStore() {
  return configureStore({ reducer: { files: filesReducer } });
}

const state = (store: ReturnType<typeof freshStore>): FilesState => store.getState().files;
const names = (store: ReturnType<typeof freshStore>) => state(store).files.map((f) => f.name);
const active = (store: ReturnType<typeof freshStore>) => selectActive(state(store));

/** Набор из перечисленных файлов: имя и текст на каждый. */
function seed(store: ReturnType<typeof freshStore>, ...files: [string, string][]) {
  store.dispatch(
    replaceWorkspace({ files: files.map(([name, source]) => ({ name, source })) }),
  );
}

describe('свободное имя в наборе', () => {
  it('оставляет незанятое как есть', () => {
    expect(freeName(['a.conf'], 'b.conf')).toBe('b.conf');
  });

  // Номер идёт перед расширением: `rules.conf-2` не открылось бы как
  // конфигурация ни одним редактором, включая этот.
  it('приписывает номер перед расширением', () => {
    expect(freeName(['rules.conf'], 'rules.conf')).toBe('rules-2.conf');
    expect(freeName(['rules.conf', 'rules-2.conf'], 'rules.conf')).toBe('rules-3.conf');
  });

  it('обходится без расширения', () => {
    expect(freeName(['rules'], 'rules')).toBe('rules-2');
  });
});

describe('набор файлов', () => {
  it('открывает несколько файлов сразу и переходит к первому из них', () => {
    const store = freshStore();
    seed(store, ['rules.conf', 'SecRuleEngine On']);

    store.dispatch(
      addFiles([
        { name: 'first.conf', source: 'SecRuleRemoveById 1' },
        { name: 'second.conf', source: 'SecRuleRemoveById 2' },
      ]),
    );

    expect(names(store)).toEqual(['rules.conf', 'first.conf', 'second.conf']);
    expect(active(store)?.name).toBe('first.conf');
  });

  // Два одинаковых имени в наборе — это выбор раздела наугад и выгрузка
  // второго файла поверх первого.
  it('не пускает в набор второе такое же имя', () => {
    const store = freshStore();
    seed(store, ['rules.conf', '']);
    store.dispatch(addFiles([{ name: 'rules.conf', source: '' }]));

    expect(names(store)).toEqual(['rules.conf', 'rules-2.conf']);
  });

  it('переставляет файл: порядок набора — это порядок включения', () => {
    const store = freshStore();
    seed(store, ['a.conf', ''], ['b.conf', ''], ['c.conf', '']);
    const last = state(store).files[2].id;

    store.dispatch(moveFile({ id: last, to: 0 }));
    expect(names(store)).toEqual(['c.conf', 'a.conf', 'b.conf']);

    // За пределы набора файл не уходит: там его было бы не найти.
    store.dispatch(moveFile({ id: last, to: 9 }));
    expect(names(store)).toEqual(['c.conf', 'a.conf', 'b.conf']);
  });

  it('после удаления активного смотрит на соседа снизу', () => {
    const store = freshStore();
    seed(store, ['a.conf', ''], ['b.conf', ''], ['c.conf', '']);
    const middle = state(store).files[1].id;
    store.dispatch(select(middle));

    store.dispatch(removeFile(middle));

    expect(names(store)).toEqual(['a.conf', 'c.conf']);
    expect(active(store)?.name).toBe('c.conf');
  });

  it('после удаления последнего смотрит на соседа сверху', () => {
    const store = freshStore();
    seed(store, ['a.conf', ''], ['b.conf', '']);
    const last = state(store).files[1].id;
    store.dispatch(select(last));

    store.dispatch(removeFile(last));

    expect(active(store)?.name).toBe('a.conf');
  });

  it('не переходит к файлу, которого в наборе нет', () => {
    const store = freshStore();
    seed(store, ['a.conf', '']);
    const only = state(store).activeId;

    store.dispatch(select('нет такого'));
    expect(state(store).activeId).toBe(only);
  });

  it('заменяет набор целиком: так открывают пример', () => {
    const store = freshStore();
    seed(store, ['a.conf', ''], ['b.conf', '']);

    store.dispatch(replaceWorkspace({ files: [{ name: 'example.conf', source: 'SecMarker X' }] }));

    expect(names(store)).toEqual(['example.conf']);
    expect(active(store)?.name).toBe('example.conf');
  });

  it('заводит чистый файл и переходит к нему', () => {
    const store = freshStore();
    seed(store, ['rules.conf', 'SecRuleEngine On']);

    store.dispatch(newFile());

    expect(active(store)?.source).toBe('');
    expect(state(store).files).toHaveLength(2);
  });
});

describe('правки и история', () => {
  it('правит только активный файл', () => {
    const store = freshStore();
    seed(store, ['a.conf', 'SecMarker A'], ['b.conf', 'SecMarker B']);
    store.dispatch(select(state(store).files[1].id));

    store.dispatch(applyRuleSource('SecMarker EDITED', 'push'));

    expect(state(store).files[0].source).toBe('SecMarker A');
    expect(selectSource(state(store))).toBe('SecMarker EDITED');
  });

  /**
   * История у каждого файла своя.
   *
   * Общая правила бы файл, которого не видно: отмена — действие над тем, на
   * что смотрят, и промахнуться ею мимо файла хуже, чем не иметь её вовсе.
   */
  it('отменяет правку в том файле, в котором её сделали', () => {
    const store = freshStore();
    seed(store, ['a.conf', 'SecMarker A'], ['b.conf', 'SecMarker B']);
    const [first, second] = state(store).files.map((file) => file.id);

    store.dispatch(select(first));
    store.dispatch(applyRuleSource('SecMarker A2', 'push'));
    store.dispatch(select(second));
    store.dispatch(applyRuleSource('SecMarker B2', 'push'));

    // Отмена в другом файле первого не касается.
    store.dispatch(undo());
    expect(state(store).files[1].source).toBe('SecMarker B');
    expect(state(store).files[0].source).toBe('SecMarker A2');

    store.dispatch(select(first));
    store.dispatch(undo());
    expect(state(store).files[0].source).toBe('SecMarker A');

    store.dispatch(redo());
    expect(state(store).files[0].source).toBe('SecMarker A2');
  });

  it('без файлов кладёт текст в новый: набору неоткуда взяться иначе', () => {
    const store = freshStore();
    store.dispatch(applyRuleSource('SecMarker SEEDED', 'skip'));

    expect(state(store).files).toHaveLength(1);
    expect(selectSource(state(store))).toBe('SecMarker SEEDED');
  });

  it('считает файл правленым, пока его не выгрузили', () => {
    const store = freshStore();
    seed(store, ['a.conf', 'SecMarker A']);
    const id = state(store).activeId;

    store.dispatch(applyRuleSource('SecMarker A2', 'push'));
    expect(state(store).files[0].baseline).not.toBe('SecMarker A2');

    store.dispatch(markSaved(id));
    expect(state(store).files[0].baseline).toBe('SecMarker A2');
  });
});
