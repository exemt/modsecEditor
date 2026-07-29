import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ChoiceField } from './ChoiceField';
import { CommitField } from './CommitField';
import { SuggestField } from './SuggestField';
import { useI18n } from '../../i18n/useI18n';
import { disruptiveChoices, logFlagChoices, phaseChoices } from '../../modsec/choices';
import { readDefaultAction, writeDefaultAction } from '../../modsec/directives';
import { AUDIT_FLAGS, LOG_FLAGS, takesDestination } from '../../modsec/semantics';
import { serializeAction } from '../../modsec/serialize';
import { STATUS_SUGGESTIONS } from '../../modsec/suggestions';
import type { DefaultActionForm, DirectiveForm } from '../../modsec/directives';

const MONO = 'ui-monospace, Consolas, monospace';

interface DefaultActionPanelProps {
  form: Extract<DirectiveForm, { arg: 'actions' }>;
  onChange: (next: DirectiveForm) => void;
}

/**
 * Умолчания фазы: `SecDefaultAction "phase:2,log,auditlog,pass"`.
 *
 * Полей меньше, чем у правила, и не ради краткости. `id` у умолчаний не
 * бывает вовсе, `msg` некуда приписать, метки бессмысленны — панель правила
 * предлагала бы здесь то, чего ModSecurity не примет, а поле, которое нельзя
 * заполнить, хуже отсутствующего.
 *
 * Зато остаётся всё, ради чего эту строку и правят: фаза, которой умолчания
 * достаются, и реакция, которую наследует каждое правило ниже. Именно она —
 * тот единственный переключатель, что превращает набор из наблюдающего в
 * блокирующий: с `pass` каждое правило, полагающееся на `block`, перестаёт
 * блокировать, и в журнале это выглядит ровно так же.
 *
 * Конвейер `t:` и всё прочее стоит записью и правится в текстовой вкладке.
 * Поле, понимающее запись наполовину, потеряло бы вторую половину при первой
 * же правке соседнего.
 */
export function DefaultActionPanel({ form, onChange }: DefaultActionPanelProps) {
  const { t } = useI18n();

  const value = readDefaultAction(form.actions);
  const set = (next: DefaultActionForm) =>
    onChange({ ...form, actions: writeDefaultAction(next) });

  const statusRelevant = value.disruptive === 'deny' || value.disruptive === 'redirect';

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ width: 260 }}>
          <ChoiceField
            prefix="phase:"
            label={t('builder.phase')}
            emptyLabel={t('builder.unset')}
            choices={phaseChoices(value.phase)}
            value={value.phase}
            onChange={(phase) => set({ ...value, phase })}
            // Фаза здесь не уточнение, а адрес: умолчания достаются только
            // правилам своей фазы, и без неё строка не относится ни к кому.
            error={value.phase === '' ? t('builder.directivePhaseRequired') : undefined}
          />
        </Box>

        <Box sx={{ width: 250 }}>
          <ChoiceField
            label={t('builder.disruptive')}
            emptyLabel={t('builder.unset')}
            choices={disruptiveChoices(value.disruptive)}
            value={value.disruptive}
            onChange={(disruptive) =>
              set({
                ...value,
                disruptive,
                // Адрес принадлежит только перенаправлению: оставленный у
                // `deny`, он превратил бы умолчания в то, чего движок не примет.
                disruptiveValue: takesDestination(disruptive) ? value.disruptiveValue : '',
              })
            }
          />
        </Box>

        {takesDestination(value.disruptive) && (
          <CommitField
            size="small"
            label={t('builder.destination')}
            placeholder={value.disruptive === 'proxy' ? 'http://backend/' : '/blocked.html'}
            value={value.disruptiveValue}
            onCommit={(disruptiveValue) => set({ ...value, disruptiveValue })}
            error={value.disruptiveValue === ''}
            sx={{ flex: '1 1 220px' }}
          />
        )}

        <SuggestField
          label={t('builder.status')}
          disabled={!statusRelevant}
          suggestions={STATUS_SUGGESTIONS}
          value={value.status}
          onCommit={(status) => set({ ...value, status })}
          sx={{ width: 160 }}
        />
      </Stack>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ width: 230 }}>
          <ChoiceField
            label={t('builder.log')}
            emptyLabel={t('builder.unset')}
            choices={logFlagChoices(LOG_FLAGS, flagName(value.log, LOG_FLAGS))}
            value={flagName(value.log, LOG_FLAGS)}
            onChange={(name) => set({ ...value, log: flagState(name, LOG_FLAGS) })}
          />
        </Box>
        <Box sx={{ width: 230 }}>
          <ChoiceField
            label={t('builder.auditlog')}
            emptyLabel={t('builder.unset')}
            choices={logFlagChoices(AUDIT_FLAGS, flagName(value.auditlog, AUDIT_FLAGS))}
            value={flagName(value.auditlog, AUDIT_FLAGS)}
            onChange={(name) => set({ ...value, auditlog: flagState(name, AUDIT_FLAGS) })}
          />
        </Box>
      </Stack>

      {value.extra.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('builder.otherActions')}
          </Typography>
          {value.extra.map((item, index) => (
            <Tooltip key={index} title={t('builder.readOnly')}>
              <Chip
                size="small"
                variant="outlined"
                label={serializeAction(item)}
                sx={{ fontFamily: MONO }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

/** Тройное состояние флага — в имя действия, которым его пишут. */
function flagName(state: boolean | null, flags: readonly string[]): string {
  if (state === null) return '';
  return state ? flags[0] : flags[1];
}

/** И обратно: имя действия — в тройное состояние. */
function flagState(name: string, flags: readonly string[]): boolean | null {
  if (name === '') return null;
  return name === flags[0];
}
