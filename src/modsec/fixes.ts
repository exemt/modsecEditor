/**
 * Быстрые правки к диагностикам.
 *
 * Половина замечаний описывает механическую ошибку: шаг конвейера записан
 * дважды, `@rx` взят там, где хватило бы `@contains`, аргумент написан не в
 * том регистре. Читать такое сообщение и руками повторять то, что в нём и так
 * сказано, — работа, которую редактор должен делать сам.
 *
 * Правок два рода, и различаются они тем, что нужно, чтобы их сделать.
 *
 * **Правка текста** — исправление ядра (`src/seclang`). Оно выводится из
 * замечания и дерева и переписывает ровно то место, о котором сказано: убрать
 * повтор, вставить потерянную запятую, стереть пробел после переноса. Смысла
 * правила такая правка не меняет, форматирования вокруг не трогает и модели
 * конструктора не требует — поэтому работает и там, где конструктор закрыт
 * ошибкой: её-то она обычно и чинит.
 *
 * **Правка модели** — то, чего ядро не делает нарочно: оно чинит только
 * запись, а здесь меняется то, что правило проверяет. Привести аргумент к
 * нижнему регистру, дописать `t:hexEncode`, подставить фазу — на это нужен
 * выбор человека, и кнопка — его способ этот выбор сделать. Описана такая
 * правка как преобразование модели правила: дописать в правило новую часть
 * умеет сборка текста из модели, а не точечная замена в исходнике.
 *
 * Правки здесь только однозначные. Там, где вариантов несколько — какую из
 * двух несовместимых проверок цепочки убрать, чем заменить `deny` — кнопки
 * нет: угадывать намерение автора правила дороже, чем не угадывать.
 */

import { applyFixes, fixFor, operatorSpec } from '../seclang';
import { targetsMinPhase } from './semantics';
import type { DiagnosticCode as CoreCode, FileNode } from '../seclang';
import type { Diagnostic } from './diagnostics';
import type { VisualCondition, VisualRule } from './model';

/**
 * Что именно сделает кнопка. Ключ перевода — `fix.<kind>`.
 *
 * Вид правки не совпадает с кодом диагностики: разные замечания чинятся
 * одинаково («заменить на @contains» годится и шаблону без спецсимволов,
 * и списку из одной фразы), и подпись у кнопки должна быть одна.
 */
export type FixKind =
  | 'lowercaseValue'
  | 'uppercaseValue'
  | 'useContains'
  | 'useStreq'
  | 'dropLeadingWildcard'
  | 'escapeDots'
  | 'moveNoneFirst'
  | 'removeTransform'
  | 'removeAction'
  | 'reorderPipeline'
  | 'clearTransforms'
  | 'addHexEncode'
  | 'addNormalisation'
  | 'removeTarget'
  | 'usePatternSelector'
  | 'setPhase'
  | 'clearStatus'
  | 'restoreLog'
  | 'enableCapture'
  | 'disableCapture'
  | 'joinContinuation'
  | 'endComment'
  | 'macroDot'
  | 'trimOperator'
  | 'insertComma';

interface FixLabel {
  kind: FixKind;
  /** Подстановки в подпись кнопки. */
  params?: Record<string, string>;
}

/** Правка текста: новый исходник файла целиком. */
export interface TextFix extends FixLabel {
  via: 'text';
  /**
   * Текст файла после правки.
   *
   * Считается по нажатию, а не заранее: кнопок на экране сотни, и собирать
   * ради каждой новый текст файла, который почти никогда не понадобится,
   * незачем.
   */
  apply: () => string;
}

/** Правка модели: правило, которое соберётся в текст обычным путём. */
export interface ModelFix extends FixLabel {
  via: 'model';
  apply: (rule: VisualRule) => VisualRule;
}

export type QuickFix = TextFix | ModelFix;

/* ------------------------------------------------------------------ */
/* Правки текста: исправления ядра                                     */
/* ------------------------------------------------------------------ */

/**
 * Подпись кнопки для каждого исправления ядра.
 *
 * У ядра подпись своя, английская (`Fix.title`), — для тех, у кого перевода
 * нет. Здесь она заменена ключом перевода редактора. Таблица полная: тест
 * сверяет её со списком кодов, которые ядро умеет чинить, и новое
 * исправление без подписи не пройдёт.
 */
export const TEXT_FIX_KINDS: Partial<Record<CoreCode, FixKind>> = {
  continuationSpace: 'joinContinuation',
  commentSwallowsLine: 'endComment',
  duplicateTransform: 'removeTransform',
  redundantTransform: 'removeTransform',
  duplicateAction: 'removeAction',
  duplicateTarget: 'removeTarget',
  macroKeySeparator: 'macroDot',
  selectorNeedsQuotes: 'usePatternSelector',
  operatorReadAsPattern: 'trimOperator',
  textAfterQuote: 'insertComma',
  anchoredLiteralRegex: 'useStreq',
  regexIsPlainText: 'useContains',
  redundantLeadingWildcard: 'dropLeadingWildcard',
};

/**
 * Исправление ядра для замечания — или `null`, если ядро его не чинит.
 *
 * Правится тот текст, по которому замечание найдено: границы замечания
 * считаются в нём, и применить их к другому значило бы резать не там.
 */
function textFixFor(diagnostic: Diagnostic, tree: FileNode): TextFix | null {
  const { range } = diagnostic;
  const kind = TEXT_FIX_KINDS[diagnostic.code as CoreCode];
  if (range === undefined || kind === undefined) return null;

  const fix = fixFor(tree, {
    code: diagnostic.code as CoreCode,
    start: range.start,
    end: range.end,
    data: diagnostic.params,
  });
  if (fix === null || fix.edits.length === 0) return null;

  const name = diagnostic.params?.name;
  return {
    via: 'text',
    kind,
    params: name === undefined ? undefined : { name },
    apply: () => applyFixes(tree.source, [fix]).source,
  };
}

/* ------------------------------------------------------------------ */
/* Правки модели: точечные изменения                                   */
/* ------------------------------------------------------------------ */

/** Номер звена, к которому относится диагностика (0-based). */
function conditionIndex(diagnostic: Diagnostic): number {
  return (diagnostic.anchor?.condition ?? 1) - 1;
}

/** Меняет одно звено цепочки, оставляя остальное правило нетронутым. */
function editCondition(
  rule: VisualRule,
  index: number,
  edit: (condition: VisualCondition) => VisualCondition,
): VisualRule {
  const conditions = rule.conditions.map((c, i) => (i === index ? edit(c) : c));
  return { ...rule, conditions };
}

/** Правка звена: переписывает оператор. */
function editOperator(
  diagnostic: Diagnostic,
  edit: (operator: VisualCondition['operator']) => Partial<VisualCondition['operator']>,
) {
  return (rule: VisualRule) =>
    editCondition(rule, conditionIndex(diagnostic), (condition) => ({
      ...condition,
      operator: { ...condition.operator, ...edit(condition.operator) },
    }));
}

/** Правка звена: переписывает конвейер преобразований. */
function editTransforms(diagnostic: Diagnostic, edit: (transforms: string[]) => string[]) {
  return (rule: VisualRule) =>
    editCondition(rule, conditionIndex(diagnostic), (condition) => ({
      ...condition,
      transforms: edit(condition.transforms),
    }));
}

/**
 * Включает или выключает `capture` у звена с этим номером.
 *
 * `capture` действует только на оператор того условия, в котором записан,
 * поэтому поставить его «правилу» нельзя — только звену. У головы он лежит
 * среди действий правила, у остальных звеньев — среди их собственных.
 */
function withCapture(rule: VisualRule, index: number, on: boolean): VisualRule {
  if (index <= 0) return { ...rule, actions: { ...rule.actions, capture: on } };
  return editCondition(rule, index, (condition) => {
    const rest = condition.extra.filter((action) => action.name.toLowerCase() !== 'capture');
    return {
      ...condition,
      extra: on ? [...rest, { raw: '', name: 'capture', quoted: false }] : rest,
    };
  });
}

/** Правка действий правила. */
function editActions(edit: (rule: VisualRule) => Partial<VisualRule['actions']>) {
  return (rule: VisualRule): VisualRule => ({
    ...rule,
    actions: { ...rule.actions, ...edit(rule) },
  });
}

/** Переставляет шаг конвейера так, чтобы он оказался перед другим. */
function moveBefore(transforms: string[], moved: string, anchor: string): string[] {
  const without = transforms.filter((name) => name !== moved);
  const at = without.indexOf(anchor);
  if (at === -1) return transforms;
  return [...without.slice(0, at), moved, ...without.slice(at)];
}

/** Добавляет шаги в начало конвейера, не трогая ведущий `t:none`. */
function prependTransforms(transforms: string[], added: string[]): string[] {
  const head = transforms[0] === 'none' ? ['none'] : [];
  const rest = transforms.slice(head.length).filter((name) => !added.includes(name));
  return [...head, ...added, ...rest];
}

/**
 * Приводит аргумент оператора к одному регистру.
 *
 * У буквального сравнения меняется весь текст. В шаблоне так нельзя: `\D` и
 * `\d` — разные классы, и приведённый к нижнему регистру шаблон искал бы не
 * то. Экранированные пары поэтому остаются как написаны, а меняется только
 * то, что между ними.
 */
function foldCase(operator: VisualCondition['operator'], upper: boolean): string {
  const fold = (text: string) => (upper ? text.toUpperCase() : text.toLowerCase());
  if (operatorSpec(operator.name)?.arg !== 'regex') return fold(operator.argument);
  return operator.argument.replace(/\\[\s\S]|[^\\]+/g, (part) =>
    part.startsWith('\\') ? part : fold(part),
  );
}

/* ------------------------------------------------------------------ */
/* Каталог правок модели                                               */
/* ------------------------------------------------------------------ */

function modelFixFor(diagnostic: Diagnostic): ModelFix | null {
  const params = diagnostic.params ?? {};
  const fix = (
    kind: FixKind,
    apply: ModelFix['apply'],
    labelParams?: Record<string, string>,
  ): ModelFix => ({ via: 'model', kind, params: labelParams, apply });

  switch (diagnostic.code) {
    case 'caseNeverMatches': {
      const toUpper = params.name === 'uppercase';
      return fix(
        toUpper ? 'uppercaseValue' : 'lowercaseValue',
        editOperator(diagnostic, (operator) => ({ argument: foldCase(operator, toUpper) })),
      );
    }

    case 'singlePhraseList':
      return fix(
        'useContains',
        editOperator(diagnostic, () => ({ name: 'contains' })),
      );

    // Замечание выдаётся только шаблону, в котором кроме точек нет ничего
    // особенного: каждая из них и есть та самая «любой символ вместо точки».
    case 'unescapedDot':
      return fix(
        'escapeDots',
        editOperator(diagnostic, (operator) => ({
          argument: operator.argument.replace(/\./g, '\\.'),
        })),
      );

    case 'transformNoneNotFirst':
      return fix(
        'moveNoneFirst',
        editTransforms(diagnostic, (transforms) => [
          'none',
          ...transforms.filter((name) => name !== 'none'),
        ]),
      );

    case 'decodeAfterNormalise':
      return fix(
        'reorderPipeline',
        editTransforms(diagnostic, (transforms) =>
          moveBefore(transforms, params.decode, params.normalise),
        ),
      );

    case 'countWithTransforms':
      return fix(
        'clearTransforms',
        editTransforms(diagnostic, () => []),
      );

    case 'hashWithoutHexEncode':
      return fix(
        'addHexEncode',
        editTransforms(diagnostic, (transforms) => [...transforms, 'hexEncode']),
      );

    // Одной нормализации мало: если оставить аргумент как есть, `t:lowercase`
    // тут же сделает проверку невыполнимой. Правка чинит обе половины сразу.
    case 'noNormalisation':
      return fix('addNormalisation', (rule) =>
        editCondition(rule, conditionIndex(diagnostic), (condition) => ({
          ...condition,
          transforms: prependTransforms(condition.transforms, ['urlDecodeUni', 'lowercase']),
          operator: {
            ...condition.operator,
            argument: foldCase(condition.operator, false),
          },
        })),
      );

    case 'overlappingTargets':
      return fix(
        'removeTarget',
        (rule) =>
          editCondition(rule, conditionIndex(diagnostic), (condition) => ({
            ...condition,
            targets: condition.targets.filter(
              (target) => target.name !== params.inner || target.params.length > 0,
            ),
          })),
        { name: params.inner },
      );

    // Фазу не нужно угадывать: она однозначно следует из того, когда
    // заполняются области проверки.
    case 'missingPhase':
    case 'phaseTooEarly':
      return fix(
        'setPhase',
        editActions((rule) => ({
          phase: String(Math.max(...rule.conditions.map((c) => targetsMinPhase(c.targets)), 1)),
        })),
      );

    case 'statusWithoutBlock':
      return fix(
        'clearStatus',
        editActions(() => ({ status: '' })),
      );

    case 'blockWithoutLog':
    case 'logdataWithoutLog':
      return fix(
        'restoreLog',
        editActions(() => ({ log: null })),
      );

    // Замечание стоит там, где группу читают, а `capture` нужен там, где её
    // находят: номер этого звена ядро передаёт вместе с замечанием.
    case 'captureMissing':
      return fix('enableCapture', (rule) =>
        withCapture(rule, Number(params.condition ?? '1') - 1, true),
      );

    // Здесь замечание стоит на самом `capture` — в своём звене.
    case 'captureUnused':
    case 'captureWithoutRegex':
      return fix('disableCapture', (rule) => withCapture(rule, conditionIndex(diagnostic), false));

    default:
      return null;
  }
}

/**
 * Правка для диагностики или `null`, если однозначной правки нет.
 *
 * Сначала спрашивается ядро: его исправление точнее и не зависит от модели.
 * `tree` — дерево файла, по которому замечание найдено; без него остаются
 * только правки модели. Вызывающему остаётся записать результат: текст — в
 * файл, а для правки модели найти правило по `anchor.ruleKey` и применить
 * её — модель пересоберётся в текст обычным путём.
 */
export function quickFixFor(diagnostic: Diagnostic, tree: FileNode | null = null): QuickFix | null {
  const text = tree === null ? null : textFixFor(diagnostic, tree);
  return text ?? modelFixFor(diagnostic);
}
