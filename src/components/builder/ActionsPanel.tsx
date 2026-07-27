import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { ChipInput } from './ChipInput';
import { CommitField } from './CommitField';
import { LongTextField } from './LongTextField';
import { SuggestField } from './SuggestField';
import { useLabel } from './useLabel';
import { useI18n } from '../../i18n/useI18n';
import {
  DISRUPTIVE_ACTIONS,
  PHASES,
  PHASE_LABELS,
  SEVERITIES,
  takesDestination,
} from '../../modsec/semantics';
import {
  MACRO_SUGGESTIONS,
  SETVAR_SUGGESTIONS,
  STATUS_SUGGESTIONS,
  TAG_SUGGESTIONS,
} from '../../modsec/suggestions';
import type { DisruptiveAction } from '../../modsec/semantics';
import type { VisualActions } from '../../modsec/model';
import type { TranslationKey } from '../../i18n/translations';

interface ActionsPanelProps {
  actions: VisualActions;
  onChange: (next: VisualActions) => void;
  /** `SecAction` не имеет условий — прятать нечего, показываем всё сразу. */
  alwaysExpanded?: boolean;
}

/** Тройное состояние флага: не задано / включено / выключено. */
function flagValue(flag: boolean | null): string {
  if (flag === null) return '';
  return flag ? 'on' : 'off';
}

function parseFlag(value: string): boolean | null {
  if (value === '') return null;
  return value === 'on';
}

/**
 * Реакция правила: что ModSecurity делает, когда все условия совпали.
 *
 * Эти действия принадлежат правилу целиком и в тексте живут только на
 * первой директиве цепочки — звенья несут лишь свои преобразования.
 */
export function ActionsPanel({ actions, onChange, alwaysExpanded }: ActionsPanelProps) {
  const { t } = useI18n();
  const label = useLabel();
  const [expanded, setExpanded] = useState(false);

  const statusRelevant =
    actions.disruptive === 'deny' || actions.disruptive === 'redirect';

  return (
    <Stack spacing={1.5} sx={{ px: 1, pt: 0.5, pb: 1 }}>
      <Typography variant="subtitle2" color="text.secondary">
        {t('builder.actions')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <CommitField
          size="small"
          label={t('builder.id')}
          value={actions.id}
          onCommit={(id) => onChange({ ...actions, id })}
          sx={{ width: 110 }}
        />

        <TextField
          select
          size="small"
          label={t('builder.phase')}
          value={actions.phase}
          onChange={(event) => onChange({ ...actions, phase: event.target.value })}
          sx={{ width: 190 }}
        >
          <MenuItem value="">{t('builder.unset')}</MenuItem>
          {PHASES.map((phase) => (
            <MenuItem key={phase} value={String(phase)}>
              {phase} — {label(PHASE_LABELS[phase], String(phase))}
            </MenuItem>
          ))}
        </TextField>

        <TextField
          select
          size="small"
          label={t('builder.disruptive')}
          value={actions.disruptive}
          onChange={(event) => {
            const disruptive = event.target.value as DisruptiveAction | '';
            // Адрес принадлежит только перенаправлению: оставить его у
            // `deny` значит собрать правило, которое ModSecurity не примет.
            onChange({
              ...actions,
              disruptive,
              disruptiveValue: takesDestination(disruptive) ? actions.disruptiveValue : '',
            });
          }}
          sx={{ width: 190 }}
        >
          <MenuItem value="">{t('builder.unset')}</MenuItem>
          {DISRUPTIVE_ACTIONS.map((name) => (
            <MenuItem key={name} value={name}>
              {t(`disruptive.${name}` as TranslationKey)}
            </MenuItem>
          ))}
        </TextField>

        {takesDestination(actions.disruptive) && (
          <CommitField
            size="small"
            label={t('builder.destination')}
            placeholder={actions.disruptive === 'proxy' ? 'http://backend/' : '/blocked.html'}
            value={actions.disruptiveValue}
            onCommit={(disruptiveValue) => onChange({ ...actions, disruptiveValue })}
            error={actions.disruptiveValue === ''}
            sx={{ flex: '1 1 220px' }}
          />
        )}

        <SuggestField
          label={t('builder.status')}
          disabled={!statusRelevant}
          suggestions={STATUS_SUGGESTIONS}
          value={actions.status}
          onCommit={(status) => onChange({ ...actions, status })}
          sx={{ width: 160 }}
        />

        <CommitField
          size="small"
          label={t('builder.message')}
          value={actions.msg}
          onCommit={(msg) => onChange({ ...actions, msg })}
          sx={{ flex: '1 1 260px' }}
        />
      </Stack>

      {!alwaysExpanded && (
        <Box>
          <Button size="small" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('builder.less') : t('builder.more')}
          </Button>
        </Box>
      )}

      <Collapse in={alwaysExpanded || expanded} unmountOnExit>
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <TextField
              select
              size="small"
              label={t('builder.severity')}
              value={actions.severity}
              onChange={(event) => onChange({ ...actions, severity: event.target.value })}
              sx={{ width: 160 }}
            >
              <MenuItem value="">{t('builder.unset')}</MenuItem>
              {SEVERITIES.map((severity) => (
                <MenuItem key={severity} value={severity}>
                  {severity}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              select
              size="small"
              label={t('builder.log')}
              value={flagValue(actions.log)}
              onChange={(event) =>
                onChange({ ...actions, log: parseFlag(event.target.value) })
              }
              sx={{ width: 140 }}
            >
              <MenuItem value="">{t('builder.unset')}</MenuItem>
              <MenuItem value="on">log</MenuItem>
              <MenuItem value="off">nolog</MenuItem>
            </TextField>

            <TextField
              select
              size="small"
              label={t('builder.auditlog')}
              value={flagValue(actions.auditlog)}
              onChange={(event) =>
                onChange({ ...actions, auditlog: parseFlag(event.target.value) })
              }
              sx={{ width: 160 }}
            >
              <MenuItem value="">{t('builder.unset')}</MenuItem>
              <MenuItem value="on">auditlog</MenuItem>
              <MenuItem value="off">noauditlog</MenuItem>
            </TextField>

            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={actions.capture}
                  onChange={(event) =>
                    onChange({ ...actions, capture: event.target.checked })
                  }
                />
              }
              label={<Typography variant="body2">{t('builder.capture')}</Typography>}
            />
          </Stack>

          <LongTextField
            fullWidth
            label={t('builder.logdata')}
            dialogTitle={t('builder.logdata')}
            suggestions={MACRO_SUGGESTIONS}
            value={actions.logdata}
            onCommit={(logdata) => onChange({ ...actions, logdata })}
          />

          <ChipInput
            fullWidth
            label={t('builder.tags')}
            placeholder={t('builder.addTag')}
            separators={[',']}
            suggestions={TAG_SUGGESTIONS}
            values={actions.tags}
            onChange={(tags) => onChange({ ...actions, tags })}
          />

          <Stack spacing={0.75}>
            <Typography variant="body2" color="text.secondary">
              {t('builder.setvar')}
            </Typography>
            {actions.setvar.map((setvar, index) => (
              <Stack key={index} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                <LongTextField
                  fullWidth
                  monospace
                  dialogTitle={t('builder.setvar')}
                  suggestions={SETVAR_SUGGESTIONS}
                  value={setvar}
                  onCommit={(value) =>
                    onChange({
                      ...actions,
                      setvar: actions.setvar.map((v, i) => (i === index ? value : v)),
                    })
                  }
                />
                <IconButton
                  size="small"
                  onClick={() =>
                    onChange({
                      ...actions,
                      setvar: actions.setvar.filter((_, i) => i !== index),
                    })
                  }
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
            <Box>
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={() => onChange({ ...actions, setvar: [...actions.setvar, ''] })}
              >
                setvar
              </Button>
            </Box>
          </Stack>
        </Stack>
      </Collapse>
    </Stack>
  );
}
