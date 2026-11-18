/**
 * Исключения: дотягивается ли запись до правила, на которое ссылается.
 *
 * `SecRuleRemoveById 942100` и `ctl:ruleRemoveTargetById=942100;ARGS:q` —
 * указатели, и ошибка в них почти никогда не в записи. Номера нет в
 * загруженных файлах; запись стоит так, что со своей целью не встречается;
 * правило уже снято строкой выше. Движок обо всём этом молчит: исключение,
 * которое ничего не исключило, для него не ошибка.
 *
 * Порядок — место, где два рода исключений расходятся в противоположные
 * стороны. Директива применяется, пока конфигурация читается, и обязана
 * стоять ниже цели. `ctl` применяется, когда сработал его носитель, и
 * обязан отработать раньше — а «раньше» здесь значит сначала фазу и только
 * потом строку.
 */

import { reviewRegex } from '../../regex';
import { runsBefore } from '../../symbols';
import { REFUSED } from '../codes';
import { patternCaseDiffers, selectorKey } from './targets';
import type { ExclusionNode, VariableNode } from '../../ast';
import type { RuleInfo, Scope } from '../../analyze';
import type { Engine } from '../../engines';
import type { ExclusionSite } from '../../symbols';
import type { Check, Range } from '../engine';

/** Со скольких снятых правил удаление считается широким. */
const BROAD = 10;

/** Реакции носителя, после которых до снятых правил дело не дойдёт. */
const TERMINAL = new Set(['deny', 'drop', 'redirect', 'proxy']);

/** Что о наборе посчитано один раз на все его файлы. */
interface Resolved {
  /** Правила, подходящие под выборку исключения, без учёта порядка. */
  matches: Map<ExclusionSite, RuleInfo[]>;
  /** Правило → директива, снявшая его безусловно. */
  removed: Map<RuleInfo, ExclusionSite>;
  /** Выборки по тегу и по сообщению: нашла ли хоть одна своё правило. */
  patternMatch: { tag: boolean; msg: boolean };
  /** Тысячи, в которых у набора есть правила: `942` для `942100`. */
  blocks: Set<number>;
  /** Уже посчитанные выборки по тегу и сообщению. */
  cache: Map<string, RuleInfo[]>;
}

/** Обрезает значение до длины, на которой сообщение ещё читается. */
function short(value: string, limit = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * Как движок сравнивает тег и сообщение с выборкой.
 *
 * ModSecurity 2 собирает из выборки регулярное выражение и ищет его в теге:
 * `attack` снимет и `attack-sqli`, и `attack-xss`. ModSecurity 3 и Coraza
 * сравнивают строки целиком: для них `attack` — тег с таким именем, а
 * `^attack-` — тег, которого нет ни у одного правила.
 */
type Matching = 'regex' | 'exact';

function matchingOf(engine: string | undefined): Matching {
  return engine === 'modsecurity3' || engine === 'coraza' ? 'exact' : 'regex';
}

const RESOLVED = new WeakMap<Scope, Map<Matching, Resolved>>();

type Cache = Map<string, RuleInfo[]>;

function selectByPattern(
  scope: Scope,
  site: ExclusionSite,
  cache: Cache,
  matching: Matching,
): RuleInfo[] {
  const pattern = site.pattern ?? '';
  const key = `${matching}\u0000${site.by}\u0000${pattern}`;
  const known = cache.get(key);
  if (known !== undefined) return known;

  // Шаблон, которого не собрать, не выбирает ничего: какие правила он имел
  // в виду, сказать всё равно нельзя.
  let fits: ((text: string) => boolean) | null = null;
  if (pattern !== '') {
    if (matching === 'exact') {
      fits = (text) => text === pattern;
    } else {
      const { regex } = reviewRegex(pattern);
      if (regex !== null) fits = (text) => regex.test(text);
    }
  }
  const test = fits;
  const picked =
    test === null
      ? []
      : scope.rules.filter((rule) =>
          site.by === 'msg' ? rule.msg !== null && test(rule.msg) : rule.tags.some(test),
        );
  cache.set(key, picked);
  return picked;
}

function select(scope: Scope, site: ExclusionSite, cache: Cache, matching: Matching): RuleInfo[] {
  if (site.by !== 'id') return selectByPattern(scope, site, cache, matching);

  const picked: RuleInfo[] = [];
  for (const range of site.ids) {
    if (range.from === range.to) {
      const exact = scope.ids.get(String(range.from));
      if (exact !== undefined) picked.push(...exact);
      continue;
    }
    // Диапазоны редки, и отдельный указатель под них обошёлся бы дороже
    // одного прохода по правилам.
    for (const rule of scope.rules) {
      if (rule.id === null || !/^\d+$/.test(rule.id)) continue;
      const id = Number(rule.id);
      if (id >= range.from && id <= range.to) picked.push(rule);
    }
  }
  return picked;
}

/** Дотянулось ли исключение до правила: порядок у двух родов разный. */
function applies(site: ExclusionSite, rule: RuleInfo): boolean {
  if (site.carrier === null) return rule.order < site.order;
  return site.carrier !== rule && runsBefore(site.carrier, rule);
}

function resolve(scope: Scope, matching: Matching): Resolved {
  let perMatching = RESOLVED.get(scope);
  if (perMatching === undefined) {
    perMatching = new Map();
    RESOLVED.set(scope, perMatching);
  }
  const known = perMatching.get(matching);
  if (known !== undefined) return known;

  const cache: Cache = new Map();
  const resolved: Resolved = {
    matches: new Map(),
    removed: new Map(),
    patternMatch: { tag: false, msg: false },
    blocks: new Set(),
    cache,
  };
  for (const rule of scope.rules) {
    if (rule.id !== null && /^\d+$/.test(rule.id)) {
      resolved.blocks.add(Math.floor(Number(rule.id) / 1000));
    }
  }

  for (const site of scope.exclusions) {
    // Носитель под собственную выборку не попадает: правило, которое снимает
    // диапазон вместе с собой, само себя уже проверило.
    const matches = select(scope, site, cache, matching).filter((rule) => rule !== site.carrier);
    resolved.matches.set(site, matches);
    if (matches.length > 0 && site.by !== 'id') resolved.patternMatch[site.by] = true;
    // «Снято насовсем» — только директивой: `ctl` снимает правило лишь для
    // тех запросов, на которых сработал его носитель.
    if (site.source === 'directive' && site.op === 'remove') {
      for (const rule of matches) {
        if (applies(site, rule) && !resolved.removed.has(rule)) resolved.removed.set(rule, site);
      }
    }
  }

  perMatching.set(matching, resolved);
  return resolved;
}

/** Строка записи: у директивы своя, у `ctl` — строка правила-носителя. */
function lineOf(site: ExclusionSite): number {
  if (site.carrier !== null) return site.carrier.head.line;
  return (site.node as ExclusionNode).line;
}

/** Выборка словами — для замечания. */
function selectorText(site: ExclusionSite): string {
  if (site.by !== 'id') return site.pattern ?? '';
  const ids = site.ids.map((r) => (r.from === r.to ? String(r.from) : `${r.from}-${r.to}`));
  return [...ids, ...site.badIds].join(' ');
}

function targetsText(site: ExclusionSite): string {
  return site.targets
    .map((v) => {
      const prefix = (v.exclude ? '!' : '') + (v.count ? '&' : '');
      return `${prefix}${v.name}${v.selector === null ? '' : `:${v.selector.value}`}`;
    })
    .join('|');
}

/**
 * Кто не загрузит правку правила, которого на этот момент нет.
 *
 * Снять несуществующее правило можно в любом движке. Править — нет: Coraza
 * ищет правило сразу и, не найдя, отказывается от конфигурации. Вторая
 * версия отказывается от `SecRuleUpdateTargetById`, пока в конфигурации нет
 * вообще ни одного правила («no ruleset in this context»).
 */
function refusedUpdate(site: ExclusionSite, scope: Scope): readonly Engine[] {
  if (site.source !== 'directive' || site.by !== 'id') return REFUSED.NONE;
  if (site.op !== 'updateTarget' && site.op !== 'updateAction') return REFUSED.NONE;
  const first = scope.rules.length === 0 ? Infinity : scope.rules[0].order;
  const noRules = site.op === 'updateTarget' && first > site.order;
  return noRules ? REFUSED.V2_CORAZA : REFUSED.CORAZA;
}

/**
 * Отпечаток исключения. Имя параметра в исключении вторая версия и Coraza
 * сравнивают без учёта регистра, третья — буква в букву (сценарии
 * `exclusion-case-…`): для неё `!ARGS:Foo` и `!ARGS:foo` — два разных
 * исключения, и оба могут быть нужны.
 */
function signature(site: ExclusionSite, caseless: boolean): string {
  const where = site.carrier === null ? '' : `${site.carrier.order}:`;
  const targets = site.targets
    .map((v) => {
      const prefix = (v.exclude ? '!' : '') + (v.count ? '&' : '');
      const selector = v.selector === null ? '' : caseless ? selectorKey(v.selector) : v.selector.value;
      return `${prefix}${v.name.toUpperCase()}${selector === '' && v.selector === null ? '' : `:${selector}`}`;
    })
    .join('|');
  return `${where}${site.op}|${site.by}|${selectorText(site)}|${targets}`;
}

/** Коллекции, имена в которых шлёт клиент как хочет: по HTTP/2 — строчными. */
const HEADER_COLLECTIONS = new Set(['REQUEST_HEADERS', 'REQUEST_HEADERS_NAMES']);

/**
 * Где правило проверяет область, которую исключение снимает.
 *
 * `head` — в первом условии, `link` — только в звеньях цепочки, `none` —
 * нигде. Совпадает имя коллекции; параметр — если у правила он назван и
 * другой, область не та. Шаблон с любой стороны считается совпадением:
 * что он выберет, решается на запросе.
 */
function whereInspected(rule: RuleInfo, target: VariableNode): 'head' | 'link' | 'none' {
  const name = target.name.toUpperCase();
  const wanted = target.selector;
  const hits = (condition: RuleInfo['conditions'][number]) =>
    condition.targets.some(({ node }) => {
      if (node.exclude || node.name.toUpperCase() !== name) return false;
      if (wanted === null || wanted.pattern || node.selector === null || node.selector.pattern) return true;
      return node.selector.value.toLowerCase() === wanted.value.toLowerCase();
    });
  if (rule.conditions.length === 0 || hits(rule.conditions[0])) return 'head';
  return rule.conditions.slice(1).some(hits) ? 'link' : 'none';
}

/** Запись области для сообщения: `REQUEST_HEADERS:User-Agent`. */
function targetText(target: VariableNode): string {
  return target.selector === null ? target.name : `${target.name}:${target.selector.value}`;
}

/** Шаблон, который выберет имя без учёта регистра в любом движке. */
function caselessPattern(name: string): string {
  return `/(?i)^${name.replace(/[.\\+*?()[\]{}^$|/]/g, '\\$&')}$/`;
}

export const exclusions: Check = {
  name: 'exclusions',
  create({ model, file, options, report }) {
    const { scope } = model;
    const matching = matchingOf(options.engine);

    return {
      end() {
        if (!scope.exclusions.some((site) => site.file === file)) return;
        const resolved = resolve(scope, matching);
        /** Отпечаток исключения → строка, где оно встретилось впервые. */
        const seen = new Map<string, number>();

        for (const site of scope.exclusions) {
          if (site.file !== file) continue;
          const { name } = site;
          const node = site.node;
          const at: Range =
            node.kind === 'Exclusion' ? { start: node.start, end: node.nameEnd } : node;
          const matches = resolved.matches.get(site) ?? [];
          const applied = matches.filter((rule) => applies(site, rule));
          const target = selectorText(site);

          const key = signature(site, options.engine === 'modsecurity2' || options.engine === 'coraza');
          const first = seen.get(key);
          if (first === undefined) seen.set(key, lineOf(site));
          else report('exclusionDuplicate', at, { name, line: String(first) });

          if (site.ids.some((range) => range.from > range.to)) {
            report('exclusionEmptyRange', at, { target });
          }
          if (site.by === 'msg') report('exclusionByMsgFragile', at, { name });

          // Область без `!` — не исключение, а расширение проверки. Третий
          // аргумент меняет дело: с ним директива заменяет одну область другой.
          if (
            site.op === 'updateTarget' &&
            !site.replaced &&
            site.targets.length > 0 &&
            site.targets.every((variable) => !variable.exclude)
          ) {
            report('exclusionUpdateTargetNotExclusion', at, { name, targets: targetsText(site) });
          }

          if (node.kind === 'Exclusion' && node.actions !== null) {
            const meta = node.actions.items.find((a) => /^(?:id|phase)$/i.test(a.name));
            if (meta !== undefined) {
              report('exclusionUpdateActionMetadata', meta, { name, action: meta.name });
            }
          }

          if (site.source === 'directive') {
            // Недособранную директиву движок не загрузит.
            if (site.incomplete) report('exclusionNoTarget', at, { name });
            for (const value of site.badIds) {
              // Список номеров в одних кавычках Coraza ещё разбирает.
              const refused = /\s/.test(value.trim()) ? REFUSED.V3 : REFUSED.V3_CORAZA;
              report('exclusionBadId', at, { name, value }, refused);
            }
          } else {
            // Записанный неверно `ctl` конфигурацию не роняет: он молча ничего
            // не находит. Поэтому здесь предупреждения, и подробнее.
            if (site.badIds.length > 0) {
              report('exclusionCtlBadId', at, { name, value: site.badIds.join(' ') });
            }
            if (site.op === 'removeTarget') {
              if (site.targets.length === 0) report('exclusionCtlNoTarget', at, { name });
              // Всё после `;` движок читает одним именем с параметром: список
              // областей для него — параметр, которого нет ни у одного правила.
              if (site.targets.length > 1) {
                report('exclusionCtlTargetList', at, { name, targets: targetsText(site) });
              }
              // Сравнение идёт по имени и параметру; `!` и `&` в нём не участвуют.
              const dead = site.targets.find((variable) => variable.exclude || variable.count);
              if (dead !== undefined) {
                report('exclusionCtlDeadTarget', at, {
                  name,
                  target: `${dead.exclude ? '!' : ''}${dead.count ? '&' : ''}${dead.name}`,
                });
              }
            }
            const carrier = site.carrier;
            if (carrier !== null && matches.length > 0 && carrier.head.actions !== null) {
              const stop = carrier.head.actions.items.find((a) => TERMINAL.has(a.name.toLowerCase()));
              if (stop !== undefined) {
                report('exclusionCtlCarrierStops', at, { name, action: stop.name });
              }
            }
          }

          const dynamic = node.kind === 'Ctl' && node.value !== null && node.value.macros.length > 0;

          // Области, которые исключение снимает: у директивы — с `!`, у `ctl`
          // — все (знак там ничего не значит, о нём сказано выше).
          const removing =
            site.op === 'removeTarget'
              ? site.targets.filter((v) => !v.count)
              : site.op === 'updateTarget' && !site.replaced
                ? site.targets.filter((v) => v.exclude && !v.count)
                : [];

          for (const target of removing) {
            const { selector } = target;
            const upper = target.name.toUpperCase();

            // Шаблон в `ctl:ruleRemoveTargetById` понимает одна Coraza: вторая
            // версия его молча пропускает, третья не грузит (сценарий
            // `ctl-remove-target-regex`).
            if (site.source === 'ctl' && selector !== null && selector.pattern) {
              report('exclusionCtlPattern', at, { name, target: targetText(target) }, REFUSED.V3);
            }
            // И у исключения шаблон по именам параметров Coraza читает с учётом
            // регистра (сценарий `exclusion-case-pattern`).
            if (
              selector !== null &&
              options.engine !== 'modsecurity2' &&
              options.engine !== 'modsecurity3' &&
              patternCaseDiffers(target.name, selector)
            ) {
              report('selectorPatternCase', at, { value: short(selector.value) });
            }

            // Имя заголовка в исключении третья версия сравнивает буква в
            // букву, а клиенты пишут его по-разному: по HTTP/2 — строчными.
            if (
              HEADER_COLLECTIONS.has(upper) &&
              selector !== null &&
              !selector.pattern &&
              /[A-Za-z]/.test(selector.value) &&
              (options.engine === undefined || options.engine === 'modsecurity3')
            ) {
              if (site.source === 'directive') {
                report('exclusionHeaderCase', at, {
                  target: targetText(target),
                  pattern: `${target.name}:${caselessPattern(selector.value)}`,
                });
              } else {
                report('exclusionCtlHeaderCase', at, {
                  target: targetText(target),
                  lower: `${target.name}:${selector.value.toLowerCase()}`,
                });
              }
            }

            // Правило, которое эту область не проверяет. Говорить можно,
            // только когда исключение нацелено на одно правило и оно видно:
            // выборка по тегу или диапазону задевает многие, и у части из
            // них такой области может не быть законно.
            const single =
              site.by === 'id' &&
              site.badIds.length === 0 &&
              site.ids.length === 1 &&
              site.ids[0].from === site.ids[0].to;
            for (const rule of single ? applied : []) {
              const place = whereInspected(rule, target);
              if (place === 'head') continue;
              const data = { name, id: rule.id ?? '', target: targetText(target) };
              if (place === 'none') {
                report('exclusionTargetNotInRule', at, data);
              } else if (site.source === 'directive') {
                // Из звена цепочки область уберёт одна вторая версия; третья
                // и Coraza правят только первое условие (сценарий
                // `update-target-chain-link`).
                if (options.engine !== 'modsecurity2') report('exclusionTargetInLink', at, data);
              } else if (options.engine !== 'coraza') {
                // У `ctl` наоборот: из звена её уберёт одна Coraza (сценарий
                // `ctl-remove-target-chain-link`).
                report('exclusionCtlTargetInLink', at, data);
              }
              break;
            }
          }

          // Выборка по тегу и по сообщению: шаблон она или строка, зависит от
          // движка — и от этого зависит, что будет снято.
          if (site.by !== 'id' && site.pattern !== null && site.pattern !== '' && !dynamic) {
            const review = reviewRegex(site.pattern);
            const value = short(site.pattern);
            if (matching === 'regex' && review.regex === null && review.unsupported === null) {
              report('exclusionBadPattern', at, { name, value, reason: review.reason ?? '' });
              // Шаблон не собрался: «ничего не нашёл» — уже следствие.
              continue;
            } else if (options.engine !== 'modsecurity2') {
              const other = selectByPattern(
                scope,
                site,
                resolved.cache,
                matching === 'regex' ? 'exact' : 'regex',
              ).filter((rule) => rule !== site.carrier);
              if (/[\\^$*+?()[\]{}|]/.test(site.pattern) || other.length !== matches.length) {
                report('exclusionPatternNotPortable', at, {
                  value,
                  what: site.by === 'tag' ? 'tag' : 'message',
                });
              }
            }
          }

          if (matches.length === 0) {
            // Правило законно живёт в файле, которого здесь нет: надстройка
            // над чужим набором — обычное дело. Говорить о промахе стоит,
            // только когда видно, что тот набор загружен: у номера — что в
            // наборе есть его соседи по тысяче, у тега и сообщения — что
            // другая такая же выборка своё правило нашла.
            const loaded =
              site.by === 'id'
                ? site.ids.some((range) => {
                    // Идём по тысячам набора, а не диапазона: `1-4294967295`
                    // иначе пришлось бы перебирать миллионами.
                    const low = Math.floor(range.from / 1000);
                    const high = Math.floor(range.to / 1000);
                    for (const block of resolved.blocks) {
                      if (block >= low && block <= high) return true;
                    }
                    return false;
                  })
                : resolved.patternMatch[site.by];
            const sure = loaded && !site.incomplete && site.badIds.length === 0 && !dynamic;
            if (sure && target !== '') {
              report('exclusionNoMatch', at, { name, target }, refusedUpdate(site, scope));
            }
          } else if (applied.length === 0 && site.carrier === null) {
            // Третья версия применяет исключения после загрузки всех правил:
            // для неё порядок не важен, и промаха здесь нет.
            if (options.engine === 'modsecurity3') continue;
            // «Стоит выше правила» и «стоит в файле, который читают раньше» —
            // один промах, но чинят их по-разному.
            const rule = matches[0];
            const home = scope.files.get(rule);
            const refused = refusedUpdate(site, scope);
            if (home === file || home === undefined) {
              report('exclusionBeforeRule', at, { name, id: rule.id ?? '' }, refused);
            } else {
              report(
                'exclusionInEarlierFile',
                at,
                { name, id: rule.id ?? '', file: scope.names.get(home) ?? '' },
                refused,
              );
            }
          } else if (applied.length === 0 && site.carrier !== null) {
            report('exclusionCtlAfterRule', at, {
              name,
              id: matches[0].id ?? '',
              phase: String(site.carrier.effectivePhase),
            });
          }

          if (site.op === 'remove' && applied.length > BROAD) {
            report('exclusionTooBroad', at, { name, count: String(applied.length) });
          }

          // Правило, которое директива уже сняла целиком. Править в нём
          // нечего, а `ctl`, снимающий его второй раз, — лишняя строка.
          if (applied.length > 0) {
            let gone: ExclusionSite | null = null;
            for (const rule of applied) {
              const by = resolved.removed.get(rule);
              // Правка должна идти после удаления; для `ctl` порядок не важен:
              // правило, снятое директивой, снято с самой загрузки.
              const later = site.source === 'directive' && by !== undefined && by.order > site.order;
              if (by === undefined || by === site || later) {
                gone = null;
                break;
              }
              gone ??= by;
            }
            if (gone !== null && site.op !== 'remove') {
              report('exclusionRemovedThenUpdated', at, { name, line: String(lineOf(gone)) });
            } else if (gone !== null && site.source === 'ctl') {
              report('exclusionCtlAlreadyRemoved', at, { name, line: String(lineOf(gone)) });
            }
          }
        }
      },
    };
  },
};
