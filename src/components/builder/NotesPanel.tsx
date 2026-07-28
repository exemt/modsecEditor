import Chip from '@mui/material/Chip';
import { Section } from './Section';
import { DiagnosticNotes } from '../diagnostics/DiagnosticNotes';
import { useI18n } from '../../i18n/useI18n';
import { diagnosticKey } from '../../i18n/translations';
import type { Diagnostic } from '../../modsec/diagnostics';

interface NotesPanelProps {
  notes: Diagnostic[];
}

/**
 * Блок «Замечания»: всё, что сказано о правиле целиком, — реакция, фаза,
 * номер, действия, которые конструктор не редактирует.
 *
 * Блок наравне с условиями и действиями, а не подвал под ними: замечаний
 * бывает больше, чем самих полей, и в файле, который разбирают целиком, они
 * отодвигают следующее правило за край экрана. Свернуть их — то же желание,
 * что свернуть условия.
 *
 * Свёрнутый блок оставляет на виду число и первое сообщение: проблему нельзя
 * закрыть от себя нажатием, но и держать её раскрытой никто не обязан.
 *
 * Правилу без замечаний блок не нужен вовсе: пустая полоса «Замечаний нет»
 * занимала бы строку ровно там, где её нечем занять.
 */
export function NotesPanel({ notes }: NotesPanelProps) {
  const { t } = useI18n();

  const [first] = notes;
  if (first === undefined) return null;

  const worst = notes.some((d) => d.severity === 'error')
    ? 'error'
    : notes.some((d) => d.severity === 'warning')
      ? 'warning'
      : 'default';

  return (
    <Section
      title={t('builder.notes')}
      summary={t(diagnosticKey(first.code), first.params)}
      counters={<Chip size="small" color={worst} variant="outlined" label={notes.length} />}
    >
      <DiagnosticNotes items={notes} />
    </Section>
  );
}
