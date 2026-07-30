import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Collapse from '@mui/material/Collapse';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { ChipInput } from './ChipInput';
import { ChoiceField } from './ChoiceField';
import { CommitField } from './CommitField';
import { Counter } from './Counter';
import { CtlExclusionList } from './CtlExclusionList';
import { LongTextField } from './LongTextField';
import { Section, SECTION_PADDING } from './Section';
import { SetvarSection } from './SetvarSection';
import { SuggestField } from './SuggestField';
import { ruleActionCount, ruleActionSummary } from './summary';
import { FLAG_COLUMN, PHASE_COLUMN, REACTION_COLUMN, STATUS_COLUMN } from './layout';
import { useI18n } from '../../i18n/useI18n';
import { serializeAction } from '../../modsec/serialize';
import { isExclusionCtl } from '../../modsec/exclusions';
import { AUDIT_FLAGS, LOG_FLAGS, takesDestination } from '../../modsec/semantics';
import {
  disruptiveChoices,
  logFlagChoices,
  phaseChoices,
  severityChoices,
} from '../../modsec/choices';
import { MACRO_SUGGESTIONS, STATUS_SUGGESTIONS, TAG_SUGGESTIONS } from '../../modsec/suggestions';
import type { DisruptiveAction } from '../../modsec/semantics';
import type { ExclusionEntry } from '../../modsec/exclusions';
import type { VisualActions } from '../../modsec/model';

interface ActionsPanelProps {
  actions: VisualActions;
  onChange: (next: VisualActions) => void;
  /**
   * `SecAction` не имеет условий: панель — всё содержимое его карточки. Своего
   * заголовка и своей раскрывашки у неё тогда нет — их роль играет шапка
   * карточки, — а поля показаны сразу: прятать в блоке нечего.
   */
  alwaysExpanded?: boolean;
  /**
   * Номер правила правится в шапке карточки. Второе поле для того же
   * значения только заставляло бы гадать, какое из них главное.
   */
  hideId?: boolean;
  /**
   * Что проверки узнали об исключениях `ctl` среди этих действий.
   *
   * Передаёт их тот, кому больше некуда: у `SecAction` панель и есть вся
   * карточка. У правила исключения показывает своя секция — в ней рядом стоит
   * и обратная сторона, «чем снять это правило», и место записи в цепочке,
   * которого панель действий не знает.
   */
  exclusions?: ExclusionEntry[];
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
  exclusions = [],
}: ActionsPanelProps) {
  const { t } = useI18n();
  // Показаны ли редкие поля — журналы, теги, `setvar`. Это не сворачивание
  // блока целиком, а его вторая половина: у большинства правил эти поля
  // пусты, и на виду они прячут за собой те, что заполняют всегда.
  const [moreShown, setMoreShown] = useState(false);

  const statusRelevant =
    actions.disruptive === 'deny' || actions.disruptive === 'redirect';

  // Флаги журналов хранятся тройным состоянием, а поля работают с именами
  // действий: перевод делается один раз на оба использования — список и само
  // значение обязаны говорить об одном и том же.
  const log = flagName(actions.log, LOG_FLAGS);
  const auditlog = flagName(actions.auditlog, AUDIT_FLAGS);

  // Исключения уходят из общего списка в свою группу: там о них сказано то,
  // чего в самой записи нет, — до каких правил они дотянулись. Показывает их
  // панель только тогда, когда ей передали, что о них известно: у правила это
  // делает секция исключений, и вторая такая группа читалась бы как ещё одна
  // запись, у которой ищут отличия от первой.
  const settings = actions.extra.filter((item) => !isExclusionCtl(item));
  const hasCtl = exclusions.length > 0 && actions.extra.some(isExclusionCtl);

  const body = (
    <Stack spacing={1.5}>
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

        <Box sx={{ width: PHASE_COLUMN }}>
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
        <Box sx={{ width: REACTION_COLUMN }}>
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
          sx={{ width: STATUS_COLUMN }}
        />

        <CommitField
          size="small"
          label={t('builder.message')}
          value={actions.msg}
          onCommit={(msg) => onChange({ ...actions, msg })}
          sx={{ flex: '1 1 260px' }}
        />
      </Stack>

      {/* Действия, для которых поля нет: `initcol`, `expirevar`, `exec`,
          настройки движка вроде `ctl:requestBodyAccess=Off`. Каждое меняет
          поведение правила, а форма о них молчала — узнать о таком соседе
          можно было только из панели замечаний. Поэтому они стоят здесь, на
          виду и прежней записью, но правятся текстом: строка `ctl` — это своя
          грамматика, и поле, понимающее её наполовину, хуже её отсутствия.
          За «Ещё» их не спрятать: соседнее поле правят, уже зная о них. */}
      {settings.length > 0 && (
        <Stack
          direction="row"
          spacing={1}
          sx={{ flexWrap: 'wrap', gap: 1, alignItems: 'center' }}
        >
          <Typography variant="body2" color="text.secondary">
            {t('builder.otherActions')}
          </Typography>
          {settings.map((item, index) => (
            <Tooltip key={index} title={t('builder.readOnly')}>
              <Chip
                size="small"
                variant="outlined"
                label={serializeAction(item)}
                sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}
              />
            </Tooltip>
          ))}
        </Stack>
      )}

      {/* Исключения, которые ставит сам блок. Запись `ctl:ruleRemoveById=942100`
          среди прочих действий выглядела настройкой движка, а на деле это
          исключение — и работает оно так же, как `SecRuleRemoveById`: до кого-то
          дотягивается, до кого-то нет. Поэтому она вынута из общего списка,
          разобрана на поля и стоит со своими отметками. */}
      {hasCtl && (
        <Stack spacing={0.75}>
          <Typography variant="body2" color="text.secondary">
            {t('builder.setsExclusions')}
          </Typography>
          <CtlExclusionList
            actions={actions.extra}
            entries={exclusions}
            onChange={(extra) => onChange({ ...actions, extra })}
            link={0}
            links={1}
          />
        </Stack>
      )}

      {!alwaysExpanded && (
        <Box>
          <Button size="small" onClick={() => setMoreShown((v) => !v)}>
            {moreShown ? t('builder.less') : t('builder.more')}
          </Button>
        </Box>
      )}

      <Collapse in={alwaysExpanded || moreShown} unmountOnExit>
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

            <Box sx={{ width: FLAG_COLUMN }}>
              <ChoiceField
                label={t('builder.log')}
                emptyLabel={t('builder.unset')}
                choices={logFlagChoices(LOG_FLAGS, log)}
                value={log}
                onChange={(name) => onChange({ ...actions, log: parseFlag(name, LOG_FLAGS) })}
              />
            </Box>

            <Box sx={{ width: FLAG_COLUMN }}>
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

          {/* Паспорт правила. Движок эти поля не читает, но набор правил без
              них не собрать: по `ver` и `rev` разбор логов отличает версию
              правила, по `maturity` и `accuracy` набор собирают под уровень
              паранойи. Стоят они рядом с критичностью, потому что заполняют
              их из одного соображения — насколько правилу можно доверять. */}
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            <CommitField
              size="small"
              label={t('builder.ver')}
              placeholder="OWASP_CRS/4.0.0"
              value={actions.ver}
              onCommit={(ver) => onChange({ ...actions, ver })}
              sx={{ flex: '1 1 220px' }}
            />
            <CommitField
              size="small"
              label={t('builder.rev')}
              value={actions.rev}
              onCommit={(rev) => onChange({ ...actions, rev })}
              sx={{ width: 110 }}
            />
            <CommitField
              size="small"
              label={t('builder.maturity')}
              placeholder="1–9"
              value={actions.maturity}
              onCommit={(maturity) => onChange({ ...actions, maturity })}
              sx={{ width: 120 }}
            />
            <CommitField
              size="small"
              label={t('builder.accuracy')}
              placeholder="1–9"
              value={actions.accuracy}
              onCommit={(accuracy) => onChange({ ...actions, accuracy })}
              sx={{ width: 120 }}
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

          {/* Список стоит и пустым — иначе завести первое присваивание было бы
              негде, а ради него `SecAction` и пишут. Заготовка при этом
              обязана быть готовой записью: пустой `setvar` не переживает
              обхода через текст — компиляция отбрасывает действие без
              значения, — а ряд, исчезающий сам, хуже его отсутствия. */}
          <SetvarSection
            values={actions.setvar}
            onChange={(setvar) => onChange({ ...actions, setvar })}
          />
        </Stack>
      </Collapse>
    </Stack>
  );

  // Панель, которая и есть тело карточки, держит её внутреннее поле сама:
  // блока с заголовком вокруг неё нет, а отступ должен быть тот же.
  if (alwaysExpanded) return <Box sx={{ p: SECTION_PADDING }}>{body}</Box>;

  return (
    <Section
      title={t('builder.actions')}
      summary={ruleActionSummary(actions)}
      monospace
      counters={
        <Counter
          hint={t('builder.countActions', { count: String(ruleActionCount(actions)) })}
          count={ruleActionCount(actions)}
        />
      }
    >
      {body}
    </Section>
  );
}
