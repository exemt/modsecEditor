/**
 * Макросы и аргументы операторов: то, что стоит справа от имени.
 *
 * Здесь собрано то, о чём нельзя судить по одному лишь типу значения:
 * есть ли такая переменная в макросе, раскроет ли оператор макрос вообще,
 * читается ли список адресов, не написан ли шаблон там, где ищут буквально.
 * И два вопроса к правилу целиком: не противоречат ли друг другу сравнения
 * в цепочке и не повторяет ли правило уже сказанное.
 */

import { RULE_FIELDS, operatorSpec, variableSpec } from '../../catalog';
import { ENGINES, ENGINE_LABELS, expandsMacros, urlDecodedBy } from '../../engines';
import { REFUSED } from '../codes';
import { activeSteps } from '../../analyze';
import { BLOCKING } from '../../symbols';
import { isValidIpEntry } from '../../ip';
import { Fact, hasFact } from '../../value';
import type { OperatorNode } from '../../ast';
import type { ConditionInfo, RuleInfo } from '../../analyze';
import type { Check } from '../engine';

/** Обрезает значение до длины, на которой сообщение ещё читается. */
function short(value: string, limit = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

const RULE_KEYS = new Set(RULE_FIELDS);

/** Имена в макросах: существует ли переменная и раскроет ли её оператор. */
export const macros: Check = {
  name: 'macros',
  create({ report, file, options }) {
    return {
      Macro(node) {
        if (node.name === '') return;
        // В области проверки параметр пишут через двоеточие, и рука тянется
        // написать так же в макросе. Вторая версия и Coraza делят имя только
        // по точке: `%{ARGS:id}` для них — переменная с именем `ARGS:id`.
        if (
          node.key !== null &&
          options.engine !== 'modsecurity3' &&
          file.source.charAt(node.start + 2 + node.name.length) === ':'
        ) {
          report('macroKeySeparator', node, { name: node.name, key: node.key });
        }
        const spec = variableSpec(node.name);
        if (spec === null) {
          // Третья версия и Coraza разбирают макрос при загрузке и незнакомой
          // переменной не прощают; вторая подставит пустоту на запросе.
          report(
            'unknownMacro',
            node,
            { name: node.key === null ? node.name : `${node.name}.${node.key}` },
            REFUSED.V3_CORAZA,
          );
          return;
        }
        // У `RULE` полей немного, и все названы: `%{rule.mgs}` — опечатка.
        if (spec.name === 'RULE' && node.key !== null && !RULE_KEYS.has(node.key.toLowerCase())) {
          report('unknownMacro', node, { name: `${node.name}.${node.key}` });
        }
      },

      Operator(node) {
        const spec = operatorSpec(node.name);
        if (spec === null || spec.arg === 'none') return;
        if (expandsMacros(options.engine, spec.name, spec.macros)) return;
        // Оператор разбирает аргумент один раз, при загрузке: макрос для него —
        // обычные символы, и сравнивать он будет с ними.
        const macro = node.argument.macros[0];
        if (macro === undefined) return;
        // Список адресов вторая версия разбирает при загрузке — и текст
        // макроса адресом не считает.
        const refused = spec.arg === 'ipList' ? REFUSED.V2 : REFUSED.NONE;
        report('macroNotExpanded', macro, { name: spec.name }, refused);
      },
    };
  },
};

/* ------------------------------------------------------------------ */
/* Аргументы операторов                                                */
/* ------------------------------------------------------------------ */

/** Запись списка байтов: `32-126`, `9`. */
function isByteRange(entry: string): boolean {
  // Пробелы вокруг чисел движок пропускает: читает он их через `atoi`.
  const match = /^(\d{1,3})\s*(?:-\s*(\d{1,3}))?$/.exec(entry.trim());
  if (match === null) return false;
  const from = Number(match[1]);
  const to = match[2] === undefined ? from : Number(match[2]);
  return from <= 255 && to <= 255 && from <= to;
}

/**
 * В буквальном значении видна попытка написать шаблон.
 *
 * Признаки подобраны так, чтобы не спутать шаблон с обычным текстом: точка,
 * звёздочка и доллар сами по себе встречаются в путях и ценах, а вот `.*`,
 * экранированный метасимвол или класс символов в буквальном сравнении почти
 * наверняка означают, что автор ждал шаблона.
 */
function looksLikeRegex(value: string): boolean {
  if (/\.[*+]/.test(value)) return true;
  // `\d+` — шаблон, `c:\windows` — путь: класс символов узнаётся по тому,
  // что слово за ним не продолжается.
  if (/\\[dwsDWS](?![A-Za-z])/.test(value)) return true;
  if (/\\[.*+?^$(){}|[\]]/.test(value)) return true;
  if (/\(\?[:=!]/.test(value)) return true;
  // Скобки сами по себе встречаются в тексте (`$_GET[id]`, `[url]`); шаблон
  // выдаёт диапазон внутри них или квантор сразу за ними.
  if (/\[\^?[^\]]*\w-\w[^\]]*\]/.test(value)) return true;
  if (/\[\^?[^\]]+\][*+?{]/.test(value)) return true;
  if (/\{\d+(,\d*)?\}/.test(value)) return true;
  return value.length > 1 && value.startsWith('^');
}

/** Переменные с текстом, который пришёл от клиента как есть. */
const USER_INPUT = new Set([
  'ARGS',
  'ARGS_NAMES',
  'ARGS_GET',
  'ARGS_GET_NAMES',
  'ARGS_POST',
  'ARGS_POST_NAMES',
  'QUERY_STRING',
  'REQUEST_URI',
  'REQUEST_URI_RAW',
  'REQUEST_LINE',
  'REQUEST_BODY',
  'REQUEST_HEADERS',
  'REQUEST_COOKIES',
  'REQUEST_FILENAME',
  'REQUEST_BASENAME',
  'FILES',
  'FILES_NAMES',
  'RESPONSE_BODY',
]);

/** Множество чисел, которое пропускает одно числовое сравнение. */
interface Span {
  min: number;
  max: number;
  minOpen: boolean;
  maxOpen: boolean;
}

function spanOf(node: OperatorNode): Span | null {
  const value = node.argument.value.trim();
  if (node.negated || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  const all = { min: -Infinity, max: Infinity, minOpen: false, maxOpen: false };
  switch (node.name.toLowerCase()) {
    case 'eq':
      return { min: n, max: n, minOpen: false, maxOpen: false };
    case 'gt':
      return { ...all, min: n, minOpen: true };
    case 'ge':
      return { ...all, min: n };
    case 'lt':
      return { ...all, max: n, maxOpen: true };
    case 'le':
      return { ...all, max: n };
    default:
      return null;
  }
}

function intersect(a: Span, b: Span): Span {
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  return {
    min,
    max,
    minOpen: (a.min === min && a.minOpen) || (b.min === min && b.minOpen),
    maxOpen: (a.max === max && a.maxOpen) || (b.max === max && b.maxOpen),
  };
}

function isEmpty(span: Span): boolean {
  return span.min > span.max || (span.min === span.max && (span.minOpen || span.maxOpen));
}

/** Отпечаток областей условия: по нему узнаётся «то же самое проверяют». */
function targetsKey(condition: ConditionInfo): string {
  return condition.targets
    .map(({ node }) => {
      const prefix = (node.exclude ? '!' : '') + (node.count ? '&' : '');
      return `${prefix}${node.name.toUpperCase()}:${node.selector === null ? '' : node.selector.value}`;
    })
    .sort()
    .join('|');
}

/** Отпечаток условия целиком: области, конвейер, оператор. */
function conditionKey(condition: ConditionInfo): string {
  const operator = condition.node.operator;
  const steps = condition.pipeline.steps
    .filter((step) => !step.inherited)
    .map((step) => step.node.transform.toLowerCase())
    .join('.');
  const check =
    operator === null
      ? ''
      : `${operator.negated ? '!' : ''}${operator.name.toLowerCase()} ${operator.argument.value}`;
  return `${targetsKey(condition)}#${steps}#${check}`;
}

/** Сравнения с одним значением: отрицание у них значит «пусть будет вот это». */
const GATES = new Set(['streq', 'eq', 'ipMatch', 'ipMatchFromFile', 'ipMatchF']);

/** Макрос из хранилища, где лежат ключи и токены: `%{SESSION.csrf_token}`. */
const PERSISTENT_MACRO = /^(?:session|user|global|ip|resource)$/i;

/** Коллекции, элемент которых клиент может просто не прислать. */
const CLIENT_SENT = new Set([
  'ARGS',
  'ARGS_GET',
  'ARGS_POST',
  'REQUEST_HEADERS',
  'REQUEST_COOKIES',
]);

/** Правило останавливает запрос: само или последним звеном цепочки. */
function blocks(rule: RuleInfo): boolean {
  const lists = [rule.head.actions, ...rule.conditions.slice(1).map((c) => c.node.actions)];
  return lists.some(
    (list) => list !== null && list.items.some((action) => BLOCKING.has(action.name.toLowerCase())),
  );
}

/** Правило ослабляет проверку, а не усиливает: снимает правила, перепрыгивает, пропускает. */
function relaxes(rule: RuleInfo): boolean {
  // `ctl` обычно стоит в последнем звене цепочки, а не в голове.
  const lists = [rule.head.actions, ...rule.conditions.slice(1).map((c) => c.node.actions)];
  return lists.some(
    (list) =>
      list !== null &&
      list.items.some(
        (action) => action.kind === 'Ctl' || /^(?:skip|skipafter|allow)$/i.test(action.name),
      ),
  );
}

/** Действия, от которых зависит, что правило делает, — без паспорта. */
const PASSPORT = /^(?:id|msg|tag|rev|ver|severity|maturity|accuracy|logdata)$/;

function behaviourKey(rule: RuleInfo): string {
  const parts: string[] = [];
  const lists = [rule.head.actions, ...rule.conditions.slice(1).map((c) => c.node.actions)];
  for (const list of lists) {
    if (list === null) continue;
    for (const action of list.items) {
      const name = action.name.toLowerCase();
      if (action.kind === 'Transform' || PASSPORT.test(name)) continue;
      parts.push(`${name}:${action.value === null ? '' : action.value.value}`);
    }
  }
  return parts.sort().join(',');
}

/** Аргументы операторов и согласованность условий правила. */
export const operands: Check = {
  name: 'operands',
  create({ model, report, options }) {
    /** Отпечаток правила → номер первого правила с таким же. */
    const firstWith = new Map<string, string>();

    return {
      condition(condition) {
        const node = condition.node.operator;
        const spec = condition.operator;
        if (node === null || spec === null) return;

        const value = node.argument.value.trim();
        const dynamic = node.argument.macros.length > 0;

        if (spec.arg === 'ipList' && value !== '' && !dynamic) {
          // ModSecurity режет список по запятым и отдаёт куски как есть:
          // пробел рядом с запятой делает адрес нечитаемым. Coraza пробелы
          // вокруг адреса убирает сама.
          const strict = options.engine !== 'coraza';
          // Пустой элемент — запятая в конце — пропускается всеми.
          const bad = value
            .split(',')
            .filter((entry) => entry.trim() !== '')
            .filter((entry) => !isValidIpEntry(entry) || (strict && entry !== entry.trim()));
          if (bad.length > 0) {
            report('invalidIpEntry', node.argument, { value: short(bad.join(', ')) });
          }
        }

        if (spec.arg === 'byteRange' && value !== '' && !dynamic) {
          // Пробелы внутри записи ModSecurity пропускает, Coraza — нет.
          const loose = options.engine !== 'coraza';
          const bad = value
            .split(',')
            .filter((entry) => !isByteRange(entry) || (!loose && /\s/.test(entry.trim())));
          if (bad.length > 0) {
            // Число вне байта не грузит никто. Диапазон задом наперёд Coraza
            // принимает, а буквы вместо чисел вторая версия читает как ноль.
            const numbers = (entry: string) => /^\s*\d+\s*(?:-\s*\d+\s*)?$/.test(entry);
            const tooLarge = bad.some((entry) => numbers(entry) && (entry.match(/\d+/g) ?? []).some((n) => Number(n) > 255));
            // Запись, в которой неверны только пробелы, не грузит одна Coraza.
            const onlySpaces = bad.every((entry) => isByteRange(entry));
            const refused = tooLarge
              ? REFUSED.ALL
              : onlySpaces
                ? REFUSED.CORAZA
                : bad.every(numbers)
                  ? REFUSED.V2_V3
                  : REFUSED.V3_CORAZA;
            report('invalidByteRange', node.argument, { value: short(bad.join(', ')) }, refused);
          }
        }

        // Проверять кодирование после раскодирования не на чем.
        if (spec.name === 'validateUrlEncoding') {
          const decode = activeSteps(condition.pipeline).find(
            (step) => step.spec !== null && /^urldecode/i.test(step.spec.name),
          );
          if (decode !== undefined && decode.spec !== null) {
            report('validateAfterDecode', node.implicit ? node : { start: node.nameStart, end: node.nameEnd }, {
              name: spec.name,
              decode: decode.spec.name,
            });
          } else {
            // Раскодировать может и сам движок, ещё до преобразований. Тогда
            // проверка не просто бесполезна, а ошибается: верное `%25zz`
            // приходит как `%zz` и проверку не проходит (стенд,
            // `decode-validate-args`). Кто что раскодирует — `urlDecodedBy`.
            const asked = options.engine === undefined ? ENGINES : [options.engine];
            for (const target of condition.targets) {
              const { node: variable, spec: known } = target;
              if (variable.exclude || variable.count || known === null) continue;
              const by = urlDecodedBy(known.name, condition.rule.effectivePhase).filter((e) =>
                asked.includes(e),
              );
              if (by.length === 0) continue;
              report('validateDecodedInput', variable, {
                variable: known.name,
                engines: by.map((e) => ENGINE_LABELS[e]).join(', '),
              });
              break;
            }
          }
        }

        if (spec.name === 'pm' && value !== '' && !/\s/.test(value)) {
          report('singlePhraseList', node.argument, { value: short(value) });
        }

        // `@within` ищет значение внутри списка как подстроку: `ET` найдётся в
        // `GET POST` (сценарий `within-substring`). Список, где каждое слово
        // обнесено разделителем (`|GET| |POST|`), — известный приём против
        // этого, его не трогаем.
        if (spec.name === 'within' && value !== '' && !dynamic) {
          const words = value.split(/\s+/).filter((word) => word !== '');
          const fenced = words.every((word) => word.length > 2 && /^[|,;/]/.test(word) && word.endsWith(word[0]));
          const longest = words.reduce((a, b) => (b.length > a.length ? b : a), '');
          if (!fenced && longest.length > 1) {
            const escaped = words.map((word) => word.replace(/[.\\+*?()[\]{}^$|/]/g, '\\$&'));
            report('withinSubstring', node.argument, {
              value: short(value),
              sample: longest.slice(1),
              pattern: short(`\\A(?:${escaped.join('|')})\\z`, 60),
            });
          }
        }

        // Отрицание на названном параметре: если его не прислали вовсе,
        // правило не исполняется, и «не равно» не срабатывает (сценарий
        // `negated-on-missing-variable`). У проверки формата (`!@rx ^\d+$`)
        // так и задумано; у сравнения с одним значением — почти никогда.
        // Сравнивают с ключом — буквальным или хранимым в сессии; сверка
        // двух заголовков между собой (`%{TX.1}`) без одного из них и не нужна.
        const gate = node.argument.macros.every((macro) => PERSISTENT_MACRO.test(macro.name));
        if (node.negated && gate && GATES.has(spec.name) && blocks(condition.rule)) {
          const named = condition.targets.filter(({ node: target }) => !target.exclude);
          const missing =
            named.length > 0 &&
            named.every(
              ({ node: target }) =>
                !target.count &&
                CLIENT_SENT.has(target.name.toUpperCase()) &&
                target.selector !== null &&
                !target.selector.pattern &&
                target.selector.value !== '',
            );
          // Присутствие уже проверяет другое правило: `&X "@eq 0"`.
          const checked = (name: string, key: string) =>
            model.scope.rules.some((rule) =>
              rule.conditions.some((c) =>
                c.targets.some(
                  ({ node: t }) =>
                    t.count &&
                    t.name.toUpperCase() === name &&
                    t.selector !== null &&
                    t.selector.value.toLowerCase() === key,
                ),
              ),
            );
          const unchecked =
            missing &&
            named.some(({ node: t }) => !checked(t.name.toUpperCase(), (t.selector?.value ?? '').toLowerCase()));
          if (unchecked) {
            const first = named[0].node;
            const target = `${first.name}:${first.selector?.value ?? ''}`;
            report('negatedOnMissing', node.implicit ? node : { start: node.nameStart, end: node.nameEnd }, {
              target,
              name: spec.name,
            });
          }
        }
        if (spec.name === 'rbl') {
          report('rblOnHotPath', node.implicit ? node : { start: node.nameStart, end: node.nameEnd });
        }

        if (spec.literal && value !== '' && !dynamic && looksLikeRegex(value)) {
          report('literalWithRegexSyntax', node.argument, { name: spec.name, value: short(value) });
        }

        // Количество и длина не бывают отрицательными: сравнение с нулём снизу
        // ничего не проверяет, а «меньше нуля» не выполнится никогда.
        const { seen } = condition.pipeline;
        if (hasFact(seen, Fact.NonNegative) && /^-?\d+$/.test(value)) {
          const n = Number(value);
          const name = spec.name;
          const always = (name === 'ge' && n <= 0) || (name === 'gt' && n < 0);
          const never =
            (name === 'lt' && n <= 0) || (name === 'le' && n < 0) || (name === 'eq' && n < 0);
          // Отрицание меняет их местами: `!@ge 0` не выполнится никогда.
          if (node.negated ? never : always) report('alwaysTrueComparison', node.argument);
          if (node.negated ? always : never) report('neverTrueComparison', node.argument);
        }

        // Буквальное сравнение с текстом от клиента — без единого
        // преобразования: регистр и кодирование выбирает тот, кто шлёт запрос.
        const untouched = condition.pipeline.steps.length === condition.pipeline.activeFrom;
        // С отрицанием совет не нужен: «всё, кроме этого слова» от чужого
        // регистра становится только строже. Не нужен он и правилу, которое
        // не ловит, а пропускает: исключение, не узнавшее `/WP-Admin/`,
        // просто не сработает, и проверка останется на месте. На наборах
        // исключений CRS без этой оговорки совет стоял бы на каждой строке.
        if (
          untouched &&
          spec.literal &&
          !node.negated &&
          !relaxes(condition.rule) &&
          !dynamic &&
          /[A-Za-z]/.test(value) &&
          condition.targets.some(
            ({ node: target }) =>
              !target.exclude && !target.count && USER_INPUT.has(target.name.toUpperCase()),
          )
        ) {
          report('noNormalisation', node.argument);
        }
      },

      rule(rule) {
        const { conditions } = rule;
        if (conditions.length === 0) return;

        // Звенья цепочки соединены по «и»: два числовых сравнения одной и той
        // же области обязаны иметь общее решение.
        const spans = new Map<string, { span: Span; label: string }>();
        const keys = new Set<string>();

        for (const condition of conditions) {
          const key = conditionKey(condition);
          if (keys.has(key)) report('duplicateCondition', condition.node.operator ?? condition.node);
          keys.add(key);

          const operator = condition.node.operator;
          if (operator === null) continue;
          const span = spanOf(operator);
          if (span === null) continue;
          const targets = targetsKey(condition);
          const label = `@${operator.name} ${operator.argument.value.trim()}`;
          const earlier = spans.get(targets);
          if (earlier === undefined) {
            spans.set(targets, { span, label });
            continue;
          }
          const merged = intersect(earlier.span, span);
          if (isEmpty(merged)) {
            report('impossibleNumericRange', operator.argument, {
              first: earlier.label,
              second: label,
            });
          }
          spans.set(targets, { span: merged, label });
        }

        // Повтор правила — те же условия в той же фазе с теми же действиями.
        // Одни условия с разными действиями повтором не считаются: так в CRS
        // записаны переходы по уровню паранойи, и у каждого своя метка.
        if (rule.id === null) return;
        const signature = `${rule.effectivePhase}|${[...keys].join('&&')}|${behaviourKey(rule)}`;
        const twin = firstWith.get(signature);
        if (twin === undefined) firstWith.set(signature, rule.id);
        else if (twin !== rule.id) report('duplicateRule', rule.idNode ?? rule.head, { id: twin });
      },
    };
  },
};
