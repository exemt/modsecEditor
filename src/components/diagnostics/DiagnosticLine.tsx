import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useRule } from '../../context/ruleContext';
import { useI18n } from '../../i18n/useI18n';
import { diagnosticKey, fixKey, slotKey } from '../../i18n/translations';
import { quickFixFor } from '../../modsec/fixes';
import { findRule } from '../../modsec/model';
import type { Diagnostic } from '../../modsec/diagnostics';

/** Значок уровня: ошибка, предупреждение, совет. */
export function SeverityIcon({ severity }: { severity: Diagnostic['severity'] }) {
  if (severity === 'error') return <ErrorOutlineIcon fontSize="small" color="error" />;
  if (severity === 'warning') return <WarningAmberIcon fontSize="small" color="warning" />;
  return <LightbulbOutlinedIcon fontSize="small" color="disabled" />;
}

interface DiagnosticLineProps {
  diagnostic: Diagnostic;
  /**
   * Показывать адрес сообщения.
   *
   * Общему списку он нужен: там сообщения всех правил вперемешку. Рядом с
   * самим полем в конструкторе адрес — повтор того, что и так видно.
   */
  showPlace?: boolean;
}

/**
 * Одно сообщение диагностики — с кнопкой правки, если правка однозначна.
 *
 * Компонент общий для текстовой и визуальной вкладок: сообщение об одной и
 * той же проблеме не должно выглядеть и вести себя по-разному в зависимости
 * от того, откуда на него смотрят.
 */
export function DiagnosticLine({ diagnostic, showPlace = false }: DiagnosticLineProps) {
  const { t } = useI18n();
  const { compiled, updateRule } = useRule();
  const { anchor } = diagnostic;

  // Чинить можно только то, что компилятор разложил в модель: пока в тексте
  // есть блокирующая ошибка, правка не на что опереться.
  const fix = quickFixFor(diagnostic);
  const rule = findRule(compiled.model, anchor?.ruleKey);

  // Адрес читается от мелкого к крупному: «оператор · условие 2 · строка 7».
  const place = showPlace
    ? [
        anchor?.condition !== undefined
          ? t('debug.condition', { index: String(anchor.condition) })
          : null,
        anchor?.slot !== undefined ? t(slotKey(anchor.slot)) : null,
        diagnostic.line !== undefined
          ? t('debug.line', { line: String(diagnostic.line) })
          : null,
      ].filter((part): part is string => part !== null)
    : [];

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.5 }}>
      <SeverityIcon severity={diagnostic.severity} />
      <Typography
        variant="body2"
        color={diagnostic.severity === 'advice' ? 'text.secondary' : 'text.primary'}
        sx={{ flex: 1 }}
      >
        {t(diagnosticKey(diagnostic.code), diagnostic.params)}
      </Typography>

      {fix !== null && rule !== null && (
        <Button
          size="small"
          sx={{ py: 0, minWidth: 0, whiteSpace: 'nowrap' }}
          onClick={() => updateRule(fix.apply(rule))}
        >
          {t(fixKey(fix.kind), fix.params)}
        </Button>
      )}

      {place.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {place.join(' · ')}
        </Typography>
      )}
    </Stack>
  );
}
