import { useState } from 'react';
import type { DragEvent } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import CloseIcon from '@mui/icons-material/Close';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import { ConfirmDialog } from './ConfirmDialog';
import { ARCHIVE_ACCEPT } from './archive';
import { downloadFile } from './download';
import { FILE_ACCEPT, filesFrom, useFilePicker } from './useFilePicker';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import { useWorkspace } from '../context/workspaceContext';
import type { WorkspaceFile } from '../context/workspaceContext';

interface FileManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Свой вид переносимого в буфере перетаскивания.
 *
 * По нему перестановка строки отличается от файла, притащенного с рабочего
 * стола: у обоих одно и то же событие, и без метки список принимал бы файл
 * системы за свою строку.
 */
const ROW_MIME = 'application/x-exeditor-row';

/** Тащат файлы системы, а не строку списка. */
function hasFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files');
}

/**
 * Набор файлов: порядок, пополнение, удаление, выгрузка.
 *
 * Порядок здесь — не оформление. ModSecurity читает включённые файлы подряд, и
 * исключение действует только на правила, прочитанные раньше него: переставить
 * файл значит изменить, до кого дотягиваются его директивы. Поэтому у строк есть
 * номера, а перенос показывает, куда файл встанет, — и то и другое о порядке
 * чтения, а не о виде списка.
 *
 * Пополняют набор здесь, а заменяют — в меню «Файл». Разница не в удобстве:
 * файл, добавленный в конец, читается последним и его исключения дотягиваются до
 * всего набора, а это видно только рядом со списком.
 *
 * Выгрузка из строки отдаёт один файл как есть — его кладут в чужое дерево
 * конфигурации, где имя и место уже заданы. Набор целиком уходит архивом из
 * меню: здесь этой кнопке делать нечего, окно про порядок, а не про выгрузку.
 */
export function FileManagerDialog({ open, onClose }: FileManagerDialogProps) {
  const { t } = useI18n();
  const {
    files,
    activeId,
    selectFile,
    newFile,
    openFiles,
    removeFile,
    moveFile,
    markSaved,
    textOf,
  } = useWorkspace();

  /** Строка, которую тащат, и строка, над которой её держат. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  /** Над окном держат файлы системы. */
  const [dropping, setDropping] = useState(false);

  const [pending, setPending] = useState<WorkspaceFile | null>(null);
  const [notice, setNotice] = useState<TranslationKey | null>(null);

  const failed = () => setNotice('files.archiveFailed');

  // Архив здесь принимается наравне с файлами: в набор он добавляет всё своё
  // содержимое, а не заменяет набор собой, — это то же пополнение.
  const picker = useFilePicker({
    accept: `${FILE_ACCEPT},${ARCHIVE_ACCEPT}`,
    multiple: true,
    onFiles: openFiles,
    onError: failed,
  });

  /** Единственный файл не убирают, а очищают: правят всегда какой-то файл. */
  const lonely = files.length === 1;

  const download = (file: WorkspaceFile) => {
    downloadFile(file.name, textOf(file.id));
    markSaved(file.id);
  };

  const askRemove = (file: WorkspaceFile) => {
    // Вопрос задаётся там, где ответ «нет» ещё что-то меняет: у пустого и
    // выгруженного файла терять нечего, и лишний вопрос только мешает.
    if (file.edited || lonely) setPending(file);
    else removeFile(file.id);
  };

  const move = (from: number, to: number) => {
    const file = files[from];
    if (file !== undefined) moveFile(file.id, to);
  };

  const endDrag = () => {
    setDragIndex(null);
    setOverIndex(null);
  };

  /**
   * С какой стороны строки встанет переносимый файл.
   *
   * Полоса рисуется тенью внутрь, а не рамкой: рамка добавила бы строке
   * пару пикселей высоты, и список дёргался бы под курсором.
   */
  const edge = (index: number): 'top' | 'bottom' | null => {
    if (dragIndex === null || overIndex !== index || dragIndex === index) return null;
    return dragIndex > index ? 'top' : 'bottom';
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        {/* В полосе заголовка стоит имя окна и кнопка закрытия, и больше ничего.
            Фраза о порядке — абзац, а не подпись: поставленная в ту же строку,
            она переносится по второй, третьей и растаскивает полосу тем сильнее,
            чем уже окно. Сказана она над списком, потому что она про список. */}
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }} component="div">
          <Typography variant="h6" component="h2" noWrap sx={{ flex: 1, minWidth: 0 }}>
            {t('files.title')}
          </Typography>
          <IconButton onClick={onClose} aria-label={t('app.close')} sx={{ mr: -1 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        {/* Принимает файлы всё окно, а не только пунктирная область внизу:
            область говорит, куда тащить, но промах мимо неё не должен
            заканчиваться уходом браузера на открытие файла в новой вкладке. */}
        <DialogContent
          dividers
          onDragEnter={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDropping(true);
          }}
          onDragOver={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            setDropping(true);
          }}
          onDragLeave={(event) => {
            // Уход внутрь себя — не уход: курсор идёт по вложенным строкам, и
            // без этой проверки подсветка мигала бы на каждой границе.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setDropping(false);
            }
          }}
          onDrop={(event) => {
            if (!hasFiles(event)) return;
            event.preventDefault();
            setDropping(false);
            void filesFrom([...event.dataTransfer.files]).then(openFiles, failed);
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('files.order')}
          </Typography>

          <Stack
            component="ul"
            spacing={1}
            sx={{ m: 0, p: 0, listStyle: 'none' }}
            aria-label={t('files.list')}
          >
            {files.map((file, index) => {
              const current = file.id === activeId;
              const side = edge(index);

              return (
                <Paper
                  key={file.id}
                  component="li"
                  variant="outlined"
                  onDragOver={(event) => {
                    if (dragIndex === null) return;
                    event.preventDefault();
                    setOverIndex(index);
                  }}
                  onDrop={(event) => {
                    if (dragIndex === null) return;
                    event.preventDefault();
                    move(dragIndex, index);
                    endDrag();
                  }}
                  sx={(theme) => ({
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    px: 1,
                    py: 0.75,
                    opacity: dragIndex === index ? 0.4 : 1,
                    borderColor: current ? 'primary.main' : 'divider',
                    boxShadow:
                      side === null
                        ? 'none'
                        : `inset 0 ${side === 'top' ? '' : '-'}2px 0 0 ${theme.palette.primary.main}`,
                  })}
                >
                  {/* Номер — это и есть порядок чтения: по нему говорят «правило
                      из третьего файла», а не «из того, что ниже второго». */}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      width: 20,
                      flexShrink: 0,
                      textAlign: 'center',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {index + 1}
                  </Typography>

                  <Tooltip title={t('files.drag')}>
                    <Box
                      draggable
                      onDragStart={(event) => {
                        // Своя метка в буфере: по ней список отличит перенос
                        // строки от файла, притащенного с рабочего стола.
                        event.dataTransfer.setData(ROW_MIME, String(index));
                        event.dataTransfer.effectAllowed = 'move';
                        setDragIndex(index);
                      }}
                      onDragEnd={endDrag}
                      sx={{ display: 'flex', cursor: 'grab', color: 'text.disabled' }}
                    >
                      <DragIndicatorIcon fontSize="small" />
                    </Box>
                  </Tooltip>

                  {/* Имя — кнопка: выбрать файл здесь же короче, чем закрыть
                      окно и искать его в списке разделов. */}
                  <Box
                    component="button"
                    type="button"
                    onClick={() => {
                      selectFile(file.id);
                      onClose();
                    }}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      textAlign: 'left',
                      background: 'none',
                      border: 0,
                      p: 0,
                      cursor: 'pointer',
                      font: 'inherit',
                      color: 'inherit',
                    }}
                  >
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                      <Typography variant="body2" noWrap sx={{ fontWeight: current ? 600 : 400 }}>
                        {file.name}
                      </Typography>
                      {/* Открытый файл назван словом, а не только рамкой: цвет
                          рамки в списке из одного файла ни с чем не сравнить. */}
                      {current && (
                        <Chip label={t('files.current')} size="small" color="primary" variant="outlined" />
                      )}
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {file.lines === 0
                        ? t('files.empty')
                        : t('files.lines', { count: String(file.lines) })}
                      {file.edited ? ` · ${t('files.edited')}` : ''}
                    </Typography>
                  </Box>

                  <Tooltip title={t('files.up')}>
                    <IconButton
                      size="small"
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('files.down')}>
                    <IconButton
                      size="small"
                      disabled={index === files.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('files.download', { name: file.name })}>
                    <IconButton size="small" onClick={() => download(file)}>
                      <DownloadIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('files.remove', { name: file.name })}>
                    <IconButton size="small" onClick={() => askRemove(file)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Paper>
              );
            })}
          </Stack>

          {/* Пополнение стоит там, куда файл встанет, — в конце списка, а не в
              подвале окна: новый файл читается последним, и это видно по месту
              кнопки. Оба источника показаны рядом и оба названы: спрятать их в
              меню значило бы заставить искать «загрузить» там, где написано
              «добавить». */}
          <Box
            sx={(theme) => ({
              mt: 1.5,
              px: 2,
              py: 1.5,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1,
              borderRadius: 1,
              border: '1px dashed',
              borderColor: dropping ? 'primary.main' : 'divider',
              bgcolor: dropping ? alpha(theme.palette.primary.main, 0.08) : 'transparent',
            })}
          >
            <Typography variant="caption" color="text.secondary" sx={{ textAlign: 'center' }}>
              {t('files.dropHere')}
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button startIcon={<NoteAddIcon fontSize="small" />} onClick={newFile}>
                {t('files.create')}
              </Button>
              <Button startIcon={<FolderOpenIcon fontSize="small" />} onClick={picker.open}>
                {t('files.addFromDisk')}
              </Button>
            </Stack>
          </Box>

          {picker.input}
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>{t('app.close')}</Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={pending !== null}
        title={t(lonely ? 'files.clearTitle' : 'files.removeTitle')}
        body={t(lonely ? 'files.clearBody' : 'files.removeBody', { name: pending?.name ?? '' })}
        confirmLabel={t(lonely ? 'files.clearConfirm' : 'files.removeConfirm')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) removeFile(pending.id);
          setPending(null);
        }}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={2500}
        onClose={() => setNotice(null)}
        message={notice === null ? '' : t(notice)}
      />
    </>
  );
}
