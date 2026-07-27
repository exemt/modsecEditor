import { useState } from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { Bracket, BracketLine } from './Bracket';
import { ConditionRow } from './ConditionRow';
import { conditionDiagnostics } from '../diagnostics/useDiagnostics';
import { useI18n } from '../../i18n/useI18n';
import { makeCondition } from '../../modsec/model';
import type { Diagnostic } from '../../modsec/diagnostics';
import type { VisualCondition } from '../../modsec/model';

interface ConditionsPanelProps {
  conditions: VisualCondition[];
  /** Все замечания правила: панель раздаёт их звеньям по номеру. */
  diagnostics: Diagnostic[];
  onChange: (next: VisualCondition[]) => void;
}

/**
 * Блок «Условия»: все условия правила, объединённые логическим И.
 *
 * В ModSecurity это цепочка `chain` — набор директив `SecRule`, которые
 * срабатывают только все вместе. Скобка И слева показывает именно это.
 */
export function ConditionsPanel({
  conditions,
  diagnostics,
  onChange,
}: ConditionsPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);

  const replace = (index: number, next: VisualCondition) =>
    onChange(conditions.map((c, i) => (i === index ? next : c)));

  // Свёрнутый блок не должен прятать проблему: счётчик в заголовке говорит,
  // что внутри есть о чём поговорить, и красит себя по худшему из замечаний.
  const inside = conditions.flatMap((_, index) => conditionDiagnostics(diagnostics, index));
  const worst = inside.some((d) => d.severity === 'error')
    ? 'error'
    : inside.some((d) => d.severity === 'warning')
      ? 'warning'
      : 'default';

  return (
    <Accordion
      disableGutters
      elevation={0}
      expanded={expanded}
      onChange={(_, open) => setExpanded(open)}
      sx={{ bgcolor: 'transparent' }}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ px: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="subtitle2">{t('builder.conditions')}</Typography>
          {!expanded && inside.length > 0 && (
            <Chip size="small" color={worst} variant="outlined" label={inside.length} />
          )}
        </Stack>
      </AccordionSummary>

      <AccordionDetails sx={{ px: 1, pt: 0 }}>
        <Bracket label={t('builder.and')} color="error.main" line="condition">
          <Stack spacing={1.5}>
            {conditions.map((condition, index) => (
              <ConditionRow
                key={condition.key}
                condition={condition}
                diagnostics={conditionDiagnostics(diagnostics, index)}
                canRemove={conditions.length > 1}
                onChange={(next) => replace(index, next)}
                onRemove={() => onChange(conditions.filter((_, i) => i !== index))}
              />
            ))}

            {/* Кнопка отмечена как звено цепочки: скобка доводится до неё,
                и видно, что добавляется ещё одно условие по И. */}
            <Box sx={{ position: 'relative', display: 'flex' }}>
              <BracketLine name="condition" height="100%" />
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => onChange([...conditions, makeCondition()])}
              >
                {t('builder.addCondition')}
              </Button>
            </Box>
          </Stack>
        </Bracket>
      </AccordionDetails>
    </Accordion>
  );
}
