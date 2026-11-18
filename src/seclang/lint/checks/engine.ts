/**
 * Совместимость с движком: поймёт ли он то, что написано.
 *
 * Работает, только когда движок назван в настройках (`engine`). Без него
 * правило, верное хотя бы для одного движка, считается верным.
 *
 * Говорит о двух вещах. Первая — имена: действие, оператор, переменная или
 * директива, которых в этом движке нет (`engines.ts`). Вторая — шаблоны:
 * Coraza считает их регулярными выражениями Go, а в них нет просмотров,
 * обратных ссылок и запрета возврата. Имя, которого не знает и каталог,
 * здесь не трогается: о нём уже сказано как о незнакомом.
 */

import {
  actionSpec,
  directiveName,
  operatorSpec,
  transformSpec,
  variableSpec,
} from '../../catalog';
import { ENGINE_LABELS, engineSupports } from '../../engines';
import { regexFeatures } from '../../regexFeatures';
import type { ActionNode, Statement } from '../../ast';
import type { NameKind } from '../../engines';
import type { RegexFeature } from '../../regexFeatures';
import type { Check, Range } from '../engine';

const KIND_LABEL: Record<NameKind, string> = {
  variable: 'Variable',
  operator: 'Operator',
  transform: 'Transformation',
  action: 'Action',
  directive: 'Directive',
};

const FEATURE_LABEL: Record<RegexFeature, string> = {
  lookahead: 'lookahead',
  lookbehind: 'lookbehind',
  backreference: 'backreferences',
  possessive: 'possessive quantifiers',
  atomic: 'atomic groups',
  recursion: 'recursion',
  conditional: 'conditional groups',
  escape: 'PCRE-only escapes (\\K, \\G, \\Z, \\h, \\R, \\X, \\e, \\c)',
  comment: 'inline comments',
  flag: 'flags other than i, m, s, U',
  quotedName: "the (?'name'…) group syntax",
  largeRepeat: 'a repeat count above 1000',
};

export const engines: Check = {
  name: 'engines',
  create({ options, report }) {
    const { engine } = options;
    if (engine === undefined) return {};

    const label = ENGINE_LABELS[engine];

    const check = (kind: NameKind, name: string, at: Range): void => {
      if (engineSupports(engine, kind, name)) return;
      report('notInEngine', at, { kind: KIND_LABEL[kind], name, engine: label });
    };

    const directive = (node: Exclude<Statement, { kind: 'Comment' }>): void => {
      const canonical = directiveName(node.name);
      if (canonical !== null) check('directive', canonical, { start: node.start, end: node.nameEnd });
    };

    const action = (node: ActionNode): void => {
      const spec = actionSpec(node.name);
      if (spec !== null) check('action', spec.name, { start: node.nameStart, end: node.nameEnd });
    };

    return {
      SecRule: directive,
      SecAction: directive,
      SecDefaultAction: directive,
      SecMarker: directive,
      SecRuleScript: directive,
      Exclusion: directive,
      Directive(node) {
        // `<IfModule>` и прочие блоки Apache понимает только Apache: у третьей
        // версии и у Coraza разбор свой, и угловая скобка для них — ошибка.
        if (node.name.startsWith('<')) {
          if (engine !== 'modsecurity2' && !node.name.startsWith('</')) {
            report('notInEngine', { start: node.start, end: node.nameEnd }, {
              kind: 'Apache block',
              name: node.name.replace(/^<|>$/g, ''),
              engine: label,
            });
          }
          return;
        }
        directive(node);
        // Шаблон бывает и у директивы: `SecAuditLogRelevantStatus` из
        // рекомендованной конфигурации ModSecurity написан с просмотром вперёд.
        if (engine !== 'coraza' || node.name.toLowerCase() !== 'secauditlogrelevantstatus') return;
        const pattern = node.args[0];
        if (pattern === undefined) return;
        const features = regexFeatures(pattern.value);
        if (features.length > 0) {
          report('regexNotInEngine', pattern, {
            feature: features.map((feature) => FEATURE_LABEL[feature]).join(', '),
            engine: label,
          });
        }
      },

      Variable(node) {
        const spec = variableSpec(node.name);
        if (spec !== null) check('variable', spec.name, { start: node.nameStart, end: node.nameEnd });
      },

      Macro(node) {
        // Третья версия и Coraza разбирают макрос при загрузке: переменная,
        // которой у них нет, — отказ. Вторая подставит пустоту на запросе, и
        // о ней здесь молчим: так написана её же рекомендованная конфигурация.
        if (engine === 'modsecurity2') return;
        const spec = variableSpec(node.name);
        if (spec !== null) check('variable', spec.name, node);
      },

      Operator(node) {
        const spec = operatorSpec(node.name);
        if (spec === null) return;
        const at = node.implicit ? node : { start: node.nameStart, end: node.nameEnd };
        check('operator', spec.name, at);

        // Чужие шаблоны (`@verifyCC` и подобные) Coraza и так не знает как
        // операторы. Макрос в шаблоне проверке не мешает: Coraza его не
        // раскрывает и собирает шаблон при загрузке как написан.
        if (engine !== 'coraza' || spec.arg !== 'regex') return;
        const features = regexFeatures(node.argument.value);
        if (features.length > 0) {
          report('regexNotInEngine', node.argument, {
            feature: features.map((feature) => FEATURE_LABEL[feature]).join(', '),
            engine: label,
          });
        }
      },

      Action: action,
      Setvar(node) {
        action(node);
        // Коллекций, кроме `TX`, у Coraza нет: запись в них она не грузит.
        const collection = node.collection.toLowerCase();
        if (engine === 'coraza' && collection !== '' && collection !== 'tx' && !collection.includes('%{')) {
          report('notInEngine', node.value ?? node, {
            kind: 'Writing to collection',
            name: node.collection,
            engine: label,
          });
        }
      },
      Ctl: action,
      Transform(node) {
        action(node);
        const spec = transformSpec(node.transform);
        if (spec !== null) check('transform', spec.name, node.value ?? node);
      },
    };
  },
};
