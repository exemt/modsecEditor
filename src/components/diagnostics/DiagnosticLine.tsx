import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import LightbulbOutlinedIcon from '@mui/icons-material/LightbulbOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useRule } from '../../context/ruleContext';
import { useBuilderView } from '../../context/builderViewContext';
import { useEditorView } from '../../context/editorViewContext';
import { useWorkspace } from '../../context/workspaceContext';
import { useI18n } from '../../i18n/useI18n';
import { diagnosticKey, diagnosticParams, fixKey, slotKey } from '../../i18n/translations';
import { quickFixFor } from '../../modsec/fixes';
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
  const { compiled, updateRule, replaceSource } = useRule();
  const { revealLine } = useEditorView();
  const { revealRule } = useBuilderView();
  const { files, activeId, nameOf, treeOf } = useWorkspace();
  const { anchor } = diagnostic;

  /**
   * Замечание не о том файле, который открыт.
   *
   * Правят только активный файл: у него и модель на руках, и история отмены.
   * У чужого замечания поэтому не ищется ни правило, ни правка: ключ `rule-3`
   * есть в каждом файле, и поиск по открытой модели нашёл бы чужое правило.
   * Перейти к нему всё равно можно — переход сменит файл.
   */
  const foreign = diagnostic.file !== undefined && diagnostic.file !== activeId;

  // Блок замечания в открытой модели. Адрес есть у любого блока — правила,
  // безусловного действия, метки, директивы, — и показать в конструкторе
  // можно любой; правка модели нужна только правилу.
  const block =
    foreign || anchor === undefined
      ? undefined
      : compiled.model?.blocks.find((candidate) => candidate.key === anchor.ruleKey);
  const rule = block?.kind === 'rule' ? block.rule : null;

  // Правка текста опирается на дерево файла и работает даже там, где
  // конструктор закрыт ошибкой. Правке модели нужно правило: пока в тексте
  // есть блокирующая ошибка, ей не на что опереться.
  const found = foreign ? null : quickFixFor(diagnostic, treeOf(activeId));
  const fix = found !== null && found.via === 'model' && rule === null ? null : found;

  const applyFix = () => {
    if (fix === null) return;
    if (fix.via === 'text') replaceSource(fix.apply());
    else if (rule !== null) updateRule(fix.apply(rule));
  };

  // Адрес читается от мелкого к крупному: «оператор · условие 2 · строка 7».
  // Номер строки отделён от остального: он не просто подпись, по нему
  // переходят.
  const place = showPlace
    ? [
        anchor?.condition !== undefined
          ? t('debug.condition', { index: String(anchor.condition) })
          : null,
        anchor?.slot !== undefined ? t(slotKey(anchor.slot)) : null,
        // Имя файла — крупнее всего остального, поэтому стоит в конце адреса.
        // Показывается, когда файлов несколько: в наборе список замечаний
        // перемешан, и «строка 12» без файла — не адрес.
        files.length > 1 && diagnostic.file !== undefined
          ? t('debug.inFile', { file: nameOf(diagnostic.file) })
          : null,
      ].filter((part): part is string => part !== null)
    : [];
  const line = showPlace ? diagnostic.line : undefined;

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', py: 0.5 }}>
      <SeverityIcon severity={diagnostic.severity} />
      <Typography
        variant="body2"
        color={diagnostic.severity === 'advice' ? 'text.secondary' : 'text.primary'}
        sx={{ flex: 1 }}
      >
        {t(diagnosticKey(diagnostic.code), diagnosticParams(diagnostic.params, t))}
      </Typography>

      {fix !== null && (
        <Button
          size="small"
          sx={{ py: 0, minWidth: 0, whiteSpace: 'nowrap' }}
          onClick={applyFix}
        >
          {t(fixKey(fix.kind), fix.params)}
        </Button>
      )}

      {place.length > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
          {place.join(' · ')}
        </Typography>
      )}

      {/* Две ссылки, а не одна: у текста и у конструктора разные сильные
          стороны, и выбор между ними — за человеком, а не за панелью. */}
      {showPlace && anchor !== undefined && (block !== undefined || foreign) && (
        <Link
          component="button"
          variant="caption"
          underline="hover"
          onClick={() => revealRule(anchor.ruleKey, diagnostic.file)}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {t('debug.inBuilder')}
        </Link>
      )}

      {line !== undefined && (
        <Link
          component="button"
          variant="caption"
          underline="hover"
          onClick={() => revealLine(line, diagnostic.file)}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {t('debug.line', { line: String(line) })}
        </Link>
      )}
    </Stack>
  );
}
