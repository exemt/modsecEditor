/**
 * Парсер SecLang: текст конфигурации → дерево из `ast.ts`.
 *
 * Проход один, по исходной строке, без промежуточных копий: границы узлов
 * считаются в смещениях исходника, а подстрока вырезается только там, где
 * узлу нужно значение. Утверждения друг от друга не зависят — связывать
 * звенья цепочки и считать типы парсер не берётся, это работа `analyze.ts`.
 *
 * Разбор трёхслойный, как и сама запись:
 *
 *  1. Физические строки собираются в утверждение: строка с нечётным числом
 *     `\` в конце продолжается следующей.
 *  2. Утверждение режется на аргументы по пробелам; двойные кавычки
 *     группируют, `\"` внутри них — кавычка.
 *  3. Аргументы `SecRule` и `SecAction` разбираются своими грамматиками:
 *     список областей проверки, оператор, список действий.
 *
 * Второй слой меняет текст — снимает кавычки, `\"` и переносы, — а третий
 * читает уже снятое. Чтобы границы узлов третьего слоя всё равно указывали
 * в исходник, каждый аргумент помнит, что и где из него вырезано
 * ({@link RawArg.cuts}). Обычно не вырезано ничего, и пересчёт сводится
 * к сложению.
 *
 * Парсер не бросает исключений и не отказывается от ввода: чего не хватает,
 * то остаётся `null`, а что не читается однозначно — попадает в
 * `FileNode.issues`.
 *
 * Трактовка записи следует движку (вторая версия, `msre_create_rule` и
 * `msre_parse_generic`), а не удобству: перенос внутри кавычек исчезает
 * бесследно, пробел в конце аргумента оператора остаётся его частью,
 * а имена директив регистр не различают.
 */

import type {
  ActionListNode,
  ActionNode,
  ArgumentNode,
  ExclusionBy,
  ExclusionOp,
  FileNode,
  MacroNode,
  OperatorNode,
  SelectorNode,
  SetvarOp,
  Statement,
  SyntaxIssue,
  TextNode,
  VariableListNode,
  VariableNode,
} from './ast';

const TAB = 9;
const LF = 10;
const CR = 13;
const SPACE = 32;
const BANG = 33;
const QUOTE = 34;
const HASH = 35;
const PERCENT = 37;
const AMP = 38;
const APOSTROPHE = 39;
const COMMA = 44;
const DOT = 46;
const SLASH = 47;
const COLON = 58;
const AT = 64;
const BACKSLASH = 92;
const BRACE_OPEN = 123;
const PIPE = 124;
const BRACE_CLOSE = 125;
const BOM = 0xfeff;

/** Один на все значения без макросов: таких подавляющее большинство. */
const NO_MACROS: readonly MacroNode[] = Object.freeze([]);

function isSpace(code: number): boolean {
  return code === SPACE || code === TAB || code === CR || code === LF;
}

/* ------------------------------------------------------------------ */
/* Аргументы верхнего уровня                                           */
/* ------------------------------------------------------------------ */

/**
 * Аргумент директивы до того, как стал узлом.
 *
 * `text` — то, что читает следующий слой: без кавычек, `\"` и переносов.
 * `base` и `cuts` возвращают позицию в `text` обратно в исходник.
 */
interface RawArg {
  /** Границы в исходнике вместе с кавычками. */
  start: number;
  end: number;
  quoted: boolean;
  text: string;
  /** Смещение в исходнике, которому отвечает `text[0]`. */
  base: number;
  /**
   * Вырезанное из середины: пары «позиция в `text`, сколько символов
   * исходника пропущено до неё всего». `null` — ничего не вырезано.
   *
   * Сумма накопленная, а не по одной вырезке: тогда сдвиг для любой позиции
   * находится делением пополам. Список действий на сотню строк — это сотня
   * вырезок и сотни узлов, и перебор подряд стоил бы их произведения.
   */
  cuts: number[] | null;
  /** В тексте есть `%{` — без этого макросы в значениях не ищутся вовсе. */
  macros: boolean;
}

/** Смещение в исходнике, с которого начинается `text[index]`. */
function sourceStart(arg: RawArg, index: number): number {
  const { cuts } = arg;
  if (cuts === null) return arg.base + index;

  let low = 0;
  let high = (cuts.length >> 1) - 1;
  let shift = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (cuts[middle << 1] <= index) {
      shift = cuts[(middle << 1) + 1];
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return arg.base + index + shift;
}

/**
 * Смещение в исходнике сразу за `text[index - 1]`.
 *
 * Не то же, что {@link sourceStart}: если следом за символом вырезан
 * перенос, конец узла должен остаться на своей строке, а не уехать на
 * следующую вместе с переносом.
 */
function sourceEnd(arg: RawArg, index: number): number {
  return index === 0 ? sourceStart(arg, 0) : sourceStart(arg, index - 1) + 1;
}

function rawArg(
  start: number,
  end: number,
  quoted: boolean,
  text: string,
  base: number,
  cuts: number[] | null,
): RawArg {
  return { start, end, quoted, text, base, cuts, macros: text.indexOf('%{') !== -1 };
}

/** Длина переноса `\` + конец строки в позиции `i`; ноль — переноса нет. */
function continuationAt(source: string, i: number, to: number): number {
  // Пробелы между `\` и концом строки переносу мешают — движку, но не
  // замыслу автора: строка читается как продолженная, а о пробелах парсер
  // говорит отдельно (`continuationSpace`).
  let j = i + 1;
  let next = source.charCodeAt(j);
  while (next === SPACE || next === TAB) next = source.charCodeAt(++j);
  if (next === LF) return j + 1 <= to ? j + 1 - i : 0;
  if (next === CR && source.charCodeAt(j + 1) === LF) return j + 2 <= to ? j + 2 - i : 0;
  return 0;
}

/** Пропускает пробелы и переносы между аргументами. */
function skipSpace(source: string, from: number, to: number): number {
  let i = from;
  while (i < to) {
    const code = source.charCodeAt(i);
    if (isSpace(code)) {
      i++;
    } else if (code === BACKSLASH) {
      const length = continuationAt(source, i, to);
      if (length === 0) break;
      i += length;
    } else {
      break;
    }
  }
  return i;
}

/**
 * Читает один аргумент, начиная с непробельного символа.
 *
 * Сначала пробуется короткий путь: аргумент без `\` внутри — это либо
 * слово, либо текст между двумя кавычками, и вырезается одной подстрокой.
 * Всё остальное идёт общим путём.
 */
function scanArg(source: string, from: number, to: number, issues: SyntaxIssue[]): RawArg {
  if (source.charCodeAt(from) === QUOTE) {
    let i = from + 1;
    for (; i < to; i++) {
      const code = source.charCodeAt(i);
      if (code === QUOTE) break;
      if (code === BACKSLASH) return scanArgSlow(source, from, to, issues);
    }
    const after = i + 1;
    if (i < to && (after >= to || isSpace(source.charCodeAt(after)))) {
      return rawArg(from, after, true, source.slice(from + 1, i), from + 1, null);
    }
    return scanArgSlow(source, from, to, issues);
  }

  if (source.charCodeAt(from) === APOSTROPHE) {
    const single = scanSingleQuoted(source, from, to);
    if (single !== null) return single;
  }

  let i = from;
  for (; i < to; i++) {
    const code = source.charCodeAt(i);
    if (isSpace(code)) break;
    if (code === QUOTE || code === BACKSLASH) return scanArgSlow(source, from, to, issues);
  }
  return rawArg(from, i, false, source.slice(from, i), from, null);
}

/**
 * Аргумент в одинарных кавычках: `SecAction 'id:1,phase:1,pass'`.
 *
 * Так пишут редко, но Apache это допускает: кавычка в начале слова открывает
 * аргумент, такая же закрывает, `\'` внутри — кавычка. В отличие от двойной,
 * одинарная считается только в начале слова: посреди него это обычный знак,
 * которым записаны значения действий и параметры областей проверки.
 *
 * `null` — пары у кавычки нет или за ней сразу идёт текст. Тогда слово
 * читается как обычное: гадать, где автор хотел его закончить, незачем.
 */
function scanSingleQuoted(source: string, from: number, to: number): RawArg | null {
  const cuts: number[] = [];
  let text = '';
  let pending = from + 1;

  for (let i = from + 1; i < to; i++) {
    const code = source.charCodeAt(i);
    if (code === BACKSLASH) {
      const length = continuationAt(source, i, to);
      if (length !== 0) {
        text += source.slice(pending, i);
        cuts.push(text.length, length);
        pending = i + length;
        i += length - 1;
      } else if (source.charCodeAt(i + 1) === APOSTROPHE && i + 1 < to) {
        text += source.slice(pending, i);
        cuts.push(text.length, 1);
        pending = i + 1;
        i++;
      } else {
        i++;
      }
      continue;
    }
    if (code !== APOSTROPHE) continue;

    const after = i + 1;
    if (after < to && !isSpace(source.charCodeAt(after))) return null;
    text += source.slice(pending, i);
    let total = 0;
    for (let k = 1; k < cuts.length; k += 2) {
      total += cuts[k];
      cuts[k] = total;
    }
    return rawArg(from, after, true, text, from + 1, cuts.length === 0 ? null : cuts);
  }
  return null;
}

/**
 * Общий путь: кавычки посреди слова, `\"`, `\\` и переносы.
 *
 * Кавычка переключает режим где угодно, а не только в начале слова.
 * Пара `\\` проходит насквозь обоими слэшами: разворачивать её умеет
 * только вторая версия движка, третья оставляет как есть, и выбирать за
 * автора файла, какую из них он имел в виду, парсер не вправе.
 */
function scanArgSlow(source: string, from: number, to: number, issues: SyntaxIssue[]): RawArg {
  const cuts: number[] = [];
  let text = '';
  let pending = from;
  let i = from;
  let inQuotes = false;
  let opened = -1;

  const cut = (at: number, length: number) => {
    text += source.slice(pending, at);
    cuts.push(text.length, length);
    pending = at + length;
  };

  while (i < to) {
    const code = source.charCodeAt(i);

    if (code === BACKSLASH) {
      const length = continuationAt(source, i, to);
      if (length !== 0) {
        // Вне кавычек перенос разделяет аргументы, внутри — исчезает.
        if (!inQuotes) break;
        cut(i, length);
        i += length;
      } else if (inQuotes && source.charCodeAt(i + 1) === QUOTE && i + 1 < to) {
        cut(i, 1);
        i += 2;
      } else if (inQuotes && source.charCodeAt(i + 1) === BACKSLASH && i + 1 < to) {
        i += 2;
      } else {
        i++;
      }
      continue;
    }

    if (code === QUOTE) {
      cut(i, 1);
      if (!inQuotes) opened = i;
      inQuotes = !inQuotes;
      i++;
      continue;
    }

    if (!inQuotes && isSpace(code)) break;
    i++;
  }

  text += source.slice(pending, i);
  if (inQuotes) issues.push({ code: 'unterminatedQuote', start: opened, end: opened + 1 });

  // Вырезанное в самом начале — обычно открывающая кавычка — переносится
  // в базу, а вырезанное в самом конце на пересчёт не влияет вовсе. После
  // этого у типичного аргумента в кавычках список вырезок пуст.
  let base = from;
  let first = 0;
  while (first < cuts.length && cuts[first] === 0) {
    base += cuts[first + 1];
    first += 2;
  }
  let last = cuts.length;
  while (last > first && cuts[last - 2] === text.length) last -= 2;
  const rest = first === 0 && last === cuts.length ? cuts : cuts.slice(first, last);

  let total = 0;
  for (let k = 1; k < rest.length; k += 2) {
    total += rest[k];
    rest[k] = total;
  }

  return rawArg(
    from,
    i,
    source.charCodeAt(from) === QUOTE,
    text,
    base,
    rest.length === 0 ? null : rest,
  );
}

function toArgument(arg: RawArg): ArgumentNode {
  return { kind: 'Argument', start: arg.start, end: arg.end, value: arg.text, quoted: arg.quoted };
}

/* ------------------------------------------------------------------ */
/* Значения                                                            */
/* ------------------------------------------------------------------ */

function isQuoted(raw: string): boolean {
  return (
    raw.length >= 2 &&
    raw.charCodeAt(0) === APOSTROPHE &&
    raw.charCodeAt(raw.length - 1) === APOSTROPHE
  );
}

/** Снимает одинарные кавычки и две допустимые в них пары: `\'` и `\\`. */
function unquote(raw: string): string {
  const inner = raw.slice(1, -1);
  return inner.indexOf('\\') === -1 ? inner : inner.replace(/\\(['\\])/g, '$1');
}

/**
 * Проверяет значение в одинарных кавычках так, как его читает движок.
 *
 * Список действий и список областей разбирает одна функция ModSecurity 2
 * (`msre_parse_generic`), и к кавычкам она строга: незакрытая — «Missing
 * closing quote», а `\` перед чем-либо, кроме `'` и `\`, — «Invalid quoted
 * pair». В обоих случаях конфигурация не загружается.
 *
 * До этой функции текст проходит через разбор строки директивы, который
 * сам сворачивает `\` в `\`. Поэтому считать нужно не пары, а сколько
 * слэшей останется: из `n` подряд до движка доходит `⌈n/2⌉`, и нечётный
 * остаток обязан стоять перед кавычкой. Отсюда записи, которые выглядят
 * избыточными, а на деле единственно верные: `\d` внутри кавычек пишется
 * как `\\d` — именно так он записан в CRS (`TX:'/^\\d.*WEB_ATTACK/'`).
 */
function checkQuoted(arg: RawArg, from: number, to: number, issues: SyntaxIssue[]): void {
  const { text } = arg;
  if (from >= to || text.charCodeAt(from) !== APOSTROPHE) return;

  let i = from + 1;
  while (i < to) {
    const code = text.charCodeAt(i);
    if (code === APOSTROPHE) {
      // Значение кончилось, а запись — нет: `msg:'a'b`. Остаток движок
      // читает как имя следующего действия и такого действия не находит.
      if (i + 1 < to) {
        issues.push({
          code: 'textAfterQuote',
          start: sourceStart(arg, i + 1),
          end: sourceEnd(arg, to),
        });
      }
      return;
    }
    if (code !== BACKSLASH) {
      i++;
      continue;
    }
    let run = i;
    while (run < to && text.charCodeAt(run) === BACKSLASH) run++;
    const count = run - i;
    const next = run < to ? text.charCodeAt(run) : -1;
    const left = (count >> 1) + (count & 1);
    if ((left & 1) === 0) {
      i = run;
      continue;
    }
    if (next === APOSTROPHE) {
      i = run + 1;
      continue;
    }
    // Перенос строки внутри значения — не пара: его убирают ещё до разбора.
    if (next !== LF && next !== CR && next !== SPACE && next !== TAB && next !== -1) {
      issues.push({
        code: 'invalidQuotedPair',
        start: sourceStart(arg, i),
        end: sourceEnd(arg, run + 1),
      });
      return;
    }
    i = run;
  }
  const start = sourceStart(arg, from);
  issues.push({ code: 'unterminatedValueQuote', start, end: start + 1 });
}

/** Макросы `%{...}` на отрезке текста аргумента. */
function scanMacros(
  arg: RawArg,
  from: number,
  to: number,
  issues: SyntaxIssue[],
): readonly MacroNode[] {
  if (!arg.macros) return NO_MACROS;

  const { text } = arg;
  let found: MacroNode[] | null = null;

  for (let i = from; i < to - 1; i++) {
    if (text.charCodeAt(i) !== PERCENT || text.charCodeAt(i + 1) !== BRACE_OPEN) continue;

    let close = i + 2;
    while (close < to && text.charCodeAt(close) !== BRACE_CLOSE) close++;
    if (close >= to) {
      issues.push({
        code: 'unterminatedMacro',
        start: sourceStart(arg, i),
        end: sourceEnd(arg, to),
      });
      break;
    }

    let separator = -1;
    for (let k = i + 2; k < close; k++) {
      const code = text.charCodeAt(k);
      if (code === DOT || code === COLON) {
        separator = k;
        break;
      }
    }

    (found ??= []).push({
      kind: 'Macro',
      start: sourceStart(arg, i),
      end: sourceEnd(arg, close + 1),
      name: text.slice(i + 2, separator === -1 ? close : separator),
      key: separator === -1 ? null : text.slice(separator + 1, close),
    });
    i = close;
  }

  return found ?? NO_MACROS;
}

/* ------------------------------------------------------------------ */
/* Список областей проверки                                            */
/* ------------------------------------------------------------------ */

/**
 * Делит текст списка по разделителям верхнего уровня.
 *
 * Разделитель внутри одинарных кавычек или фигурных скобок частью записи
 * и остаётся: `ARGS:'a,b'` — один терм, `%{TX.a,b}` — одно значение.
 * Отрезки отдаются уже без пробелов по краям, пустые пропускаются.
 */
function splitList(
  text: string,
  first: number,
  second: number,
  emit: (from: number, to: number) => void,
): void {
  const length = text.length;
  let chunk = 0;
  let inQuotes = false;
  let depth = 0;

  for (let i = 0; i <= length; i++) {
    if (i < length) {
      const code = text.charCodeAt(i);
      if (inQuotes) {
        // Последний символ текста пропускать нельзя: за ним ещё нужно
        // отдать незакрытый отрезок.
        if (code === BACKSLASH) {
          if (i + 1 < length) i++;
        } else if (code === APOSTROPHE) {
          inQuotes = false;
        }
        continue;
      }
      if (code === APOSTROPHE) {
        inQuotes = true;
        continue;
      }
      if (code === BRACE_OPEN) {
        depth++;
        continue;
      }
      if (code === BRACE_CLOSE) {
        if (depth > 0) depth--;
        continue;
      }
      if (depth !== 0 || (code !== first && code !== second)) continue;
    }

    let from = chunk;
    let to = Math.min(i, length);
    while (from < to && isSpace(text.charCodeAt(from))) from++;
    while (to > from && isSpace(text.charCodeAt(to - 1))) to--;
    if (from < to) emit(from, to);
    chunk = i + 1;
  }
}

/**
 * `ARGS|!ARGS:token|&REQUEST_HEADERS:Host`.
 *
 * Терм обрывает и `|`, и запятая: движок разбирает список тем же кодом,
 * что и список действий. `ARGS:a,b` поэтому — две области проверки, а
 * параметр с запятой внутри пишется только в кавычках.
 */
function readVariableList(arg: RawArg, issues?: SyntaxIssue[]): VariableListNode {
  const { text } = arg;
  const items: VariableNode[] = [];

  splitList(text, PIPE, COMMA, (from, to) => {
    let at = from;
    let exclude = false;
    let count = false;
    if (text.charCodeAt(at) === BANG) {
      exclude = true;
      at++;
    }
    if (at < to && text.charCodeAt(at) === AMP) {
      count = true;
      at++;
    }

    let colon = at;
    while (colon < to && text.charCodeAt(colon) !== COLON) colon++;

    let selector: SelectorNode | null = null;
    if (colon < to) {
      if (issues !== undefined) checkQuoted(arg, colon + 1, to, issues);
      const raw = text.slice(colon + 1, to);
      const quoted = isQuoted(raw);
      const value = quoted ? unquote(raw) : raw;
      selector = {
        kind: 'Selector',
        start: sourceStart(arg, colon + 1),
        end: sourceEnd(arg, to),
        value,
        quoted,
        pattern:
          value.length >= 2 &&
          value.charCodeAt(0) === SLASH &&
          value.charCodeAt(value.length - 1) === SLASH,
      };
    }

    items.push({
      kind: 'Variable',
      start: sourceStart(arg, from),
      end: sourceEnd(arg, to),
      name: text.slice(at, colon),
      nameStart: sourceStart(arg, at),
      nameEnd: colon === at ? sourceStart(arg, at) : sourceEnd(arg, colon),
      exclude,
      count,
      selector,
    });
  });

  return {
    kind: 'VariableList',
    start: sourceStart(arg, 0),
    end: sourceEnd(arg, text.length),
    items,
  };
}

/* ------------------------------------------------------------------ */
/* Оператор                                                            */
/* ------------------------------------------------------------------ */

/**
 * `@rx foo`, `!@eq 0`, `foo`.
 *
 * Пробел перед `!` или `@` не пропускается: движок его тоже не пропускает,
 * и `" @rx foo"` для него — шаблон из семи символов, а не оператор.
 * Сказать об этом — дело линтера, но прочитать нужно так же, как движок.
 */
function readOperator(arg: RawArg, issues: SyntaxIssue[]): OperatorNode {
  const { text } = arg;
  const length = text.length;
  let i = 0;

  let negated = false;
  if (text.charCodeAt(0) === BANG) {
    negated = true;
    i = 1;
    while (i < length && isSpace(text.charCodeAt(i))) i++;
  }

  let name = 'rx';
  let implicit = true;
  let nameStart = i;
  let nameEnd = i;

  if (i < length && text.charCodeAt(i) === AT) {
    let end = i + 1;
    while (end < length && !isSpace(text.charCodeAt(end))) end++;
    name = text.slice(i + 1, end);
    implicit = false;
    nameStart = i;
    nameEnd = end;
    i = end;
    while (i < length && isSpace(text.charCodeAt(i))) i++;
  }

  const argument: TextNode = {
    kind: 'Text',
    start: sourceStart(arg, i),
    end: i === length ? sourceStart(arg, i) : sourceEnd(arg, length),
    value: text.slice(i),
    quoted: false,
    macros: scanMacros(arg, i, length, issues),
  };

  return {
    kind: 'Operator',
    start: sourceStart(arg, 0),
    end: sourceEnd(arg, length),
    name,
    nameStart: sourceStart(arg, nameStart),
    nameEnd: nameEnd === nameStart ? sourceStart(arg, nameStart) : sourceEnd(arg, nameEnd),
    negated,
    implicit,
    argument,
  };
}

/* ------------------------------------------------------------------ */
/* Список действий                                                     */
/* ------------------------------------------------------------------ */

/** Коллекция и имя: `tx.score`, `ip:counter`. Разделитель — первый из двух. */
function splitTarget(target: string): [string, string] {
  for (let i = 0; i < target.length; i++) {
    const code = target.charCodeAt(i);
    if (code === DOT || code === COLON) return [target.slice(0, i), target.slice(i + 1)];
  }
  return [target, ''];
}

/**
 * Значение `setvar`: что, куда и как кладётся.
 *
 * Запись без `=` движок читает как «положить единицу», с `!` в начале —
 * как удаление. Обе формы разбираются: отличить опечатку от приёма по
 * одной записи нельзя, а линтеру нужны обе.
 */
function readSetvar(value: string): { target: string; op: SetvarOp; operand: string | null } {
  const body = value.trim();
  if (body.charCodeAt(0) === BANG) {
    return { target: body.slice(1).trim(), op: 'delete', operand: null };
  }
  const equals = body.indexOf('=');
  if (equals === -1) return { target: body, op: 'set', operand: null };

  const target = body.slice(0, equals).trim();
  const right = body.slice(equals + 1);
  if (right.charCodeAt(0) === 43) return { target, op: 'add', operand: right.slice(1) };
  if (right.charCodeAt(0) === 45) return { target, op: 'sub', operand: right.slice(1) };
  return { target, op: 'set', operand: right };
}

/** `id:1,phase:2,deny,t:lowercase,msg:'hi'`. */
function readActionList(arg: RawArg, issues: SyntaxIssue[]): ActionListNode {
  const { text } = arg;
  const items: ActionNode[] = [];

  splitList(text, COMMA, COMMA, (from, to) => {
    let colon = from;
    while (colon < to && text.charCodeAt(colon) !== COLON) colon++;

    let nameEnd = colon;
    while (nameEnd > from && isSpace(text.charCodeAt(nameEnd - 1))) nameEnd--;
    const name = text.slice(from, nameEnd);

    let value: TextNode | null = null;
    if (colon < to) {
      let at = colon + 1;
      while (at < to && isSpace(text.charCodeAt(at))) at++;
      checkQuoted(arg, at, to, issues);
      const raw = text.slice(at, to);
      const quoted = isQuoted(raw);
      value = {
        kind: 'Text',
        start: sourceStart(arg, at),
        end: at === to ? sourceStart(arg, at) : sourceEnd(arg, to),
        value: quoted ? unquote(raw) : raw,
        quoted,
        macros: scanMacros(arg, at, to, issues),
      };
    }

    const start = sourceStart(arg, from);
    const end = sourceEnd(arg, to);
    const nameStart = start;
    const nameStop = sourceEnd(arg, nameEnd);

    // Имена действий регистр не различают; длина отсекает почти все
    // действия раньше, чем дело дойдёт до приведения регистра.
    const lower = name.length <= 6 ? name.toLowerCase() : '';

    if (lower === 't') {
      items.push({
        kind: 'Transform',
        start,
        end,
        name,
        nameStart,
        nameEnd: nameStop,
        value,
        transform: value === null ? '' : value.value.trim(),
      });
    } else if (lower === 'setvar') {
      const { target, op, operand } = readSetvar(value === null ? '' : value.value);
      const [collection, key] = splitTarget(target);
      items.push({
        kind: 'Setvar',
        start,
        end,
        name,
        nameStart,
        nameEnd: nameStop,
        value,
        collection,
        key,
        op,
        operand,
      });
    } else if (lower === 'ctl') {
      const body = value === null ? '' : value.value.trim();
      const equals = body.indexOf('=');
      items.push({
        kind: 'Ctl',
        start,
        end,
        name,
        nameStart,
        nameEnd: nameStop,
        value,
        option: equals === -1 ? body : body.slice(0, equals).trim(),
        operand: equals === -1 ? null : body.slice(equals + 1),
      });
    } else {
      items.push({ kind: 'Action', start, end, name, nameStart, nameEnd: nameStop, value });
    }
  });

  return {
    kind: 'ActionList',
    start: sourceStart(arg, 0),
    end: sourceEnd(arg, text.length),
    items,
  };
}

/* ------------------------------------------------------------------ */
/* Утверждение                                                         */
/* ------------------------------------------------------------------ */

/** Директивы-исключения: что делает и чем выбирает. */
const EXCLUSIONS: Record<string, [ExclusionOp, ExclusionBy] | undefined> = {
  secruleremovebyid: ['remove', 'id'],
  secruleremovebymsg: ['remove', 'msg'],
  secruleremovebytag: ['remove', 'tag'],
  secruleupdatetargetbyid: ['updateTarget', 'id'],
  secruleupdatetargetbymsg: ['updateTarget', 'msg'],
  secruleupdatetargetbytag: ['updateTarget', 'tag'],
  secruleupdateactionbyid: ['updateAction', 'id'],
};

function readStatement(
  source: string,
  from: number,
  to: number,
  line: number,
  endLine: number,
  issues: SyntaxIssue[],
): Statement | null {
  let i = skipSpace(source, from, to);
  if (i >= to) return null;

  if (source.charCodeAt(i) === HASH) {
    let textStart = i + 1;
    if (textStart < to && isSpace(source.charCodeAt(textStart))) textStart++;
    let end = to;
    while (end > textStart && isSpace(source.charCodeAt(end - 1))) end--;
    const text = source.slice(textStart, end);
    return {
      kind: 'Comment',
      start: i,
      end: Math.max(end, i + 1),
      line,
      endLine,
      // Перенос в комментарии — редкость, и платить за него должен только он.
      text: endLine > line ? text.replace(/\\\r?\n/g, '') : text,
    };
  }

  const args: RawArg[] = [];
  while (i < to) {
    const arg = scanArg(source, i, to, issues);
    args.push(arg);
    i = skipSpace(source, arg.end > i ? arg.end : i + 1, to);
  }

  const head = args[0];
  const name = head.text;
  const base = {
    start: head.start,
    end: args[args.length - 1].end,
    line,
    endLine,
    name,
    nameEnd: head.end,
    argCount: args.length - 1,
  };

  // Директив десятки, а особо разбираются пять; длина имени отсекает
  // остальные без приведения регистра.
  const length = name.length;
  const special =
    length === 7 ||
    length === 9 ||
    length === 13 ||
    (length >= 16 && length <= 18) ||
    length === 23 ||
    length === 24;
  const lower = special ? name.toLowerCase() : '';

  if (lower === 'secrule') {
    return {
      kind: 'SecRule',
      ...base,
      variables: args.length > 1 ? readVariableList(args[1], issues) : null,
      operator: args.length > 2 ? readOperator(args[2], issues) : null,
      actions: args.length > 3 ? readActionList(args[3], issues) : null,
    };
  }
  if (lower === 'secaction') {
    return {
      kind: 'SecAction',
      ...base,
      actions: args.length > 1 ? readActionList(args[1], issues) : null,
    };
  }
  if (lower === 'secdefaultaction') {
    return {
      kind: 'SecDefaultAction',
      ...base,
      actions: args.length > 1 ? readActionList(args[1], issues) : null,
    };
  }
  if (lower === 'secrulescript') {
    return {
      kind: 'SecRuleScript',
      ...base,
      script: args.length > 1 ? toArgument(args[1]) : null,
      actions: args.length > 2 ? readActionList(args[2], issues) : null,
    };
  }
  if (lower === 'secmarker') {
    return { kind: 'SecMarker', ...base, label: args.length > 1 ? toArgument(args[1]) : null };
  }

  const exclusion = EXCLUSIONS[lower];
  if (exclusion !== undefined) {
    const [op, by] = exclusion;
    // Удаление по номеру принимает сколько угодно номеров и диапазонов; у
    // остальных выборка — один аргумент, а за ним идёт то, что приписать.
    const given = args.length - 1;
    const count = op === 'remove' && by === 'id' ? given : Math.min(1, given);
    const selectors: ArgumentNode[] = [];
    for (let k = 1; k <= count; k++) selectors.push(toArgument(args[k]));
    const payload = args[count + 1];
    const third = args[count + 2];
    return {
      kind: 'Exclusion',
      ...base,
      op,
      by,
      selectors,
      variables: op === 'updateTarget' && payload !== undefined ? readVariableList(payload, issues) : null,
      replaced: op === 'updateTarget' && third !== undefined ? toArgument(third) : null,
      actions:
        op === 'updateAction' && payload !== undefined ? readActionList(payload, issues) : null,
    };
  }

  const rest: ArgumentNode[] = [];
  for (let k = 1; k < args.length; k++) rest.push(toArgument(args[k]));
  return { kind: 'Directive', ...base, args: rest };
}

/* ------------------------------------------------------------------ */
/* Точки входа                                                         */
/* ------------------------------------------------------------------ */

/**
 * Разбирает текст конфигурации целиком.
 *
 * Время линейно от длины текста: строки ищутся встроенным поиском, а
 * посимвольно читается только то, что стало аргументом директивы.
 */
export function parse(source: string): FileNode {
  const statements: Statement[] = [];
  const issues: SyntaxIssue[] = [];
  const length = source.length;

  let position = source.charCodeAt(0) === BOM ? 1 : 0;
  let line = 1;

  while (position < length) {
    const from = position;
    const startLine = line;
    let lineEnd: number;

    // Строка с нечётным числом `\` в конце продолжается следующей.
    for (;;) {
      lineEnd = source.indexOf('\n', position);
      if (lineEnd === -1) {
        lineEnd = length;
        break;
      }
      let tail = lineEnd;
      if (tail > position && source.charCodeAt(tail - 1) === CR) tail--;
      let run = tail;
      while (run > position && source.charCodeAt(run - 1) === BACKSLASH) run--;
      if (((tail - run) & 1) === 0) {
        // Пробел после `\` глазом не виден, а перенос отменяет: для движка
        // строка кончается здесь, и её продолжение становится отдельной
        // директивой. Читаем так, как хотел автор, — одной строкой, — и
        // говорим об ошибке: иначе вместо одного замечания выйдет десяток
        // о двух обломках правила. Комментарию продолжение не нужно.
        let text = tail;
        while (text > position && isSpace(source.charCodeAt(text - 1))) text--;
        if (text === tail || text === position || source.charCodeAt(text - 1) !== BACKSLASH) break;
        let slashes = text;
        while (slashes > position && source.charCodeAt(slashes - 1) === BACKSLASH) slashes--;
        if (((text - slashes) & 1) === 0) break;
        let first = from;
        while (first < text && isSpace(source.charCodeAt(first))) first++;
        if (source.charCodeAt(first) === HASH) break;
        issues.push({ code: 'continuationSpace', start: text - 1, end: tail });
      }
      position = lineEnd + 1;
      line++;
    }

    const statement = readStatement(source, from, lineEnd, startLine, line, issues);
    if (statement !== null) statements.push(statement);

    position = lineEnd + 1;
    line++;
  }

  return { kind: 'File', start: 0, end: length, source, statements, issues };
}

/** Фрагмент как аргумент директивы: текст уже без внешних кавычек. */
function fragment(text: string, offset: number): RawArg {
  return rawArg(offset, offset + text.length, false, text, offset, null);
}

/**
 * Разбор отдельных частей правила.
 *
 * Нужен там, где текст приходит не из файла: форма конструктора правит
 * список действий одной строкой, и ей нужен тот же разбор, что и файлу.
 * `offset` сдвигает границы узлов, если фрагмент — часть большего текста.
 */
export function parseVariableList(text: string, offset = 0): VariableListNode {
  return readVariableList(fragment(text, offset));
}

export function parseOperator(text: string, offset = 0): OperatorNode {
  return readOperator(fragment(text, offset), []);
}

export function parseActionList(text: string, offset = 0): ActionListNode {
  return readActionList(fragment(text, offset), []);
}

/**
 * Аргументы одной директивы — так же, как их режет разбор файла.
 *
 * У разобранных директив (`SecDefaultAction`, семь исключений) дерево хранит
 * уже прочитанные части, а не сами аргументы: списку действий незачем помнить,
 * что он был вторым словом в строке. Но тому, кто показывает директиву
 * строкой или собирает её из полей, нужны именно слова — со снятыми
 * кавычками и переносами, как их увидит движок. Резать строку своим кодом
 * значило бы завести второе правило о том, где кончается аргумент.
 *
 * Первым идёт имя директивы. `offset` сдвигает границы узлов, если текст —
 * часть большего.
 */
export function parseArguments(text: string, offset = 0): ArgumentNode[] {
  const nodes: ArgumentNode[] = [];
  const issues: SyntaxIssue[] = [];
  const to = text.length;

  let i = skipSpace(text, 0, to);
  while (i < to) {
    const arg = scanArg(text, i, to, issues);
    nodes.push({
      kind: 'Argument',
      start: arg.start + offset,
      end: arg.end + offset,
      value: arg.text,
      quoted: arg.quoted,
    });
    i = skipSpace(text, arg.end > i ? arg.end : i + 1, to);
  }
  return nodes;
}
