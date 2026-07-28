import type { ReactNode } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import RedoIcon from '@mui/icons-material/Redo';
import UndoIcon from '@mui/icons-material/Undo';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useRule } from '../context/ruleContext';
import { useBuilderView } from '../context/builderViewContext';
import { useI18n } from '../i18n/useI18n';
import { ICON_BUTTON_PAD } from '../theme';
import type { EditorTab } from '../context/editorViewContext';

/**
 * Просвет внутри обоймы: до краёв подложки, до подписи, между значками.
 *
 * Один на всё, потому что мерить его глаз будет по значкам, а не по разметке:
 * у иконочной кнопки есть собственное поле вокруг значка, и просвет разметки
 * к нему прибавляется. Поэтому всюду, где просвет упирается в кнопку, это
 * поле из него вычтено — а между двумя кнопками вычтено дважды.
 */
const GROUP_GAP = 8;

/**
 * Обойма мелких кнопок: подложка чуть темнее строки вкладок.
 *
 * Значки без подписей и счёт без рамки рассыпаются по полосе на отдельные
 * пятна, и глазу приходится собирать их заново. Своя подложка говорит, что
 * это одна группа, — а темнее, а не светлее, потому что группа служебная:
 * смотреть в неё надо реже, чем в содержимое документа.
 */
function ControlGroup({ children }: { children: ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{
        alignItems: 'baseline',
        gap: `${GROUP_GAP - ICON_BUTTON_PAD}px`,
        pl: `${GROUP_GAP}px`,
        pr: `${GROUP_GAP - ICON_BUTTON_PAD}px`,
        borderRadius: 1,
        bgcolor: 'background.default',
        height: 26
      }}
      spacing={0.5}
    >
      {children}
    </Stack>
  );
}

/**
 * Отмена и повтор.
 *
 * Стоят до вкладок и отбиты от них делителем, потому что принадлежат
 * документу, а не режиму: шаг назад откатывает и набор текста, и правку из
 * формы, и от переключения вкладки эти кнопки не меняются — значит, и ездить
 * по строке вместе с ней не должны. Показывать их обязательно: сочетание
 * клавиш само себя не показывает.
 */
export function HistoryButtons() {
  const { t } = useI18n();
  const { undo, redo, canUndo, canRedo } = useRule();

  return (
    <Stack direction="row" spacing={0.5} sx={{mr:2}}>
      <Tooltip title={t('toolbar.undo')}>
        {/* Обёртка нужна, чтобы подсказка работала и у выключенной кнопки. */}
        <span>
          <IconButton
            size="small"
            disabled={!canUndo}
            onClick={undo}
            aria-label={t('toolbar.undo')}
          >
            <UndoIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('toolbar.redo')}>
        <span style={{ height: 20, width: 20 }}>
          <IconButton
            size="small"
            disabled={!canRedo}
            onClick={redo}
            aria-label={t('toolbar.redo')}
          >
            <RedoIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  );
}

/** Сколько блоков раскрыто и кнопки «свернуть/раскрыть весь файл». */
function ExpansionControls() {
  const { t } = useI18n();
  const { expandAll, collapseAll, expandedCount, collapsibleCount } = useBuilderView();

  // Сворачивать нечего — обойма не нужна вовсе: пустая подложка выглядела бы
  // оторвавшимся от чего-то куском.
  if (collapsibleCount === 0) return null;

  return (
    <ControlGroup>
      <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: '20px' }}>
        {t('builder.expandedOf', {
          expanded: String(expandedCount),
          total: String(collapsibleCount),
        })}
      </Typography>
      {/* Своя обойма у пары кнопок: между ними просветов разметки не нужно
          вовсе — расстояние набирается их собственными полями. */}
      <Stack direction="row" sx={{ gap: `${GROUP_GAP - 2 * ICON_BUTTON_PAD}px` }}>
        <Tooltip title={t('builder.collapseAll')}>
          <span style={{ height: 20, width: 20 }}>
            <IconButton
              size="small"
              disabled={expandedCount === 0}
              onClick={collapseAll}
              aria-label={t('builder.collapseAll')}
              sx={{ height: 20, width: 20 }}
            >
              <UnfoldLessIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        {/* Раскрыть весь большой файл — законное желание и дорогая операция:
            подсказка называет цену до нажатия, а не после. */}
        <Tooltip
          title={t(collapsibleCount > 100 ? 'builder.expandAllSlow' : 'builder.expandAll')}
        >
          <span style={{ height: 20, width: 20 }}>
            <IconButton
              size="small"
              disabled={expandedCount === collapsibleCount}
              onClick={expandAll}
              aria-label={t('builder.expandAll')}
              sx={{ height: 20, width: 20 }}
            >
              <UnfoldMoreIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </ControlGroup>
  );
}

/** Главное действие текстового режима: разложить правило по строкам. */
function FormatButton() {
  const { t } = useI18n();
  const { formatSource, canFormat } = useRule();

  return (
    <Tooltip title={t(canFormat ? 'toolbar.formatHint' : 'toolbar.formatDone')}>
      <span>
        <Button
          size="small"
          variant="contained"
          disabled={!canFormat}
          onClick={formatSource}
          startIcon={<AutoFixHighIcon fontSize="small" />}
        >
          {t('toolbar.format')}
        </Button>
      </span>
    </Tooltip>
  );
}

/** Главное действие визуального режима: новое правило в конец файла. */
function AddRuleButton() {
  const { t } = useI18n();
  const { addRule } = useRule();
  const { expandNext } = useBuilderView();

  return (
    <Button
      size="small"
      variant="contained"
      startIcon={<AddIcon />}
      onClick={() => {
        expandNext();
        addRule();
      }}
    >
      {t('builder.addRule')}
    </Button>
  );
}

/**
 * Органы управления активного режима — в одной строке с вкладками.
 *
 * Своей полосы ни та, ни другая панель не заработала: в них полдюжины кнопок,
 * а горизонталей над содержимым и без того хватает. Высоту строки всё равно
 * задают вкладки, поэтому панель встаёт следом за ними бесплатно.
 *
 * Строение у панелей одно, чтобы переключение режима не переставляло кнопки
 * под курсором: у правого края — главное действие режима, всегда в одном
 * виде, и вплотную перед ним то, что режим рассказывает о документе. Пустая
 * середина полосы лучше пустого правого края: обойма — подпись к главному
 * действию, а не самостоятельный житель строки, и стоять ей рядом с ним.
 * Различие проведено по вкладке снаружи, а не по контексту внутри: панель
 * обязана показывать то, что видно на экране, а не то, что последним
 * записали в состояние.
 */
export function EditorToolbar({ tab }: { tab: EditorTab }) {
  return (
    <Stack
      direction="row"
      sx={{
        flex: 1,
        minWidth: 0,
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: `${GROUP_GAP}px`,
        pl: 1,
        pr: 1.5,
      }}
    >
      {tab === 'visual' && <ExpansionControls />}
      {tab === 'text' ? <FormatButton /> : <AddRuleButton />}
    </Stack>
  );
}
