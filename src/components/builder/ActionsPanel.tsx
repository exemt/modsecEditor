import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import { ChipInput } from './ChipInput';
import { ChoiceField } from './ChoiceField';
import { CommitField } from './CommitField';
import { LongTextField } from './LongTextField';
import { SuggestField } from './SuggestField';
import { useI18n } from '../../i18n/useI18n';
import { AUDIT_FLAGS, LOG_FLAGS, takesDestination } from '../../modsec/semantics';
import {
  disruptiveChoices,
  logFlagChoices,
  phaseChoices,
  severityChoices,
} from '../../modsec/choices';
import {
  MACRO_SUGGESTIONS,
  SETVAR_SUGGESTIONS,
  STATUS_SUGGESTIONS,
  TAG_SUGGESTIONS,
} from '../../modsec/suggestions';
import type { DisruptiveAction } from '../../modsec/semantics';
import type { VisualActions } from '../../modsec/model';

interface ActionsPanelProps {
  actions: VisualActions;
  onChange: (next: VisualActions) => void;
  /** `SecAction` не имеет условий — прятать нечего, показываем всё сразу. */
  alwaysExpanded?: boolean;
  /**
   * Номер правила правится в шапке карточки. Второе поле для того же
   * значения только заставляло бы гадать, какое из них главное.
   */
  hideId?: boolean;
}

/**
 * Тройное состояние флага — в имя действия и обратно.
 *
 * В поле стоит то, что уйдёт в правило: `log` или `nolog`, а не «включено» и
 * «выключено». Иначе пояснение к варианту рассказывало бы про положение
 * переключателя, а не про запись в журнал. Пара имён приходит извне: у
 * журнала ошибок она своя, у аудита своя.
 */
function flagName(flag: boolean | null, [on, off]: readonly [string, string]): string {
  if (flag === null) return '';
  return flag ? on : off;
}

function parseFlag(name: string, [on]: readonly [string, string]): boolean | null {
  if (name === '') return null;
  return name === on;
}

/**
 * Реакция правила: что ModSecurity делает, когда все условия совпали.
 *
 * Эти действия принадлежат правилу целиком и в тексте живут только на
 * первой директиве цепочки — звенья несут лишь свои преобразования.
 */
export function ActionsPanel({
  actions,
  onChange,
  alwaysExpanded,
  hideId,
}: ActionsPanelProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);

  const statusRelevant =
    actions.disruptive === 'deny' || actions.disruptive === 'redirect';

  // Флаги журналов хранятся тройным состоянием, а поля работают с именами
  // действий: перевод делается один раз на оба использования — список и само
  // значение обязаны говорить об одном и том же.
  const log = flagName(actions.log, LOG_FLAGS);
  const auditlog = flagName(actions.auditlog, AUDIT_FLAGS);

  return (
    <Stack spacing={1.5} sx={{ px: 1, pt: 0.5, pb: 1 }}>
      <Typography variant="subtitle2" color="text.secondary">
        {t('builder.actions')}
      </Typography>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        {!hideId && (
          <CommitField
            size="small"
            label={t('builder.id')}
            value={actions.id}
            onCommit={(id) => onChange({ ...actions, id })}
            sx={{ width: 110 }}
          />
        )}

        {/* Ширина полей — под самое длинное название с запасом на кнопку
            очистки и стрелку: «1 — Заголовки запроса» и «Разорвать
            соединение» должны читаться целиком, а не с многоточием. */}
        <Box sx={{ width: 260 }}>
          <ChoiceField
            prefix="phase:"
            label={t('builder.phase')}
            emptyLabel={t('builder.unset')}
            choices={phaseChoices(actions.phase)}
            value={actions.phase}
            onChange={(phase) => onChange({ ...actions, phase })}
          />
        </Box>

        {/* Реакция выбирается тем же полем, что оператор и преобразование:
            названия «Запретить», «Блокировать» и «Разорвать соединение» сами
            по себе неразличимы, а разницу между ними — код ответа, чужой
            SecDefaultAction, молчащий обрыв — видно только из пояснений. */}
        <Box sx={{ width: 250 }}>
          <ChoiceField
            label={t('builder.disruptive')}
            emptyLabel={t('builder.unset')}
            choices={disruptiveChoices(actions.disruptive)}
            value={actions.disruptive}
            onChange={(name) => {
              const disruptive = name as DisruptiveAction | '';
              // Адрес принадлежит только перенаправлению: оставить его у
              // `deny` значит собрать правило, которое ModSecurity не примет.
              onChange({
                ...actions,
                disruptive,
                disruptiveValue: takesDestination(disruptive) ? actions.disruptiveValue : '',
              });
            }}
          />
        </Box>

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
            <Box sx={{ width: 200 }}>
              <ChoiceField
                prefix="severity:"
                label={t('builder.severity')}
                emptyLabel={t('builder.unset')}
                choices={severityChoices(actions.severity)}
                value={actions.severity}
                onChange={(severity) => onChange({ ...actions, severity })}
              />
            </Box>

            <Box sx={{ width: 190 }}>
              <ChoiceField
                label={t('builder.log')}
                emptyLabel={t('builder.unset')}
                choices={logFlagChoices(LOG_FLAGS, log)}
                value={log}
                onChange={(name) => onChange({ ...actions, log: parseFlag(name, LOG_FLAGS) })}
              />
            </Box>

            <Box sx={{ width: 190 }}>
              <ChoiceField
                label={t('builder.auditlog')}
                emptyLabel={t('builder.unset')}
                choices={logFlagChoices(AUDIT_FLAGS, auditlog)}
                value={auditlog}
                onChange={(name) =>
                  onChange({ ...actions, auditlog: parseFlag(name, AUDIT_FLAGS) })
                }
              />
            </Box>

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
            dialogTitle={t('builder.tags')}
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
