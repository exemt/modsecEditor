import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import { MiniEditorPane } from './MiniEditorPane';
import { useBuilderView } from '../context/builderViewContext';
import { useEditorView } from '../context/editorViewContext';
import { useWorkspace } from '../context/workspaceContext';
import { useI18n } from '../i18n/useI18n';

interface RulePreviewProps {
  /** Значение `id` правила — то, что написано на чипе. */
  id: string;
  /** Файл, в котором стоит правило. */
  file: string;
  /** Ключ блока модели — по нему конструктор находит карточку. */
  ruleKey: string;
  /**
   * Показывать ли превью по наведению.
   *
   * `false` — чистый переход: номер ведёт в конструктор, без подсказки,
   * модалки и иконки текста. Так чип ставят в шапке, где исходник уже виден.
   */
  preview?: boolean;
  /** Перед переходом — закрыть родительское окно или подсказку. */
  onNavigate?: () => void;
}

/**
 * Номер правила как переход: наведение показывает исходник, нажатие — карточку.
 *
 * Компактное превью обрезает длинные строки: в подсказке горизонтальный скролл
 * только мешает. Подробности — отдельным окном из шапки превью; оттуда же
 * можно уйти в текстовую вкладку на эту строку.
 */
export function RulePreview({
  id,
  file,
  ruleKey,
  preview = true,
  onNavigate,
}: RulePreviewProps) {
  const { t } = useI18n();
  const { revealRule } = useBuilderView();
  const { revealLine } = useEditorView();
  const { activeId, nameOf, snippetOf } = useWorkspace();
  const [tipOpen, setTipOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const snippet = preview ? snippetOf(file, ruleKey) : null;
  const foreign = file !== activeId ? nameOf(file) : '';
  const label = id === '' ? t('builder.unset') : id;
  const fileName = nameOf(file);

  const revealHint =
    foreign === ''
      ? t('builder.exclusionReveal', { id: label })
      : t('builder.exclusionRevealIn', { id: label, file: foreign });

  const textHint =
    foreign === ''
      ? t('builder.rulePreviewText', { id: label })
      : t('builder.rulePreviewTextIn', { id: label, file: foreign });

  const goVisual = () => {
    onNavigate?.();
    revealRule(ruleKey, file);
  };

  const leavePreview = () => {
    setTipOpen(false);
    setModalOpen(false);
  };

  const openText = () => {
    if (snippet === null) return;
    leavePreview();
    onNavigate?.();
    revealLine(snippet.startLine, file);
  };

  const openFile = () => {
    leavePreview();
    onNavigate?.();
    revealLine(1, file);
  };

  const openModal = () => {
    setTipOpen(false);
    setModalOpen(true);
  };

  const openFileLabel =
    fileName === '' ? undefined : t('builder.rulePreviewOpenFile', { file: fileName });
  const openLinesLabel =
    snippet === null
      ? undefined
      : snippet.startLine === snippet.endLine
        ? t('builder.rulePreviewOpenLines', { line: String(snippet.startLine) })
        : t('builder.rulePreviewOpenLinesRange', {
            from: String(snippet.startLine),
            to: String(snippet.endLine),
          });

  const chip = (
    <Chip
      size="small"
      component="button"
      label={
        preview ? (
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
          >
            {label}
            {snippet !== null && (
              <IconButton
                component="span"
                size="small"
                aria-label={textHint}
                // span, а не button: Chip уже кнопка, и кнопка в кнопке —
                // невалидная разметка, на которую ругается и a11y, и клики.
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                  openText();
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return;
                  event.stopPropagation();
                  event.preventDefault();
                  openText();
                }}
                sx={{
                  p: 0.15,
                  ml: 0.25,
                  color: 'inherit',
                  '& .MuiSvgIcon-root': { fontSize: 14 },
                }}
              >
                <NotesOutlinedIcon />
              </IconButton>
            )}
          </Box>
        ) : (
          label
        )
      }
      onClick={goVisual}
      aria-label={revealHint}
      sx={{ flexShrink: 0 }}
    />
  );

  if (!preview) return chip;

  const tip =
    snippet === null ? (
      revealHint
    ) : (
      <MiniEditorPane
        variant="compact"
        text={snippet.text}
        startLine={snippet.startLine}
        fileName={fileName}
        openFileLabel={openFileLabel}
        onOpenFile={openFile}
        openLinesLabel={openLinesLabel}
        onOpenLines={openText}
        expandLabel={t('builder.rulePreviewExpand')}
        onExpand={openModal}
        closeLabel={t('app.close')}
        onClose={() => setTipOpen(false)}
      />
    );

  return (
    <>
      <Tooltip
        title={tip}
        placement="top"
        open={tipOpen}
        onOpen={() => {
          if (!modalOpen) setTipOpen(true);
        }}
        onClose={() => setTipOpen(false)}
        // Иначе курсор с чипа на кнопки в шапке тултип закрыл бы по дороге.
        disableInteractive={false}
        slotProps={{
          tooltip: {
            sx: {
              bgcolor: 'transparent',
              p: 0,
              maxWidth: 'none',
              boxShadow: 'none',
            },
          },
        }}
      >
        {chip}
      </Tooltip>

      {snippet !== null && (
        <Dialog
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          fullWidth
          maxWidth="lg"
          slotProps={{
            paper: {
              sx: {
                height: '80vh',
                bgcolor: '#1e1e1e',
                backgroundImage: 'none',
              },
            },
          }}
        >
          <DialogContent
            sx={{
              p: 0,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              '&.MuiDialogContent-root': { pt: 0 },
            }}
          >
            <MiniEditorPane
              variant="expanded"
              text={snippet.text}
              startLine={snippet.startLine}
              fileName={fileName}
              ruleAction={
                <RulePreview
                  id={id}
                  file={file}
                  ruleKey={ruleKey}
                  preview={false}
                  onNavigate={() => setModalOpen(false)}
                />
              }
              openFileLabel={openFileLabel}
              onOpenFile={openFile}
              openLinesLabel={openLinesLabel}
              onOpenLines={openText}
              closeLabel={t('app.close')}
              onClose={() => setModalOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
