/**
 * Регулярные выражения: соберётся ли шаблон и то ли он ищет.
 *
 * Движок считает шаблоны через PCRE, а здесь под рукой только `RegExp`.
 * Поэтому шаблон сначала переводится (`regex.ts`): встроенные флаги,
 * атомарные группы, POSIX-классы и прочее, что в PCRE пишется иначе,
 * приводится к понятному виду — и только потом компилируется. Если в
 * шаблоне есть запись, которую перевести нечем, проверка молчит: сказать
 * «некорректно» про рабочее правило хуже, чем промолчать.
 *
 * Остальное — приметы шаблона, который написан не так, как задуман:
 * подходит ко всему, оказался обычной подстрокой, может уйти в перебор.
 * Это эвристики, и подобраны они так, чтобы молчать на правилах CRS.
 */

import { reviewRegex } from '../../regex';
import { REFUSED } from '../codes';
import { countGroups, regexFeatures } from '../../regexFeatures';
import { capturesHere } from '../../symbols';
import { Fact, hasFact } from '../../value';
import { blamedForGroup } from './captures';
import { readsMatch } from './flow';
import type { RuleInfo } from '../../analyze';
import type { Check } from '../engine';

/** Обрезает значение до длины, на которой сообщение ещё читается. */
function short(value: string, limit = 40): string {
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/**
 * Шаблон без того, что мешает судить о его строении.
 *
 * Экранированный символ и класс символов — каждый один знак входа, и что
 * именно в них написано, для вопросов «есть ли группа» и «есть ли пустая
 * ветка» неважно. Зато скобка или черта внутри них сбила бы подсчёт.
 */
function skeleton(pattern: string): string {
  return pattern.replace(/\\./g, 'x').replace(/\[\^?\]?[^\]]*\]/g, 'x');
}

/** Ветви альтернативы верхнего уровня. */
function branches(text: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === '|' && depth === 0) {
      result.push(text.slice(start, i));
      start = i + 1;
    }
  }
  result.push(text.slice(start));
  return result;
}

/** Содержимое группы, если шаблон — одна группа целиком; иначе `null`. */
function unwrap(text: string): string | null {
  const open = /^\((?:\?:)?/.exec(text);
  if (open === null || text.startsWith('(?', 0) !== text.startsWith('(?:', 0)) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return i === text.length - 1 ? text.slice(open[0].length, i) : null;
    }
  }
  return null;
}

/**
 * Шаблон подходит к любому входу.
 *
 * Два способа этого добиться: написать `.*` и оставить пустую ветку в
 * альтернативе верхнего уровня (`foo|` или `(?:foo|)`). Пустая ветка внутри
 * шаблона — `colou(?:r|)s` — обычная необязательная часть, и её здесь не
 * ищут: CRS пользуется такой записью постоянно.
 */
function matchesAnything(pattern: string): boolean {
  let core = skeleton(pattern);
  let fromStart = false;
  let toEnd = false;

  for (;;) {
    const before = core;
    if (core.startsWith('^')) {
      fromStart = true;
      core = core.slice(1);
    }
    if (core.endsWith('$')) {
      toEnd = true;
      core = core.slice(0, -1);
    }
    core = unwrap(core) ?? core;
    if (core === before) break;
  }

  if (core === '.*' || core === '.*?' || core === '(?s).*') return true;
  // Пустая ветка совпадает с пустым местом в любой строке — если только
  // шаблон не прибит к обоим краям: `^(?:foo|)$` подходит лишь к пустой.
  if (fromStart && toEnd) return false;
  return core !== '' && branches(core).some((branch) => branch === '');
}

/**
 * В просмотре назад стоит неограниченный повтор: `(?<=a+)b`.
 *
 * `RegExp` такое принимает, а PCRE — нет: длину того, что стоит позади,
 * он обязан знать заранее. Правило с таким шаблоном движок не загрузит,
 * хотя здесь шаблон собирается без единой жалобы.
 */
function hasOpenLookbehind(bare: string): boolean {
  for (let at = bare.indexOf('(?<'); at !== -1; at = bare.indexOf('(?<', at + 1)) {
    const mark = bare[at + 3];
    if (mark !== '=' && mark !== '!') continue;
    let depth = 0;
    let end = at;
    for (; end < bare.length; end++) {
      if (bare[end] === '(') depth++;
      else if (bare[end] === ')' && --depth === 0) break;
    }
    if (/[*+]|\{\d+,\}/.test(bare.slice(at + 4, end))) return true;
  }
  return false;
}

/**
 * Символ не из ASCII там, где побайтовое сравнение его разрывает: внутри
 * класса `[…]` или перед повтором (`é+` повторяет последний байт). Вне этих
 * мест многобайтовый символ — просто несколько байтов подряд, и он совпадает.
 */
function byteWiseCharacter(pattern: string): string | null {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (!inClass && ch === '[') {
      inClass = true;
      // `]` сразу после `[` или `[^` — обычный символ класса.
      if (pattern[i + 1] === '^') i++;
      if (pattern[i + 1] === ']') i++;
      continue;
    }
    if (inClass && ch === ']') {
      inClass = false;
      continue;
    }
    const code = pattern.codePointAt(i) ?? 0;
    if (code <= 0x7f) continue;
    const char = String.fromCodePoint(code);
    if (inClass) return char;
    const next = pattern[i + char.length];
    if (next !== undefined && /[*+?{]/.test(next)) return char;
    i += char.length - 1;
  }
  return null;
}

/** Сколько байтов символ занимает в UTF-8. */
function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
}

/** Ведущие флаги вида `(?i)`; `(?m)` и `(?-m)` автор пишет, зная о строках. */
const LEADING_FLAGS = /^\(\?[a-zA-Z]*\)/;

/**
 * Шаблон прибит к обоим краям: начинается с `^` (после флагов) и кончается
 * неэкранированным `$`. Явный `m` в флагах — знак, что строки задуманы.
 */
function anchoredBothEnds(pattern: string): boolean {
  const flags = LEADING_FLAGS.exec(pattern);
  if (flags !== null && /m/.test(flags[0])) return false;
  const body = flags === null ? pattern : pattern.slice(flags[0].length);
  if (!body.startsWith('^') || !body.endsWith('$') || body.length < 3) return false;
  let slashes = 0;
  for (let i = body.length - 2; i >= 0 && body[i] === '\\'; i--) slashes++;
  if (slashes % 2 !== 0) return false;
  // `^.*…` и `….*$`: точка берёт и перевод строки, якорь за ней ничего не
  // решает. Если так с обеих сторон, строки шаблону безразличны.
  const inner = body.slice(1, -1);
  return !(/^\.[*+]/.test(inner) && /\.[*+]\??$/.test(inner));
}

/** Тот же шаблон с `\A` и `\z` вместо `^` и `$` по краям. */
function toTextAnchors(pattern: string): string {
  const flags = LEADING_FLAGS.exec(pattern)?.[0] ?? '';
  const body = pattern.slice(flags.length);
  return `${flags}\\A${body.slice(1, -1)}\\z`;
}

/**
 * Правило ослабляет защиту: пропускает запрос, перепрыгивает правила, снимает
 * их или выключает проверку. Такое правило, совпав там, где не должно,
 * открывает дорогу. `ctl:auditLogParts` и прочие настройки журнала — нет.
 */
function relaxes(rule: RuleInfo): boolean {
  const lists = [rule.head.actions, ...rule.conditions.slice(1).map((c) => c.node.actions)];
  return lists.some(
    (list) =>
      list !== null &&
      list.items.some((action) => {
        if (action.kind !== 'Ctl') return /^(?:skip|skipafter|allow)$/i.test(action.name);
        const value = (action.operand ?? '').trim();
        if (/^ruleRemove/i.test(action.option)) return true;
        if (/^ruleEngine$/i.test(action.option)) return /^(?:off|detectiononly)$/i.test(value);
        if (/^requestBodyAccess$/i.test(action.option)) return /^(?:off|false)$/i.test(value);
        return false;
      }),
  );
}

/** Шаблон записан без единого спецсимвола — это обычный поиск подстроки. */
function isPlainText(pattern: string): boolean {
  return pattern !== '' && !/[\\^$.*+?()[\]{}|]/.test(pattern);
}

/**
 * Номер группы, на которую шаблон ссылается и которой в нём нет; `null` —
 * все ссылки на месте. Смотрятся только `\1`–`\9`: двузначную запись PCRE
 * и сам читает как код символа, если групп меньше.
 */
function missingGroup(pattern: string): number | null {
  let wanted = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      const next = pattern[i + 1];
      if (!inClass && next >= '1' && next <= '9' && !/\d/.test(pattern[i + 2] ?? '')) {
        wanted = Math.max(wanted, Number(next));
      }
      i++;
    } else if (inClass) {
      if (char === ']') inClass = false;
    } else if (char === '[') {
      inClass = true;
    }
  }
  return wanted > countGroups(pattern) ? wanted : null;
}

/**
 * Есть ли в шаблоне слэши, которые движки прочитают по-разному.
 *
 * До ModSecurity 2 строка директивы проходит через Apache, и тот сворачивает
 * `\\` в `\`; ModSecurity 3 и Coraza получают шаблон как написан. Из `n`
 * слэшей подряд шаблон видит: без свёртки — `⌊n/2⌋` буквальных слэшей и,
 * если `n` нечётно, экранированный следующий символ; после свёртки — то же
 * самое, посчитанное от `⌈n/2⌉`. Запись расходится, когда расходится число
 * буквальных слэшей либо когда экранирование следующего символа у одного
 * есть, у другого нет — и для этого символа оно что-то значит.
 *
 * Отсюда и то, что выглядит странно, но переносимо: `[\\\\]` (четыре слэша в
 * классе) — класс со слэшем у всех, `[\\\(]` — слэш и скобка у всех. А вот
 * `[\\/]` — слэш или косая черта без свёртки и одна косая черта после неё.
 */
export function hasAmbiguousBackslashes(pattern: string): boolean {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char !== '\\') {
      if (char === '[' && !inClass) inClass = true;
      else if (char === ']' && inClass) inClass = false;
      continue;
    }
    let run = i;
    while (run < pattern.length && pattern[run] === '\\') run++;
    const count = run - i;
    const next = pattern[run] ?? '';

    const folded = (count >> 1) + (count & 1);
    const literalRaw = count >> 1;
    const literalFolded = folded >> 1;
    const escapesRaw = (count & 1) === 1;
    const escapesFolded = (folded & 1) === 1;

    // В классе важно, есть ли слэш вообще; вне его — сколько их.
    const sameLiterals = inClass
      ? literalRaw > 0 === literalFolded > 0
      : literalRaw === literalFolded;
    if (!sameLiterals) return true;
    if (escapesRaw !== escapesFolded && escapeMatters(next, inClass)) return true;

    // Нечётный хвост экранирует следующий символ: он не начало и не конец класса.
    i = escapesRaw ? run : run - 1;
  }
  return false;
}

/** Значит ли для символа что-нибудь слэш перед ним. */
function escapeMatters(char: string, inClass: boolean): boolean {
  if (char === '') return false;
  if (/[A-Za-z0-9]/.test(char)) return true;
  return inClass ? /[\]^[-]/.test(char) : /[.^$*+?()[\]{}|]/.test(char);
}

export const regexes: Check = {
  name: 'regexes',
  create({ model, options, report }) {
    return {
      Selector(node) {
        if (!node.pattern) return;
        const review = reviewRegex(node.value.slice(1, -1));
        if (review.unsupported === null && review.regex === null) {
          report('invalidSelectorPattern', node, {
            value: short(node.value),
            reason: review.reason ?? '',
          });
        }
      },

      condition(condition) {
        const node = condition.node.operator;
        const spec = condition.operator;
        if (node === null || spec === null || spec.arg !== 'regex') return;

        // Что окажется на месте макроса, станет известно только на запросе.
        const written = node.argument.value;
        if (written.trim() === '' || node.argument.macros.length > 0) return;
        // Второй версии шаблон достаётся после Apache, уже со свёрнутыми
        // парами слэшей: `\\1` для неё — обратная ссылка. Судить о шаблоне
        // нужно в том виде, в каком его увидит названный движок.
        const pattern = options.engine === 'modsecurity2' ? written.replace(/\\\\/g, '\\') : written;
        // Оператор, прочитанный как шаблон: разбирать такой «шаблон» незачем,
        // о нём уже сказано главное.
        if (node.implicit && /^\s*!*\s*@[A-Za-z]/.test(pattern)) return;

        // ModSecurity собирает шаблон побайтово: символ с кодом выше `\xff`
        // для него не существует. Coraza такие шаблоны принимает.
        const wide = /\\x\{([0-9A-Fa-f]+)\}/g;
        for (let hit = wide.exec(pattern); hit !== null; hit = wide.exec(pattern)) {
          if (Number.parseInt(hit[1], 16) > 0xff) {
            report('wideCodePoint', node.argument, { escape: hit[0] });
            break;
          }
        }

        // Два слэша подряд. Строку директивы у второй версии читает Apache и
        // пару сворачивает в один слэш; у третьей версии и Coraza разбор
        // свой, и до шаблона доходят оба. `\\d` поэтому цифра в одном движке
        // и слэш с буквой в другом. Говорить об этом стоит, пока движок не
        // назван: для одного движка запись однозначна.
        if (options.engine === undefined && hasAmbiguousBackslashes(pattern)) {
          report('backslashPair', node.argument);
        }

        const review = reviewRegex(pattern);
        // Запись PCRE, аналога которой здесь нет: шаблон рабочий, просто
        // разобрать его нечем.
        if (review.unsupported !== null) return;
        if (review.regex === null) {
          report('invalidRegex', node.argument, { name: spec.name, reason: review.reason ?? '' });
          return;
        }
        // `RegExp` ссылку на группу, которой нет, молча читает как код
        // символа. PCRE — нет: «reference to non-existent subpattern».
        const missing = missingGroup(pattern);
        if (missing !== null) {
          report(
            'invalidRegex',
            node.argument,
            { name: spec.name, reason: `Reference to group ${missing}, which the pattern does not have` },
            REFUSED.V2_V3,
          );
          return;
        }

        if (hasOpenLookbehind(skeleton(pattern))) {
          report('lookbehindNotFixed', node.argument);
          return;
        }

        // Дальше — про смысл шаблона, и только для обычного поиска: у
        // `@verifyCC` шаблон лишь отбирает кандидатов, и совет записать его
        // через `@contains` там неуместен.
        if (spec.name !== 'rx' && spec.name !== 'rxGlobal') return;

        // ModSecurity собирает шаблон без UTF-8: `é` для него два байта, и
        // `[é]` — класс из двух байтов, ни один из которых не `é`. Coraza
        // считает буквами (сценарий `non-ascii-in-class`).
        if (options.engine !== 'coraza') {
          const wide = byteWiseCharacter(pattern);
          if (wide !== null) {
            report('multibyteInClass', node.argument, {
              char: wide,
              bytes: String(utf8Length(wide)),
            });
          }
        }

        if (matchesAnything(pattern)) {
          // Шаблон «что угодно» пишут и нарочно — не чтобы отсеять, а чтобы
          // взять значение: захватить его целиком (`(.*)` с `capture`),
          // прочитать после преобразований из `MATCHED_VAR` или узнать из
          // `MATCHED_VAR_NAME`, какая переменная подошла.
          const taken = capturesHere(model.scope, condition) || readsMatch(condition);
          if (node.negated) report('negationMatchesNothing', node.argument);
          else if (!taken) report('matchesEverything', node.argument);
          return;
        }

        const bare = skeleton(pattern);

        // Группа с квантором внутри, к которой применён ещё один квантор:
        // на подобранной строке разбор такого шаблона уходит в перебор.
        if (/\([^()]*[*+][^()]*\)[*+{]/.test(bare)) report('possibleRedos', node.argument);

        // Шаблон-валидатор: `!@rx ^\d+$` пропускает то, что не цифры, — или
        // правило-исключение, которое пропускает подходящее. В третьей версии
        // и Coraza `^` и `$` — ещё и границы строк, и второй строкой в
        // значении такая проверка обходится (сценарий `anchors-negated-newline`).
        // `\A` и `\z` — края значения во всех трёх.
        const lines =
          options.engine !== 'modsecurity2' &&
          !hasFact(condition.pipeline.seen, Fact.OneLine) &&
          (node.negated || relaxes(condition.rule)) &&
          anchoredBothEnds(pattern);
        if (lines) {
          report('anchorsMatchLines', node.argument, { pattern: short(toTextAnchors(pattern), 60) });
        }

        const anchored = /^\^([^\\^$.*+?()[\]{}|]+)\$$/.exec(pattern);
        if (anchored && lines) {
          // О буквальном шаблоне сказано уже главное.
        } else if (anchored) {
          // `@streq` это только там, где `^` и `$` — края всего значения.
          // ModSecurity 2 собирает шаблон так всегда, третья версия и Coraza —
          // в многострочном режиме: `^admin$` у них найдёт `admin` и на
          // отдельной строке значения. Разницы нет, только если переводу
          // строки взяться неоткуда.
          const whole =
            options.engine === 'modsecurity2' || hasFact(condition.pipeline.seen, Fact.OneLine);
          report(whole ? 'anchoredLiteralRegex' : 'anchoredLiteralLines', node.argument, {
            value: short(anchored[1]),
          });
        } else if (isPlainText(pattern)) {
          report('regexIsPlainText', node.argument, { value: short(pattern) });
        } else if (!/[\\^$*+?()[\]{}|]/.test(pattern) && /\w\.\w/.test(pattern)) {
          // Точка среди букв — не разделитель, а «любой символ»: `admin.php`
          // подойдёт и к `adminXphp`. Говорить об этом стоит, только когда
          // шаблон в остальном буквальный.
          report('unescapedDot', node.argument, { value: short(pattern) });
        }

        // `^` перед `.*` смысла не добавляет: точка во всех трёх движках
        // совпадает и с переводом строки, так что `^.*admin` находит `admin`
        // где угодно. А `.*+` — не «что угодно», а «всё до конца, без
        // возврата»: после него шаблону искать уже нечего, и лишним его не
        // назовёшь.
        const wildcard = /^\^?\.\*(?!\+)/;
        if (wildcard.test(pattern) && pattern.replace(wildcard, '') !== '') {
          report('redundantLeadingWildcard', node.argument);
        }

        // Скобка без `?` после неё — захватывающая группа. Без `capture` в
        // этом же условии движок её считает и выбрасывает: `capture` соседа
        // по цепочке сюда не достаёт. Если правило группу всё же ждёт,
        // лишняя в нём не группа, а отсутствие `capture` — и об этом скажет
        // проверка захвата.
        const wanted =
          capturesHere(model.scope, condition) || blamedForGroup(model.scope, condition);
        // Группу может читать и сам шаблон: обратная ссылка, условие по
        // группе, повтор её как подпрограммы. Тогда она не лишняя.
        const selfRead = regexFeatures(pattern).some(
          (f) => f === 'backreference' || f === 'recursion' || f === 'conditional',
        );
        if (/\((?!\?)/.test(bare) && !wanted && !selfRead) {
          report('capturingGroupUnused', node.argument);
        }
      },
    };
  },
};
