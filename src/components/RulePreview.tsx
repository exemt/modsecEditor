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
}

/**
 * Номер правила как переход: наведение показывает исходник, нажатие — карточку.
 *
 * Компактное превью обрезает длинные строки: в подсказке горизонтальный скролл
 * только мешает. Подробности — отдельным окном из шапки превью; оттуда же
 * можно уйти в текстовую вкладку на эту строку.
 */
export function RulePreview({ id, file, ruleKey }: RulePreviewProps) {
  const { t } = useI18n();
  const { revealRule } = useBuilderView();
  const { revealLine } = useEditorView();
  const { activeId, nameOf, snippetOf } = useWorkspace();
  const [tipOpen, setTipOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const snippet = snippetOf(file, ruleKey);
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

  const openText = () => {
    if (snippet === null) return;
    setTipOpen(false);
    setModalOpen(false);
    revealLine(snippet.startLine, file);
  };

  const openModal = () => {
    setTipOpen(false);
    setModalOpen(true);
  };

  const tip =
    snippet === null ? (
      revealHint
    ) : (
      <MiniEditorPane
        variant="compact"
        text={snippet.text}
        startLine={snippet.startLine}
        fileName={fileName}
        openTextLabel={textHint}
        onOpenText={openText}
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
        <Chip
          size="small"
          component="button"
          label={
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
          }
          onClick={() => revealRule(ruleKey, file)}
          aria-label={revealHint}
          sx={{ flexShrink: 0 }}
        />
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
              openTextLabel={textHint}
              onOpenText={openText}
              closeLabel={t('app.close')}
              onClose={() => setModalOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
