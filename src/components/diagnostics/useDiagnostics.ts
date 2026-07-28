import { useRule } from '../../context/ruleContext';
import type { Diagnostic } from '../../modsec/diagnostics';

const NONE: Diagnostic[] = [];

/**
 * Все сообщения одного правила — и о его звеньях, и о его действиях.
 *
 * Карточка правила берёт список один раз и раздаёт по местам сама: так
 * каждое поле не перебирает диагностику всего файла заново. По той же причине
 * раскладка по правилам считается разом при разборе документа, а не каждой
 * карточкой отдельно.
 */
export function useRuleDiagnostics(ruleKey: string): Diagnostic[] {
  const { analysis } = useRule();
  return analysis.byRule.get(ruleKey) ?? NONE;
}

/**
 * Сообщения о звене цепочки с указанным номером (0-based).
 *
 * У правила без цепочки номер звена в адресе не проставлен — «условие 1»
 * там было бы лишним уточнением, — поэтому отсутствие номера читается
 * как первое звено.
 */
export function conditionDiagnostics(all: Diagnostic[], position: number): Diagnostic[] {
  return all.filter((d) => {
    const slot = d.anchor?.slot;
    if (slot === undefined || slot === 'actions') return false;
    return (d.anchor?.condition ?? 1) - 1 === position;
  });
}

/** Сообщения о правиле целиком: реакция, логи, согласованность звеньев. */
export function ruleLevelDiagnostics(all: Diagnostic[]): Diagnostic[] {
  return all.filter((d) => {
    const slot = d.anchor?.slot;
    return slot === undefined || slot === 'actions';
  });
}

/**
 * Худший уровень среди сообщений.
 *
 * По нему свёрнутый блок красит свой счётчик и выбирает значок: набор из
 * ошибки и двух советов — это ошибка, и полоса обязана сказать об этом, не
 * дожидаясь, пока её раскроют. Пустой набор — совет: счётчик нуля не рисуют.
 */
export function worstSeverity(all: Diagnostic[]): Diagnostic['severity'] {
  if (all.some((d) => d.severity === 'error')) return 'error';
  if (all.some((d) => d.severity === 'warning')) return 'warning';
  return 'advice';
}
