import { useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { ActionsPanel } from './ActionsPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { CommitField } from './CommitField';
import { conditionSummary } from './summary';
import { DiagnosticNotes } from '../diagnostics/DiagnosticNotes';
import { ruleLevelDiagnostics, useRuleDiagnostics } from '../diagnostics/useDiagnostics';
import { useI18n } from '../../i18n/useI18n';
import type { TranslationKey } from '../../i18n/translations';
import type { VisualRule } from '../../modsec/model';

interface RuleCardProps {
  rule: VisualRule;
  onChange: (next: VisualRule) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  /** `null`, когда двигать некуда: правило уже первое или последнее. */
  onMoveUp: (() => void) | null;
  onMoveDown: (() => void) | null;
}

/**
 * Однострочная выжимка правила для свёрнутой карточки.
 *
 * Показывает то, по чему правило узнают в списке: где смотрит, что ищет и
 * чем отвечает. Остальные звенья цепочки в строку не влезут, поэтому о них
 * говорится числом.
 */
function summarize(rule: VisualRule, t: (key: TranslationKey) => string): string {
  const [first] = rule.conditions;
  const parts: string[] = [];

  if (first !== undefined) parts.push(conditionSummary(first));

  const rest = rule.conditions.length - 1;
  if (rest > 0) parts.push(`+${rest} ${t('builder.andMore')}`);
  if (rule.actions.disruptive !== '') {
    parts.push(`→ ${t(`disruptive.${rule.actions.disruptive}` as TranslationKey)}`);
  }

  return parts.join('  ');
}

/**
 * Карточка одного логического правила: описание, условия (И-цепочка)
 * и реакция. Всё, что здесь меняется, немедленно пересобирается в текст.
 *
 * Карточку можно свернуть: в файле на десяток правил развёрнуты нужны редко,
 * а листать экран ради соседнего правила — самая частая мелкая морока.
 * Свёрнутая карточка не прячет замечания: их число остаётся в заголовке,
 * иначе проблему можно было бы закрыть от себя нажатием.
 */
export function RuleCard({
  rule,
  onChange,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}: RuleCardProps) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  const description = rule.comments.join(' ');
  const diagnostics = useRuleDiagnostics(rule.key);

  const worst = diagnostics.some((d) => d.severity === 'error')
    ? 'error'
    : diagnostics.some((d) => d.severity === 'warning')
      ? 'warning'
      : 'info';

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 1.5, py: 1, bgcolor: 'action.hover' }}
      >
        <Tooltip title={t(collapsed ? 'builder.expand' : 'builder.collapse')}>
          <IconButton
            size="small"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-label={t(collapsed ? 'builder.expand' : 'builder.collapse')}
            aria-expanded={!collapsed}
          >
            {collapsed ? (
              <ChevronRightIcon fontSize="small" />
            ) : (
              <ExpandMoreIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={`${t('builder.rule')} ${rule.actions.id || '—'}`}
        />

        {collapsed ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ flex: 1, minWidth: 0, fontFamily: 'ui-monospace, Consolas, monospace' }}
            noWrap
          >
            {description === '' ? summarize(rule, t) : description}
          </Typography>
        ) : (
          <CommitField
            size="small"
            variant="standard"
            fullWidth
            placeholder={t('builder.descriptionPlaceholder')}
            value={description}
            onCommit={(value) =>
              onChange({ ...rule, comments: value.trim() === '' ? [] : [value.trim()] })
            }
            slotProps={{ input: { disableUnderline: true } }}
          />
        )}

        {collapsed && diagnostics.length > 0 && (
          <Chip size="small" color={worst} label={diagnostics.length} />
        )}

        <Tooltip title={t('builder.moveUp')}>
          <span>
            <IconButton
              size="small"
              disabled={onMoveUp === null}
              onClick={onMoveUp ?? undefined}
              aria-label={t('builder.moveUp')}
            >
              <ArrowUpwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('builder.moveDown')}>
          <span>
            <IconButton
              size="small"
              disabled={onMoveDown === null}
              onClick={onMoveDown ?? undefined}
              aria-label={t('builder.moveDown')}
            >
              <ArrowDownwardIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t('builder.duplicateRule')}>
          <IconButton
            size="small"
            onClick={onDuplicate}
            aria-label={t('builder.duplicateRule')}
          >
            <ContentCopyIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('builder.deleteRule')}>
          <IconButton
            size="small"
            color="error"
            onClick={onDelete}
            aria-label={t('builder.deleteRule')}
          >
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Collapse in={!collapsed}>
        <Divider />
        <Box>
          <ConditionsPanel
            conditions={rule.conditions}
            diagnostics={diagnostics}
            onChange={(conditions) => onChange({ ...rule, conditions })}
          />
          <Divider />
          <ActionsPanel
            actions={rule.actions}
            onChange={(actions) => onChange({ ...rule, actions })}
          />
          <Box sx={{ px: 1, pb: 1 }}>
            <DiagnosticNotes items={ruleLevelDiagnostics(diagnostics)} />
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}
