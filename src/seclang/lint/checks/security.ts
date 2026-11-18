/**
 * Проверки не о том, загрузится ли правило, а о том, не открывает ли оно
 * дорогу.
 *
 * Здесь три приметы, и каждая — про то, что правило написано верно, но
 * защищает не так, как кажется:
 *
 *  - защиту выключает то, что клиент пишет сам: заголовок, куки, параметр.
 *    `allow` по `User-Agent` или `X-Forwarded-For` откроет дверь любому, кто
 *    этот заголовок пришлёт;
 *  - значение пароля или токена уходит в журнал через `%{MATCHED_VAR}`;
 *  - тело разбирается, но ошибку разбора никто не читает. Чего разборщик не
 *    разобрал, то правила не увидят: Coraza пропускает испорченный XML с
 *    атакой внутри, если на `REQBODY_ERROR` нет правила (сценарии
 *    `body-error-xml-…`). Рекомендованные конфигурации всех трёх движков
 *    такое правило ставят (200002).
 */

import { findAction } from '../../ast';
import type { ActionNode, MacroNode } from '../../ast';
import type { RuleInfo } from '../../analyze';
import type { Check } from '../engine';

/** Что клиент присылает сам и как хочет. */
const CLIENT_WRITTEN = new Set([
  'REQUEST_HEADERS',
  'REQUEST_HEADERS_NAMES',
  'REQUEST_COOKIES',
  'REQUEST_COOKIES_NAMES',
  'ARGS',
  'ARGS_NAMES',
  'ARGS_GET',
  'ARGS_GET_NAMES',
  'ARGS_POST',
  'ARGS_POST_NAMES',
  'QUERY_STRING',
  'REQUEST_BODY',
]);

/** Имена, за которыми обычно стоит секрет. */
const SECRET = /pass(?:word|wd)?|pwd|secret|token|api[-_]?key|authorization|cvv|cvc|card[-_]?(?:no|num)/i;

/** Макросы, которые кладут в журнал само значение, а не его имя. */
const VALUE_MACROS = new Set(['matched_var', 'matched_vars']);

/** Действие, которое снимает защиту с запроса целиком или с правил. */
function relaxing(action: ActionNode): boolean {
  if (action.kind !== 'Ctl') return action.name.toLowerCase() === 'allow';
  const value = (action.operand ?? '').trim();
  if (/^ruleEngine$/i.test(action.option)) return /^(?:off|detectiononly)$/i.test(value);
  return /^ruleRemoveBy(?:Id|Tag|Msg)$/i.test(action.option);
}

function actionLists(rule: RuleInfo) {
  return [rule.head.actions, ...rule.conditions.slice(1).map((c) => c.node.actions)];
}

export const security: Check = {
  name: 'security',
  create({ model, file, report }) {
    const { scope } = model;

    return {
      rule(rule) {
        if (rule.conditions.length === 0) return;
        const targets = rule.conditions.flatMap((c) => c.targets.filter(({ node }) => !node.exclude));
        if (targets.length === 0) return;

        // Защиту снимает правило, все условия которого — о том, что
        // клиент пишет сам.
        const clientOnly = targets.every(({ node }) => CLIENT_WRITTEN.has(node.name.toUpperCase()));
        if (clientOnly) {
          for (const list of actionLists(rule)) {
            const action = list?.items.find(relaxing);
            if (action === undefined) continue;
            const first = targets[0].node;
            const target = first.selector === null ? first.name : `${first.name}:${first.selector.value}`;
            const text =
              action.kind === 'Ctl' ? `ctl:${action.option}=${action.operand ?? ''}` : action.name;
            report('relaxedByClientInput', action, { action: text, target });
            break;
          }
        }

        // Значение секрета в журнале.
        const secret = targets.find(
          ({ node }) =>
            node.selector !== null &&
            !node.selector.pattern &&
            !node.count &&
            SECRET.test(node.selector.value),
        );
        if (secret === undefined) return;
        const name = `${secret.node.name}:${secret.node.selector?.value ?? ''}`;
        for (const list of actionLists(rule)) {
          for (const key of ['logdata', 'msg']) {
            const action = findAction(list, key);
            const macros: readonly MacroNode[] = action?.value?.macros ?? [];
            const leak = macros.find((macro) => {
              const collection = macro.name.toLowerCase();
              if (VALUE_MACROS.has(collection)) return true;
              return (
                collection === secret.node.name.toLowerCase() &&
                (macro.key ?? '').toLowerCase() === (secret.node.selector?.value ?? '').toLowerCase()
              );
            });
            if (leak !== undefined) {
              report('secretInLog', leak, { target: name, macro: file.source.slice(leak.start, leak.end) });
              return;
            }
          }
        }
      },

      end() {
        // Ошибку разбора тела должен кто-то читать — хоть в каком файле набора.
        const reads = scope.rules.some((rule) =>
          rule.conditions.some((c) =>
            c.targets.some(({ node }) => /^REQBODY_(?:PROCESSOR_)?ERROR$/i.test(node.name)),
          ),
        );
        if (reads) return;
        for (const statement of file.statements) {
          if (statement.kind !== 'Directive' || !/^SecRequestBodyAccess$/i.test(statement.name)) continue;
          const value = statement.args[0];
          if (value !== undefined && /^on$/i.test(value.value)) report('bodyErrorUnchecked', statement);
        }
      },
    };
  },
};
