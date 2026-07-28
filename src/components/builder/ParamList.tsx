import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { ChipInput } from './ChipInput';
import { useI18n } from '../../i18n/useI18n';
import type { Suggestion } from '../../modsec/suggestions';

/**
 * Положение переключателя списка.
 *
 * `all` — параметры не перечислены, проверяется вся коллекция; `only` —
 * только перечисленные; `except` — вся коллекция без перечисленных.
 *
 * В модели правила такого перечисления нет: там всего два способа собрать
 * список термов, а «ВСЕ» — это пустой перечень. Переключателю же нужно
 * третье положение отдельно от двух других, потому что выбирают его раньше,
 * чем набирают значения.
 */
export type ParamMode = 'all' | 'only' | 'except';

interface ParamListProps {
  mode: ParamMode;
  values: string[];
  /** Режим и значения меняются вместе: по отдельности они не имеют смысла. */
  onChange: (next: { mode: ParamMode; values: string[] }) => void;
  /** Готовые имена параметров этой переменной. */
  suggestions?: Suggestion[];
  /** Можно ли вычитать: у переменной с обязательным параметром — нечего. */
  canExclude?: boolean;
  /** Положительной части у цели нет — список только вычитает. */
  baseless?: boolean;
}

/**
 * Параметры области проверки одним списком.
 *
 * В ModSecurity список переменных — это последовательность термов, которую
 * движок применяет слева направо: `VAR:a` добавляет элемент коллекции,
 * `!VAR:a` вычитает. Осмысленных способов уточнить переменную поэтому ровно
 * два, и они исключают друг друга: либо перечислить параметры, либо взять
 * всю коллекцию без перечисленных. Двух отдельных полей это не требует —
 * требует одного поля и переключателя.
 *
 * Переключатель — первый чип в поле, и он же отвечает на вопрос, который
 * при двух полях оставался без ответа: что будет, если не указать ничего.
 * Пустой список читается «ВСЕ», то есть вся коллекция, и это видно до
 * первого ввода, а не выясняется опытным путём.
 *
 * Положений у него три, и переключаются они и на пустом списке: режим
 * выбирают до того, как набрали значения, а не после. Пустые «ТОЛЬКО» и
 * «КРОМЕ» — состояние незаконченное, поэтому поле в нём подсвечено: правило
 * пока проверяет всю коллекцию, что бы ни было написано на переключателе.
 *
 * Имена параметров бывают длиной в строку — такой чип обрезается по ширине
 * поля, а целиком значение показывают подсказка и окно правки. Окно заодно
 * остаётся способом вставить или переписать сразу весь список.
 */
export function ParamList({
  mode,
  values,
  onChange,
  suggestions,
  canExclude = true,
  baseless = false,
}: ParamListProps) {
  const { t } = useI18n();

  const excluding = mode === 'except';
  // Режим выбран, а перечислять нечего: правило проверяет всю коллекцию,
  // а не то, что написано на переключателе.
  const incomplete = !baseless && mode !== 'all' && values.length === 0;

  /**
   * Список сам возвращает переключатель в «ВСЕ», когда снят последний чип,
   * и уводит из него, когда появился первый: пустой перечень и есть вся
   * коллекция. Осознанно пустыми бывают только «ТОЛЬКО» и «КРОМЕ»,
   * выставленные нажатием на сам переключатель.
   */
  const setValues = (next: string[]) => {
    const settled = next.length === 0 ? 'all' : mode === 'all' ? 'only' : mode;
    onChange({ mode: settled, values: next });
  };

  const modeLabel = baseless
    ? t('builder.except')
    : mode === 'all'
      ? t('builder.paramsAll')
      : excluding
        ? t('builder.paramsExcept')
        : t('builder.paramsOnly');

  // Вычитать без положительной части не из чего, поэтому такую цель не
  // переключают: её и собрал не конструктор, а чужой текст правила.
  const switchable = canExclude && !baseless;

  // Пустой список перебирает все три положения; с непустым «ВСЕ»
  // пропускается — одно нажатие не должно стирать набранный перечень.
  const order: ParamMode[] =
    values.length === 0 ? ['all', 'only', 'except'] : ['only', 'except'];
  const nextMode = order[(order.indexOf(mode) + 1) % order.length];

  const modeChip = (
    // Подсказка именно поясняет чип, а не называет его: имя у чипа своё,
    // видимое. Без `describeChild` MUI подменил бы им имя целиком, и чип
    // перестал бы называться тем словом, которое на нём написано.
    <Tooltip
      describeChild
      title={
        <>
          {mode === 'all' && <div>{t('builder.paramsAllHint')}</div>}
          {incomplete && <div>{t('builder.paramsRequired')}</div>}
          {switchable && <div>{t('builder.paramsModeHint')}</div>}
          {switchable && values.length > 0 && <div>{t('builder.paramsAllBlocked')}</div>}
        </>
      }
    >
      <Chip
        size="small"
        color={excluding ? 'error' : mode === 'all' ? 'default' : 'warning'}
        label={modeLabel}
        // Нажатие на чип не должно уводить каретку в поле и раскрывать
        // список подсказок: это переключатель, а не начало ввода. Поле
        // ловит и нажатие, и клик, поэтому гасить нужно оба.
        onMouseDown={(event) => event.preventDefault()}
        onClick={
          switchable
            ? (event) => {
                event.stopPropagation();
                onChange({ mode: nextMode, values });
              }
            : undefined
        }
        sx={{ fontWeight: 700, letterSpacing: 0.5 }}
      />
    </Tooltip>
  );

  return (
    <ChipInput
      fullWidth
      monospace
      prefix={modeChip}
      chipColor={excluding ? 'error' : 'warning'}
      label={t('builder.parameters')}
      placeholder={excluding ? t('builder.addExcept') : t('builder.addParam')}
      dialogTitle={excluding ? t('builder.exclusions') : t('builder.parameters')}
      separators={[',']}
      suggestions={suggestions}
      values={values}
      error={incomplete}
      helperText={incomplete ? t('builder.paramsRequired') : undefined}
      renderLabel={(value) => (value === '' ? t('builder.anyParameter') : value)}
      onChange={setValues}
    />
  );
}
