import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { BlockActions } from './BlockActions';
import { CommitField } from './CommitField';
import { CHEVRON_COLUMN } from './layout';
import { useI18n } from '../../i18n/useI18n';
import { BLOCK_ROW } from '../../theme';
import type { ReactElement, ReactNode } from 'react';
import type { TranslationKey } from '../../i18n/translations';

interface StatementRowProps {
  /** Разряд строки — он же имя поля для чтения с экрана. */
  kind: TranslationKey;
  /** Подпись чипа: разряд строки или, у исключения, его действие. */
  title: string;
  /** Значок в чипе: по нему разряд узнаётся раньше, чем прочитан текст. */
  icon?: ReactElement;
  text: string;
  /** Отметки после чипа: то, чего в самой строке не видно. */
  marks?: ReactNode;
  onCommit: (text: string) => void;
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
  onDuplicate: () => void;
  onDelete: () => void;
}

/**
 * Блок в одну строку, правящийся текстом: метка и директива без формы.
 *
 * Метка стоит здесь навсегда: содержимого у неё ровно одно — имя, и поле с
 * именем ничем не отличалось бы от поля со строкой целиком.
 *
 * Директива попадает сюда, когда разбор не сошёлся: незнакомое имя, лишний
 * аргумент, макрос `%{...}` в значении. Форма показала бы меньше, чем есть в
 * строке, а сохранила бы ровно то, что показала, — поэтому её и нет. Поле
 * знает о содержимом не больше, чем показывает, а разбирает набранное тот же
 * парсер, что читает файл; притворяться понимающим больше было бы обманом, а
 * не удобством. Всё, что разобралось, правится полями — {@link DirectiveRow}.
 *
 * Чип с разрядом стоит справа, а не перед текстом. Разряд — вывод редактора о
 * строке, и место ему рядом с остальными выводами: до кого исключение
 * дотянулось и работает ли оно вообще. Слева же должно начинаться то, что
 * человек написал сам, и начинаться на той вертикали, где у карточки правила
 * стоит его номер.
 */
export function StatementRow({
  kind,
  title,
  icon,
  text,
  marks,
  onCommit,
  onMoveUp,
  onMoveDown,
  onDuplicate,
  onDelete,
}: StatementRowProps) {
  const { t } = useI18n();

  return (
    <Paper variant="outlined" sx={{ px: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: BLOCK_ROW }}>
        {/* Колонка раскрывашки пустует: сворачивать в одной строке нечего, а
            уберёшь колонку — текст уедет влево от соседних блоков. */}
        <Box sx={{ width: CHEVRON_COLUMN, flexShrink: 0 }} />

        <CommitField
          value={text}
          // Пустая строка — это пустая строка, а не отказ от правки: что
          // набрано, то и уходит в файл, а строка без содержимого перестаёт
          // быть блоком и уходит из списка. Удаление рядом, и угадывать за
          // человека, которое из двух он имел в виду, незачем.
          onCommit={(next) => onCommit(next.trim())}
          sx={{
            flex: 1,
            minWidth: 0,
            '& .MuiInputBase-input': { fontFamily: 'ui-monospace, Consolas, monospace' },
          }}
          slotProps={{ htmlInput: { 'aria-label': t(kind), spellCheck: false } }}
        />

        <Chip size="small" variant="outlined" icon={icon} label={title} sx={{ flexShrink: 0 }} />
        {marks}

        <BlockActions
          onMoveUp={onMoveUp}
          onMoveDown={onMoveDown}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          duplicateLabel="builder.duplicateLine"
          deleteLabel="builder.deleteLine"
        />
      </Stack>
    </Paper>
  );
}
