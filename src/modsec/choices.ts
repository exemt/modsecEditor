/**
 * Готовые списки выбора: преобразования и операторы.
 *
 * И то и другое человек выбирает по одному и тому же набору вопросов: как
 * это пишется в правиле, что оно делает, часто ли так пишут и подходит ли
 * оно к тому, что проверяется прямо здесь. `semantics.ts` знает ответы по
 * отдельности, `suggestions.ts` — что обычно ставят на этой области
 * проверки; здесь ответы сводятся в одну строку списка.
 *
 * Порядок в списке — это и есть подсказка. Сначала то, что уместно именно
 * тут, потом остальное применимое по разделам, и только в конце то, что к
 * текущему значению не подходит: такие варианты не прячутся совсем, потому
 * что запрет надо объяснить, а не сделать вид, что варианта не существует.
 *
 * Модуль не зависит от React: подписи двуязычные, переводит их UI.
 */

import {
  DISRUPTIVE_ACTIONS,
  OPERATOR_NAMES,
  PHASE_NAMES,
  SEVERITY_NAMES,
  TRANSFORM_NAMES,
  disruptiveMeta,
  logFlagMeta,
  operatorMeta,
  phaseMeta,
  severityMeta,
  transformMeta,
} from './semantics';
import type { ActionMeta, Label, ValueKind } from './semantics';

/** Один вариант списка со всем, что о нём нужно знать при выборе. */
export interface Choice {
  /** Имя как оно пишется в правиле: `urlDecode`, `rx`. */
  value: string;
  /** Человеческое название. */
  label: Label;
  /** Что оно делает и когда его ставят. */
  note: Label;
  /** Заголовок раздела, под которым вариант стоит в списке. */
  group: Label;
  /** Встречается постоянно — остаётся в списке и в кратком виде. */
  common: boolean;
  /** Уместен именно на этой области проверки. */
  recommended: boolean;
  /** Почему вариант не подходит к текущему значению; `null` — подходит. */
  unfit: Label | null;
}

const RECOMMENDED_GROUP: Label = {
  en: 'Fits this check',
  ru: 'Подходит этой проверке',
};

const UNFIT_GROUP: Label = {
  en: 'Does not fit the value',
  ru: 'Не подходит к значению',
};

const UNKNOWN_GROUP: Label = {
  en: 'Not from the list',
  ru: 'Не из списка',
};

/**
 * Почему вариант не подходит — по тому, что в руках на этом шаге.
 *
 * Причина всегда в типе значения, и назвать её важнее, чем скрыть вариант:
 * «t:lowercase недоступно» без объяснения выглядит поломкой, а «здесь уже
 * число» сразу показывает, что дело в `&` или в `t:length` выше.
 */
const UNFIT_REASON: Record<ValueKind, Label> = {
  string: {
    en: 'Does not apply to a text value',
    ru: 'К текстовому значению не применяется',
  },
  number: {
    en: 'The value here is already a number',
    ru: 'Здесь в руках уже число, а не текст',
  },
  binary: {
    en: 'The value here is raw bytes',
    ru: 'Здесь в руках сырые байты, а не текст',
  },
};

const UNKNOWN_NOTE: Label = {
  en: 'Not in the built-in list — check the spelling',
  ru: 'Во встроенном списке такого нет — проверьте написание',
};

/**
 * Вариант для имени, которого база знаний не знает.
 *
 * Правило могло прийти из чужого набора или из более новой версии
 * ModSecurity. Подменять такое имя знакомым нельзя, потерять — тем более,
 * поэтому оно встаёт в список отдельной строкой с пометкой.
 */
function unknownChoice(value: string): Choice {
  return {
    value,
    label: { en: value, ru: value },
    note: UNKNOWN_NOTE,
    group: UNKNOWN_GROUP,
    common: true,
    recommended: false,
    unfit: null,
  };
}

/**
 * Раскладывает варианты по трём полкам: уместные здесь, остальные годные,
 * негодные. Внутри средней полки порядок остаётся объявленным в базе
 * знаний, поэтому разделы не разрываются и `groupBy` в списке работает.
 */
function shelve(choices: Choice[]): Choice[] {
  return [
    ...choices
      .filter((choice) => choice.unfit === null && choice.recommended)
      .map((choice) => ({ ...choice, group: RECOMMENDED_GROUP })),
    ...choices.filter((choice) => choice.unfit === null && !choice.recommended),
    ...choices
      .filter((choice) => choice.unfit !== null)
      .map((choice) => ({ ...choice, group: UNFIT_GROUP })),
  ];
}

/**
 * Преобразования для шага конвейера, на вход которого приходит `kind`.
 *
 * Тип входа именно шага, а не всего условия: `t:lowercase` после `t:length`
 * бессмысленно ровно так же, как над `&ARGS`, и список обязан это показать.
 */
export function transformChoices(
  kind: ValueKind,
  recommended: string[],
  current: string,
): Choice[] {
  const fit = new Set(recommended);

  const known = TRANSFORM_NAMES.map((value) => {
    const meta = transformMeta(value);
    if (meta === null) return unknownChoice(value);
    const applies = meta.accepts.includes(kind);
    return {
      value,
      label: meta.label,
      note: meta.note,
      group: meta.group,
      common: meta.common,
      recommended: applies && fit.has(value),
      unfit: applies ? null : UNFIT_REASON[kind],
    };
  });

  return withCurrent(shelve(known), current, transformMeta(current) !== null);
}

/**
 * Операторы для значения типа `kind`.
 *
 * Негодные не выбрасываются: компилятор всё равно предупредит о них
 * отдельно, а список, из которого оператор просто исчез, читается как
 * ошибка конструктора.
 */
export function operatorChoices(
  kind: ValueKind,
  recommended: string[],
  current: string,
): Choice[] {
  const fit = new Set(recommended);

  const known = OPERATOR_NAMES.map((value) => {
    const meta = operatorMeta(value);
    if (meta === null) return unknownChoice(value);
    const applies = meta.inputs.includes(kind);
    return {
      value,
      label: meta.label,
      note: meta.note,
      group: meta.group,
      common: meta.common,
      recommended: applies && fit.has(value),
      unfit: applies ? null : UNFIT_REASON[kind],
    };
  });

  return withCurrent(shelve(known), current, operatorMeta(current) !== null);
}

/**
 * Список действий правила: реакция, фаза, критичность, запись в журнал.
 *
 * От операторов и преобразований они отличаются тем, что относятся к правилу
 * целиком, а не к значению на текущем шаге. Значит, делить варианты на годные
 * и негодные здесь не по чему: подходит любой, и полок, отбора по типу входа
 * и краткого вида нет. Разделы и порядок заданы базой знаний, а список только
 * доносит пояснения.
 */
function actionChoices(
  names: readonly string[],
  meta: (name: string) => ActionMeta | null,
  current: string,
): Choice[] {
  const known: Choice[] = names.map((value) => {
    const info = meta(value);
    if (info === null) return unknownChoice(value);
    return {
      value,
      label: info.label,
      note: info.note,
      group: info.group,
      common: true,
      recommended: false,
      unfit: null,
    };
  });

  return withCurrent(known, current, meta(current) !== null);
}

/** Реакции: что правило делает, когда все условия совпали. */
export function disruptiveChoices(current: string): Choice[] {
  return actionChoices(DISRUPTIVE_ACTIONS, disruptiveMeta, current);
}

/** Фазы: когда правило выполняется и что к этому моменту заполнено. */
export function phaseChoices(current: string): Choice[] {
  return actionChoices(PHASE_NAMES, phaseMeta, current);
}

/** Уровни критичности срабатывания. */
export function severityChoices(current: string): Choice[] {
  return actionChoices(SEVERITY_NAMES, severityMeta, current);
}

/**
 * Запись в журнал — пара «писать / не писать» для одного из двух журналов.
 *
 * Пары разведены по вызовам, а не сведены в один список: поле спрашивает
 * про свой журнал, и `auditlog` рядом с `nolog` предлагал бы выбрать
 * что-то одно из четырёх там, где выбор всего из двух.
 */
export function logFlagChoices(flags: readonly string[], current: string): Choice[] {
  return actionChoices(flags, logFlagMeta, current);
}

/** Дописывает выбранное значение, если базе знаний оно незнакомо. */
function withCurrent(choices: Choice[], current: string, known: boolean): Choice[] {
  if (current === '' || known) return choices;
  return [...choices, unknownChoice(current)];
}
