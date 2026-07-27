import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { ActionsPanel } from './ActionsPanel';
import { ConditionsPanel } from './ConditionsPanel';
import { CommitField } from './CommitField';
import { DiagnosticNotes } from '../diagnostics/DiagnosticNotes';
import { ruleLevelDiagnostics, useRuleDiagnostics } from '../diagnostics/useDiagnostics';
import { useI18n } from '../../i18n/useI18n';
import type { VisualRule } from '../../modsec/model';

interface RuleCardProps {
  rule: VisualRule;
  onChange: (next: VisualRule) => void;
  onDelete: () => void;
}

/**
 * Карточка одного логического правила: описание, условия (И-цепочка)
 * и реакция. Всё, что здесь меняется, немедленно пересобирается в текст.
 */
export function RuleCard({ rule, onChange, onDelete }: RuleCardProps) {
  const { t } = useI18n();
  const description = rule.comments.join(' ');
  const diagnostics = useRuleDiagnostics(rule.key);

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', px: 1.5, py: 1, bgcolor: 'action.hover' }}
      >
        <Chip
          size="small"
          color="primary"
          variant="outlined"
          label={`${t('builder.rule')} ${rule.actions.id || '—'}`}
        />
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
        <Tooltip title={t('builder.deleteRule')}>
          <IconButton size="small" color="error" onClick={onDelete}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

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
    </Paper>
  );
}
