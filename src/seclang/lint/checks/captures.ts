/**
 * Захват: кто заполняет `TX.0`…`TX.9` и кто их читает.
 *
 * Раньше линтер считал, что группа живёт внутри правила: читаешь `%{TX.1}`
 * без `capture` — значит, там пусто. Движки устроены иначе, и замечание
 * выходило неправдой дважды: значение не пустое, а чужое, и правило,
 * которое нарочно читает захваченное правилом выше, ни в чём не ошиблось.
 *
 * Как оно на самом деле, записано в `symbols.ts` при `CaptureSite` и
 * проверено на стенде (`scripts/engines/scenarios.json`, сценарии
 * `capture-…`). Отсюда вопросы к каждому чтению, по порядку:
 *
 *  1. успело ли его заполнить само правило — тогда всё в порядке;
 *  2. заполнило бы, стой `capture` при нужном условии, — тогда он забыт,
 *     и читается не то, что нашло правило (`captureMissing`);
 *  3. иначе значение приходит сверху. Если ни одно правило с `capture`
 *     раньше не исполняется, прийти ему неоткуда (`groupNeverCaptured`);
 *  4. если исполняется — важно, где чтение стоит. Область проверки и
 *     аргумент оператора читают чужую группу нарочно: «захватил в одном
 *     правиле, проверил в другом» — обычный приём, и сказать о нём нечего.
 *     А в `msg`, `logdata` и `setvar` группа выдаёт себя за находку самого
 *     правила, хотя оно её не заполняло (`groupFromEarlierRule`).
 *
 * И один — к каждому захвату: читает ли его хоть кто-нибудь, здесь или
 * ниже (`captureUnused`).
 */

import { capturesHere, groupsOf, ownCapture, runsBefore, variableKey } from '../../symbols';
import type { ConditionInfo, RuleInfo, Scope } from '../../analyze';
import type { CaptureSite, GroupRead } from '../../symbols';
import type { Check } from '../engine';

/** Успевает ли условие с этим номером совпасть к моменту чтения. */
function reaches(index: number, read: GroupRead): boolean {
  if (read.where === 'log') return true;
  return read.where === 'action' ? index <= read.index : index < read.index;
}

/** Заполнена ли группа самим правилом к моменту чтения. */
function filledInside(scope: Scope, read: GroupRead): boolean {
  const sites = scope.captures.get(read.rule);
  if (sites === undefined) return false;
  return sites.some((site) => site.groups >= read.group && reaches(site.index, read));
}

/**
 * Заполнило бы условие группу для этого чтения, стой при нём `capture`.
 *
 * Отрицание не в счёт: `!@rx (a)` срабатывает как раз тогда, когда шаблон
 * не подошёл и захватывать нечего.
 */
function wouldFill(scope: Scope, condition: ConditionInfo, read: GroupRead): boolean {
  if (capturesHere(scope, condition) || !reaches(condition.index, read)) return false;
  if (condition.node.operator?.negated === true) return false;
  const groups = groupsOf(condition);
  return groups !== null && groups >= read.group;
}

/**
 * `capture` в правиле записан, но ни при одном операторе, который умеет
 * захватывать: правило хотело свой захват и не получило никакого.
 */
function futile(scope: Scope, rule: RuleInfo): boolean {
  if (scope.captures.has(rule)) return false;
  return rule.conditions.some(
    (condition) => ownCapture(condition) !== null && groupsOf(condition) === -1,
  );
}

/** Группу выставляют и руками: `setvar:tx.1=…`. Тогда захват ни при чём. */
function setByHand(scope: Scope, group: number): boolean {
  const entry = scope.variables.get(variableKey('tx', String(group)));
  return entry !== undefined && entry.writes.some((site) => site.use !== 'delete');
}

/**
 * Откуда к чтению приходит значение.
 *
 *  - `own` — его заполнило само правило или `setvar`: вопросов нет;
 *  - `missing` — заполнило бы само правило, не будь забыт `capture`;
 *  - `futile` — правило написало `capture` не там, где он действует;
 *  - `above` — от правила выше, если такое найдётся.
 */
type Origin = 'own' | 'missing' | 'futile' | 'above';

function origin(scope: Scope, read: GroupRead): Origin {
  if (filledInside(scope, read) || setByHand(scope, read.group)) return 'own';
  if (read.rule.conditions.some((condition) => wouldFill(scope, condition, read))) return 'missing';
  return futile(scope, read.rule) ? 'futile' : 'above';
}

/**
 * Ждёт ли правило от этого условия группу, которую оно без `capture` не
 * заполняет. Тогда лишняя в шаблоне не группа, а отсутствие `capture`.
 */
export function blamedForGroup(scope: Scope, condition: ConditionInfo): boolean {
  const reads = scope.groupReads.get(condition.rule);
  if (reads === undefined) return false;
  return reads.some((read) => !filledInside(scope, read) && wouldFill(scope, condition, read));
}

/** Что нужно знать о наборе целиком, чтобы судить об одном правиле. */
interface Overview {
  /** Группа → самое раннее по исполнению условие, которое её заполняет. */
  first: Array<CaptureSite | null>;
  /**
   * Самое позднее по исполнению правило, которое берёт группу сверху.
   *
   * Чтения, о которых линтер уже сказал «здесь забыт `capture`», сюда не
   * входят: такое правило хотело свою находку, а не чужую, и считать его
   * читателем чужого захвата значило бы молчать о лишнем `capture` везде
   * выше одной описки.
   */
  lastReader: RuleInfo | null;
}

function overview(scope: Scope): Overview {
  const first: Array<CaptureSite | null> = new Array<CaptureSite | null>(10).fill(null);
  for (const sites of scope.captures.values()) {
    for (const site of sites) {
      for (let group = 0; group <= site.groups; group++) {
        const known = first[group];
        if (known === null || runsBefore(site.rule, known.rule)) first[group] = site;
      }
    }
  }

  let lastReader: RuleInfo | null = null;
  const later = (rule: RuleInfo): void => {
    if (lastReader === null || runsBefore(lastReader, rule)) lastReader = rule;
  };
  for (const reads of scope.groupReads.values()) {
    for (const read of reads) {
      if (origin(scope, read) === 'above') later(read.rule);
    }
  }
  // `SecRule TX "@rx …"` читает всё, что есть в коллекции, — и группы тоже.
  for (const rule of scope.groupSweeps) later(rule);

  return { first, lastReader };
}

/** Захват: есть ли что захватывать, есть ли кому читать и то ли читается. */
export const captures: Check = {
  name: 'captures',
  create({ model, report }) {
    const { scope } = model;

    // Обзор набора нужен не каждому файлу: считается по первому требованию.
    let known: Overview | null = null;
    const whole = (): Overview => (known ??= overview(scope));

    return {
      rule(rule) {
        const reads = scope.groupReads.get(rule) ?? [];
        const sites = scope.captures.get(rule) ?? [];

        // `capture` действует на условие, в котором записан. Если его
        // оператор не захватывает, не захватит никто — даже когда соседнее
        // звено цепочки ищет по шаблону. Говорить об этом стоит, пока
        // правило не захватывает вовсе: CRS 3 пишет `capture` и в голове с
        // `@eq`, и в звене с `@rx`, и лишний из двух ничему не мешает.
        if (sites.length === 0) {
          for (const condition of rule.conditions) {
            const capture = ownCapture(condition);
            if (capture !== null && groupsOf(condition) === -1) {
              report('captureWithoutRegex', capture);
            }
          }
        }

        // Замечание каждого рода одно на правило, сколько бы групп оно ни
        // читало: причина у них общая.
        const said = new Set<string>();
        const once = (
          code: 'captureMissing' | 'groupNeverCaptured' | 'groupFromEarlierRule',
          read: GroupRead,
          more: Record<string, string> = {},
        ): void => {
          if (said.has(code)) return;
          said.add(code);
          report(code, read.node, { index: String(read.group), ...more });
        };

        for (const read of reads) {
          const from = origin(scope, read);
          if (from === 'missing') {
            // Замечание стоит на чтении, а `capture` нужен при операторе —
            // это может быть другое звено. Его номер, с единицы, уходит с
            // замечанием: тому, кто будет чинить, не придётся искать заново.
            const blamed = rule.conditions.find((condition) => wouldFill(scope, condition, read));
            once('captureMissing', read, { condition: String((blamed?.index ?? 0) + 1) });
          }
          // `futile`: правилу уже сказано, что его `capture` ничего не
          // захватывает; пустая группа — следствие, а не вторая беда.
          if (from !== 'above') continue;

          const first = whole().first[read.group];
          if (first === null || !runsBefore(first.rule, rule)) {
            once('groupNeverCaptured', read);
          } else if (read.where === 'action' || read.where === 'log') {
            once('groupFromEarlierRule', read);
          }
        }

        for (const site of sites) {
          // Захват из умолчаний никто не писал — и убирать его неоткуда.
          if (site.inherited) continue;
          if (reads.some((read) => reaches(site.index, read))) continue;
          if (scope.groupSweeps.has(rule)) continue;
          const { lastReader } = whole();
          if (lastReader !== null && runsBefore(rule, lastReader)) continue;
          report('captureUnused', site.node);
        }
      },
    };
  },
};
