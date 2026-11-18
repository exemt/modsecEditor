/**
 * Какими возможностями PCRE шаблон пользуется.
 *
 * ModSecurity считает шаблоны через PCRE и понимает всё перечисленное.
 * Coraza — через регулярные выражения Go (RE2), а в них нет ни просмотров
 * вперёд и назад, ни обратных ссылок, ни запрета возврата: RE2 гарантирует
 * линейное время и платит за это именно ими. Шаблон с такой записью Coraza
 * не скомпилирует, и правило не загрузится.
 *
 * Разбор здесь нарочно поверхностный: нужно не понять шаблон, а заметить в
 * нём запись — и не спутать её с тем же текстом внутри класса символов или
 * после обратного слэша.
 */

export type RegexFeature =
  /** `(?=…)`, `(?!…)`. */
  | 'lookahead'
  /** `(?<=…)`, `(?<!…)`. */
  | 'lookbehind'
  /** `\1`, `\g{1}`, `\k<name>`, `(?P=name)`. */
  | 'backreference'
  /** `a++`, `a*+`, `a?+`, `a{2,}+`. */
  | 'possessive'
  /** `(?>…)`. */
  | 'atomic'
  /** `(?R)`, `(?1)`, `(?&name)`. */
  | 'recursion'
  /** `(?(…)…|…)`. */
  | 'conditional'
  /** `\K`, `\G`, `\Z`, `\h`, `\R`, `\X`, `\e`, `\cX` — того, чего нет в RE2. */
  | 'escape'
  /** `(?#…)`. */
  | 'comment'
  /** Флаги, кроме `i`, `m`, `s`, `U`: `(?x)`, `(?J)`. */
  | 'flag'
  /** `(?'name'…)`. */
  | 'quotedName'
  /** Повтор больше тысячи раз: `a{1001}`. */
  | 'largeRepeat';

/** Возможности, которых нет в RE2, — в порядке первого появления в шаблоне. */
export function regexFeatures(pattern: string): RegexFeature[] {
  const found: RegexFeature[] = [];
  const add = (feature: RegexFeature) => {
    if (!found.includes(feature)) found.push(feature);
  };

  const length = pattern.length;
  let i = 0;

  while (i < length) {
    const char = pattern[i];

    if (char === '\\') {
      const next = pattern[i + 1];
      // Литерал `\Q…\E` читается как есть, что бы в нём ни стояло.
      if (next === 'Q') {
        const end = pattern.indexOf('\\E', i + 2);
        i = end === -1 ? length : end + 2;
        continue;
      }
      if (next !== undefined && ((next >= '1' && next <= '9') || next === 'g' || next === 'k')) {
        add('backreference');
      } else if (next !== undefined && 'KGZhHRXNec'.includes(next)) {
        add('escape');
      }
      i += 2;
      continue;
    }

    if (char === '[') {
      // Внутри класса `(`, `?` и `+` — обычные символы.
      i += 1;
      if (pattern[i] === '^') i += 1;
      if (pattern[i] === ']') i += 1;
      while (i < length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i += 1;
        else if (pattern[i] === '[' && pattern[i + 1] === ':') {
          const close = pattern.indexOf(':]', i + 2);
          if (close !== -1) i = close + 1;
        }
        i += 1;
      }
      i += 1;
      continue;
    }

    if (char === '(' && pattern[i + 1] === '?') {
      const head = pattern.slice(i + 2, i + 5);
      if (head[0] === '=' || head[0] === '!') add('lookahead');
      else if (head.startsWith('<=') || head.startsWith('<!')) add('lookbehind');
      else if (head[0] === '>') add('atomic');
      else if (head.startsWith('P=')) add('backreference');
      else if (head[0] === '(') add('conditional');
      else if (/^(?:R\)|\d|&|P>|[+-]\d)/.test(head)) add('recursion');
      else if (head[0] === '#') {
        add('comment');
        const close = pattern.indexOf(')', i);
        i = close === -1 ? length : close + 1;
        continue;
      } else if (head[0] === "'") add('quotedName');
      else {
        const flags = /^\(\?([A-Za-z-]+)[:)]/.exec(pattern.slice(i, i + 16));
        if (flags !== null && /[^imsU-]/.test(flags[1])) add('flag');
      }
      i += 2;
      continue;
    }

    if (char === '*' || char === '+' || char === '?') {
      // Плюс сразу за квантором — запрет возврата; вопросительный знак — лень.
      if (pattern[i + 1] === '+') {
        add('possessive');
        i += 2;
      } else {
        i += pattern[i + 1] === '?' ? 2 : 1;
      }
      continue;
    }

    if (char === '{') {
      const repeat = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(i, i + 24));
      if (repeat !== null) {
        if (Number(repeat[1]) > 1000 || Number(repeat[2] ?? 0) > 1000) add('largeRepeat');
        i += repeat[0].length;
        if (pattern[i] === '+') {
          add('possessive');
          i += 1;
        } else if (pattern[i] === '?') {
          i += 1;
        }
        continue;
      }
    }

    i += 1;
  }

  return found;
}

/**
 * Сколько в шаблоне захватывающих групп.
 *
 * Столько же `TX.1`…`TX.N` оператор заполнит при `capture`; `TX.0` —
 * совпадение целиком — есть всегда. Группа захватывает, если за скобкой
 * нет `?` или стоит имя: `(?<name>…)`, `(?P<name>…)`, `(?'name'…)`.
 */
export function countGroups(pattern: string): number {
  let groups = 0;
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === '\\') {
      i++;
    } else if (inClass) {
      if (char === ']') inClass = false;
    } else if (char === '[') {
      inClass = true;
    } else if (char === '(') {
      const head = pattern.slice(i + 1, i + 5);
      if (!head.startsWith('?') || /^\?(?:P?<[A-Za-z_]|')/.test(head)) groups++;
    }
  }
  return groups;
}
