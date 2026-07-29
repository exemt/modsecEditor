import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useBuilderView } from '../../context/builderViewContext';
import { useI18n } from '../../i18n/useI18n';
import type { ExclusionEntry } from '../../modsec/exclusions';

/**
 * Сколько правил названо номерами, прежде чем остаток назван числом.
 *
 * `SecRuleRemoveByTag` снимает сотни правил, и списком это не читается; шесть
 * номеров позволяют узнать, о том ли наборе речь, а число рядом честнее, чем
 * оборванный список без предупреждения.
 */
const SHOWN_RULES = 6;

/**
 * Отметки у строки исключения: кого оно задевает и работает ли вообще.
 *
 * Исключение — единственная запись файла, чей смысл лежит не в ней:
 * `SecRuleRemoveById 942100` сама по себе не говорит ни того, есть ли такое
 * правило, ни того, дотянется ли она до него. Дотянется только вниз — директива
 * применяется при чтении конфигурации, — поэтому строка, стоящая выше своей
 * цели, выглядит осмысленной и не делает ничего. Об этом здесь и сказано, рядом
 * с самой директивой, а не в отдельной сводке: порядок строк — и есть ответ.
 *
 * У `ctl` не дотянуться значит противоположное — «сработал слишком поздно», —
 * поэтому одна и та же отметка объясняется по-разному. Причина промаха тут
 * важнее самого промаха: чинят её переносом в другую фазу, а не вниз по файлу.
 */
export function ExclusionMarks({ entry }: { entry: ExclusionEntry }) {
  const { t } = useI18n();
  const { revealRule } = useBuilderView();
  const { directive, matches } = entry;

  const shown = matches.slice(0, SHOWN_RULES);
  const inactive = matches.length > 0 && matches.every((match) => !match.applies);
  const inactiveHint =
    directive.source === 'ctl' ? 'builder.exclusionLateHint' : 'builder.exclusionInactiveHint';

  return (
    <>
      {matches.length === 0 ? (
        <Tooltip title={t('builder.exclusionNoMatchHint')}>
          <Chip
            size="small"
            variant="outlined"
            label={t('builder.exclusionNoMatch')}
            sx={{ flexShrink: 0 }}
          />
        </Tooltip>
      ) : (
        <>
          {/* Номер сам за себя не говорит: «1000» рядом с директивой читается
              как её аргумент — то же число, что набрано в поле слева, — а не
              как правило, до которого она дотянулась. Подпись стоит одна на
              всю россыпь: приписанная к каждому номеру, она вытеснила бы из
              строки сами номера. */}
          <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
            {t(matches.length === 1 ? 'builder.exclusionRule' : 'builder.exclusionRules')}
          </Typography>

          {shown.map((match) => (
            <Tooltip key={match.key} title={t('builder.exclusionReveal', { id: match.id })}>
              <Chip
                size="small"
                onClick={() => revealRule(match.key)}
                label={match.id === '' ? t('builder.unset') : match.id}
                sx={{ flexShrink: 0 }}
              />
            </Tooltip>
          ))}
        </>
      )}

      {matches.length > shown.length && (
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
          {`+${matches.length - shown.length}`}
        </Typography>
      )}

      {inactive && (
        <Tooltip title={t(inactiveHint)}>
          <Chip
            size="small"
            color="warning"
            variant="outlined"
            label={t('builder.exclusionInactive')}
            sx={{ flexShrink: 0 }}
          />
        </Tooltip>
      )}
    </>
  );
}
