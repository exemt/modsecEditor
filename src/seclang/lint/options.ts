/**
 * Настройки линтера: что проверять, что нет и где.
 *
 * Способов сказать «это замечание мне не нужно» несколько, и они отвечают
 * на разные вопросы:
 *
 *  - **какие замечания нужны вообще** — по коду, по теме или по уровню
 *    (`only`, `codes`, `topics`, `minSeverity`). Так настраивают линтер под
 *    себя: тому, кто переносит готовый набор правил, советы по стилю ни к
 *    чему;
 *  - **в каком правиле** — по номеру (`rules`). Так принимают находку в
 *    чужом наборе, который править нельзя;
 *  - **в каком месте файла** — пометкой в комментарии (`# seclang-ignore`).
 *    Так принимают находку в своём правиле, и решение остаётся рядом с ним.
 *
 * Первая группа решается до проверки: о выключенном коде проверка даже не
 * узнаёт, что его кто-то назвал. Две другие — после, потому что зависят от
 * места, в которое замечание попало.
 */

import { statementAt } from '../ast';
import { CODES, refuses } from './codes';
import type { FileNode, Statement } from '../ast';
import type { Model, RuleInfo } from '../analyze';
import type { Engine } from '../engines';
import type { DiagnosticCode, Severity, Topic } from './codes';
import type { Check, Range } from './engine';

/** Уровень замечания либо отказ от него. */
export type Level = Severity | 'off';

export interface LintOptions {
  /**
   * Для какого движка написаны правила: `modsecurity2`, `modsecurity3`,
   * `coraza`.
   *
   * Без него линтер знает объединение всех трёх и о различиях молчит:
   * правило, верное хоть где-то, неверным не считается. С ним — говорит
   * о действиях, операторах, переменных и директивах, которых в этом
   * движке нет, а для Coraza ещё и о записях в шаблонах, которых нет в
   * регулярных выражениях Go.
   */
  engine?: Engine;
  /**
   * Проверять только это: всё, что не названо, выключено.
   *
   * Удобно, когда нужен один вопрос к большому набору: «где сравнение не
   * совпадёт из-за регистра?»
   */
  only?: readonly DiagnosticCode[];
  /**
   * По коду: `off` — не выдавать, уровень — выдавать с ним вместо словарного.
   * Сильнее, чем `topics`: названный код слушается только этой настройки.
   */
  codes?: Partial<Record<DiagnosticCode, Level>>;
  /** По теме: то же, что `codes`, но сразу для всех кодов темы. */
  topics?: Partial<Record<Topic, Level>>;
  /** Самый низкий уровень, который попадает в результат. */
  minSeverity?: Severity;
  /**
   * По номеру правила: `off` — о правиле не говорить ничего, список — не
   * говорить перечисленного. Цепочка считается одним правилом.
   */
  rules?: Readonly<Record<string, 'off' | readonly DiagnosticCode[]>>;
  /**
   * Слушать ли пометки в комментариях файла. По умолчанию — да.
   *
   *     # seclang-ignore: caseNeverMatches     ← правило ниже, только этот код
   *     # seclang-ignore                       ← правило ниже, всё
   *     # seclang-ignore-file: phasePartial    ← весь файл
   *
   * Выключают их там, где нужен честный ответ о файле: в отчёте о чужом
   * наборе пометки его автора — не довод.
   */
  comments?: boolean;
  /** Свой набор проверок вместо стандартного. */
  checks?: readonly Check[];
  /**
   * Какие файлы данных существуют: список путей либо функция «есть ли
   * такой». Без настройки ссылки на файлы не проверяются — линтер работает
   * с текстом и о диске ничего не знает.
   *
   * С ней `@pmFromFile` и `@ipMatchFromFile` сверяются с тем, что названо:
   * файла, которого нет, движок не простит — конфигурация не загрузится.
   * Функции вторым аргументом приходит имя файла правил, если оно известно:
   * относительный путь движок отсчитывает от него.
   */
  files?: readonly string[] | ((path: string, from: string | undefined) => boolean);
}

const RANK: Record<Severity, number> = { advice: 0, warning: 1, error: 2 };

const CODE_NAMES = Object.keys(CODES) as DiagnosticCode[];

/**
 * Уровень замечания с учётом настроек и того, какие движки запись не
 * загружают; `null` — замечание не выдаётся.
 *
 * Таблица считается один раз на проверку файла, чтобы в горячем месте — на
 * каждом замечании — остались обращение к ней и пара сравнений.
 *
 * Порядок решений: выключенное остаётся выключенным; уровень, который
 * человек назначил сам (`codes`, `topics`), сильнее отказа движков — он
 * сказал, как к этому относиться; порог `minSeverity` применяется последним,
 * к уже окончательному уровню, иначе предупреждение, ставшее ошибкой, под
 * него бы не прошло.
 */
export function resolveLevels(
  options: LintOptions,
): (code: DiagnosticCode, refusedBy?: readonly Engine[]) => Severity | null {
  const only = options.only === undefined ? null : new Set<string>(options.only);
  const floor = options.minSeverity === undefined ? 0 : RANK[options.minSeverity];
  const table = {} as Record<DiagnosticCode, Severity | null>;
  const chosen = new Set<DiagnosticCode>();

  for (const code of CODE_NAMES) {
    const spec = CODES[code];
    const own = options.codes?.[code] ?? options.topics?.[spec.topic];
    let level: Level = own ?? spec.severity;
    if (own !== undefined) chosen.add(code);
    if (only !== null && !only.has(code)) level = 'off';
    table[code] = level === 'off' ? null : level;
  }

  const { engine } = options;
  return (code, refusedBy = CODES[code].refusedBy) => {
    let level = table[code];
    if (level === null) return null;
    if (!chosen.has(code) && refusedBy.length > 0 && refuses(refusedBy, engine)) level = 'error';
    return RANK[level] < floor ? null : level;
  };
}

/* ------------------------------------------------------------------ */
/* Отказ по месту                                                      */
/* ------------------------------------------------------------------ */

/** Замечание ровно настолько, насколько оно нужно, чтобы решить его судьбу. */
interface Located {
  code: string;
  start: number;
}

/** Замечание о самой пометке: его добавляет не проверка, а разбор пометок. */
export interface PragmaIssue extends Range {
  code: 'unknownIgnoreCode' | 'unusedIgnore';
  data: Record<string, string>;
}

/** Пометка в комментарии и то, что она покрывает. */
interface Pragma extends Range {
  /** Границы покрытого: правило ниже либо весь файл. */
  from: number;
  to: number;
  /** Названные коды; `null` — пометка снимает всё. */
  codes: ReadonlySet<string> | null;
  /** Сняла ли она хоть что-нибудь. */
  used: boolean;
}

export interface Mute {
  /** Снято ли это замечание — пометкой либо настройкой по номеру правила. */
  muted(item: Located): boolean;
  /** Что сказать о самих пометках, когда всё остальное отфильтровано. */
  finish(): PragmaIssue[];
}

const IGNORE = /^seclang-ignore(-file)?(?:[:\s]+(.*))?$/;

function ruleByStatement(model: Model): Map<Statement, RuleInfo> {
  const owners = new Map<Statement, RuleInfo>();
  for (const rule of model.rules) {
    owners.set(rule.head, rule);
    for (const condition of rule.conditions) owners.set(condition.node, rule);
  }
  return owners;
}

/** Границы правила целиком: от головы до последнего звена цепочки. */
function ruleSpan(rule: RuleInfo): Range {
  const last = rule.conditions[rule.conditions.length - 1];
  return { start: rule.head.start, end: last === undefined ? rule.head.end : last.node.end };
}

/**
 * Собирает из настроек и пометок файла ответ на вопрос «снято ли это
 * замечание». `null` — снимать нечего, и фильтровать результат не нужно.
 */
export function buildMute(file: FileNode, model: Model, options: LintOptions): Mute | null {
  const byRule =
    options.rules !== undefined && Object.keys(options.rules).length > 0 ? options.rules : null;

  const pragmas: Pragma[] = [];
  const issues: PragmaIssue[] = [];
  let owners: Map<Statement, RuleInfo> | null = null;

  if (options.comments !== false) {
    const { statements } = file;
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      // Комментариев в файле тысячи, пометок — единицы: поиск подстроки
      // отсекает почти всё раньше, чем дело дойдёт до разбора.
      if (statement.kind !== 'Comment' || statement.text.indexOf('seclang-ignore') === -1) continue;
      const match = IGNORE.exec(statement.text.trim());
      if (match === null) continue;

      const names = (match[2] ?? '').split(/[\s,]+/).filter((name) => name !== '');
      // Опечатка в коде не снимает ничего, а замечание при этом остаётся —
      // и понять, почему пометка не работает, по ней самой нельзя.
      for (const name of names) {
        if (!(name in CODES)) {
          issues.push({
            code: 'unknownIgnoreCode',
            start: statement.start,
            end: statement.end,
            data: { name },
          });
        }
      }
      const codes = names.length === 0 ? null : new Set(names);

      if (match[1] !== undefined) {
        pragmas.push({
          start: statement.start,
          end: statement.end,
          from: 0,
          to: file.end,
          codes,
          used: false,
        });
        continue;
      }

      // Пометка относится к ближайшему утверждению ниже; между ними могут
      // стоять другие комментарии — описание правила, например.
      let next = i + 1;
      while (next < statements.length && statements[next].kind === 'Comment') next++;
      const target = statements[next];
      if (target === undefined) continue;

      owners ??= ruleByStatement(model);
      const rule = owners.get(target);
      const span = rule === undefined ? target : ruleSpan(rule);
      pragmas.push({
        start: statement.start,
        end: statement.end,
        from: span.start,
        to: span.end,
        codes,
        used: false,
      });
    }
  }

  if (byRule === null && pragmas.length === 0 && issues.length === 0) return null;

  // Пометка, которая ничего не сняла, лишняя — но судить об этом можно,
  // только когда замечания не отсеяны ещё и настройками: иначе «ничего не
  // сняла» значило бы всего лишь «её замечание сейчас выключено».
  const plain =
    options.only === undefined &&
    options.codes === undefined &&
    options.topics === undefined &&
    options.minSeverity === undefined;

  return {
    muted(item) {
      let muted = false;
      for (const pragma of pragmas) {
        if (item.start < pragma.from || item.start > pragma.to) continue;
        if (pragma.codes !== null && !pragma.codes.has(item.code)) continue;
        pragma.used = true;
        muted = true;
      }
      if (muted) return true;

      if (byRule !== null) {
        const statement = statementAt(file, item.start);
        if (statement !== null) {
          owners ??= ruleByStatement(model);
          const id = owners.get(statement)?.id;
          const setting = id === null || id === undefined ? undefined : byRule[id];
          if (setting === 'off') return true;
          if (setting !== undefined && (setting as readonly string[]).includes(item.code)) {
            return true;
          }
        }
      }
      return false;
    },

    finish() {
      if (plain) {
        for (const pragma of pragmas) {
          if (pragma.used) continue;
          issues.push({ code: 'unusedIgnore', start: pragma.start, end: pragma.end, data: {} });
        }
      }
      return issues;
    },
  };
}
