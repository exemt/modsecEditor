import { useRef } from 'react';
import type { ReactElement } from 'react';
import { looksLikeArchive, readArchive } from './archive';
import type { NewFile } from '../store/filesSlice';

/** Что предлагает выбрать окно открытия обычных файлов правил. */
export const FILE_ACCEPT = '.conf,.txt,text/plain';

/**
 * Выбранное человеком — в файлы набора.
 *
 * Архив распаковывается, остальное берётся текстом. Различает их расширение, а
 * не то, из какого окна файл пришёл: `accept` — подсказка окну выбора, а не
 * запрет, и архив, выбранный в окне обычных файлов, всё равно должен открыться
 * набором, а не одной строкой двоичного мусора.
 */
export async function filesFrom(picked: readonly File[]): Promise<NewFile[]> {
  const groups = await Promise.all(picked.map(readOne));
  return groups.flat();
}

async function readOne(file: File): Promise<NewFile[]> {
  if (!looksLikeArchive(file.name)) return [{ name: file.name, source: await file.text() }];
  return readArchive(new Uint8Array(await file.arrayBuffer()));
}

interface FilePickerOptions {
  accept: string;
  /** Выбирать сразу несколько: у архива за раз берут один. */
  multiple?: boolean;
  onFiles: (files: NewFile[]) => void;
  /** Выбранное не прочиталось — обычно это испорченный или не тот архив. */
  onError?: () => void;
}

/**
 * Скрытое поле выбора файлов и способ его позвать.
 *
 * Открыть окно выбора можно только из настоящего `input`, поэтому он есть у
 * каждого места, откуда файлы открывают. Спрятан он и убран из обхода по Tab:
 * нажимают на кнопку или пункт меню рядом, и второе «Открыть» для клавиатуры и
 * скринридера было бы обманом.
 */
export function useFilePicker(options: FilePickerOptions): {
  input: ReactElement;
  open: () => void;
} {
  const ref = useRef<HTMLInputElement>(null);
  const { accept, multiple = false, onFiles, onError } = options;

  const input = (
    <input
      ref={ref}
      type="file"
      accept={accept}
      multiple={multiple}
      hidden
      tabIndex={-1}
      onChange={(event) => {
        const picked = [...(event.target.files ?? [])];
        // Сбрасываем значение: иначе выбор того же файла второй раз не поднимет
        // событие, и «открыть» перестанет работать.
        event.target.value = '';
        if (picked.length === 0) return;
        void filesFrom(picked).then(onFiles, () => onError?.());
      }}
    />
  );

  return { input, open: () => ref.current?.click() };
}
