/**
 * Компилятор правил: разобранный документ → модель визуального конструктора.
 *
 * Это шлюз между двумя вкладками редактора. Текст остаётся источником правды,
 * но перейти в визуальный режим можно только если текст «собирается»: то есть
 * компилятор смог разложить его в {@link VisualModel} и не нашёл ошибок.
 * Предупреждения и советы переход не блокируют — они лишь подсвечиваются.
 *
 * Здесь остались только структурные проверки: без них правило не загрузится
 * в ModSecurity или не имеет однозначного визуального представления —
 * разорванная цепочка, отсутствующий или дублирующийся `id`, `id` на звене
 * цепочки, непарные кавычки, незнакомая директива, условие без областей
 * проверки или с незнакомым оператором.
 *
 * Всё, что касается смысла правила, живёт в `checks.ts` и вызывается отдельным
 * проходом из `inspect.ts`. Проход именно отдельный, а не по ходу разбора:
 * смысловые проверки должны видеть весь файл. `skipAfter` ссылается на метку
 * ниже, `TX:score` кто-то должен был выставить выше, а `SecRuleEngine
 * DetectionOnly` в начале файла меняет смысл каждого `deny` после него.
 *
 * Ошибок смысловой проход не выдаёт вовсе — и это не совпадение, а условие
 * его отложенности: `ok` должен быть известен сразу, иначе визуальная вкладка
 * открывалась бы и через мгновение блокировалась.
 */

import { DIRECTIVES } from '../components/syntax/modsecKeywords';
import { isDisruptive, isHeadOnlyAction } from './semantics';
import { Diagnostics } from './diagnostics';
import { checkConditionStructure } from './checks';
import { inspectDocument } from './inspect';
import { emptyActions } from './model';
import type { Diagnostic } from './diagnostics';
import type {
  VisualActions,
  VisualBlock,
  VisualCondition,
  VisualModel,
  VisualRule,
  VisualTarget,
} from './model';
import type {
  ParsedDocument,
  ParsedStatement,
  RuleAction,
  RuleVariable,
  SecRuleStatement,
} from './types';

export type {
  Diagnostic,
  DiagnosticAnchor,
  DiagnosticCode,
  DiagnosticSeverity,
  DiagnosticTopic,
} from './diagnostics';

export interface CompileResult {
  /** Ошибок нет — визуальный режим доступен. */
  ok: boolean;
  /** Модель конструктора; `null`, если есть блокирующие ошибки. */
  model: VisualModel | null;
  /**
   * Блоки, разложенные компилятором, — даже когда модель заблокирована.
   *
   * Смысловому проходу они нужны и в этом случае: правило без `id` в
   * конструктор не пустят, но сказать о нём всё остальное можно и полезно.
   */
  blocks: VisualBlock[];
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  /** Советы считаются отдельно: они не должны красить сводку. */
  adviceCount: number;
}

/* ------------------------------------------------------------------ */
/* Вспомогательные проверки                                            */
/* ------------------------------------------------------------------ */

/** Непарные двойные кавычки в строке директивы (частая опечатка). */
function hasUnbalancedQuotes(raw: string): boolean {
  let count = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\') {
      i++;
      continue;
    }
    if (raw[i] === '"') count++;
  }
  return count % 2 === 1;
}

const KNOWN_DIRECTIVES = new Set<string>(DIRECTIVES);

/* ------------------------------------------------------------------ */
/* Цели: сборка термов одной переменной                                */
/* ------------------------------------------------------------------ */

/**
 * Превращает плоский список переменных в цели конструктора.
 *
 * Термы одной переменной собираются в одну область проверки, но только по
 * одному из двух способов сразу: `VAR:a|VAR:b` даёт перечень параметров, а
 * `VAR|!VAR:a` — ту же коллекцию с вычитанием. Смешивать нельзя, потому что
 * в ModSecurity это разные операции над одним набором: перечень задаёт
 * набор, а `!` вычитает из уже набранного.
 *
 * Поэтому голый терм (`VAR`) и терм с параметром (`VAR:a`) в одну цель не
 * сливаются: `VAR|VAR:a` — это по-прежнему вся коллекция, а не параметр `a`.
 * По той же причине не сливаются термы с разным подсчётом `&`.
 */
export function groupTargets(variables: RuleVariable[]): VisualTarget[] {
  const targets: VisualTarget[] = [];
  /** Цель переменной, в перечень которой ложится очередной параметр. */
  const listing = new Map<string, VisualTarget>();
  /** Цель переменной, из которой можно вычитать: её база — вся коллекция. */
  const subtractable = new Map<string, VisualTarget>();

  for (const v of variables) {
    if (v.exclusion) {
      const host = subtractable.get(v.name);
      if (host) {
        host.mode = 'except';
        host.params.push(v.selector ?? '');
        continue;
      }
      // Вычитать не из чего: положительной части у переменной нет. Такая
      // цель показывается отдельной строкой и помечается предупреждением.
      const orphan: VisualTarget = {
        name: v.name,
        count: v.count,
        mode: 'except',
        params: [v.selector ?? ''],
        excludeOnly: true,
      };
      targets.push(orphan);
      subtractable.set(v.name, orphan);
      continue;
    }

    if (v.selector === undefined) {
      const whole: VisualTarget = { name: v.name, count: v.count, mode: 'only', params: [] };
      targets.push(whole);
      subtractable.set(v.name, whole);
      // Дальнейшие параметры этой переменной относятся уже не к ней:
      // рядом с целой коллекцией перечень значит отдельную цель.
      listing.delete(v.name);
      continue;
    }

    const host = listing.get(v.name);
    if (host !== undefined && host.count === v.count) {
      host.params.push(v.selector);
      continue;
    }

    const listed: VisualTarget = {
      name: v.name,
      count: v.count,
      mode: 'only',
      params: [v.selector],
    };
    targets.push(listed);
    listing.set(v.name, listed);
  }

  return targets;
}

/* ------------------------------------------------------------------ */
/* Действия                                                            */
/* ------------------------------------------------------------------ */

/** Раскладывает плоский список действий в структуру для форм конструктора. */
export function toVisualActions(actions: RuleAction[]): VisualActions {
  const out = emptyActions();

  for (const a of actions) {
    switch (a.name) {
      case 'id':
        out.id = a.value ?? '';
        break;
      case 'phase':
        out.phase = a.value ?? '';
        break;
      case 'status':
        out.status = a.value ?? '';
        break;
      case 'msg':
        out.msg = a.value ?? '';
        break;
      case 'logdata':
        out.logdata = a.value ?? '';
        break;
      case 'severity':
        out.severity = a.value ?? '';
        break;
      case 'ver':
        out.ver = a.value ?? '';
        break;
      case 'rev':
        out.rev = a.value ?? '';
        break;
      case 'maturity':
        out.maturity = a.value ?? '';
        break;
      case 'accuracy':
        out.accuracy = a.value ?? '';
        break;
      case 'tag':
        if (a.value) out.tags.push(a.value);
        break;
      case 'setvar':
        if (a.value) out.setvar.push(a.value);
        break;
      case 'capture':
        out.capture = true;
        break;
      case 'log':
        out.log = true;
        break;
      case 'nolog':
        out.log = false;
        break;
      case 'auditlog':
        out.auditlog = true;
        break;
      case 'noauditlog':
        out.auditlog = false;
        break;
      // Конвейер трансформаций принадлежит условию, а `chain` — структуре.
      case 't':
      case 'chain':
        break;
      default:
        if (isDisruptive(a.name)) {
          out.disruptive = a.name;
          // У `redirect` и `proxy` адрес записан значением действия. Взять
          // одно имя значило бы потерять его при первой же правке в форме.
          out.disruptiveValue = a.value ?? '';
        } else out.extra.push(a);
    }
  }

  return out;
}

/** Список трансформаций правила в порядке следования. */
function transformsOf(actions: RuleAction[]): string[] {
  return actions
    .filter((a) => a.name === 't' && a.value !== undefined)
    .map((a) => a.value as string);
}

/* ------------------------------------------------------------------ */
/* Компиляция                                                          */
/* ------------------------------------------------------------------ */

/** Комментарии, стоящие вплотную перед утверждением `index`. */
function leadingComments(
  statements: ParsedStatement[],
  index: number,
): { startIndex: number; comments: string[] } {
  let start = index;
  const comments: string[] = [];
  for (let i = index - 1; i >= 0 && statements[i].kind === 'comment'; i--) {
    comments.unshift((statements[i] as { text: string }).text);
    start = i;
  }
  return { startIndex: start, comments };
}

/** Превращает одну директиву `SecRule` в условие конструктора. */
function toCondition(
  rule: SecRuleStatement,
  statementIndex: number,
  comments: string[] = [],
): VisualCondition {
  return {
    key: `cond-${statementIndex}`,
    statementIndex,
    comments,
    targets: groupTargets(rule.variables),
    transforms: transformsOf(rule.actions),
    operator: {
      name: rule.operator.name,
      negated: rule.operator.negated,
      argument: rule.operator.argument,
    },
  };
}

/**
 * Компилирует документ в модель конструктора.
 *
 * Возвращает `ok: false`, если найдены блокирующие ошибки — в этом случае
 * визуальная вкладка должна быть недоступна, а пользователь остаётся
 * в текстовом редакторе с подсвеченным списком проблем.
 */
export function compileDocument(doc: ParsedDocument | null): CompileResult {
  const diag = new Diagnostics();

  if (doc === null) {
    diag.report('notParsed');
    return {
      ok: false,
      model: null,
      blocks: [],
      diagnostics: diag.items,
      errorCount: 1,
      warningCount: 0,
      adviceCount: 0,
    };
  }

  const { statements } = doc;
  const blocks: VisualBlock[] = [];
  const seenIds = new Map<string, number>();

  let i = 0;
  while (i < statements.length) {
    const statement = statements[i];

    if (statement.kind === 'comment' || statement.kind === 'blank') {
      i++;
      continue;
    }

    const line = statement.span.startLine;
    diag.at(line);
    if (hasUnbalancedQuotes(statement.raw)) diag.report('unbalancedQuotes');

    const { startIndex, comments } = leadingComments(statements, i);

    if (statement.kind === 'SecRule') {
      // Собираем цепочку: звенья идут подряд, между ними допустимы комментарии.
      const conditions: VisualCondition[] = [toCondition(statement, i)];
      const headIndex = i;
      let tailIndex = i;
      let current: SecRuleStatement = statement;

      while (current.chained) {
        let next = tailIndex + 1;
        while (
          next < statements.length &&
          (statements[next].kind === 'comment' || statements[next].kind === 'blank')
        ) {
          next++;
        }
        const link = statements[next];
        if (link === undefined || link.kind !== 'SecRule') {
          diag.at(current.span.startLine).report('danglingChain');
          break;
        }
        conditions.push(toCondition(link, next, leadingComments(statements, next).comments));

        // Звено цепочки не должно нести действия «шапки» — они игнорируются
        // ModSecurity и почти всегда означают ошибку автора правила.
        for (const a of link.actions) {
          if (a.name !== 't' && a.name !== 'chain' && isHeadOnlyAction(a.name)) {
            diag.at(link.span.startLine).report('chainLinkHeadAction', { name: a.name });
          }
        }

        tailIndex = next;
        current = link;
      }

      const actions = toVisualActions(statement.actions);

      diag.at(line);
      if (actions.id === '') {
        diag.report('missingId');
      } else {
        if (seenIds.has(actions.id)) diag.report('duplicateId', { id: actions.id });
        seenIds.set(actions.id, line);
      }

      const rule: VisualRule = {
        key: `rule-${headIndex}`,
        startIndex,
        headIndex,
        tailIndex,
        comments,
        conditions,
        actions,
      };
      blocks.push({ kind: 'rule', key: rule.key, rule });

      conditions.forEach((condition, position) => {
        // «Условие 1» у правила без цепочки — лишнее уточнение.
        const chained = conditions.length > 1 ? { condition: position + 1 } : {};
        diag.at(statements[condition.statementIndex]?.span.startLine ?? line, {
          ruleKey: rule.key,
          ...chained,
        });
        checkConditionStructure(condition, diag);
      });

      i = tailIndex + 1;
      continue;
    }

    if (statement.kind === 'SecAction') {
      const actions = toVisualActions(statement.actions);
      if (actions.id === '') {
        diag.report('missingId');
      } else if (seenIds.has(actions.id)) {
        diag.report('duplicateId', { id: actions.id });
      } else {
        seenIds.set(actions.id, line);
      }
      blocks.push({
        kind: 'action',
        key: `action-${i}`,
        startIndex,
        statementIndex: i,
        comments,
        actions,
      });
      i++;
      continue;
    }

    if (statement.kind === 'SecMarker') {
      blocks.push({
        kind: 'marker',
        key: `marker-${i}`,
        startIndex,
        statementIndex: i,
        comments,
        label: statement.label,
      });
      i++;
      continue;
    }

    // Обобщённая директива: имя должно быть известным, иначе это опечатка.
    if (!KNOWN_DIRECTIVES.has(statement.name)) {
      diag.report('unknownDirective', { name: statement.name });
    }
    blocks.push({
      kind: 'directive',
      key: `directive-${i}`,
      startIndex,
      statementIndex: i,
      comments,
      name: statement.name,
      args: statement.args,
    });
    i++;
  }

  const errorCount = diag.count('error');
  const ok = errorCount === 0;

  return {
    ok,
    model: ok ? { blocks } : null,
    blocks,
    diagnostics: byLine(diag.items),
    errorCount,
    warningCount: diag.count('warning'),
    adviceCount: diag.count('advice'),
  };
}

/**
 * Сообщения в порядке файла, а не в порядке проверок.
 *
 * Читать удобнее так: сначала всё про первое правило, потом про второе.
 * Сортировка устойчива, поэтому у сообщений об одной строке сохраняется
 * порядок проверок — от структуры к смыслу.
 */
export function byLine(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort((a, b) => (a.line ?? 0) - (b.line ?? 0));
}

/**
 * Компиляция вместе со смысловым проходом, разом и до конца.
 *
 * Приложение так не делает: смысловой проход оно ведёт отдельно и по частям.
 * Но там, где нужен полный ответ о документе — в тестах и в разборе примеров, —
 * дробить его не на что, а собирать два вызова руками каждый раз незачем.
 */
export function analyzeDocument(doc: ParsedDocument | null): CompileResult {
  const compiled = compileDocument(doc);
  if (doc === null) return compiled;

  const semantic = inspectDocument(compiled.blocks, doc.statements);
  const diagnostics = byLine([...compiled.diagnostics, ...semantic]);
  const count = (severity: Diagnostic['severity']) =>
    diagnostics.filter((d) => d.severity === severity).length;

  return {
    ...compiled,
    diagnostics,
    errorCount: count('error'),
    warningCount: count('warning'),
    adviceCount: count('advice'),
  };
}
