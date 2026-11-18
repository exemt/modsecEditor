/**
 * Указатели: метки, переменные и коллекции.
 *
 * Всё здесь — про связи, которых в самом правиле не видно: куда ведёт
 * переход, кто выставил переменную и успел ли он это сделать. Ответы лежат
 * в `symbols.ts`, собранные по всему набору; проверки только сопоставляют
 * «где использовано» с «где объявлено».
 *
 * Каждая проверка говорит о своём файле: набор проверяется файл за
 * файлом, и замечание должно попасть в тот, где стоит запись, — а не в
 * тот, где нашлась или не нашлась её пара.
 */

import { PERSISTENT, matchesPattern, runsBefore, variableKey } from '../../symbols';
import type { ActionNode } from '../../ast';
import type { RuleInfo } from '../../analyze';
import type { Site, VariableEntry } from '../../symbols';
import type { Check } from '../engine';

/* ------------------------------------------------------------------ */
/* Метки и переходы                                                    */
/* ------------------------------------------------------------------ */

function eachAction(rule: RuleInfo, visit: (action: ActionNode) => void): void {
  const lists = [rule.head.actions];
  for (let i = 1; i < rule.conditions.length; i++) lists.push(rule.conditions[i].node.actions);
  for (const list of lists) {
    if (list !== null) for (const action of list.items) visit(action);
  }
}

/** Переходы `skipAfter` и `skip` и метки, на которые они ведут. */
export const markers: Check = {
  name: 'markers',
  create({ model, report }) {
    const { scope } = model;

    return {
      SecMarker(node) {
        if (node.label === null) return;
        const label = node.label.value;

        // Метку с пробелом грузит только Coraza: обе версии ModSecurity
        // отказываются от директивы (проба `y1-marker-space`).
        if (/\s/.test(label.trim())) report('markerWithSpace', node.label, { name: label });

        // Переход останавливается на первой метке ниже себя; до второй с тем
        // же именем дело не дойдёт никогда.
        const sites = scope.markers.get(label);
        if (sites !== undefined && sites.length > 1 && sites[0].node !== node) {
          report('duplicateMarker', node.label, { name: label });
        }
        // Если хоть одна метка в наборе берётся из макроса, сказать, что на
        // эту никто не прыгает, уже нельзя.
        if (!scope.dynamicJumps && !scope.jumps.has(label)) {
          report('unusedMarker', node.label, { name: label });
        }
      },

      rule(rule) {
        eachAction(rule, (action) => {
          if (action.kind !== 'Action' || action.value === null) return;
          const name = action.name.toLowerCase();

          if (name === 'skipafter') {
            const label = action.value.value;
            // Метка из макроса известна только во время запроса.
            if (label === '' || action.value.macros.length > 0) return;
            // То же в переходе: `skipAfter:'END CHECKS'` обе версии ModSecurity
            // не грузят (проба `y3-skipafter-space`).
            if (/\s/.test(label.trim())) report('markerWithSpace', action.value, { name: label });

            // Метка может стоять в любом файле набора, в том числе в следующем.
            const sites = scope.markers.get(label);
            if (sites === undefined) {
              report('missingMarker', action.value, { name: label });
            } else if (sites.every((site) => site.order < rule.order)) {
              // `skipAfter` ищет метку только ниже себя. Не найдя, движок
              // пропускает всё, что осталось в фазе.
              report('markerBehind', action.value, { name: label });
            }
            return;
          }

          if (name === 'skip') {
            const count = Number.parseInt(action.value.value, 10);
            if (Number.isNaN(count)) return;
            // Считаются правила той же фазы: в другую фазу `skip` не заходит.
            let rest = 0;
            for (const other of scope.rules) {
              if (other.order > rule.order && other.effectivePhase === rule.effectivePhase) rest++;
            }
            if (count > rest) {
              report('skipBeyondEnd', action, { count: String(count), rest: String(rest) });
            }
          }
        });
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Переменные и коллекции                                              */
/* ------------------------------------------------------------------ */

/** Переменные транзакции, которые выставляет сам движок. */
const ENGINE_SET = new Set(['tx.msc_pcre_limits_exceeded', 'tx.msc_pcre_error']);

/** Поля, которые есть у любой долгоживущей коллекции с момента открытия. */
const BUILTIN_KEYS = new Set([
  'create_time',
  'is_new',
  'key',
  'last_update_time',
  'timeout',
  'update_counter',
  'update_rate',
]);

/** Чем открывают коллекцию — для подсказки в замечании. */
const OPENED_BY: Record<string, string> = {
  ip: 'initcol:ip=%{REMOTE_ADDR}',
  global: 'initcol:global=global',
  resource: 'initcol:resource=…',
  session: 'setsid',
  user: 'setuid',
};

/** Группа, захваченная оператором: `TX:0` … `TX:9`; о них — `captures.ts`. */
function isCaptureGroup(entry: VariableEntry): boolean {
  return entry.collection === 'tx' && /^\d$/.test(entry.name);
}

/** Переменные: выставлена ли, успела ли к чтению, открыта ли её коллекция. */
export const variables: Check = {
  name: 'variables',
  create({ model, file, report }) {
    const { scope } = model;

    /** Самое раннее по тексту место из этого файла. */
    const firstHere = (sites: readonly Site[]): Site | null => {
      let first: Site | null = null;
      for (const site of sites) {
        if (site.file !== file) continue;
        if (first === null || site.node.start < first.node.start) first = site;
      }
      return first;
    };

    return {
      end() {
        /** Коллекция → первое место в этом файле, где к ней обращаются. */
        const unopened = new Map<string, Site>();
        for (const entry of scope.variables.values()) {
          const { collection, name } = entry;

          if (PERSISTENT.has(collection) && !scope.inits.has(collection)) {
            for (const sites of [entry.writes, entry.reads, entry.tests]) {
              const site = firstHere(sites);
              if (site === null) continue;
              const known = unopened.get(collection);
              if (known === undefined || site.node.start < known.node.start) {
                unopened.set(collection, site);
              }
            }
          }

          // Группы заполняет не `setvar`, а `capture`: у них свой счёт.
          if (isCaptureGroup(entry)) continue;

          // Служебные поля долгоживущей коллекции заполняет движок.
          if (collection !== 'tx' && BUILTIN_KEYS.has(name)) continue;

          // Правило, которое само проверяет, есть ли переменная, читает её
          // сознательно: `SecRule &TX:limit "@eq 1" "chain"` перед
          // `SecRule &ARGS "@gt %{tx.limit}"` — именно защита от пустого
          // значения, и говорить ему о пустом значении незачем.
          const guarded = new Set<RuleInfo>();
          for (const site of entry.tests) guarded.add(site.rule);
          const unguarded =
            guarded.size === 0 ? entry.reads : entry.reads.filter((site) => !guarded.has(site.rule));

          const set = entry.writes.some((site) => site.use !== 'delete');

          if (!set) {
            if (ENGINE_SET.has(variableKey(collection, name))) continue;
            if (matchesPattern(scope, collection, name)) continue;
            // Одного замечания на переменную в файле достаточно: без файла
            // настройки их были бы сотни, и все об одном.
            const site = firstHere(unguarded);
            if (site === null) continue;
            if (collection === 'tx') report('txNeverSet', site.node, { name });
            else report('variableNeverSet', site.node, { name: `${collection}.${name}` });
            continue;
          }

          // Порядок важен только внутри запроса: в долгоживущей коллекции
          // значение могло остаться от прошлого.
          if (collection !== 'tx') continue;

          for (const site of unguarded) {
            if (site.file !== file || site.use !== 'read') continue;
            let ready = false;
            for (const write of entry.writes) {
              if (write.use === 'delete') continue;
              if (write.rule === site.rule || runsBefore(write.rule, site.rule)) {
                ready = true;
                break;
              }
            }
            if (!ready) report('txReadBeforeSet', site.node, { name });
          }
        }

        for (const [collection, site] of unopened) {
          report('collectionNotInitialised', site.node, {
            name: collection,
            action: OPENED_BY[collection] ?? 'initcol',
          });
        }
      },
    };
  },
};
