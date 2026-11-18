/**
 * Области проверки: согласуется ли запись с тем, чем переменная является.
 *
 * Параметр у переменной, которая его не принимает; подсчёт того, что не
 * коллекция; вычитание без указания, что вычитать. Запись при этом
 * правильная и движок её загрузит — просто проверяться будет не то.
 *
 * Смотрится только список областей самого правила. Такой же список стоит в
 * директивах-исключениях, но читается он там иначе: `!ARGS:password` у
 * `SecRuleUpdateTargetById` — не вычитание из пустоты, а весь смысл записи.
 */

import { variableSpec } from '../../catalog';
import { selectorIssue, selectorPattern } from '../../quoting';
import type { SelectorNode } from '../../ast';
import type { Check } from '../engine';

/** Более узкая коллекция целиком входит в более широкую. */
const CONTAINED_IN: Record<string, string> = {
  ARGS_GET: 'ARGS',
  ARGS_POST: 'ARGS',
  ARGS_GET_NAMES: 'ARGS_NAMES',
  ARGS_POST_NAMES: 'ARGS_NAMES',
};

/**
 * Коллекции, шаблон по именам в которых Coraza сравнивает с учётом регистра.
 * Для остальных она сама переводит шаблон в нижний регистр, а ModSecurity
 * регистр не учитывает нигде (сценарии `target-pattern-case…`).
 */
const CASED_PATTERNS = new Set([
  'ARGS',
  'ARGS_NAMES',
  'ARGS_GET',
  'ARGS_POST',
  'ARGS_GET_NAMES',
  'ARGS_POST_NAMES',
]);

/**
 * Шаблон по именам параметров, который в Coraza выберет не то, что в
 * ModSecurity: в нём есть заглавная буква и нет `(?i)`. Экранированные
 * классы (`\D`, `\x2F`) и класс, где есть оба регистра, буквами не считаются.
 */
export function patternCaseDiffers(name: string, selector: SelectorNode): boolean {
  if (!selector.pattern || !CASED_PATTERNS.has(name.toUpperCase())) return false;
  const body = selector.value.replace(/^\/|\/$/g, '');
  if (/\(\?[a-zA-Z]*i/.test(body)) return false;
  const bare = body
    .replace(/\\x[0-9a-fA-F]{2}|\\[pP]\{[^}]*\}|\\./g, '')
    .replace(/\[[^\]]*\]/g, (cls) => (/a-z/.test(cls) && /A-Z/.test(cls) ? '' : cls));
  return /[A-Z]/.test(bare);
}

/** Параметр для сравнения: имя без учёта регистра, шаблон — как записан. */
export function selectorKey(selector: SelectorNode): string {
  return selector.pattern ? selector.value : selector.value.toLowerCase();
}

/** Обрезает значение до длины, на которой сообщение ещё читается. */
function short(value: string, limit = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export const targets: Check = {
  name: 'targets',
  create({ options, report }) {
    return {
      SecRule(rule) {
        const list = rule.variables;
        if (list === null) return;

        const positive = new Set<string>();
        const whole = new Set<string>();
        const seen = new Set<string>();

        for (const node of list.items) {
          const name = { name: node.name };
          const upper = node.name.toUpperCase();
          const { selector } = node;

          if (!node.exclude) {
            positive.add(upper);
            if (selector === null && !node.count) whole.add(upper);
          }

          if (node.exclude && (selector === null || selector.value === '')) {
            report('excludeWithoutSelector', node, name);
          }

          // Имя параметра движки сравнивают без учёта регистра — все три, и
          // для `ARGS`, и для куки, и для `TX` (стенд, `selector-name-case`):
          // `ARGS:Q` и `ARGS:q` — одна и та же область. Шаблон — другое
          // дело: его текст сравнивается как написан.
          const key =
            (node.exclude ? '!' : '') +
            (node.count ? '&' : '') +
            upper +
            (selector === null ? '' : `:${selectorKey(selector)}`);
          if (seen.has(key)) report('duplicateTarget', node, name);
          seen.add(key);

          if (selector !== null && options.engine !== 'modsecurity2' && options.engine !== 'modsecurity3') {
            if (patternCaseDiffers(node.name, selector)) {
              report('selectorPatternCase', selector, { value: short(selector.value) });
            }
          }

          if (selector !== null) {
            // Имя параметра с пробелом — не выдумка: браузер шлёт
            // `Add+to+Basket`, и до правила оно доходит как `Add to Basket`.
            // Записать его прямо нельзя, а обходные пути у двух версий движка
            // разные; общая форма одна — шаблон, её и предлагаем.
            const issue = selectorIssue(selector.value);
            if (issue !== null) {
              const pattern = issue === 'v2only' ? selectorPattern(selector.value) : null;
              if (pattern !== null) {
                report('selectorNeedsQuotes', selector, { value: short(selector.value), pattern });
              } else {
                report('selectorNotPortable', selector, { value: short(selector.value) });
              }
            }
          }

          const spec = variableSpec(node.name);
          if (spec === null) continue;

          if (selector !== null && spec.selector === 'none') {
            report('selectorNotSupported', selector, name);
          }
          if (selector === null && spec.selector === 'required' && !node.exclude) {
            report('selectorRequired', node, name);
          }
          if (node.count && !spec.collection) report('countOnScalar', node, name);
        }

        // Вычитать можно только из того, что есть: `!ARGS:x` без `ARGS` в
        // списке ничего не убирает.
        for (const node of list.items) {
          if (node.exclude && node.selector !== null && !positive.has(node.name.toUpperCase())) {
            report('excludeWithoutBase', node, { name: node.name });
          }
        }

        for (const inner of Object.keys(CONTAINED_IN)) {
          const outer = CONTAINED_IN[inner];
          if (!whole.has(inner) || !whole.has(outer)) continue;
          const node = list.items.find((v) => !v.exclude && v.name.toUpperCase() === inner);
          if (node !== undefined) report('overlappingTargets', node, { inner, outer });
        }
      },
    };
  },
};
