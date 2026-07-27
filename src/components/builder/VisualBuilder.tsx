import { useEffect, useRef } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import RedoIcon from '@mui/icons-material/Redo';
import UndoIcon from '@mui/icons-material/Undo';
import { ActionsPanel } from './ActionsPanel';
import { RuleCard } from './RuleCard';
import { useRule } from '../../context/ruleContext';
import { useI18n } from '../../i18n/useI18n';
import { emitActionBlock } from '../../modsec/emit';
import type { VisualBlock, VisualModel } from '../../modsec/model';

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
    <Paper variant="outlined" sx={{ px: 1.5, py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
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
 * Визуальный конструктор правил.
 *
 * Рендерится по модели, которую собрал компилятор. Если текст перестал
 * компилироваться (например, у правила стёрли `id`), последняя удачная
 * модель остаётся на экране, но становится неактивной — это лучше, чем
 * пустая вкладка, и сразу объясняет, что именно сломалось.
 */
export function VisualBuilder() {
  const { t } = useI18n();
  const {
    compiled,
    updateRule,
    replaceLines,
    removeBlock,
    addRule,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useRule();

  const lastGood = useRef<VisualModel | null>(null);
  useEffect(() => {
    if (compiled.model) lastGood.current = compiled.model;
  }, [compiled.model]);

  const model = compiled.model ?? lastGood.current;

  const renderBlock = (block: VisualBlock) => {
    switch (block.kind) {
      case 'rule':
        return (
          <RuleCard
            key={block.key}
            rule={block.rule}
            onChange={updateRule}
            onDelete={() => removeBlock(block.rule.startIndex, block.rule.tailIndex)}
          />
        );
      case 'action':
        return (
          <Paper key={block.key} variant="outlined">
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center', px: 1.5, py: 1, bgcolor: 'action.hover' }}
            >
              <Chip size="small" color="secondary" variant="outlined" label={t('builder.secAction')} />
              <Box sx={{ flex: 1 }} />
              <IconButton
                size="small"
                color="error"
                onClick={() => removeBlock(block.startIndex, block.statementIndex)}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Divider />
            <ActionsPanel
              alwaysExpanded
              actions={block.actions}
              onChange={(actions) =>
                replaceLines(
                  block.startIndex,
                  block.statementIndex,
                  emitActionBlock(actions, block.comments),
                )
              }
            />
          </Paper>
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

  return (
    <Box sx={{ height: '100%', overflow: 'auto', p: 1.5 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Tooltip title={t('toolbar.undo')}>
            <span>
              <IconButton size="small" disabled={!canUndo} onClick={undo}>
                <UndoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={t('toolbar.redo')}>
            <span>
              <IconButton size="small" disabled={!canRedo} onClick={redo}>
                <RedoIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Box sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={addRule}>
            {t('builder.addRule')}
          </Button>
        </Stack>

        {!compiled.ok && <Alert severity="error">{t('debug.blocked')}</Alert>}

        {model === null || model.blocks.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            {t('builder.empty')}
          </Typography>
        ) : (
          <Stack
            spacing={1.5}
            sx={{
              opacity: compiled.ok ? 1 : 0.45,
              pointerEvents: compiled.ok ? 'auto' : 'none',
            }}
          >
            {model.blocks.map(renderBlock)}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
