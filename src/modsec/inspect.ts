/**
 * Смысловой проход по собранной модели.
 *
 * Отделён от компиляции по двум причинам. Первая — порядок: каждой проверке
 * здесь нужно то, чего в момент чтения очередной строки ещё нет, — контекст
 * всего файла, готовые условия правила и то, какие правила уже встречались
 * выше. Вторая — цена: проход стоит примерно как сама компиляция, но, в
 * отличие от неё, ни на что не влияет немедленно. Ошибок он не выдаёт вовсе,
 * поэтому ни доступность визуальной вкладки, ни модель конструктора его
 * результата не ждут — а значит, его можно вести по частям и в паузах.
 *
 * Отсюда две формы одного и того же: {@link inspectDocument} для тех, кому
 * нужен готовый список, и {@link inspectSlices} для того, кто отдаёт проходу
 * по несколько миллисекунд за раз. Вторая — источник, первая — вычерпывание
 * второй, так что разойтись им негде.
 */

import { isDisruptive } from './semantics';
import { Diagnostics } from './diagnostics';
import {
  checkCondition,
  checkDocument,
  checkExclusions,
  checkRule,
  conditionSignature,
  emptyDocumentContext,
} from './checks';
import { collectExclusions } from './exclusions';
import type { DocumentContext } from './checks';
import type { Diagnostic } from './diagnostics';
import type { ExclusionIndex } from './exclusions';
import type { VisualBlock } from './model';
import type { ParsedStatement } from './types';

/** Значение директивы-переключателя: `On` — да, `Off` — нет. */
function toggle(args: string[]): boolean | null {
  const value = args[0]?.toLowerCase();
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

/**
 * Собирает то, что о правилах известно только по остальному файлу.
 *
 * Проход дешёвый и делается до основного: проверкам нужны и метки ниже по
 * файлу, и директивы выше, поэтому откладывать сбор до места использования
 * нельзя.
 */
export function readDocumentContext(statements: ParsedStatement[]): DocumentContext {
  const context = emptyDocumentContext();

  for (const statement of statements) {
    if (statement.kind === 'SecMarker') {
      context.markers.add(statement.label);
      continue;
    }

    if (statement.kind === 'directive') {
      const name = statement.name.toLowerCase();
      if (name === 'secruleengine') {
        context.engine = statement.args[0] ?? '';
        context.engineLine = statement.span.startLine;
      }
      if (name === 'secrequestbodyaccess') {
        context.requestBodyAccess = toggle(statement.args);
      }
      if (name === 'secresponsebodyaccess') {
        context.responseBodyAccess = toggle(statement.args);
      }
      continue;
    }

    if (statement.kind !== 'SecRule' && statement.kind !== 'SecAction') continue;

    for (const action of statement.actions) {
      if (action.name === 'setvar') {
        const assigned = /^!?tx[.:]([\w-]+)/i.exec(action.value ?? '');
        if (assigned) context.transactionVars.add(assigned[1].toLowerCase());
      }
      if (action.name === 'ctl' && /^requestBodyProcessor=XML$/i.test(action.value ?? '')) {
        context.xmlProcessor = true;
      }
    }
  }

  return context;
}

/**
 * Смысловой проход по частям: каждая выдача — замечания об одном правиле.
 *
 * Шаг — правило, а не заранее отмеренный кусок работы: проверки правила
 * делят между собой его контекст, и разрезать их посередине значило бы
 * собирать этот контекст дважды. Правил в файле тысячи, так что дробить
 * мельче незачем — тот, кто ведёт проход, набирает столько шагов, сколько
 * влезает в его бюджет.
 *
 * Последняя выдача — замечания об уровне файла: они опираются на то, что
 * стало известно по ходу прохода, и раньше конца появиться не могут.
 */
export function* inspectSlices(
  blocks: VisualBlock[],
  statements: ParsedStatement[],
  exclusions?: ExclusionIndex,
): Generator<Diagnostic[], void, void> {
  const diag = new Diagnostics();
  const context = readDocumentContext(statements);
  const lineOf = (index: number) => statements[index]?.span.startLine;

  /** Правила, считая `SecAction`: по ним отсчитывает `skip:N`. */
  const executable = blocks.filter((b) => b.kind === 'rule' || b.kind === 'action');
  /** Первое правило с такой же проверкой — чтобы поймать копию. */
  const seenSignatures = new Map<string, string>();

  /** Сколько замечаний уже отдано: остальное — новое с прошлой выдачи. */
  let published = 0;
  const fresh = () => {
    const slice = diag.items.slice(published);
    published = diag.items.length;
    return slice;
  };

  for (let index = 0; index < executable.length; index++) {
    const block = executable[index];
    const rulesAfter = executable.length - index - 1;
    const actions = block.kind === 'rule' ? block.rule.actions : block.actions;
    const conditions = block.kind === 'rule' ? block.rule.conditions : [];
    const headLine =
      block.kind === 'rule' ? lineOf(block.rule.headIndex) : lineOf(block.statementIndex);

    if (isDisruptive(actions.disruptive) && actions.disruptive !== 'pass') {
      context.hasBlockingRule = true;
    }

    const conditionContext = { document: context, capture: actions.capture };
    conditions.forEach((condition, position) => {
      // «Условие 1» у правила без цепочки — лишнее уточнение.
      const chained = conditions.length > 1 ? { condition: position + 1 } : {};
      diag.at(lineOf(condition.statementIndex) ?? headLine, {
        ruleKey: block.key,
        ...chained,
      });
      checkCondition(condition, conditionContext, diag);
    });

    const signature = conditions.map(conditionSignature).join('&&');
    const twinId = conditions.length > 0 ? seenSignatures.get(signature) : undefined;
    if (conditions.length > 0 && twinId === undefined && actions.id !== '') {
      seenSignatures.set(signature, actions.id);
    }

    diag.at(headLine, { ruleKey: block.key });
    checkRule(actions, conditions, { document: context, rulesAfter, twinId }, diag);

    yield fresh();
  }

  checkDocument(context, diag);
  // Индекс исключений собирает компиляция: там он нужен и без замечаний —
  // по нему карточка правила показывает, что его сняли. Считать его заново
  // здесь пришлось бы только ради того, чтобы вызвать проверку.
  checkExclusions(exclusions ?? collectExclusions(blocks, statements), diag);
  yield fresh();
}

/** Смысловой проход целиком — для тех, кому результат нужен сразу. */
export function inspectDocument(
  blocks: VisualBlock[],
  statements: ParsedStatement[],
  exclusions?: ExclusionIndex,
): Diagnostic[] {
  const all: Diagnostic[] = [];
  for (const slice of inspectSlices(blocks, statements, exclusions)) all.push(...slice);
  return all;
}
