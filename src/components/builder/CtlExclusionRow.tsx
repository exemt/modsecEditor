import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { Bracket, BracketLine } from './Bracket';
import { ChoiceField } from './ChoiceField';
import { ExclusionMarks } from './ExclusionMarks';
import { SuggestField } from './SuggestField';
import { TargetRow } from './TargetRow';
import { CONDITION_PADDING, CONDITION_PADDING_TOP } from './layout';
import { useI18n } from '../../i18n/useI18n';
import { ctlExclusionChoices } from '../../modsec/choices';
import { ctlOption } from '../../modsec/exclusions';
import { makeTarget, targetsToVariables } from '../../modsec/model';
import { serializeVariable } from '../../modsec/serialize';
import { TAG_SUGGESTIONS } from '../../modsec/suggestions';
import type { TranslationKey } from '../../i18n/translations';
import type { CtlExclusion, ExclusionEntry, ExclusionSelector } from '../../modsec/exclusions';
import type { VisualTarget } from '../../modsec/model';

interface CtlExclusionRowProps {
  value: CtlExclusion;
  /** Что редактор узнал об этой записи: до кого дотянулась и дотянулась ли. */
  entry?: ExclusionEntry;
  /**
   * Номер звена цепочки, в котором запись стоит; 0 — действия правила.
   *
   * Показывается только у цепочки: у правила из одного условия «звено 1» —
   * уточнение без второй возможности.
   */
  link: number;
  /** Всего звеньев: у последнего условие исключения — «совпала вся цепочка». */
  links: number;
  onChange: (next: CtlExclusion) => void;
  onRemove: () => void;
}

/** Фраза об исключении — по тому, что снимаем и как выбираем. */
const PHRASE: Record<string, TranslationKey> = {
  'remove/id': 'builder.ctlRemoveById',
  'remove/msg': 'builder.ctlRemoveByMsg',
  'remove/tag': 'builder.ctlRemoveByTag',
  'removeTarget/id': 'builder.ctlRemoveTargetById',
  'removeTarget/msg': 'builder.ctlRemoveTargetByMsg',
  'removeTarget/tag': 'builder.ctlRemoveTargetByTag',
};

/** Чем подписано поле выборки: номер, метка и шаблон — три разные вещи. */
const PICK_LABEL: Record<ExclusionSelector, TranslationKey> = {
  id: 'builder.ctlPickId',
  msg: 'builder.ctlPickMsg',
  tag: 'builder.ctlPickTag',
};

/**
 * Одно исключение времени запроса: строка `ctl` как форма.
 *
 * Полем, а не текстом, — в отличие от прочих `ctl`. Причина в том, что здесь
 * грамматика известна целиком: шесть значений, у каждого выборка и, у половины,
 * снимаемая цель. Поле, понимающее запись наполовину, было бы хуже её
 * отсутствия; поле, понимающее её полностью, снимает главную сложность таких
 * правил — запись `ruleRemoveTargetByTag=id1515300;REQUEST_HEADERS:Referer`
 * приходится расшифровывать глазами, и ошибка в ней ничем не выдаёт себя.
 *
 * Поэтому первой строкой стоит фраза о том, что исключение делает, а запись
 * собирается из полей под ней. Рядом — то, чего в самой записи нет: до каких
 * правил файла она дотянулась и дотянулась ли вообще.
 *
 * Цели снимаются той же секцией, что стоит у правила, и по той же причине:
 * снимают их такими же — вся коллекция, перечень параметров, — и второй способ
 * набрать то же самое пришлось бы узнавать заново. Разошлись только связка и
 * два положения. Связка здесь И, а не ИЛИ: цели правила — где искать, любой
 * из них хватит, — а цели исключения снимаются все до одной. А `&` и вычитание
 * отпали вовсе: снимаемую цель ModSecurity сравнивает с целью правила по имени
 * и параметру, и `&ARGS` с `!ARGS:a` не совпадут ни с чем.
 *
 * Строка формы при этом стоит нескольких строк файла: цель в записи `ctl`
 * ровно одна, и каждая следующая — ещё одна запись. Это не вольность
 * редактора, а единственный способ снять две цели, и решение о них человек
 * принимает одно.
 */
export function CtlExclusionRow({
  value,
  entry,
  link,
  links,
  onChange,
  onRemove,
}: CtlExclusionRowProps) {
  const { t } = useI18n();

  // Цель разбирается и собирается тем же кодом, что цели правила: имя
  // параметра бывает с пробелом, и кавычки в нём — не украшение.
  const terms = targetsToVariables(value.targets).filter((term) => term.name !== '');
  // Через запятую, а не через `|`: вертикальной чертой в ModSecurity разделён
  // список целей одного правила, а здесь каждая цель — своя запись.
  const shown = terms.map(serializeVariable).join(', ');

  // Незаполненное исключение фразой не пересказать: «не проверять ARGS в
  // правиле не задано» читается как поломка редактора, а не как недописанная
  // запись. Поэтому вместо фразы стоит то, чего не хватает, — и говорится
  // именно то, чего: выборка и цель недописаны по-разному и чинятся в разных
  // полях.
  const phrase =
    value.pick === ''
      ? t('builder.ctlIncomplete')
      : value.op === 'removeTarget' && terms.length === 0
        ? t('builder.ctlIncompleteTarget')
        : t(PHRASE[`${value.op}/${value.selector}`], { pick: value.pick, target: shown });

  // Цели, стоящие в секции: у недописанного исключения — одна пустая. Секция
  // без единого поля отняла бы у него то место, где цель называют, а кнопка
  // «добавить» рядом с пустотой не сказала бы, к чему добавляет.
  const targets = value.targets.length === 0 ? [makeTarget('')] : value.targets;
  const setTargets = (next: VisualTarget[]) => onChange({ ...value, targets: next });

  return (
    // Строка оформлена как звено цепочки: то же поле, тот же фон, та же
    // корзина у правого края. Это и есть одно и то же дело — список, который
    // правят, — и второй способ его показать пришлось бы узнавать заново.
    <Stack
      spacing={0.75}
      sx={{
        p: CONDITION_PADDING,
        pt: CONDITION_PADDING_TOP,
        borderRadius: 1.5,
        bgcolor: 'action.hover',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ position: 'relative', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}
      >
        {/* Отмечена именно строка фразы, а не карточка целиком: скобка И
            снаружи ставит подпись по строкам, которые обнимает, и по фразам
            она встаёт там же, где у условий — по их первым полям. */}
        <BracketLine name="ctl" height="100%" />

        <Typography variant="body2">{phrase}</Typography>

        {/* Место в цепочке — часть смысла: исключение случится, когда совпадёт
            это звено, а у последнего это значит «совпала вся цепочка». */}
        {links > 1 && (
          <Tooltip
            title={t(link === links - 1 ? 'builder.ctlLinkLastHint' : 'builder.ctlLinkHint', {
              n: String(link + 1),
            })}
          >
            {/* Подсказка — на обёртке: подписанная ею метка читалась бы вслух
                пояснением вместо своего короткого «звено 3». */}
            <Box component="span" sx={{ display: 'inline-flex' }}>
              <Chip
                size="small"
                variant="outlined"
                label={t('builder.ctlLink', { n: String(link + 1) })}
              />
            </Box>
          </Tooltip>
        )}

        {entry !== undefined && <ExclusionMarks entry={entry} />}

        <Box sx={{ flex: 1 }} />
        <Tooltip title={t('builder.deleteExclusion')}>
          <IconButton size="small" onClick={onRemove} aria-label={t('builder.deleteExclusion')}>
            <DeleteOutlineIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ width: 250 }}>
          <ChoiceField
            label={t('builder.ctlOption')}
            emptyLabel={t('builder.unset')}
            choices={ctlExclusionChoices(ctlOption(value.op, value.selector))}
            value={ctlOption(value.op, value.selector)}
            onChange={(option) => {
              const selector: ExclusionSelector = option.endsWith('ByTag')
                ? 'tag'
                : option.endsWith('ByMsg')
                  ? 'msg'
                  : 'id';
              const op = option.includes('Target') ? 'removeTarget' : 'remove';
              // Снятое правило целями не сужают: цель у такой записи
              // ModSecurity прочитает как мусор в номере.
              onChange({ ...value, op, selector, targets: op === 'remove' ? [] : value.targets });
            }}
          />
        </Box>

        <SuggestField
          label={t(PICK_LABEL[value.selector])}
          suggestions={value.selector === 'tag' ? TAG_SUGGESTIONS : []}
          value={value.pick}
          onCommit={(pick) => onChange({ ...value, pick })}
          error={value.pick === '' ? t('builder.ctlPickRequired') : undefined}
          sx={{ width: 220 }}
        />
      </Stack>

      {/* Секция целей — ниже полей, а не рядом с ними: у неё своя ширина
          (имя параметра бывает длиной в строку) и своя высота, растущая с
          каждой снятой целью. Запас сверху — под плавающую подпись первого
          поля, она стоит выше его верхнего края. */}
      {value.op === 'removeTarget' && (
        <Box sx={{ pt: 1 }}>
          <Bracket label={t('builder.and')} color="error.main" line="target">
            <Stack spacing={2}>
              {targets.map((target, index) => (
                <TargetRow
                  key={`${target.name}-${index}`}
                  target={target}
                  canRemove={targets.length > 1}
                  error={target.name === '' ? t('builder.ctlTargetRequired') : undefined}
                  countBlocked={t('builder.ctlTargetNoCount')}
                  exceptBlocked={t('builder.ctlTargetNoExcept')}
                  onChange={(next) => setTargets(targets.map((v, i) => (i === index ? next : v)))}
                  onRemove={() => setTargets(targets.filter((_, i) => i !== index))}
                />
              ))}

              {/* Кнопка отмечена как цель: скобка доводится до неё, и видно,
                  что добавляется ещё одна снимаемая цель, а не что-то рядом. */}
              <Box sx={{ position: 'relative', display: 'flex' }}>
                <BracketLine name="target" height="100%" />
                <Tooltip title={t('builder.addCtlTargetHint')}>
                  <Box component="span" sx={{ display: 'inline-flex' }}>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<AddIcon />}
                      onClick={() => setTargets([...targets, makeTarget()])}
                    >
                      {t('builder.addCtlTarget')}
                    </Button>
                  </Box>
                </Tooltip>
              </Box>
            </Stack>
          </Bracket>
        </Box>
      )}
    </Stack>
  );
}
