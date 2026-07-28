import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import { SeverityIcon } from '../diagnostics/DiagnosticLine';
import type { Diagnostic } from '../../modsec/diagnostics';

interface CounterProps {
  /**
   * Что посчитано — словами и вместе с самим числом.
   *
   * Число входит в текст, потому что подсказка служит чипу ещё и именем для
   * чтения с экрана: «Замечаний об этих условиях» без числа — не счётчик.
   */
  hint: string;
  count: number;
  /**
   * Худший уровень среди посчитанного — тогда счётчик про замечания, а не
   * про содержимое блока.
   */
  severity?: Diagnostic['severity'];
}

/**
 * Счётчик у правого края полосы блока.
 *
 * Голое число там читается как загадка, а у «Условий» их два подряд: чипы «1»
 * и «1» выглядят одинаково, но говорят о разном — сколько в цепочке звеньев и
 * сколько о них сказано. Разводит их две вещи. Подсказка называет счёт словами;
 * замечания вдобавок носят значок своего уровня — тот же, что стоит у самого
 * сообщения. Значок отличает счётчики до наведения: навести можно только на то,
 * о чём уже возник вопрос, а вопрос возникает не всегда.
 */
export function Counter({ hint, count, severity }: CounterProps) {
  return (
    <Tooltip title={hint}>
      <Chip
        size="small"
        variant="outlined"
        color={severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'default'}
        icon={severity === undefined ? undefined : <SeverityIcon severity={severity} />}
        label={count}
      />
    </Tooltip>
  );
}
