import { useState } from 'react';
import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Snackbar from '@mui/material/Snackbar';
import Tooltip from '@mui/material/Tooltip';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import LibraryAddIcon from '@mui/icons-material/LibraryAdd';
import NoteAddIcon from '@mui/icons-material/NoteAdd';
import { ConfirmDialog } from './ConfirmDialog';
import { ExamplesDialog } from './ExamplesDialog';
import { ARCHIVE_ACCEPT } from './archive';
import { downloadFile, downloadSet } from './download';
import { FILE_ACCEPT, useFilePicker } from './useFilePicker';
import { exampleFile } from '../data/exampleFile';
import type { ModsecExample } from '../data/modsecExamples';
import { DEFAULT_NAME } from '../store/filesSlice';
import type { NewFile } from '../store/filesSlice';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import { useRule } from '../context/ruleContext';
import { useWorkspace } from '../context/workspaceContext';

/**
 * Всё, что делают с набором целиком: откуда он берётся и куда уходит.
 *
 * Меню, а не ряд кнопок над текстом. Действий здесь восемь, делают их редко —
 * раз за сеанс открыли, раз сохранили, — и в виде постоянной полосы они всё
 * время занимали место у содержимого, ради которого редактор и открыт. Порядок
 * пунктов обычный для приложений, чтобы его не приходилось изучать: сначала
 * откуда файл берётся, потом куда уходит, потом учебное.
 *
 * «Открыть» здесь значит то же, что в любом приложении: набор заменяется тем,
 * что открыли. Пополняют набор в другом месте — в окне файлов, где для этого
 * есть «Добавить»: там видно, куда файл встанет в порядке чтения, а здесь не
 * видно ничего. Поэтому же открытие спрашивает, если в наборе есть невыгруженные
 * правки: заменить работу молча нельзя, а выгрузить её после замены неоткуда.
 *
 * Начать с чистого листа — тоже замена, а не «удалить всё»: набор без файлов
 * это редактор без текста, и вернуться в него было бы неоткуда. Поэтому новый
 * набор — один пустой файл, и спрашивает он о том же и теми же словами, что
 * пример и открытие. Стоит он выше нового файла в наборе, потому что решения
 * разного размера: одно заменяет всё, второе прибавляет к тому, что есть.
 */
export function FileMenu() {
  const { t } = useI18n();
  const { source } = useRule();
  const { files, activeId, newFile, markSaved, replaceWorkspace, nameOf, textOf } = useWorkspace();

  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [notice, setNotice] = useState<TranslationKey | null>(null);

  const failed = () => setNotice('files.archiveFailed');

  const edited = files.some((file) => file.edited);

  /** Заменить набор — сразу или после ответа на вопрос о правках. */
  const replace = (next: Pending) => {
    if (edited) setPending(next);
    else replaceWorkspace(filesOf(next));
  };

  // Два поля выбора, а не одно с переключаемым фильтром: фильтр задаётся
  // разметкой, а окно выбора открывается сразу по нажатию — переставить его
  // между этими двумя событиями негде.
  const single = useFilePicker({
    accept: FILE_ACCEPT,
    multiple: true,
    onFiles: (opened) => replace({ kind: 'files', files: opened }),
    onError: failed,
  });
  const archive = useFilePicker({
    accept: ARCHIVE_ACCEPT,
    onFiles: (opened) => replace({ kind: 'files', files: opened }),
    onError: failed,
  });

  const exampleId = files.find((file) => file.id === activeId)?.exampleId ?? null;

  /** Пункт меню: закрыть меню и сделать то, что в нём выбрали. */
  const pick = (action: () => void) => () => {
    setAnchor(null);
    action();
  };

  const saveActive = () => {
    downloadFile(nameOf(activeId), source);
    markSaved(activeId);
  };

  const saveAll = () => {
    downloadSet(files.map((file) => ({ name: file.name, text: textOf(file.id) })));
    files.forEach((file) => markSaved(file.id));
  };

  // Доступ к буферу обмена может быть закрыт политикой страницы. Отвечаем и
  // на отказ: кнопка, которая иногда молчит, хуже кнопки, которая признаётся.
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('toolbar.copied');
    } catch {
      setNotice('toolbar.copyFailed');
    }
  };

  return (
    <>
      {/* `describeChild`: у кнопки есть подпись, и подсказка обязана остаться
          описанием, а не подменить имя кнопки собой. */}
      <Tooltip title={t('menu.fileHint')} describeChild>
        <Button
          size="small"
          color="inherit"
          endIcon={<ArrowDropDownIcon />}
          aria-haspopup="menu"
          onClick={(event) => setAnchor(event.currentTarget)}
          sx={{ px: 1, flexShrink: 0 }}
        >
          {t('menu.file')}
        </Button>
      </Tooltip>

      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        <Item
          icon={<LibraryAddIcon fontSize="small" />}
          label={t('menu.newSet')}
          onClick={pick(() => replace({ kind: 'blank' }))}
        />
        <Item
          icon={<NoteAddIcon fontSize="small" />}
          label={t('menu.newFile')}
          onClick={pick(newFile)}
        />

        <Divider />

        <Item
          icon={<FolderOpenIcon fontSize="small" />}
          label={t('menu.openFiles')}
          onClick={pick(single.open)}
        />
        <Item
          icon={<FolderZipIcon fontSize="small" />}
          label={t('menu.openArchive')}
          onClick={pick(archive.open)}
        />

        <Divider />

        <Item
          icon={<DownloadIcon fontSize="small" />}
          label={t('menu.saveFile', { name: nameOf(activeId) })}
          onClick={pick(saveActive)}
        />
        {/* Набор из одного файла архивом не выгружают: это тот же файл, но в
            обёртке, которую придётся снимать вручную. */}
        {files.length > 1 && (
          <Item
            icon={<FolderZipIcon fontSize="small" />}
            label={t('menu.saveArchive')}
            onClick={pick(saveAll)}
          />
        )}
        <Item
          icon={<ContentCopyIcon fontSize="small" />}
          label={t('menu.copy')}
          onClick={pick(() => void copy(source))}
        />

        <Divider />

        <Item
          icon={<CollectionsBookmarkIcon fontSize="small" />}
          label={t('menu.examples')}
          onClick={pick(() => setBrowsing(true))}
        />
      </Menu>

      {single.input}
      {archive.input}

      {/* Выбор примера закрывает витрину до вопроса о замене: два диалога
          друг над другом прячут тот, который на самом деле ждёт ответа. */}
      <ExamplesDialog
        open={browsing}
        activeId={exampleId}
        onClose={() => setBrowsing(false)}
        onCopy={(code) => void copy(code)}
        onOpenExample={(example) => {
          setBrowsing(false);
          replace({ kind: 'example', example });
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        title={t('document.replaceTitle')}
        body={
          pending === null
            ? ''
            : t(REPLACE_BODY[pending.kind], {
                count: String(pending.kind === 'files' ? pending.files.length : 0),
              })
        }
        confirmLabel={t('document.replace')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) replaceWorkspace(filesOf(pending));
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

/**
 * Замена, которая ждёт ответа о невыгруженных правках.
 *
 * Пример хранится примером, а не готовым файлом: до подтверждения он ещё может
 * не понадобиться, а имя файла у примера выводится из него самого.
 */
type Pending =
  | { kind: 'example'; example: ModsecExample }
  | { kind: 'files'; files: NewFile[] }
  | { kind: 'blank' };

function filesOf(pending: Pending): NewFile[] {
  if (pending.kind === 'example') return [exampleFile(pending.example)];
  if (pending.kind === 'blank') return [{ name: DEFAULT_NAME, source: '' }];
  return pending.files;
}

/** Вопрос один на все замены, но говорит о своей: чем именно заменяют набор. */
const REPLACE_BODY: Record<Pending['kind'], TranslationKey> = {
  example: 'document.replaceBody',
  files: 'document.replaceFilesBody',
  blank: 'document.replaceBlankBody',
};

/** Пункт меню со значком: значки выравнивают подписи в колонку. */
function Item({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <MenuItem onClick={onClick}>
      <ListItemIcon>{icon}</ListItemIcon>
      <ListItemText slotProps={{ primary: { variant: 'body2' } }}>{label}</ListItemText>
    </MenuItem>
  );
}
