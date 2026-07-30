import { packArchive } from './archive';
import { filesFrom } from './useFilePicker';

/**
 * Выбранное человеком — в файлы набора.
 *
 * Различает их расширение, а не то, из какого окна файл пришёл: `accept` —
 * подсказка окну выбора, а не запрет, и архив, выбранный в окне обычных файлов,
 * всё равно должен открыться набором.
 */
describe('чтение выбранных файлов', () => {
  it('берёт обычный файл текстом', async () => {
    const picked = new File(['SecMarker A'], 'rules.conf', { type: 'text/plain' });

    await expect(filesFrom([picked])).resolves.toEqual([
      { name: 'rules.conf', source: 'SecMarker A' },
    ]);
  });

  it('распаковывает архив в файлы набора', async () => {
    const zip = packArchive([
      { name: 'rules.conf', text: 'SecMarker A' },
      { name: 'exclusions.conf', text: 'SecRuleRemoveById 1' },
    ]);
    const picked = new File([new Uint8Array(zip)], 'set.zip', { type: 'application/zip' });

    await expect(filesFrom([picked])).resolves.toEqual([
      { name: 'rules.conf', source: 'SecMarker A' },
      { name: 'exclusions.conf', source: 'SecRuleRemoveById 1' },
    ]);
  });

  it('отказывается читать не архив с расширением архива', async () => {
    const picked = new File(['вовсе не архив'], 'set.zip', { type: 'application/zip' });

    await expect(filesFrom([picked])).rejects.toThrow();
  });
});
