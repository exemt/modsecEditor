import { useEffect, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ActionsPanel } from './ActionsPanel';
import { BlockList } from './BlockList';
import { RuleCard } from './RuleCard';
import { actionSummary } from './summary';
import { useRule } from '../../context/ruleContext';
import { blockExpansionKey, useBuilderView } from '../../context/builderViewContext';
import { useI18n } from '../../i18n/useI18n';
import { emitActionBlock } from '../../modsec/emit';
import { blockRange } from '../../modsec/model';
import { BLOCK_ROW } from '../../theme';
import type { VisualActions, VisualBlock, VisualModel } from '../../modsec/model';

/** Карточка блока, который конструктор показывает, но не редактирует. */
function ReadOnlyBlock({
  title,
  body,
  onDelete,
}: {
  title: string;
  body: string;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  return (
    <Paper variant="outlined" sx={{ px: 1.5 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: BLOCK_ROW }}>
        <Tooltip title={t('builder.readOnly')}>
          <Chip size="small" variant="outlined" label={title} />
        </Tooltip>
        <Typography
          variant="body2"
          sx={{ flex: 1, fontFamily: 'ui-monospace, Consolas, monospace' }}
          noWrap
        >
          {body}
        </Typography>
        <IconButton size="small" color="error" onClick={onDelete}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  );
}

/**
 * Безусловное действие `SecAction`.
 *
 * Сворачивается наравне с правилом, хотя условий у него нет: файл
 * инициализации CRS состоит из таких блоков почти целиком, и развёрнутыми
 * они стоят столько же, сколько правила.
 */
function ActionCard({
  block,
  expanded,
  onToggleExpanded,
  onChange,
  onDelete,
}: {
  block: Extract<VisualBlock, { kind: 'action' }>;
  expanded: boolean;
  onToggleExpanded: () => void;
  onChange: (actions: VisualActions) => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', height: BLOCK_ROW, px: 1.5, bgcolor: 'action.hover' }}
      >
        <Tooltip title={t(expanded ? 'builder.collapseBlock' : 'builder.expandBlock')}>
          <IconButton
            size="small"
            onClick={onToggleExpanded}
            aria-label={t(expanded ? 'builder.collapseBlock' : 'builder.expandBlock')}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ChevronRightIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>
        <Chip
          size="small"
          color="secondary"
          variant="outlined"
          label={t('builder.secAction')}
        />
        {expanded ? (
          <Box sx={{ flex: 1 }} />
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Consolas, monospace' }}
            noWrap
          >
            {block.comments.join(' ') || actionSummary(block.actions)}
          </Typography>
        )}
        <IconButton size="small" color="error" onClick={onDelete}>
          <DeleteOutlineIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
        <Divider />
        <ActionsPanel alwaysExpanded actions={block.actions} onChange={onChange} />
      </Collapse>
    </Paper>
  );
}

/**
 * Визуальный конструктор правил.
 *
 * Рендерится по модели, которую собрал компилятор. Если текст перестал
 * компилироваться (например, у правила стёрли `id`), последняя удачная
 * модель остаётся на экране, но становится неактивной — это лучше, чем
 * пустая вкладка, и сразу объясняет, что именно сломалось.
 */
export function VisualBuilder() {
  const { t } = useI18n();
  const { compiled, updateRule, replaceLines, removeBlock, duplicateRule, swapBlocks } =
    useRule();
  const { isExpanded, toggleExpanded, expandNext, reveal } = useBuilderView();

  const lastGood = useRef<VisualModel | null>(null);
  useEffect(() => {
    if (compiled.model) lastGood.current = compiled.model;
  }, [compiled.model]);

  const model = compiled.model ?? lastGood.current;

  const blocks = model?.blocks ?? [];

  /**
   * Перестановка — обмен местами с соседним блоком, каким бы он ни был.
   *
   * Правило может стоять рядом с меткой или директивой, и перепрыгивать через
   * них было бы неожиданно: порядок в файле значим целиком, а не только среди
   * правил. `null` означает «двигать некуда» — кнопка гаснет.
   */
  const swapWith = (index: number, delta: number) => {
    const neighbour = blocks[index + delta];
    if (neighbour === undefined) return null;
    return () => swapBlocks(blockRange(blocks[index]), blockRange(neighbour));
  };

  /**
   * Раскрыт ли блок — то есть занимает ли он больше одной строки.
   *
   * Метка и директива не раскрываются никогда: сворачивать в них нечего, а по
   * высоте они совпадают со свёрнутой карточкой, поэтому в серию встают
   * наравне с ней. Файлу CRS это важнее, чем кажется: меток в нём столько же,
   * сколько разделов.
   */
  const isOpen = (index: number) => {
    const key = blockExpansionKey(blocks[index]);
    return key !== null && isExpanded(key);
  };

  const renderBlock = (index: number) => {
    const block = blocks[index];
    const key = blockExpansionKey(block);
    const expanded = key !== null && isExpanded(key);
    const toggle = () => key !== null && toggleExpanded(key);

    switch (block.kind) {
      case 'rule':
        return (
          <RuleCard
            key={block.key}
            rule={block.rule}
            expanded={expanded}
            onToggleExpanded={toggle}
            onChange={updateRule}
            onDelete={() => removeBlock(block.rule.startIndex, block.rule.tailIndex)}
            onDuplicate={() => {
              expandNext();
              duplicateRule(block.rule);
            }}
            onMoveUp={swapWith(index, -1)}
            onMoveDown={swapWith(index, 1)}
          />
        );
      case 'action':
        return (
          <ActionCard
            key={block.key}
            block={block}
            expanded={expanded}
            onToggleExpanded={toggle}
            onChange={(actions) =>
              replaceLines(
                block.startIndex,
                block.statementIndex,
                emitActionBlock(actions, block.comments),
              )
            }
            onDelete={() => removeBlock(block.startIndex, block.statementIndex)}
          />
        );
      case 'marker':
        return (
          <ReadOnlyBlock
            key={block.key}
            title={t('builder.marker')}
            body={block.label}
            onDelete={() => removeBlock(block.startIndex, block.statementIndex)}
          />
        );
      case 'directive':
        return (
          <ReadOnlyBlock
            key={block.key}
            title={t('builder.directive')}
            body={[block.name, ...block.args].join(' ')}
            onDelete={() => removeBlock(block.startIndex, block.statementIndex)}
          />
        );
    }
  };

  // Просьба может указывать на правило, которого в модели уже нет: сообщение
  // диагностики живёт до следующего прохода и может пережить своё правило.
  const revealAt = blocks.findIndex((block) => block.key === reveal?.blockKey);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {!compiled.ok && (
        <Alert severity="error" sx={{ flexShrink: 0, mx: 1.5, mt: 1.5 }}>
          {t('debug.blocked')}
        </Alert>
      )}

      {blocks.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          {t('builder.empty')}
        </Typography>
      ) : (
        <BlockList
          count={blocks.length}
          isOpen={isOpen}
          render={renderBlock}
          dimmed={!compiled.ok}
          revealIndex={revealAt < 0 ? null : revealAt}
          revealSeq={reveal?.seq ?? 0}
        />
      )}
    </Box>
  );
}
