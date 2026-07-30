import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useBuilderView } from '../../context/builderViewContext';
import { useWorkspace } from '../../context/workspaceContext';
import { useI18n } from '../../i18n/useI18n';
import { useLabel } from './useLabel';
import { lookupVariable, readBeforeSet } from '../../modsec/variables';
import { setvarCollectionMeta } from '../../modsec/semantics';
import type { VariableSite } from '../../modsec/variables';

/**
 * Сколько мест названо строками, прежде чем остаток назван числом.
 *
 * `tx.anomaly_score` в наборе CRS прибавляют сотни правил, и списком это не
 * читается: шесть строк отвечают на вопрос «кто вообще» и дают перейти к
 * ближайшему, а число рядом честнее оборванного списка.
 */
const SHOWN_SITES = 6;

/** Коллекции, которым нужно хранилище: без него запись не переживёт запрос. */
const PERSISTENT = new Set(['ip', 'session', 'user', 'global', 'resource']);

interface VariableMarkProps {
  collection: string;
  name: string;
}

/**
 * Что набор знает о переменной: где её выставляют и где читают.
 *
 * Присваивание — вторая запись файла, чей смысл лежит не в ней самой.
 * `setvar:tx.block_flag=1` не говорит ни того, читает ли этот флаг кто-нибудь,
 * ни того, дойдёт ли дело до чтения: читающее правило может стоять в первой
 * фазе, а выставляющее — во второй, и тогда флаг не сработает ни разу. Оба
 * ответа лежат в других строках, а часто и в других файлах, — поэтому они
 * собраны здесь, у самого поля, а не в отдельной сводке.
 *
 * Отметка — значок, а не строка с числом: место в ряду полей у неё размером с
 * кнопку удаления, а сказать надо не «сколько», а «где именно». Цветом же она
 * отвечает на единственный вопрос, ответ на который виден сразу и без
 * раскрытия: читает ли эту переменную хоть кто-нибудь. Выставленная и никем
 * не читаемая переменная — не ошибка конфигурации, правило с ней загрузится и
 * будет работать; просто накопленное ею никто не проверяет.
 */
export function VariableMark({ collection, name }: VariableMarkProps) {
  const { t } = useI18n();
  const label = useLabel();
  const { revealRule } = useBuilderView();
  const { variables, activeId, nameOf } = useWorkspace();

  const entry = lookupVariable(variables, collection, name);
  const reads = entry?.reads ?? [];
  const writes = entry?.writes ?? [];
  const inits = variables.inits.get(collection.toLowerCase()) ?? [];

  // Пустое имя — это ещё не переменная, а незаполненное поле: у него нет ни
  // мест, ни коллекции, о которой стоило бы говорить.
  const unnamed = name === '';
  const unread = !unnamed && writes.length > 0 && reads.length === 0;
  const early = entry !== null && readBeforeSet(entry);
  const homeless = !unnamed && PERSISTENT.has(collection.toLowerCase()) && inits.length === 0;

  /** Место записи: сама запись и то, где она стоит. */
  const site = (item: VariableSite, index: number) => {
    const where =
      item.file === activeId
        ? t('builder.variableLine', { line: String(item.line) })
        : t('builder.variableLineIn', { file: nameOf(item.file), line: String(item.line) });

    return (
      <Box key={`${item.file}-${item.key}-${item.text}-${index}`} sx={{ mt: 0.25 }}>
        <Box component="span" sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}>
          {item.text}
        </Box>
        {' — '}
        {/* Ссылка, а не текст: место названо затем, чтобы к нему перейти, а
            правило может лежать и в другом файле — тогда переход сначала
            сменит активный, потому что ключ блока считается внутри файла. */}
        <Link
          component="button"
          type="button"
          underline="hover"
          color="inherit"
          onClick={() => revealRule(item.key, item.file)}
        >
          {item.id === '' ? where : t('builder.variableRule', { id: item.id, where })}
        </Link>
      </Box>
    );
  };

  const list = (heading: string, sites: VariableSite[], empty: string) => (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="caption" color="inherit" sx={{ fontWeight: 600 }}>
        {heading}
      </Typography>
      {sites.length === 0 ? (
        <Box sx={{ mt: 0.25 }}>{empty}</Box>
      ) : (
        <>
          {sites.slice(0, SHOWN_SITES).map(site)}
          {sites.length > SHOWN_SITES && (
            <Box sx={{ mt: 0.25 }}>{`+${sites.length - SHOWN_SITES}`}</Box>
          )}
        </>
      )}
    </Box>
  );

  const title = (
    <Box>
      <Box sx={{ fontFamily: 'ui-monospace, Consolas, monospace', fontWeight: 600 }}>
        {unnamed ? collection : `${collection}.${name}`}
      </Box>
      <Box>{label(setvarCollectionMeta(collection.toLowerCase())?.note, '')}</Box>

      {!unnamed && (
        <>
          {list(t('builder.variableSetIn'), writes, t('builder.variableNeverSet'))}
          {list(t('builder.variableReadIn'), reads, t('builder.variableNeverRead'))}
          {/* Порядок исполнения — не порядок файла: фаза идёт первой, и
              прочитанное до первой записи всегда пусто. */}
          {early && <Box sx={{ mt: 0.5 }}>{t('builder.variableEarlyRead')}</Box>}
          {homeless && <Box sx={{ mt: 0.5 }}>{t('builder.variableNoStorage')}</Box>}
        </>
      )}
    </Box>
  );

  return (
    <Tooltip title={<Stack>{title}</Stack>} placement="top-end">
      <IconButton
        size="small"
        aria-label={t('builder.variableInfo')}
        color={unread || homeless ? 'warning' : 'default'}
      >
        <InfoOutlinedIcon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
