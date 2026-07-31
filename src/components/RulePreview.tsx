import { useEffect, useRef, useState, type ReactElement } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { MiniEditorPane } from './MiniEditorPane';
import { useBuilderView } from '../context/builderViewContext';
import { useEditorView } from '../context/editorViewContext';
import { useWorkspace } from '../context/workspaceContext';
import { useI18n } from '../i18n/useI18n';

/** Пауза до монтирования Tooltip — клик по чипу успевает пройти без remount. */
const ARM_DELAY_MS = 200;

interface RulePreviewProps {
  /** Значение `id` правила — то, что написано на чипе. */
  id: string;
  /** Файл, в котором стоит правило. */
  file: string;
  /** Ключ блока модели — по нему конструктор находит карточку. */
  ruleKey: string;
  /**
   * Текст перед номером на чипе: «Правило : 942100».
   *
   * В списке исключений номер сам за себя, а в общем списке блоков без слова
   * «Правило» чип не отличить от соседних меток и директив.
   */
  preText?: string;
  /**
   * Показывать ли превью по наведению.
   *
   * `false` — чистый переход: номер ведёт в конструктор, без подсказки,
   * модалки и иконки текста. Так чип ставят в шапке, где исходник уже виден.
   */
  preview?: boolean;
  /**
   * Как показать управление.
   *
   * `chip` — номер со ссылкой и (при превью) иконкой текста.
   * `icons` — глаз с той же подсказкой и переход в текстовый редактор;
   * так ставят в поле id раскрытой карточки, где номер уже набран.
   */
  mode?: 'chip' | 'icons';
  /** Перед переходом — закрыть родительское окно или подсказку. */
  onNavigate?: () => void;
}

/**
 * Номер правила как переход: наведение показывает исходник, нажатие — карточку.
 *
 * Пока курсор не задержался, в дереве только чип или иконки: Tooltip, исходник
 * и Dialog поднимаются после короткой паузы — иначе каждый видимый чип в списке
 * тащил бы Popper, а клик ломался бы remount'ом обёртки.
 *
 * Компактное превью обрезает длинные строки: в подсказке горизонтальный скролл
 * только мешает. Подробности — отдельным окном из шапки превью; оттуда же
 * можно уйти в текстовую вкладку на эту строку.
 */
export function RulePreview({
  id,
  file,
  ruleKey,
  preText,
  preview = true,
  mode = 'chip',
  onNavigate,
}: RulePreviewProps) {
  const { t } = useI18n();
  const { revealRule } = useBuilderView();
  const { revealLine } = useEditorView();
  const { activeId, nameOf, snippetOf } = useWorkspace();
  /** Tooltip уже монтировали — повторный hover без пересоздания обёртки. */
  const [armed, setArmed] = useState(false);
  const [tipOpen, setTipOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const foreign = file !== activeId ? nameOf(file) : '';
  const label = id === '' ? t('builder.unset') : id;
  const caption =
    preText === undefined || preText === '' ? label : `${preText} : ${label}`;
  const fileName = nameOf(file);

  // Исходник нужен только открытому превью или модалке — не каждому чипу в списке.
  const snippet = tipOpen || modalOpen ? snippetOf(file, ruleKey) : null;

  useEffect(() => {
    return () => {
      if (armTimer.current !== null) clearTimeout(armTimer.current);
    };
  }, []);

  const revealHint =
    foreign === ''
      ? t('builder.exclusionReveal', { id: label })
      : t('builder.exclusionRevealIn', { id: label, file: foreign });

  const peekHint =
    foreign === ''
      ? t('builder.rulePreviewPeek', { id: label })
      : t('builder.rulePreviewPeekIn', { id: label, file: foreign });

  const textHint =
    foreign === ''
      ? t('builder.rulePreviewText', { id: label })
      : t('builder.rulePreviewTextIn', { id: label, file: foreign });

  const clearArmTimer = () => {
    if (armTimer.current === null) return;
    clearTimeout(armTimer.current);
    armTimer.current = null;
  };

  const armAndOpenTip = () => {
    setArmed(true);
    if (!modalOpen) setTipOpen(true);
  };

  /** Первое наведение: Tooltip не монтируем сразу — даём клику дойти до чипа. */
  const scheduleArm = () => {
    if (armed || armTimer.current !== null) return;
    armTimer.current = setTimeout(() => {
      armTimer.current = null;
      armAndOpenTip();
    }, ARM_DELAY_MS);
  };

  const goVisual = () => {
    clearArmTimer();
    onNavigate?.();
    revealRule(ruleKey, file);
  };

  const leavePreview = () => {
    setTipOpen(false);
    setModalOpen(false);
  };

  const openText = () => {
    clearArmTimer();
    // Без предварительного hover: исходник берём здесь, а не из состояния tip.
    const found = snippetOf(file, ruleKey);
    if (found === null) return;
    leavePreview();
    onNavigate?.();
    revealLine(found.startLine, file);
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

  const textControl = (
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
  );

  const idleHoverProps =
    preview && !armed
      ? {
          onMouseEnter: scheduleArm,
          onMouseLeave: clearArmTimer,
        }
      : {};

  const chip = (
    <Chip
      size="small"
      component="button"
      {...idleHoverProps}
      label={
        preview ? (
          <Box
            component="span"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25 }}
          >
            {caption}
            {textControl}
          </Box>
        ) : (
          caption
        )
      }
      onClick={goVisual}
      aria-label={revealHint}
      sx={{ flexShrink: 0 }}
    />
  );

  if (!preview && mode === 'chip') return chip;

  const tipTitle =
    !tipOpen
      ? ''
      : snippet === null
        ? peekHint
        : (
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

  const withTip = (trigger: ReactElement) => {
    if (!armed) return trigger;

    return (
      <Tooltip
        title={tipTitle}
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
        {trigger}
      </Tooltip>
    );
  };

  const modal =
    !modalOpen || snippet === null ? null : (
      <Dialog
        open
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
    );

  if (mode === 'icons') {
    return (
      <>
        <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
          {withTip(
            <IconButton
              size="small"
              aria-label={peekHint}
              onMouseEnter={!armed ? scheduleArm : undefined}
              onMouseLeave={!armed ? clearArmTimer : undefined}
              sx={{ p: 0.25, '& .MuiSvgIcon-root': { fontSize: 18 } }}
            >
              <VisibilityOutlinedIcon />
            </IconButton>,
          )}
          <IconButton
            size="small"
            aria-label={textHint}
            onClick={openText}
            sx={{ p: 0.25, '& .MuiSvgIcon-root': { fontSize: 18 } }}
          >
            <NotesOutlinedIcon />
          </IconButton>
        </Box>
        {modal}
      </>
    );
  }

  return (
    <>
      {withTip(chip)}
      {modal}
    </>
  );
}
