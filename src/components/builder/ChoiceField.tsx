import { useMemo, useRef, useState } from 'react';
import type { HTMLAttributes } from 'react';
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import UnfoldLessIcon from '@mui/icons-material/UnfoldLess';
import UnfoldMoreIcon from '@mui/icons-material/UnfoldMore';
import { useLabel } from './useLabel';
import { setFullList, useFullList } from './fullList';
import { useI18n } from '../../i18n/useI18n';
import type { Choice } from '../../modsec/choices';
import type { SxProps, Theme } from '@mui/material/styles';

const MONO = 'ui-monospace, Consolas, monospace';

/**
 * Отбор по набранному тексту.
 *
 * Ищем сразу по всему, что показано в строке: по имени из правила, по
 * названию и по пояснению, на обоих языках. Тот, кто помнит только «убрать
 * пробелы», наберёт это — и найдёт `compressWhitespace`, не зная слова.
 */
const filterChoices = createFilterOptions<Choice>({
  stringify: (choice) =>
    [
      choice.value,
      choice.label.en,
      choice.label.ru,
      choice.note.en,
      choice.note.ru,
    ].join(' '),
  trim: true,
});

interface ChoiceFieldProps {
  /** Подпись поля. */
  label: string;
  /** Выбранное имя; пустая строка — не выбрано. */
  value: string;
  choices: Choice[];
  onChange: (next: string) => void;
  /**
   * Приставка, с которой имя попадает в правило: `t:` или `@`. Показывается
   * рядом с вариантом, чтобы список читался как будущий текст правила.
   */
  prefix?: string;
  /** Текст на месте пустого значения; задан — значение можно не выбирать. */
  emptyLabel?: string;
  /**
   * Чего полю не хватает. Задан — поле подсвечено как незаполненное, а текст
   * стоит на месте значения и повторяется в подсказке.
   */
  error?: string;
  /** Забрать фокус сразу: поле только что появилось по действию человека. */
  autoFocus?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** Оформление самого значения — цвет и начертание. */
  inputSx?: Record<string, unknown>;
  sx?: Record<string, unknown>;
}

/**
 * Поле выбора из базы знаний ModSecurity.
 *
 * Заменяет собой выпадающий список там, где вариантов несколько десятков и
 * все они выглядят одинаково важными. Отличий от обычного списка три.
 *
 * Первое — поиск. Полсотни строк глазами не просматривают, а печатать
 * человек умеет; поле ищет и по имени из правила, и по пояснению.
 *
 * Второе — строка варианта отвечает сразу на два вопроса: как это пишется
 * в правиле (моноширинный оригинал справа) и что оно делает (пояснение
 * снизу). Без первого выбор нельзя сверить с текстовой вкладкой, без
 * второго — сделать, не зная ModSecurity наизусть.
 *
 * Третье — список отобран под текущую проверку. Наверху то, что здесь
 * обычно и ставят, ниже остальное применимое, в самом низу — то, что к
 * этому значению не подходит, с объяснением почему. Краткий вид оставляет
 * только частое; кнопка внизу списка разворачивает его целиком.
 */
export function ChoiceField({
  label,
  value,
  choices,
  onChange,
  prefix = '',
  emptyLabel,
  error,
  autoFocus = false,
  disabled = false,
  disabledReason,
  inputSx,
  sx,
}: ChoiceFieldProps) {
  const { t } = useI18n();
  const localize = useLabel();
  const full = useFullList();
  const [open, setOpen] = useState(false);
  // Пока в поле стоит подставленное значение, отбирать по нему нечего:
  // иначе открытый список показывал бы ровно то, что уже выбрано.
  const [query, setQuery] = useState('');

  const selected = choices.find((choice) => choice.value === value) ?? null;

  /** Краткий вид: только уместное здесь, частое и уже выбранное. */
  const short = useMemo(
    () =>
      choices.filter(
        (choice) =>
          choice.unfit === null &&
          (choice.recommended || choice.common || choice.value === value),
      ),
    [choices, value],
  );
  const hidden = choices.length - short.length;

  // Подвал списка перерисовывается вместе с полем, а его компонент обязан
  // сохранять тождество: пересоздание размонтировало бы открытый список.
  // Поэтому меняющиеся данные подвал читает из ссылки, а не из замыкания.
  const footer = useRef({ full, hidden, t });
  footer.current = { full, hidden, t };

  const ChoicePaper = useMemo(
    () =>
      function ChoicePaper(props: HTMLAttributes<HTMLElement>) {
        const state = footer.current;
        return (
          <Paper {...props}>
            {props.children}
            <Divider />
            <Button
              fullWidth
              startIcon={state.full ? <UnfoldLessIcon /> : <UnfoldMoreIcon />}
              // Нажатие не должно уводить фокус из поля, иначе список
              // закроется раньше, чем сработает переключение.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFullList(!state.full)}
              sx={{ justifyContent: 'flex-start', px: 1.25, py: 0.75, borderRadius: 0 }}
            >
              {state.full
                ? state.t('builder.choiceCommon')
                : state.t('builder.choiceAll', { count: String(state.hidden) })}
            </Button>
          </Paper>
        );
      },
    [],
  );

  const field = (
    <Autocomplete<Choice, false, boolean, false>
      openOnFocus
      autoHighlight
      selectOnFocus
      handleHomeEndKeys
      fullWidth
      size="small"
      disabled={disabled}
      disableClearable={emptyLabel === undefined}
      options={choices}
      value={selected}
      onChange={(_, next) => onChange(next === null ? '' : next.value)}
      onInputChange={(_, next, reason) => setQuery(reason === 'input' ? next : '')}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      getOptionLabel={(choice) => localize(choice.label, choice.value)}
      isOptionEqualToValue={(choice, current) => choice.value === current.value}
      groupBy={(choice) => localize(choice.group, '')}
      // Поиск идёт по всему списку, даже когда он свёрнут: спрашивая про
      // `base64`, человек хочет получить ответ, а не «ничего не найдено»
      // из-за режима показа.
      filterOptions={(options, state) => {
        const text = query.trim();
        if (text !== '') return filterChoices(options, { ...state, inputValue: text });
        return full ? options : short;
      }}
      slots={{ paper: ChoicePaper }}
      slotProps={{
        popper: {
          placement: 'bottom-start',
          style: { width: 'fit-content', minWidth: 320, maxWidth: 'min(540px, 92vw)' },
        },
      }}
      // Ключ строки — имя из правила, а не подпись, которую подставил бы
      // список: у синонимов вроде `normalizePath` и `normalisePath` подпись
      // одна на двоих, и React увидел бы два одинаковых ключа.
      renderOption={({ key: _label, ...props }, choice) => (
        <ChoiceOption
          {...props}
          key={choice.value}
          choice={choice}
          prefix={prefix}
          marked={full && choice.common}
        />
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          autoFocus={autoFocus}
          error={error !== undefined}
          placeholder={error ?? emptyLabel}
          sx={{ ...sx, '& .MuiInputBase-input': inputSx } as SxProps<Theme>}
          slotProps={{
            ...params.slotProps,
            inputLabel: { ...params.slotProps.inputLabel, shrink: true },
          }}
        />
      )}
    />
  );

  const hint = disabled ? disabledReason : (error ?? describe(selected, prefix, localize));
  if (hint === undefined || hint === '') return field;

  return (
    // С открытым списком подсказка гасится пустым заголовком, а не запретом
    // наведения: наведение случилось раньше открытия, и запрет уже
    // показанную подсказку не убирает — она так и висит поверх списка.
    <Tooltip title={open ? '' : hint} placement="top-start" enterDelay={600}>
      {/* Подсказке нужен обычный блок: полю она отдаёт всю ширину колонки,
          а флексом сжала бы его до длины названия. */}
      <Box sx={{ minWidth: 0 }}>{field}</Box>
    </Tooltip>
  );
}

/** Подсказка к закрытому полю: как это пишется в правиле и что означает. */
function describe(
  choice: Choice | null,
  prefix: string,
  localize: ReturnType<typeof useLabel>,
): string {
  if (choice === null) return '';
  return `${prefix}${choice.value} — ${localize(choice.note, '')}`;
}

interface ChoiceOptionProps extends HTMLAttributes<HTMLLIElement> {
  choice: Choice;
  prefix: string;
  /** Пометить вариант как частый — только в развёрнутом списке. */
  marked: boolean;
}

/**
 * Строка списка: название, оригинал, пояснение.
 *
 * Название слева и человеческое — по нему выбирают. Оригинал справа и
 * моноширинный — по нему потом ищут строку в текстовой вкладке. Пояснение
 * снизу и переносится: обрезать его нечестно, ради него список и открыли.
 */
function ChoiceOption({ choice, prefix, marked, ...props }: ChoiceOptionProps) {
  const { t } = useI18n();
  const localize = useLabel();

  return (
    <Box component="li" {...props} sx={{ alignItems: 'stretch' }}>
      <Stack spacing={0.25} sx={{ minWidth: 0, width: '100%', py: 0.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
          <Typography
            variant="body2"
            noWrap
            sx={{ flex: 1, minWidth: 0, color: choice.unfit ? 'text.disabled' : 'inherit' }}
          >
            {localize(choice.label, choice.value)}
          </Typography>
          {marked && (
            <Typography variant="caption" sx={{ flexShrink: 0, color: 'success.main' }}>
              {t('builder.choiceOften')}
            </Typography>
          )}
          <Typography
            variant="caption"
            sx={{ flexShrink: 0, fontFamily: MONO, color: 'text.disabled' }}
          >
            {prefix}
            {choice.value}
          </Typography>
        </Box>

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ whiteSpace: 'normal', lineHeight: 1.35 }}
        >
          {localize(choice.note, '')}
        </Typography>

        {choice.unfit !== null && (
          <Typography variant="caption" sx={{ whiteSpace: 'normal', color: 'warning.main' }}>
            {localize(choice.unfit, '')}
          </Typography>
        )}
      </Stack>
    </Box>
  );
}
