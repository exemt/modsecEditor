import { useMemo } from 'react';
import { useRule } from '../../context/ruleContext';
import type { Diagnostic } from '../../modsec/diagnostics';
import type { ExclusionEntry, RuleEffect } from '../../modsec/exclusions';

const NONE: Diagnostic[] = [];
const NO_EXCLUSIONS: ExclusionEntry[] = [];

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
 * Что исключения файла сделали с правилом: сняли, поправили цели, действия.
 *
 * Берётся из компиляции, а не из смыслового прохода, и не замечанием, а
 * фактом. Замечание отвечает на вопрос «похоже ли это на ошибку», а снятое
 * правило — не ошибка: его сняли нарочно. Спросить об этом карточка должна
 * тогда же, когда рисует номер правила, иначе на большом файле отметка
 * появлялась бы через паузу после самой карточки.
 */
export function useRuleEffect(ruleKey: string): RuleEffect | undefined {
  const { compiled } = useRule();
  return compiled.exclusions.byRule.get(ruleKey);
}

/**
 * Исключения, написанные внутри самого блока: действия `ctl`.
 *
 * Обратная сторона {@link useRuleEffect}: там правило — жертва исключения,
 * здесь — его носитель. Спрашивается это диапазоном утверждений, а не ключом
 * блока, потому что у цепочки `ctl` может стоять в любом звене, и снять
 * правило от этого он не перестаёт.
 */
export function useRuleExclusions(from: number, to: number): ExclusionEntry[] {
  const { compiled } = useRule();
  const { byStatement } = compiled.exclusions;

  return useMemo(() => {
    if (byStatement.size === 0) return NO_EXCLUSIONS;

    const written: ExclusionEntry[] = [];
    for (let index = from; index <= to; index++) {
      const here = byStatement.get(index);
      if (here !== undefined) written.push(...here);
    }
    return written.length === 0 ? NO_EXCLUSIONS : written;
  }, [byStatement, from, to]);
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
