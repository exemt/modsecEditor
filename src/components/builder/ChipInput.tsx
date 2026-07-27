import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete';
import type { ChipProps } from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';
import { filterSuggestions, useSuggestionList } from './useSuggestionList';
import { CONTROL_HEIGHT, FIELD_GUTTER } from '../../theme';
import type { Suggestion } from '../../modsec/suggestions';

interface ChipInputProps {
  values: string[];
  onChange: (next: string[]) => void;
  /** Плавающая подпись поля — как у обычного `TextField`. */
  label?: string;
  /** Постоянная метка внутри поля: короткая, вместо плавающей подписи. */
  prefix?: ReactNode;
  /** Имя поля для скринридера, когда подпись нарисована через `prefix`. */
  ariaLabel?: string;
  placeholder?: string;
  helperText?: string;
  /** Поле заполнено не до конца: рамка и подпись под ней краснеют. */
  error?: boolean;
  /** Кнопка внутри поля справа — например, «править в окне». */
  action?: ReactNode;
  disabled?: boolean;
  chipColor?: ChipProps['color'];
  /** Подпись чипа, если она отличается от самого значения. */
  renderLabel?: (value: string) => string;
  /**
   * Символы, разделяющие значения при вводе и вставке. Пустой список —
   * значение добавляется только по Enter.
   */
  separators?: string[];
  /** Готовые варианты очередного значения; пустой список ничего не меняет. */
  suggestions?: Suggestion[];
  monospace?: boolean;
  fullWidth?: boolean;
  sx?: SxProps<Theme>;
}

/**
 * Разбивает введённый текст на готовые значения.
 *
 * Перенос строки — разделитель всегда: список, скопированный из файла или
 * из чужого конфига, должен превращаться в набор чипов сам.
 */
function splitValues(raw: string, separators: string[]): string[] {
  let parts = [raw];
  for (const separator of ['\n', ...separators]) {
    parts = parts.flatMap((part) => part.split(separator));
  }
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

/**
 * Поле-набор значений: каждое значение — отдельный чип, ввод продолжается
 * тут же в поле.
 *
 * Списки в ModSecurity живут внутри одной строки — исключения переменной,
 * теги, адреса `@ipMatch` через запятую, фразы `@pm` через пробел. Строку
 * с разделителями человеку приходится читать посимвольно и править вслепую;
 * чипы показывают ровно то, из чего список состоит, и дают удалить один
 * элемент, не задев соседние. Разделители при этом остаются рабочими:
 * вставка `10.0.0.0/8,192.168.0.0/16` сразу распадается на два чипа.
 *
 * Со списком подсказок поле работает так же, только очередное значение
 * можно не набирать, а выбрать из готовых — выбранное сразу становится
 * чипом.
 */
export function ChipInput({
  values,
  onChange,
  label,
  prefix,
  ariaLabel,
  placeholder,
  helperText,
  error = false,
  action,
  disabled = false,
  chipColor = 'default',
  renderLabel,
  separators = [],
  suggestions = [],
  monospace = false,
  fullWidth = false,
  sx,
}: ChipInputProps) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  const { slotProps, groupBy, renderOption } = useSuggestionList(suggestions);

  const commit = (raw: string) => {
    const added = splitValues(raw, separators).filter((v) => !values.includes(v));
    if (added.length > 0) onChange([...values, ...added]);
  };

  const handleInput = (raw: string) => {
    const hits = separators.map((s) => raw.lastIndexOf(s)).filter((i) => i >= 0);
    if (hits.length === 0) {
      setDraft(raw);
      return;
    }
    // Хвост после последнего разделителя ещё дописывают — он остаётся в поле.
    const cut = Math.max(...hits);
    commit(raw.slice(0, cut));
    setDraft(raw.slice(cut + 1));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      // Со списком Enter принадлежит ему: он подставит выделенный вариант,
      // а без выделения — тот же набранный текст.
      if (suggestions.length > 0) return;
      event.preventDefault();
      commit(draft);
      setDraft('');
      return;
    }
    // Открытый список Escape закрывает сам, и ввод при этом остаётся.
    if (event.key === 'Escape') {
      if (!open) setDraft('');
      return;
    }
    // Backspace в пустом поле снимает последний чип — так же, как в почте.
    if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  /**
   * Само поле. Со списком подсказок оно живёт внутри `Autocomplete`, и
   * тогда привязку к списку, стрелку и ссылку для всплывающей панели
   * приносит он — их нужно донести до тех же элементов, что и обычно.
   */
  const renderField = (params?: AutocompleteRenderInputParams) => (
    <FormControl
      size="small"
      fullWidth={fullWidth || params !== undefined}
      disabled={disabled}
      error={error}
      sx={params === undefined ? sx : undefined}
    >
      {label !== undefined && (
        <InputLabel shrink htmlFor={id} {...params?.slotProps.inputLabel}>
          {label}
        </InputLabel>
      )}
      <OutlinedInput
        {...params?.slotProps.input}
        id={params?.id ?? id}
        notched={label !== undefined}
        label={label}
        inputProps={{
          ...params?.slotProps.htmlInput,
          'aria-label': ariaLabel,
          onKeyDown: handleKeyDown,
        }}
        value={draft}
        placeholder={values.length === 0 ? placeholder : undefined}
        onChange={(event) => handleInput(event.target.value)}
        onBlur={() => {
          commit(draft);
          setDraft('');
        }}
        startAdornment={
          (prefix !== undefined || values.length > 0) && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 0.5,
                mr: 0.5,
              }}
            >
              {prefix}
              {values.map((value, index) => (
                <Chip
                  key={`${value}-${index}`}
                  size="small"
                  color={chipColor}
                  variant="outlined"
                  label={renderLabel === undefined ? value : renderLabel(value)}
                  disabled={disabled}
                  onDelete={() => onChange(values.filter((_, i) => i !== index))}
                  sx={monospace ? { fontFamily: 'ui-monospace, Consolas, monospace' } : undefined}
                />
              ))}
            </Box>
          )
        }
        endAdornment={
          action === undefined && params === undefined ? undefined : (
            <>
              {action}
              {params?.slotProps.input.endAdornment}
            </>
          )
        }
        sx={{
          minHeight: CONTROL_HEIGHT,
          flexWrap: 'wrap',
          alignItems: 'center',
          rowGap: 0.5,
          // Содержимое поле собирает само, поэтому и отступ держит само —
          // иначе его левый край не совпадёт с краем соседних полей.
          px: `${FIELD_GUTTER}px`,
          py: '2px',
          // Поле ввода занимает остаток строки и переносится вместе с чипами,
          // иначе длинный список выталкивал бы каретку за границу.
          '& .MuiInputBase-input': {
            flex: '1 1 60px',
            minWidth: 60,
            width: 'auto',
            p: 0,
            ...(monospace ? { fontFamily: 'ui-monospace, Consolas, monospace' } : {}),
          },
        }}
      />
      {helperText !== undefined && <FormHelperText>{helperText}</FormHelperText>}
    </FormControl>
  );

  if (suggestions.length === 0) return renderField();

  return (
    <Autocomplete<Suggestion, false, false, true>
      freeSolo
      forcePopupIcon
      openOnFocus
      handleHomeEndKeys
      size="small"
      disabled={disabled}
      // Явное `false` MUI понимает как «поле по ширине содержимого»;
      // отсутствие значения оставляет его во всю ширину места в раскладке.
      fullWidth={fullWidth || undefined}
      options={suggestions}
      filterOptions={filterSuggestions}
      groupBy={groupBy}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.value)}
      // Значение поля — набор чипов, и живёт оно снаружи. Списку остаётся
      // только очередной ввод, своего выбранного значения у него нет.
      value={null}
      inputValue={draft}
      onChange={(_, next) => {
        commit(next === null ? '' : typeof next === 'string' ? next : next.value);
        setDraft('');
      }}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      slotProps={slotProps}
      renderOption={renderOption}
      renderInput={renderField}
      sx={sx}
    />
  );
}
