/**
 * Поток значения: от областей проверки через конвейер к оператору.
 *
 * Проверки здесь не разбирают правило сами — они читают готовый
 * {@link Pipeline}: тип значения на входе и выходе каждого шага уже
 * посчитан в `analyze.ts`. Поэтому каждая из них — это вопрос к типу, а
 * не перебор известных сочетаний имён: `t:trim` после `t:removeWhitespace`
 * бесполезен не потому, что эта пара где-то записана, а потому, что во
 * входе шага уже нет пробелов.
 */

import { operatorSpec } from '../../catalog';
import { Fact, hasFact, kindFits } from '../../value';
import { REFUSED } from '../codes';
import type { OperatorNode } from '../../ast';
import type { ConditionInfo, Pipeline, PipelineStep } from '../../analyze';
import type { OperatorSpec, TransformSpec } from '../../catalog';
import type { ValueKind } from '../../value';
import type { Check, CheckContext, Range } from '../engine';

/** Обрезает значение до длины, на которой сообщение ещё читается. */
function short(value: string, limit = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

const KIND_LABEL: Record<ValueKind, string> = {
  string: 'text',
  number: 'a number',
  binary: 'raw bytes',
  any: 'unknown',
};

function acceptsLabel(spec: TransformSpec): string {
  return spec.accepts.includes('binary') ? 'text or bytes' : 'text';
}

/**
 * Шаг, после которого свойство стало верным.
 *
 * Нужен сообщению: сказать «значение в нижнем регистре» мало, полезно
 * назвать, что его таким сделало. `null` — свойство пришло от самих
 * областей проверки, а не от конвейера.
 */
function establishedBy(
  pipeline: Pipeline,
  fact: number,
  before = pipeline.steps.length,
): PipelineStep | null {
  const { steps, activeFrom } = pipeline;
  for (let i = before - 1; i >= activeFrom; i--) {
    const step = steps[i];
    if ((step.output.facts & fact) === fact && (step.input.facts & fact) !== fact) return step;
  }
  return null;
}

/**
 * Преобразования, сворачивающие уже раскрытый текст.
 *
 * Именно они страдают от неправильного порядка: свернуть `..%2f` в путь
 * нельзя, пока `%2f` не стал косой чертой.
 */
function isNormaliser(spec: TransformSpec): boolean {
  if (spec.group === 'path') return true;
  return spec.group === 'sanitize' && spec.produces === 'string';
}

function isMatchedValue(name: string): boolean {
  const upper = name.toUpperCase();
  return upper === 'MATCHED_VAR' || upper === 'MATCHED_VARS';
}

function isMatchedName(name: string): boolean {
  const upper = name.toUpperCase();
  return upper === 'MATCHED_VAR_NAME' || upper === 'MATCHED_VARS_NAMES';
}

/**
 * Читает ли правило то, что прошло через конвейер этого условия.
 *
 * Значение после преобразований попадает в `MATCHED_VAR`, и взять его
 * оттуда могут действия самого условия и всё, что стоит в цепочке ниже.
 */
export function readsMatchedValue(condition: ConditionInfo): boolean {
  return readsMatched(condition, isMatchedValue);
}

/**
 * Берёт ли правило у этого условия хоть что-то — значение или имя того,
 * что совпало.
 *
 * `SecRule TX:/^err_/ ".*" "setvar:tx.last=%{matched_var_name}"` ничего не
 * отсеивает и не должно: шаблон здесь перебирает переменные, а нужно от
 * каждой только имя.
 */
export function readsMatch(condition: ConditionInfo): boolean {
  return readsMatched(condition, (name) => isMatchedValue(name) || isMatchedName(name));
}

function readsMatched(condition: ConditionInfo, wanted: (name: string) => boolean): boolean {
  const links = condition.rule.conditions;
  for (let i = condition.index; i < links.length; i++) {
    const { node } = links[i];
    if (node.actions !== null) {
      for (const action of node.actions.items) {
        if (action.value?.macros.some((macro) => wanted(macro.name))) return true;
      }
    }
    if (i === condition.index) continue;
    if (node.variables?.items.some((variable) => wanted(variable.name))) return true;
    if (node.operator?.argument.macros.some((macro) => wanted(macro.name))) return true;
  }
  return false;
}

/** Конвейер: годится ли каждый шаг к тому, что до него дошло. */
export const pipeline: Check = {
  name: 'pipeline',
  create({ report }) {
    return {
      condition(condition) {
        const { steps, activeFrom } = condition.pipeline;
        // Оператор на значение не смотрит, но его может прочитать само
        // правило: `t:sha1,t:hexEncode` перед `%{MATCHED_VAR}` — известный
        // приём, и конвейер в нём работает в полную силу.
        const blind =
          condition.operator !== null &&
          condition.operator.blind &&
          !readsMatchedValue(condition);

        let own = 0;
        let sinceReset = 0;
        let said = false;
        let lower = false;
        let upper = false;
        let caseSaid = false;
        let normaliser: PipelineStep | null = null;
        let decodeSaid = false;

        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          const { spec, node } = step;
          const position = step.inherited ? -1 : own++;

          if (step.status === 'reset') {
            // Сброс посреди собственного списка отменяет то, что автор
            // только что написал перед ним. Если отменять нечего, это просто
            // второй сброс подряд.
            if (position > 0) {
              if (sinceReset > 0) report('transformNoneNotFirst', node);
              else report('duplicateTransform', node, { name: 'none' });
            }
            sinceReset = 0;
            continue;
          }
          if (!step.inherited) sinceReset++;
          // Шаги до последнего сброса не исполняются: говорить о них нечего.
          if (i < activeFrom || spec === null) continue;

          const name = spec.name;
          // Base64 различает регистр: приведённое к одному регистру значение
          // раскодируется в мусор, и оператору достанется он.
          if ((lower || upper) && /^base64decode/i.test(name) && !step.inherited) {
            report('caseBeforeBase64', node, {
              decode: name,
              change: lower ? 'lowercase' : 'uppercase',
            });
          }
          if (name === 'lowercase') lower = true;
          if (name === 'uppercase') upper = true;
          const firstNormaliser = normaliser;
          if (normaliser === null && isNormaliser(spec)) normaliser = step;

          if (step.inherited) continue;

          // Количество и оператор, не глядящий на значение, отменяют смысл
          // всего конвейера сразу; разбирать шаги по одному уже незачем.
          if (condition.counting) {
            if (!said) report('countWithTransforms', node);
            said = true;
            continue;
          }
          if (blind) {
            if (!said && condition.operator !== null) {
              report('transformsWithoutCheck', node, { name: condition.operator.name });
            }
            said = true;
            continue;
          }

          if (step.status === 'mismatch') {
            report('transformInputMismatch', node, {
              name,
              expected: acceptsLabel(spec),
              actual: KIND_LABEL[step.input.kind],
            });
            continue;
          }

          if (step.status === 'idle') {
            const previous = establishedBy(condition.pipeline, spec.idleWhen, i);
            if (previous !== null && previous.spec !== null) {
              if (previous.spec.name === name) report('duplicateTransform', node, { name });
              else report('redundantTransform', node, { name, previous: previous.spec.name });
            }
            continue;
          }

          if (lower && upper && !caseSaid && spec.group === 'case') {
            report('conflictingCaseTransforms', node);
            caseSaid = true;
          }

          if (spec.group === 'decode' && firstNormaliser?.spec && !decodeSaid) {
            report('decodeAfterNormalise', node, {
              decode: name,
              normalise: firstNormaliser.spec.name,
            });
            decodeSaid = true;
          }
        }
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Оператор                                                            */
/* ------------------------------------------------------------------ */

function isNumeric(value: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(value);
}

/**
 * Текст, который шаблон ищет буквально.
 *
 * Из регулярного выражения вычёркивается всё, что символом самого себя не
 * является: экранированные последовательности, классы, префиксы групп и
 * метасимволы. Остаётся то, что должно встретиться во входе как есть, —
 * только по нему можно судить, переживёт ли шаблон приведение регистра.
 */
function regexLiteral(pattern: string): string {
  return pattern
    .replace(/\\[pP]\{[^}]*\}/g, ' ')
    .replace(/\\./g, ' ')
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\(\?[a-zA-Z:=!<>#-]*\)?/g, ' ')
    .replace(/[*+?{}()|^$.]/g, ' ');
}

/** Где показывать замечание об операторе: на имени, а у неявного — на всём. */
function operatorRange(node: OperatorNode): Range {
  return node.implicit ? node : { start: node.nameStart, end: node.nameEnd };
}

function checkArgument(
  node: OperatorNode,
  spec: OperatorSpec,
  report: CheckContext['report'],
): void {
  const value = node.argument.value.trim();
  const name = { name: spec.name };

  if (spec.arg === 'none') {
    if (value !== '') report('operatorArgumentUnexpected', node.argument, name);
    return;
  }
  if (value === '') {
    // Пустые кавычки не грузят вторая и третья версии; имя без аргумента —
    // третья и Coraza, но пустой шаблон `@rx` Coraza ещё принимает.
    const refused = node.implicit
      ? REFUSED.V2_V3
      : spec.name === 'rx'
        ? REFUSED.V3
        : REFUSED.V3_CORAZA;
    report('operatorArgumentRequired', operatorRange(node), name, refused);
    return;
  }
  if (spec.arg === 'number' && node.argument.macros.length === 0 && !isNumeric(value)) {
    report('nonNumericArgument', node.argument, name);
  }
}

/** Оператор: годится ли он к типу значения и может ли сравнение совпасть. */
export const operators: Check = {
  name: 'operators',
  create({ report }) {
    return {
      Operator(node) {
        const spec = operatorSpec(node.name);
        if (spec !== null) checkArgument(node, spec, report);

        // Имя оператора движок ищет сразу за кавычкой (и за `!`). Пробел
        // перед `@` или второй `!` — и всё написанное становится шаблоном
        // для `@rx`, без единого слова об этом.
        if (node.implicit) {
          const value = node.argument.value;
          const name = /^\s*!*\s*@([A-Za-z0-9]+)/.exec(value);
          if (name !== null && operatorSpec(name[1]) !== null) {
            // Со вторым `!` третья версия правило не грузит вовсе.
            const refused = /^\s*!/.test(value) ? REFUSED.V3 : REFUSED.NONE;
            report('operatorReadAsPattern', node.argument, { value: short(value) }, refused);
          }
        }
      },

      condition(condition) {
        const node = condition.node.operator;
        const spec = condition.operator;
        if (node === null || spec === null) return;

        // Не конец конвейера, а то, что оператор увидит: с `multiMatch`
        // это ещё и все промежуточные значения.
        const output = condition.pipeline.seen;
        const at = operatorRange(node);

        if (!kindFits(output.kind, spec.input)) {
          report('operatorInputMismatch', at, { name: spec.name });
          return;
        }
        if (spec.blind) return;

        // Сырой хеш с текстом не сравнить, каким бы оператор ни был.
        if (hasFact(output, Fact.Digest)) {
          const by = establishedBy(condition.pipeline, Fact.Digest);
          report('hashWithoutHexEncode', at, { name: by?.spec?.name ?? 'md5' });
          return;
        }

        // Дальше — может ли аргумент вообще встретиться во входе. О макросе
        // судить нельзя: что в нём окажется, станет известно только на запросе.
        const argument = node.argument.value;
        if (argument.trim() === '' || node.argument.macros.length > 0) return;

        // Число — это ещё и текст, и `RESPONSE_STATUS "@rx ^5\d\d$"` осмыслен.
        // Но букв в числе не бывает: `&ARGS "@contains admin"` формально
        // сравнивает текст с текстом, а совпасть не может ни при каком входе.
        if (hasFact(output, Fact.Numeric)) {
          const sought =
            spec.literal || spec.arg === 'phrases'
              ? argument
              : spec.name === 'rx'
                ? regexLiteral(argument)
                : '';
          if (/[A-Za-z]/.test(sought)) report('operatorInputMismatch', at, { name: spec.name });
          return;
        }

        let literal: string | null = null;
        if (spec.literal) literal = argument;
        else if (spec.name === 'rx' && argument.indexOf('(?i') === -1) {
          literal = regexLiteral(argument);
        }

        if (literal !== null) {
          const folded =
            hasFact(output, Fact.Lower) && /[A-Z]/.test(literal)
              ? Fact.Lower
              : hasFact(output, Fact.Upper) && /[a-z]/.test(literal)
                ? Fact.Upper
                : 0;
          if (folded !== 0) {
            const by = establishedBy(condition.pipeline, folded);
            if (by?.spec) {
              report('caseNeverMatches', node.argument, {
                name: by.spec.name,
                value: short(argument),
              });
              return;
            }
          }
        }

        // Пробелы судят только по буквальному сравнению: в шаблоне пробел
        // может стоять внутри класса или необязательной группы.
        if (!spec.literal) return;

        let spaced = 0;
        if (hasFact(output, Fact.NoSpace) && /\s/.test(argument)) spaced = Fact.NoSpace;
        else if (hasFact(output, Fact.Squeezed) && /\s\s|[\t\n\r\f\v]/.test(argument)) {
          spaced = Fact.Squeezed;
        } else {
          const whole = spec.name === 'streq';
          const fromStart = whole || spec.name === 'beginsWith';
          const fromEnd = whole || spec.name === 'endsWith';
          if (fromStart && hasFact(output, Fact.TrimLeft) && /^\s/.test(argument)) {
            spaced = Fact.TrimLeft;
          } else if (fromEnd && hasFact(output, Fact.TrimRight) && /\s$/.test(argument)) {
            spaced = Fact.TrimRight;
          }
        }
        if (spaced !== 0) {
          const by = establishedBy(condition.pipeline, spaced);
          if (by?.spec) {
            report('whitespaceNeverMatches', node.argument, {
              name: by.spec.name,
              value: short(argument),
            });
          }
        }
      },
    };
  },
};
