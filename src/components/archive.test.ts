import { strToU8, zipSync } from 'fflate';
import { archiveEntries, packArchive, readArchive, looksLikeArchive } from './archive';

const set = (...files: [string, string][]) => files.map(([name, text]) => ({ name, text }));

describe('упаковка набора', () => {
  it('нумерует имена по порядку включения', () => {
    expect(Object.keys(archiveEntries(set(['rules.conf', 'a'], ['exclusions.conf', 'b'])))).toEqual([
      '1-rules.conf',
      '2-exclusions.conf',
    ]);
  });

  /**
   * Номер обязан быть той же ширины у всех файлов набора.
   *
   * Иначе десятый файл встаёт в списке между первым и вторым: читатели архива
   * сортируют записи по имени, а «10-» меньше «2-».
   */
  it('держит одну ширину номера на весь набор', () => {
    const many = set(...Array.from({ length: 10 }, (_, i): [string, string] => [`f${i}.conf`, '']));
    expect(Object.keys(archiveEntries(many))[0]).toBe('01-f0.conf');
    expect(Object.keys(archiveEntries(many))[9]).toBe('10-f9.conf');
  });

  it('снимает каталоги с имён', () => {
    expect(Object.keys(archiveEntries(set(['crs/rules.conf', 'a'])))).toEqual(['1-rules.conf']);
  });
});

describe('чтение архива', () => {
  it('возвращает файлы в том порядке, в котором их упаковали', () => {
    const files = set(['zebra.conf', 'SecMarker A'], ['alpha.conf', 'SecMarker B']);

    expect(readArchive(packArchive(files))).toEqual([
      { name: 'zebra.conf', source: 'SecMarker A' },
      { name: 'alpha.conf', source: 'SecMarker B' },
    ]);
  });

  // Чужой архив номеров не имеет: тогда порядок задают сами имена — это всё,
  // что о нём можно узнать.
  it('читает архив без номеров по именам', () => {
    const zip = zipSync({
      'b.conf': strToU8('второй'),
      'a.conf': strToU8('первый'),
    });

    expect(readArchive(zip)).toEqual([
      { name: 'a.conf', source: 'первый' },
      { name: 'b.conf', source: 'второй' },
    ]);
  });

  // Архиваторы macOS кладут рядом с каждым файлом копию метаданных: без отбора
  // набор из одного файла открывался бы двумя, из которых второй — мусор.
  it('пропускает служебные записи и каталоги', () => {
    const zip = zipSync({
      'crs/': strToU8(''),
      'crs/rules.conf': strToU8('SecMarker A'),
      '__MACOSX/._rules.conf': strToU8('мусор'),
      '.DS_Store': strToU8('мусор'),
    });

    expect(readArchive(zip)).toEqual([{ name: 'rules.conf', source: 'SecMarker A' }]);
  });

  // Молча открытый пустой набор был бы худшим ответом: человек решил бы, что
  // архив принят и оказался пуст.
  it('бросает, если это не архив', () => {
    expect(() => readArchive(strToU8('SecRule ARGS "@rx a" "id:1"'))).toThrow();
  });
});

describe('распознавание архива по имени', () => {
  it.each([
    ['rules.zip', true],
    ['RULES.ZIP', true],
    ['rules.conf', false],
    ['zip.conf', false],
  ])('%s → %s', (name, expected) => {
    expect(looksLikeArchive(name)).toBe(expected);
  });
});
