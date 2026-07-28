import { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Snackbar from '@mui/material/Snackbar';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import { ConfirmDialog } from './ConfirmDialog';
import { ExamplesDialog } from './ExamplesDialog';
import { modsecExamples } from '../data/modsecExamples';
import type { ModsecExample } from '../data/modsecExamples';
import { useI18n } from '../i18n/useI18n';
import type { TranslationKey } from '../i18n/translations';
import { useRule } from '../context/ruleContext';
import { useBuilderView } from '../context/builderViewContext';

type Example = ModsecExample;

/** Имя, под которым выгружается документ, если он не пришёл из файла. */
const DEFAULT_NAME = 'rules.conf';

/**
 * Откуда берётся документ и куда уходит: примеры, файл, буфер обмена.
 *
 * Всё, что заменяет текст целиком, собрано в одном месте и подчиняется
 * одному правилу — не стирать чужую работу молча. «Изменён» здесь значит
 * «отличается от того, что в последний раз открыли или сохранили»: пока
 * человек листает примеры, вопросов нет, а как только он что-то написал,
 * замена спрашивает разрешения.
 */
export function DocumentBar() {
  const { t } = useI18n();
  const { source, setSource } = useRule();
  const { resetExpanded } = useBuilderView();

  // Текст на момент последнего открытия или сохранения.
  const [baseline, setBaseline] = useState(modsecExamples[0].code);
  const [activeId, setActiveId] = useState<string | null>(modsecExamples[0].id);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, setPending] = useState<Example | File | null>(null);
  const [notice, setNotice] = useState<TranslationKey | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);

  const edited = source !== baseline;
  const activeExample = modsecExamples.find((example) => example.id === activeId);

  // Откуда взялся текст: имя файла или название примера. Одно из двух —
  // открытый файл отменяет пример, и наоборот.
  const documentLabel =
    fileName ?? (activeExample === undefined ? null : t(activeExample.labelKey));

  // Новый документ — новый взгляд на него: раскрытые карточки прежнего файла
  // забываются, и конструктор снова показывает начало.
  const openExample = (example: Example) => {
    setActiveId(example.id);
    setFileName(null);
    setBaseline(example.code);
    resetExpanded();
    setSource(example.code);
  };

  const openFile = async (file: File) => {
    const text = await file.text();
    setActiveId(null);
    setFileName(file.name);
    setBaseline(text);
    resetExpanded();
    setSource(text);
  };

  const replace = (next: Example | File) => {
    if (next instanceof File) void openFile(next);
    else openExample(next);
  };

  const save = () => {
    const blob = new Blob([source], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName ?? DEFAULT_NAME;
    link.click();
    URL.revokeObjectURL(url);
    // Документ лёг на диск — с этого места и считаем правки.
    setBaseline(source);
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
    <Stack
      direction="row"
      spacing={1}
      sx={{
        px: 1.5,
        py: 1,
        flexWrap: 'wrap',
        gap: 1,
        alignItems: 'center',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Tooltip title={t('examples.browse')}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<CollectionsBookmarkIcon fontSize="small" />}
          onClick={() => setBrowsing(true)}
        >
          {t('examples.title')}
        </Button>
      </Tooltip>

      <Box sx={{ flex: 1 }} />

      {documentLabel !== null && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }}
          noWrap
        >
          {documentLabel}
        </Typography>
      )}

      <Divider orientation="vertical" flexItem />

      <Tooltip title={t('toolbar.openHint')}>
        <Button
          size="small"
          startIcon={<FolderOpenIcon fontSize="small" />}
          onClick={() => picker.current?.click()}
        >
          {t('toolbar.open')}
        </Button>
      </Tooltip>

      <Tooltip title={t('toolbar.saveHint')}>
        <Button size="small" startIcon={<DownloadIcon fontSize="small" />} onClick={save}>
          {t('toolbar.save')}
        </Button>
      </Tooltip>

      <Tooltip title={t('toolbar.copyHint')}>
        <Button
          size="small"
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={() => void copy(source)}
        >
          {t('toolbar.copy')}
        </Button>
      </Tooltip>

      {/* Выбор файла открывает кнопка рядом, поэтому сам input — деталь
          реализации: он спрятан и убран из обхода по Tab, чтобы не быть
          вторым «Открыть» для клавиатуры и скринридера. */}
      <input
        ref={picker}
        type="file"
        accept=".conf,.txt,text/plain"
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Сбрасываем значение: иначе выбор того же файла второй раз
          // не поднимет событие, и «открыть» перестанет работать.
          event.target.value = '';
          if (!file) return;
          if (edited) setPending(file);
          else void openFile(file);
        }}
      />

      {/* Выбор примера закрывает витрину до вопроса о замене: два диалога
          друг над другом прячут тот, который на самом деле ждёт ответа. */}
      <ExamplesDialog
        open={browsing}
        activeId={activeId}
        onClose={() => setBrowsing(false)}
        onCopy={(code) => void copy(code)}
        onOpenExample={(example) => {
          setBrowsing(false);
          if (edited) setPending(example);
          else openExample(example);
        }}
      />

      <ConfirmDialog
        open={pending !== null}
        title={t('document.replaceTitle')}
        body={t('document.replaceBody')}
        confirmLabel={t('document.replace')}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending !== null) replace(pending);
          setPending(null);
        }}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={2500}
        onClose={() => setNotice(null)}
        message={notice === null ? '' : t(notice)}
      />
    </Stack>
  );
}
