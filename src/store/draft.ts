/**
 * Черновик набора между сессиями.
 *
 * Редактор работает с файлами в памяти вкладки, и до сих пор перезагрузка
 * страницы уносила с собой всю работу. Черновик закрывает самый обидный способ
 * её потерять — случайный F5.
 *
 * Это именно черновик, а не «сохранённые файлы»: имена, тексты и порядок — и
 * ничего больше, ни истории отмены, ни выбранного примера. Настоящее
 * сохранение — выгрузка `.conf`, и она остаётся отдельным осознанным действием.
 *
 * Идентификаторов файлов здесь нет намеренно: они живут одну сессию, и
 * восстановленный набор получает свои. Хранить их значило бы обещать, что
 * ссылка из прошлой сессии куда-то ведёт.
 */

const KEY = 'exeditor.workspace';

/** Ключ прежнего черновика: один текст без имени. */
const OLD_KEY = 'exeditor.draft';

/**
 * Больше мегабайта в localStorage класть незачем: типичная квота — около
 * пяти, и одинокий редактор не должен её выедать. Предел на весь набор, а не
 * на файл: место кончается у хранилища целиком.
 */
const LIMIT = 1_000_000;

/** Файл черновика: только то, что нельзя пересчитать. */
export interface DraftFile {
  name: string;
  source: string;
}

export interface Draft {
  /** Файлы в порядке включения. */
  files: DraftFile[];
  /** Номер файла, который правили. */
  activeAt: number;
}

function readOld(): Draft | null {
  try {
    const stored = window.localStorage.getItem(OLD_KEY);
    window.localStorage.removeItem(OLD_KEY);
    if (stored === null || stored === '') return null;
    return { files: [{ name: '', source: stored }], activeAt: 0 };
  } catch {
    return null;
  }
}

/**
 * Набор прошлой сессии или `null`, если восстанавливать нечего.
 *
 * Черновик прошлой версии редактора читается один раз и тут же стирается:
 * работа, начатая до появления набора, не должна пропасть, но и жить двумя
 * ключами ей незачем.
 */
export function loadDraft(): Draft | null {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(KEY);
  } catch {
    // Приватный режим и запрет на хранилище — не повод падать.
    return null;
  }

  if (stored === null || stored === '') return readOld();

  try {
    const draft = JSON.parse(stored) as Draft;
    const files = Array.isArray(draft.files)
      ? draft.files.filter(
          (file): file is DraftFile =>
            typeof file?.name === 'string' && typeof file?.source === 'string',
        )
      : [];
    if (files.length === 0) return null;
    const activeAt =
      typeof draft.activeAt === 'number' && draft.activeAt >= 0 && draft.activeAt < files.length
        ? draft.activeAt
        : 0;
    return { files, activeAt };
  } catch {
    // Испорченная запись — то же, что её отсутствие: молча начинаем заново.
    return null;
  }
}

/**
 * Запоминает набор. Набор из одного пустого файла стирает черновик, а не
 * хранит пустоту: восстанавливать в нём нечего.
 */
export function saveDraft(draft: Draft): void {
  const empty = draft.files.every((file) => file.source === '');
  const payload = JSON.stringify(draft);

  try {
    if (empty || payload.length > LIMIT) window.localStorage.removeItem(KEY);
    else window.localStorage.setItem(KEY, payload);
  } catch {
    // Переполненное хранилище не должно мешать редактировать.
  }
}
