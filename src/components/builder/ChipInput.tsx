import { useId, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormHelperText from '@mui/material/FormHelperText';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import InputLabel from '@mui/material/InputLabel';
import OutlinedInput from '@mui/material/OutlinedInput';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import type { AutocompleteRenderInputParams } from '@mui/material/Autocomplete';
import type { ChipProps } from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';
import { filterSuggestions, useSuggestionList } from './useSuggestionList';
import { useI18n } from '../../i18n/useI18n';
import { CONTROL_HEIGHT, DIALOG_FIELD_TOP, FIELD_GUTTER } from '../../theme';
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
  /**
   * Заголовок окна правки. С ним у поля появляется карандаш, открывающий
   * весь список построчным текстом; без него окна нет.
   */
  dialogTitle?: string;
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
 *
 * Чипы хороши, пока список правят по одному значению. Переписать его
 * целиком, вставить готовый перечень из чужого конфига или просто прочитать
 * длинный список, не помещающийся в строку, проще текстом — это и делает
 * окно правки за карандашом: те же значения, по одному в строке.
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
  dialogTitle,
  disabled = false,
  chipColor = 'default',
  renderLabel,
  separators = [],
  suggestions = [],
  monospace = false,
  fullWidth = false,
  sx,
}: ChipInputProps) {
  const { t } = useI18n();
  const id = useId();
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  // Текст окна правки; `null` — окно закрыто.
  const [text, setText] = useState<string | null>(null);
  const { slotProps, groupBy, renderGroup, renderOption } = useSuggestionList(suggestions);

  const commit = (raw: string) => {
    const added = splitValues(raw, separators).filter((v) => !values.includes(v));
    if (added.length > 0) onChange([...values, ...added]);
  };

  /** Список из окна заменяет прежний целиком — в этом и смысл окна. */
  const applyText = () => {
    if (text !== null) {
      const parsed = splitValues(text, separators);
      // Повторы схлопываются: одно и то же значение дважды бессмысленно.
      const unique = parsed.filter((value, i) => parsed.indexOf(value) === i);
      const same =
        unique.length === values.length && unique.every((v, i) => v === values[i]);
      if (!same) onChange(unique);
    }
    setText(null);
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
    // В любом случае дальше поля событие не идёт: за ним стоит диалог всего
    // редактора, для которого Escape означает «закрыться».
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!open) setDraft('');
      return;
    }
    // Backspace в пустом поле снимает последний чип — так же, как в почте.
    if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  const editButton = dialogTitle === undefined ? undefined : (
    <InputAdornment position="end">
      <Tooltip title={t('builder.editInWindow')}>
        <span>
          <IconButton disabled={disabled} onClick={() => setText(values.join('\n'))}>
            <EditOutlinedIcon />
          </IconButton>
        </span>
      </Tooltip>
    </InputAdornment>
  );

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
                // Список чипов сжимается до ширины поля вместо того, чтобы
                // распирать его: без этого одно длинное значение вылезало за
                // правую границу поля и лезло на соседнюю полосу условия.
                minWidth: 0,
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
                  // Длинное значение обрезается многоточием по краю поля.
                  // Прочитать его целиком есть где: окно за карандашом
                  // показывает весь список построчным текстом.
                  title={value}
                  sx={{
                    maxWidth: '100%',
                    ...(monospace ? { fontFamily: 'ui-monospace, Consolas, monospace' } : {}),
                  }}
                />
              ))}
            </Box>
          )
        }
        endAdornment={
          editButton === undefined && params === undefined ? undefined : (
            <>
              {params?.slotProps.input.endAdornment}
              {editButton}
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

  const dialog = dialogTitle === undefined ? null : (
    <Dialog open={text !== null} onClose={() => setText(null)} fullWidth maxWidth="sm">
      <DialogTitle>{dialogTitle}</DialogTitle>
      {/* Отступ повторяет собственный селектор MUI: правило «под заголовком
          отступа нет» весит два класса и обычному `sx` не уступает. */}
      <DialogContent sx={{ '&.MuiDialogContent-root': { pt: `${DIALOG_FIELD_TOP}px` } }}>
        <TextField
          autoFocus
          fullWidth
          multiline
          minRows={4}
          maxRows={16}
          margin="dense"
          label={label ?? dialogTitle}
          value={text ?? ''}
          helperText={
            separators.includes(',')
              ? `${t('builder.listHint')} ${t('builder.listHintComma')}`
              : t('builder.listHint')
          }
          onChange={(event) => setText(event.target.value)}
          slotProps={{
            input: monospace
              ? { sx: { fontFamily: 'ui-monospace, Consolas, monospace' } }
              : undefined,
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setText(null)}>{t('app.cancel')}</Button>
        <Button variant="contained" onClick={applyText}>
          {t('app.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );

  if (suggestions.length === 0)
    return (
      <>
        {renderField()}
        {dialog}
      </>
    );

  return (
    <>
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
        renderGroup={renderGroup}
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
      {dialog}
    </>
  );
}
