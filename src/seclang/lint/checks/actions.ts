/**
 * Действия: что в них написано и как они уживаются друг с другом.
 *
 * Список действий движок читает терпимо, и в этом вся беда: `phase:9` и
 * `severity:banana` он не отвергает, а молча превращает во что-то своё —
 * в правило, которое некуда добавить, и в критичность «авария». Здесь
 * значения сверяются с тем, что движок действительно понимает; правила
 * взяты из его же валидаторов (`re_actions.c` в ModSecurity 2).
 *
 * Замечаний два рода, и различает их последствие. «Движок такого не
 * загрузит» — ошибка. «Загрузит и прочитает не так, как написано» —
 * предупреждение: оно опаснее тем, что о себе не сообщает.
 */

import {
  SEVERITY_NAMES,
  WRITABLE_COLLECTIONS,
  actionSpec,
  ctlSpec,
  phaseNumber,
} from '../../catalog';
import { reviewRegex } from '../../regex';
import { BLOCKING } from '../../symbols';
import { REFUSED } from '../codes';
import type { ActionListNode, ActionNode, PlainActionNode } from '../../ast';
import type { CtlValue } from '../../catalog';
import type { RuleInfo } from '../../analyze';
import type { Engine } from '../../engines';
import type { Check, Range } from '../engine';

const SEVERITIES = new Set(SEVERITY_NAMES.map((name) => name.toLowerCase()));
const WRITABLE = new Set(WRITABLE_COLLECTIONS);

/** Коллекции, которые открывает `initcol`. */
const INITCOL = new Set(['ip', 'global', 'resource', 'session', 'user']);

/** Диапазон номеров, занятый OWASP Core Rule Set. */
const CRS_IDS: [number, number] = [900000, 999999];

/** Реакции, после которых запрос дальше не идёт. */
const TERMINAL = new Set(['deny', 'drop', 'redirect', 'proxy']);

/**
 * Действия, значение которых движок читает при загрузке и больше к нему не
 * возвращается: макрос в них остаётся текстом. `skipAfter:%{tx.label}`
 * ищет метку с именем `%{tx.label}`, не находит — и пропускает всё, что
 * осталось в фазе.
 */
/**
 * Наибольший номер правила, который движок примет. Третья версия читает
 * номер через `std::stod` и сверяет запись: выше 2^53 число теряет цифры.
 */
const ID_LIMITS: Record<Engine, bigint> = {
  modsecurity2: BigInt('2147483647'),
  modsecurity3: BigInt('9007199254740992'),
  coraza: BigInt('9223372036854775807'),
};

const STATIC = new Set([
  'id',
  'phase',
  'severity',
  'status',
  'skip',
  'skipafter',
  'pause',
  'maturity',
  'accuracy',
]);

/** Что в умолчаниях движок ещё принимает, но уже с предупреждением. */
const DEPRECATED_IN_DEFAULTS = new Set(['t', 'severity', 'logdata']);

/** Первый `SecDefaultAction` каждой фазы — один список на весь набор. */
const FIRST_DEFAULTS = new WeakMap<object, Map<number, unknown>>();

function isNumber(text: string): boolean {
  return /^\d+$/.test(text);
}

/**
 * Чего опция `ctl` ждёт значением; `null` — значение годится.
 *
 * Возвращается не признак, а слова для замечания: человеку нужно знать не
 * то, что он ошибся, а что здесь можно написать.
 */
function ctlExpected(kind: CtlValue, value: string): string | null {
  switch (kind) {
    case 'engine':
      return /^(?:on|off|detectiononly)$/i.test(value) ? null : 'On, Off or DetectionOnly';
    case 'toggle':
      return /^(?:on|off)$/i.test(value) ? null : 'On or Off';
    case 'audit':
      return /^(?:on|off|relevantonly)$/i.test(value) ? null : 'On, Off or RelevantOnly';
    case 'xml':
      return /^(?:on|off|onlyargs)$/i.test(value) ? null : 'On, Off or OnlyArgs';
    case 'parts':
      return /^[+-]?[A-KZ]+$/i.test(value) ? null : 'audit log parts such as ABIJ, +E or -FH';
    case 'level':
      return /^[0-9]$/.test(value) ? null : 'a level from 0 to 9';
    case 'limit':
      return isNumber(value) && Number(value) > 0 ? null : 'a positive whole number';
    case 'regex': {
      const review = reviewRegex(value);
      return review.regex !== null || review.unsupported !== null
        ? null
        : 'a valid regular expression';
    }
    default:
      return null;
  }
}

/** Значения действий и их повторы. */
export const actionValues: Check = {
  name: 'actionValues',
  create({ report, model, options, file }) {
    const invalid = (node: ActionNode, at: Range, expected: string, name = node.name) =>
      report('invalidActionValue', at, {
        name,
        value: node.value === null ? '' : node.value.value,
        expected,
      });
    const suspicious = (
      node: ActionNode,
      at: Range,
      expected: string,
      refused: readonly Engine[] = REFUSED.NONE,
    ) =>
      report(
        'suspiciousActionValue',
        at,
        { name: node.name, value: node.value === null ? '' : node.value.value, expected },
        refused,
      );

    const plain = (node: PlainActionNode): void => {
      const { value } = node;
      // Пустое значение — забота другой проверки.
      if (value === null || value.value.trim() === '') return;
      if (value.macros.length > 0) {
        // Что окажется на месте макроса, станет известно только на запросе —
        // если действие его вообще раскрывает.
        const name = node.name.toLowerCase();
        if (STATIC.has(name)) {
          // Номер с макросом не грузит никто, код ответа — третья версия и
          // Coraza; метку для перехода принимают все, просто не находят.
          const refused =
            name === 'id' ? REFUSED.ALL : name === 'status' ? REFUSED.V3_CORAZA : REFUSED.NONE;
          report('macroInStaticAction', value.macros[0], { name: node.name }, refused);
        }
        return;
      }
      const text = value.value.trim();

      switch (node.name.toLowerCase()) {
        case 'id':
          // Только цифры и больше нуля — иначе движок отказывается от правила.
          if (!isNumber(text) || Number(text) <= 0) invalid(node, value, 'a positive whole number');
          else if (BigInt(text) > ID_LIMITS.modsecurity2) {
            // Потолок у каждого движка свой (пробы `x1`–`x5`): вторая версия
            // читает номер как `int`, третья — как число с плавающей точкой и
            // отказывается, когда оно теряет цифры, Coraza — как `int64`.
            const id = BigInt(text);
            const refused = (Object.keys(ID_LIMITS) as Engine[]).filter((e) => id > ID_LIMITS[e]);
            report('idTooLarge', value, { id: text }, refused);
          }
          break;
        case 'phase':
          // Фазу движок не проверяет, но правило с номером вне 1–5 ему
          // некуда положить, и загрузка обрывается.
          if (phaseNumber(text) === null) {
            invalid(node, value, 'a phase from 1 to 5, or request, response, logging');
          } else if (options.engine === 'coraza' && /[A-Z]/.test(text)) {
            // Слово фазы Coraza сравнивает буква в букву.
            invalid(node, value, 'request, response or logging in lower case');
          }
          break;
        case 'severity':
          // Незнакомое слово вторая версия читает как ноль, то есть «авария»;
          // остальные от него отказываются.
          if (SEVERITIES.has(text.toLowerCase()) || /^[0-7]$/.test(text)) break;
          suspicious(
            node,
            value,
            'EMERGENCY … DEBUG or a number from 0 to 7',
            isNumber(text) ? REFUSED.CORAZA : REFUSED.V3_CORAZA,
          );
          break;
        case 'status':
          if (/^[1-5]\d\d$/.test(text)) break;
          suspicious(node, value, 'an HTTP status code', isNumber(text) ? REFUSED.NONE : REFUSED.V3_CORAZA);
          break;
        case 'skip':
          if (isNumber(text) && Number(text) > 0) break;
          suspicious(
            node,
            value,
            'a positive number of rules',
            isNumber(text) ? REFUSED.CORAZA : REFUSED.V3_CORAZA,
          );
          break;
        case 'pause':
          if (!isNumber(text)) suspicious(node, value, 'a number of milliseconds');
          break;
        case 'maturity':
        case 'accuracy':
          if (!/^[1-9]$/.test(text)) {
            suspicious(node, value, 'a number from 1 to 9', isNumber(text) ? REFUSED.NONE : REFUSED.V3_CORAZA);
          }
          break;
        case 'allow':
          if (!/^(?:phase|request)$/i.test(text)) invalid(node, value, 'phase or request');
          break;
        case 'xmlns':
          if (text.indexOf('=') <= 0) invalid(node, value, 'prefix=namespace');
          break;
        case 'initcol': {
          const equals = text.indexOf('=');
          const collection = (equals === -1 ? text : text.slice(0, equals)).toLowerCase();
          if (equals <= 0 || equals === text.length - 1 || !INITCOL.has(collection)) {
            // Вторая версия такое загрузит и споткнётся уже на запросе.
            suspicious(
              node,
              value,
              'collection=key, where collection is ip, global or resource',
              REFUSED.V3_CORAZA,
            );
          }
          break;
        }
        case 'expirevar':
        case 'deprecatevar':
          if (!/^[A-Za-z_]\w*[.:][^=]+=.+$/.test(text)) {
            suspicious(node, value, 'collection.name=value');
          } else if (/^tx[.:]/i.test(text)) {
            // `TX` живёт один запрос: стареть в ней нечему.
            suspicious(node, value, 'a variable of a collection that outlives the request (ip, session, …)');
          }
          break;
        default:
          break;
      }
    };

    return {
      Action: plain,

      Setvar(node) {
        if (node.value === null || node.value.value.trim() === '') return;
        const collection = node.collection.toLowerCase();
        if (collection.indexOf('%{') !== -1) return;
        // Запись без имени и запись в коллекцию, которую заполняет сам
        // движок, он принимает — и ничего не делает.
        // Запятая внутри кавычек: третья версия обрывает на ней действие,
        // кавычки её не останавливают.
        if (node.value.quoted && file.source.slice(node.value.start, node.value.end).includes(',')) {
          suspicious(node, node.value, 'a value without a comma', REFUSED.V3);
        }
        if (node.key === '' || !WRITABLE.has(collection)) {
          suspicious(
            node,
            node.value,
            'collection.name, where collection is tx, ip, session, user, global or resource',
            REFUSED.V3_CORAZA,
          );
        }
      },

      Ctl(node) {
        if (node.option === '') return;
        const spec = ctlSpec(node.option);
        if (spec === null) {
          report('unknownCtl', node.value ?? node, { name: node.option });
          return;
        }
        if (node.value === null || node.value.macros.length > 0) return;
        // Опцию в одинарных кавычках третья версия не разбирает.
        if (node.value.quoted) suspicious(node, node.value, 'the option without quotes', REFUSED.V3);
        if (node.operand === null || node.operand.trim() === '') {
          invalid(node, node.value, 'a value after "="', `ctl:${spec.name}`);
          return;
        }
        const expected = ctlExpected(spec.value, node.operand.trim());
        if (expected !== null) invalid(node, node.value, expected, `ctl:${spec.name}`);
        // Свой обработчик тела подключить можно только ко второй версии;
        // третья знает четыре имени и другого не загрузит.
        if (
          options.engine !== 'modsecurity2' &&
          spec.name.toLowerCase() === 'requestbodyprocessor' &&
          !/^(?:xml|json|urlencoded|multipart)$/i.test(node.operand.trim())
        ) {
          suspicious(node, node.value, 'XML, JSON, URLENCODED or MULTIPART', REFUSED.V3);
        }
      },

      ActionList(list) {
        const seen = new Set<string>();
        const groups = new Map<string, ActionNode>();

        for (const action of list.items) {
          const spec = actionSpec(action.name);
          if (spec === null) continue;
          const key = spec.name.toLowerCase();

          if (spec.exclusive !== null) {
            // Из действий одной группы движок оставляет последнее.
            const earlier = groups.get(spec.exclusive);
            if (earlier !== undefined && earlier.name.toLowerCase() !== key) {
              report('conflictingActions', action, { first: earlier.name, second: action.name });
            }
            groups.set(spec.exclusive, action);
          }
          if (!spec.repeatable) {
            if (seen.has(key)) report('duplicateAction', action, { name: action.name });
            seen.add(key);
          }
        }
      },

      SecDefaultAction(node) {
        const list = node.actions;
        if (list === null) return;
        const at = { start: node.start, end: node.nameEnd };

        let disruptive = false;
        let phase = false;
        for (const action of list.items) {
          const spec = actionSpec(action.name);
          if (spec === null) continue;
          const name = spec.name.toLowerCase();
          if (spec.exclusive === 'disruptive') disruptive = true;
          if (name === 'phase') phase = true;
          // Умолчания — не правило: ни номера, ни сообщения, ни цепочки у
          // них быть не может, и движок на этом настаивает.
          if (/^(?:id|rev|ver|maturity|accuracy|msg|chain|skip|skipafter)$/.test(name)) {
            report('defaultActionForbidden', action, { name: action.name });
          }
          // Преобразование в умолчаниях ложится на каждое правило ниже, и по
          // самому правилу этого не видно; движок такое уже не одобряет.
          if (DEPRECATED_IN_DEFAULTS.has(name) && !/^none$/i.test(action.value?.value ?? '')) {
            // Преобразование в умолчаниях Coraza не принимает вовсе.
            const refused = name === 't' ? REFUSED.CORAZA : REFUSED.NONE;
            report('defaultActionDeprecated', action, { name: action.name }, refused);
          }
        }
        if (!disruptive) report('defaultActionIncomplete', at, { missing: 'a disruptive action' });
        if (!phase) report('defaultActionIncomplete', at, { missing: 'a phase' });

        // Вторая версия позволяет менять умолчания по ходу файла, третья —
        // нет: второй список той же фазы для неё ошибка загрузки.
        if (options.engine !== 'modsecurity3') return;
        const phaseAction = list.items.find((action) => action.name.toLowerCase() === 'phase');
        const number = phaseNumber(phaseAction?.value?.value.trim() ?? '');
        if (number === null) return;
        let first = FIRST_DEFAULTS.get(model.scope);
        if (first === undefined) {
          first = new Map();
          FIRST_DEFAULTS.set(model.scope, first);
        }
        const earlier = first.get(number);
        if (earlier === undefined) first.set(number, node);
        else if (earlier !== node) report('defaultActionRepeated', at, { phase: String(number) });
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Реакция правила и след в журнале                                    */
/* ------------------------------------------------------------------ */

function headActions(rule: RuleInfo): ActionListNode | null {
  return rule.head.actions;
}

/** Действие головы правила по имени. */
function find(rule: RuleInfo, name: string): ActionNode | null {
  const list = headActions(rule);
  if (list === null) return null;
  for (const action of list.items) {
    if (action.name.toLowerCase() === name) return action;
  }
  return null;
}

/** Реакция правила: последнее из действий, решающих судьбу запроса. */
function disruptiveOf(rule: RuleInfo): ActionNode | null {
  const list = headActions(rule);
  let found: ActionNode | null = null;
  if (list !== null) {
    for (const action of list.items) {
      if (actionSpec(action.name)?.exclusive === 'disruptive') found = action;
    }
  }
  return found;
}

/** Правило из самого CRS: у него номер в занятом диапазоне по праву. */
function isCrsRule(rule: RuleInfo): boolean {
  if (rule.tags.some((tag) => tag.toUpperCase() === 'OWASP_CRS')) return true;
  const ver = find(rule, 'ver');
  return ver !== null && ver.value !== null && /^OWASP_CRS\b/i.test(ver.value.value);
}

/** Чем правило отвечает и что от срабатывания останется. */
export const reactions: Check = {
  name: 'reactions',
  create({ model, report }) {
    const { scope } = model;
    // Файл самого CRS узнаётся по его правилам: номера из занятого диапазона
    // в нём свои, и говорить о них нечего. Пометка `OWASP_CRS` стоит не в
    // каждом его файле, поэтому есть и второй признак: набор — CRS, а в
    // файле почти все номера из этого диапазона.
    const reserved = (rule: RuleInfo): boolean => {
      if (rule.id === null || !isNumber(rule.id)) return false;
      const id = Number(rule.id);
      return id >= CRS_IDS[0] && id <= CRS_IDS[1];
    };
    const inRange = model.rules.filter(reserved).length;
    const ownRange =
      model.rules.some(isCrsRule) ||
      (inRange * 2 > model.rules.length && scope.rules.some(isCrsRule));

    return {
      rule(rule) {
        const { head } = rule;
        if (head.kind === 'SecRuleScript') return;
        const at = { start: head.start, end: head.nameEnd };

        const disruptive = disruptiveOf(rule);
        const reaction = disruptive === null ? '' : disruptive.name.toLowerCase();

        // Реакция, не записанная в правиле, может прийти из `SecDefaultAction`.
        // Молчим и там, где причина уже названа: списка действий нет вовсе
        // либо реакция записана в звене — о том и другом сказано отдельно.
        const misplaced = rule.conditions
          .slice(1)
          .some((c) =>
            (c.node.actions?.items ?? []).some(
              (action) => actionSpec(action.name)?.exclusive === 'disruptive',
            ),
          );
        if (disruptive === null && !rule.hasDefaults && headActions(rule) !== null && !misplaced) {
          report('noDisruptive', at);
        }

        // Действия головы цепочки исполняются, как только совпало первое
        // условие. Для счётчика это значит «считать и то, что цепочка в
        // итоге отвергла».
        if (rule.conditions.length > 1 && head.actions !== null) {
          const counter = head.actions.items.find(
            (action) => action.kind === 'Setvar' && action.op === 'add',
          );
          if (counter !== undefined) report('setvarInChainHead', counter);
        }

        const status = find(rule, 'status');
        // `block` решает, чем ответить, по умолчаниям — и код берёт оттуда же.
        if (status !== null && !/^(?:deny|redirect|block|)$/.test(reaction)) {
          report('statusWithoutBlock', status);
        }

        // В пятой фазе ответ уже ушёл: прерывать нечего.
        if (disruptive !== null && rule.effectivePhase === 5 && rule.phase === 5) {
          if (reaction !== 'pass') {
            // `block` в пятой фазе вторая версия ещё терпит, остальное — нет.
            const refused = reaction === 'block' ? REFUSED.NONE : REFUSED.V2;
            report('disruptiveInLoggingPhase', disruptive, { name: disruptive.name }, refused);
          }
        }

        const blocking = BLOCKING.has(reaction);
        const nolog = find(rule, 'nolog');
        if (blocking && nolog !== null && find(rule, 'log') === null) report('blockWithoutLog', nolog);
        const logdata = find(rule, 'logdata');
        if (logdata !== null && nolog !== null && find(rule, 'log') === null) {
          report('logdataWithoutLog', logdata);
        }
        // Сообщение, записанное без значения или в звене, — тоже сообщение:
        // что с ним не так, сказано отдельно, и «его нет» было бы неправдой.
        const lists = [headActions(rule), ...rule.conditions.slice(1).map((c) => c.node.actions)];
        const hasMsg = lists.some((list) =>
          (list?.items ?? []).some((action) => action.name.toLowerCase() === 'msg'),
        );
        if (blocking && rule.msg === null && !hasMsg && disruptive !== null) {
          report('blockWithoutMsg', disruptive);
        }

        if (rule.id !== null && !ownRange && reserved(rule)) {
          report('idInReservedRange', rule.idNode ?? at, { id: rule.id });
        }
      },
    };
  },
};

/** Действие `capture` — в голове или в любом звене цепочки. */
export { TERMINAL };
