import { useState } from 'react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { SuggestField } from './SuggestField';
import { useI18n } from '../../i18n/useI18n';
import type { Suggestion } from '../../modsec/suggestions';

interface LongTextFieldProps {
  label?: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Заголовок окна редактирования. */
  dialogTitle: string;
  /** Проверять значение как регулярное выражение. */
  regex?: boolean;
  /** Готовые варианты значения; пустой список оставляет поле обычным. */
  suggestions?: Suggestion[];
  monospace?: boolean;
  fullWidth?: boolean;
  sx?: Record<string, unknown>;
}

/** Сообщение о нерабочем regex или `null`, если выражение корректно. */
function regexError(pattern: string): string | null {
  if (pattern === '') return null;
  try {
    new RegExp(pattern);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Однострочное поле с кнопкой «развернуть» — тем же значением, но в окне.
 *
 * Значения операторов бывают длиной в экран: регулярка CRS на сотню
 * символов не помещается в колонку и правится вслепую. Карандаш открывает
 * то же значение многострочным моноширинным блоком, а для `@rx` ещё и
 * проверяет выражение до того, как оно уедет в текст правила.
 *
 * Длинное значение и готовый вариант не спорят друг с другом: список
 * подсказок даёт начать с типового значения, окно — дописать его до
 * нужного.
 */
export function LongTextField({
  label,
  value,
  onCommit,
  placeholder,
  disabled = false,
  dialogTitle,
  regex = false,
  suggestions = [],
  monospace = false,
  fullWidth,
  sx,
}: LongTextFieldProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);

  const open = draft !== null;
  const error = open && regex ? regexError(draft) : null;

  const save = () => {
    if (draft !== null && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <>
      <SuggestField
        label={label}
        value={value}
        onCommit={onCommit}
        suggestions={suggestions}
        placeholder={placeholder}
        disabled={disabled}
        monospace={monospace}
        fullWidth={fullWidth}
        sx={sx}
        endAdornment={
          <InputAdornment position="end">
            <Tooltip title={t('builder.editInWindow')}>
              <span>
                <IconButton
                  size="small"
                  edge="end"
                  disabled={disabled}
                  onClick={() => setDraft(value)}
                >
                  <EditOutlinedIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </InputAdornment>
        }
      />

      <Dialog open={open} onClose={() => setDraft(null)} fullWidth maxWidth="md">
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={6}
            maxRows={20}
            margin="dense"
            label={label ?? dialogTitle}
            value={draft ?? ''}
            error={error !== null}
            helperText={error ?? (regex ? t('builder.regexHint') : ' ')}
            onChange={(event) => setDraft(event.target.value)}
            slotProps={{
              input: { sx: { fontFamily: 'ui-monospace, Consolas, monospace' } },
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{t('app.cancel')}</Button>
          <Button variant="contained" disabled={error !== null} onClick={save}>
            {t('app.apply')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
