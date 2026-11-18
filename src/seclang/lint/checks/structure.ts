/**
 * Форма записи: то, что видно, не вникая в смысл правила.
 *
 * Имена, которых нет в языке, недостающие и лишние аргументы, обязательные
 * действия, целостность цепочки. Почти всё здесь — ошибки: с такой записью
 * ModSecurity конфигурацию либо не загрузит, либо молча прочитает не так.
 */

import {
  actionSpec,
  directiveName,
  operatorSpec,
  transformSpec,
  variableSpec,
} from '../../catalog';
import { findAction } from '../../ast';
import { REFUSED } from '../codes';
import type {
  ActionListNode,
  ActionNode,
  OperatorNode,
  Statement,
  VariableListNode,
} from '../../ast';
import type { Phase, VariableSpec } from '../../catalog';
import type { Check, Range } from '../engine';

/** Обрезает значение до длины, на которой сообщение ещё читается. */
function short(value: string, limit = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Имя директивы: замечание о директиве целиком показывать на нём. */
function nameOf(statement: Exclude<Statement, { kind: 'Comment' }>): Range {
  return { start: statement.start, end: statement.nameEnd };
}

/** То, что парсер не смог прочитать однозначно, и число аргументов. */
export const syntax: Check = {
  name: 'syntax',
  create({ file, options, report }) {
    const exactlyOne = (node: Exclude<Statement, { kind: 'Comment' }>) => {
      if (node.argCount !== 1) {
        report('directiveArgCount', node, { name: node.name, count: String(node.argCount) });
      }
    };

    /**
     * Кавычки вокруг аргументов. Вторая версия читает строку директивы
     * средствами Apache и терпима: оператор и действия можно не закавычивать
     * вовсе или взять в одинарные кавычки. У третьей версии и у Coraza
     * разбор свой, и двойные кавычки там — часть грамматики. С областями
     * проверки наоборот: закавыченный список Coraza не читает.
     */
    const quoting = (
      variables: VariableListNode | null,
      operator: OperatorNode | null,
      actions: ActionListNode | null,
    ): void => {
      const before = (node: Range) => file.source.charAt(node.start - 1);
      if (operator !== null && before(operator) !== '"') {
        report('unquotedArgument', operator, { part: 'operator' });
      } else if (actions !== null && before(actions) !== '"') {
        report('unquotedArgument', actions, { part: 'action list' });
      }
      if (variables !== null && variables.items.length > 0 && before(variables) === '"') {
        // Параметр в кавычках или с пробелом иначе не записать — о нём
        // говорит своя проверка, и говорит точнее.
        const forced = variables.items.some(
          (v) => v.selector !== null && (v.selector.quoted || /\s/.test(v.selector.value)),
        );
        if (!forced) report('quotedTargets', variables);
      }
    };

    return {
      File() {
        for (const issue of file.issues) {
          switch (issue.code) {
            case 'unterminatedQuote':
              report('unbalancedQuotes', issue);
              break;
            case 'unterminatedMacro':
              report('unterminatedMacro', issue);
              break;
            case 'unterminatedValueQuote':
              report('unclosedValueQuote', issue);
              break;
            case 'textAfterQuote':
              report('textAfterQuote', issue, {
                text: file.source.slice(issue.start, issue.end).slice(0, 40),
              });
              break;
            case 'invalidQuotedPair':
              // Третья версия и Coraza значение в кавычках берут как есть.
              if (options.engine === undefined || options.engine === 'modsecurity2') {
                report('invalidQuotedPair', issue, {
                  pair: file.source.slice(issue.start, issue.end),
                });
              }
              break;
            case 'continuationSpace':
              // Coraza обрезает строку перед тем, как искать перенос.
              if (options.engine !== 'coraza') report('continuationSpace', issue);
              break;
            default:
              break;
          }
        }
      },
      SecRule(node) {
        if (node.argCount < 2 || node.argCount > 3) {
          report('directiveArgCount', node, { name: node.name, count: String(node.argCount) });
        } else if (node.variables !== null && node.variables.items.length === 0) {
          report('emptyTargets', nameOf(node));
        }
        quoting(node.variables, node.operator, node.actions);

        const list = node.variables;
        if (list !== null && list.items.length > 0) {
          // Пустой элемент списка — два разделителя подряд или разделитель с
          // краю. Первое не грузит ни один движок, второе — третья версия.
          const text = file.source.slice(list.start, list.end);
          if (/\|\s*\|/.test(text)) report('emptyTarget', list, { text: short(text) }, REFUSED.ALL);
          else if (/^\s*\||\|\s*$/.test(text)) report('emptyTarget', list, { text: short(text) });

          // Запятую между областями ModSecurity читает как разделитель —
          // тем же кодом, что и список действий. Coraza — как часть имени.
          for (let i = 1; i < list.items.length; i++) {
            const gap = file.source.slice(list.items[i - 1].end, list.items[i].start);
            if (!gap.includes(',')) continue;
            report('targetsCommaSeparated', { start: list.items[i - 1].end, end: list.items[i].start });
            break;
          }
        }
      },
      SecRuleScript(node) {
        if (node.argCount < 1 || node.argCount > 2) {
          report('directiveArgCount', node, { name: node.name, count: String(node.argCount) });
        }
      },
      SecAction(node) {
        exactlyOne(node);
        quoting(null, null, node.actions);
      },
      SecDefaultAction(node) {
        exactlyOne(node);
        quoting(null, null, node.actions);
      },
      SecMarker: exactlyOne,

      ActionList(list) {
        // Запятая, за которой ничего нет: вторая версия её пропускает,
        // остальные ждут действия и не дожидаются.
        const text = file.source.slice(list.start, list.end);
        const empty = /,\s*(?:\\\r?\n\s*)*(?:,|$)/.exec(text);
        if (empty !== null && list.items.length > 0) {
          const at = list.start + empty.index;
          report('emptyAction', { start: at, end: at + 1 });
        }

        // Значение без кавычек вторая версия читает до первого пробела или
        // `|`; что стоит дальше, для неё — следующее действие.
        for (const action of list.items) {
          const { value } = action;
          if (value === null || value.quoted || action.kind === 'Ctl') continue;
          const raw = file.source.slice(value.start, value.end);
          const cut = /[\s|]/.exec(raw.replace(/\\\r?\n\s*/g, (gap) => 'x'.repeat(gap.length)));
          if (cut === null) continue;
          const rest = raw.slice(cut.index + 1).trim();
          if (rest === '') continue;
          report('unquotedValueBreak', value, { name: action.name, rest: short(rest) });
        }
      },

      Comment(node) {
        // Обратный слэш в конце комментария продолжает его следующей строкой
        // — и та перестаёт быть правилом. Закомментированное многострочное
        // правило так и задумано; фраза, случайно кончившаяся слэшем, — нет.
        if (node.endLine === node.line) return;
        const lines = file.source.slice(node.start, node.end).split('\n');
        if (/^#\s*(?:Sec[A-Za-z]|Include)/.test(lines[0])) return;
        const swallowed = lines.slice(1).some((line) => {
          const text = line.trim();
          return text !== '' && !text.startsWith('#');
        });
        if (swallowed) {
          report('commentSwallowsLine', { start: node.start, end: node.start + lines[0].length });
        }
      },
    };
  },
};

/** Имена, которых каталог не знает, и значения там, где их не бывает. */
export const names: Check = {
  name: 'names',
  create({ options, report }) {
    const valueRequired = (node: ActionNode) => {
      if (node.value === null || node.value.value === '') {
        report('actionValueRequired', node, { name: node.name });
      }
    };

    return {
      Directive(node) {
        // Чужие директивы — `Include`, `<IfModule>` — не наше дело: судить
        // можно только о тех, что принадлежат ModSecurity.
        if (!/^sec/i.test(node.name)) return;
        if (directiveName(node.name) === null) {
          report('unknownDirective', nameOf(node), { name: node.name });
        }
      },
      Variable(node) {
        if (variableSpec(node.name) === null) {
          const at = { start: node.nameStart, end: node.nameEnd };
          report('unknownVariable', at, { name: node.name });
        }
      },
      Operator(node) {
        if (node.implicit) return;
        const spec = operatorSpec(node.name);
        const at = { start: node.nameStart, end: node.nameEnd };
        if (spec === null) {
          report('unknownOperator', at, { name: node.name });
        } else if (options.engine === 'coraza' && spec.name !== node.name) {
          // ModSecurity имена операторов сравнивает без учёта регистра,
          // Coraza — буква в букву: `@RX` и `@beginswith` для неё не существуют.
          report('operatorCase', at, { name: node.name, canonical: spec.name });
        }
      },
      Transform(node) {
        if (node.transform === '') {
          report('actionValueRequired', node, { name: node.name });
        } else if (transformSpec(node.transform) === null) {
          report('unknownTransform', node.value ?? node, { name: node.transform });
        }
      },
      Setvar: valueRequired,
      Ctl: valueRequired,
      Action(node) {
        const spec = actionSpec(node.name);
        if (spec === null) {
          const at = { start: node.nameStart, end: node.nameEnd };
          report('unknownAction', at, { name: node.name });
        } else if (spec.value === 'required') {
          valueRequired(node);
        } else if (spec.value === 'none' && node.value !== null) {
          report('actionValueUnexpected', node, { name: node.name });
        }
      },
    };
  },
};

function eachAction(list: ActionListNode | null, visit: (action: ActionNode) => void): void {
  if (list !== null) for (const action of list.items) visit(action);
}

/** Правило целиком: номер, фаза, цепочка. */
export const rules: Check = {
  name: 'rules',
  create({ model, report }) {
    return {
      rule(rule) {
        const { head } = rule;
        if (rule.id === null) {
          // Правилу на Lua номер не обязателен: движок делает для него
          // исключение, и в CRS такие правила без номера есть.
          if (head.kind !== 'SecRuleScript') report('missingId', nameOf(head));
        } else if (model.scope.ids.get(rule.id)?.[0] !== rule) {
          // Лишнее из двух правил с одним номером — то, что загружено позже.
          report('duplicateId', rule.idNode ?? nameOf(head), { id: rule.id });
        }

        // Фаза, не записанная в правиле, может прийти из `SecDefaultAction`.
        if (rule.phaseNode === null && !rule.hasDefaults) {
          report('missingPhase', nameOf(head));
        }

        if (rule.phase !== null && rule.phaseNode !== null) {
          let required: Phase = 1;
          let partial: VariableSpec | null = null;
          for (const condition of rule.conditions) {
            for (const target of condition.targets) {
              const { spec } = target;
              if (target.node.exclude || spec === null) continue;
              if (spec.minPhase > required) required = spec.minPhase;
              if (spec.minPhase <= rule.phase && spec.fullPhase > rule.phase) partial ??= spec;
            }
          }
          if (required > rule.phase) {
            report('phaseTooEarly', rule.phaseNode, {
              phase: String(rule.phase),
              required: String(required),
            });
          } else if (partial !== null) {
            // Правило сработает, но увидит не всё: в первой фазе в `ARGS`
            // есть только параметры строки запроса.
            report('phasePartial', rule.phaseNode, {
              name: partial.name,
              phase: String(rule.phase),
              required: String(partial.fullPhase),
            });
          }
        }

        if (rule.dangling) {
          const last = rule.conditions[rule.conditions.length - 1];
          report('danglingChain', findAction(last.node.actions, 'chain') ?? nameOf(last.node));
        }

        for (let i = 1; i < rule.conditions.length; i++) {
          const link = rule.conditions[i].node;
          // Действия «шапки» на звене движок либо отвергает, либо молча
          // игнорирует; в обоих случаях автор ждал другого.
          eachAction(link.actions, (action) => {
            const spec = action.kind === 'Action' ? actionSpec(action.name) : null;
            if (spec === null || !spec.headOnly) return;
            // Реакцию в звене не грузит ни один движок; номер, фазу и
            // сообщение третья версия и Coraza молча пропускают.
            const refused = spec.exclusive === 'disruptive' ? REFUSED.ALL : REFUSED.V2;
            report('chainLinkHeadAction', action, { name: action.name }, refused);
          });
          // Третья версия ищет список действий и на следующей строке: звено
          // без него годится, только если дальше пустая строка или конец файла.
          if (link.actions === null) {
            const { source } = model.file;
            const eol = source.indexOf('\n', link.end);
            const after = eol === -1 ? -1 : source.indexOf('\n', eol + 1);
            const next = eol === -1 ? '' : source.slice(eol + 1, after === -1 ? source.length : after);
            if (next.trim() !== '') report('linkWithoutActions', nameOf(link));
          }
        }
      },
    };
  },
};
