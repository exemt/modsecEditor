import { loadDraft, saveDraft } from './draft';

const KEY = 'exeditor.workspace';
const OLD_KEY = 'exeditor.draft';

beforeEach(() => window.localStorage.clear());

describe('черновик набора', () => {
  it('помнит имена, тексты и правленый файл', () => {
    saveDraft({
      files: [
        { name: 'rules.conf', source: 'SecMarker A' },
        { name: 'exclusions.conf', source: 'SecRuleRemoveById 1' },
      ],
      activeAt: 1,
    });

    expect(loadDraft()).toEqual({
      files: [
        { name: 'rules.conf', source: 'SecMarker A' },
        { name: 'exclusions.conf', source: 'SecRuleRemoveById 1' },
      ],
      activeAt: 1,
    });
  });

  // Набор из пустых файлов восстанавливать нечего, а запись о нём пережила бы
  // намеренную очистку и вернула бы её обратно на следующей загрузке.
  it('стирает черновик, когда во всём наборе нет текста', () => {
    saveDraft({ files: [{ name: 'rules.conf', source: 'SecMarker A' }], activeAt: 0 });
    saveDraft({ files: [{ name: 'rules.conf', source: '' }], activeAt: 0 });

    expect(loadDraft()).toBeNull();
  });

  it('не верит испорченной записи', () => {
    window.localStorage.setItem(KEY, '{не json');
    expect(loadDraft()).toBeNull();
  });

  it('правит номер активного файла, если он вне набора', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ files: [{ name: 'a.conf', source: 'x' }], activeAt: 7 }),
    );
    expect(loadDraft()?.activeAt).toBe(0);
  });

  /**
   * Черновик прошлой версии редактора читается один раз.
   *
   * Работа, начатая до появления набора, лежит под другим ключом и без имени:
   * потерять её из-за смены формата было бы худшим видом обновления.
   */
  it('переносит прежний черновик из одного текста', () => {
    window.localStorage.setItem(OLD_KEY, 'SecMarker OLD');

    expect(loadDraft()).toEqual({ files: [{ name: '', source: 'SecMarker OLD' }], activeAt: 0 });
    // И тут же его стирает: двумя ключами одной работе жить незачем.
    expect(window.localStorage.getItem(OLD_KEY)).toBeNull();
    expect(loadDraft()).toBeNull();
  });

  it('предпочитает черновик набора прежнему', () => {
    window.localStorage.setItem(OLD_KEY, 'SecMarker OLD');
    saveDraft({ files: [{ name: 'rules.conf', source: 'SecMarker NEW' }], activeAt: 0 });

    expect(loadDraft()?.files[0].source).toBe('SecMarker NEW');
  });
});
