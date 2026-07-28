import { useEffect, useMemo, useState } from 'react';
import { byLine } from '../modsec/compile';
import { inspectDocument, inspectSlices } from '../modsec/inspect';
import type { CompileResult } from '../modsec/compile';
import type { Diagnostic } from '../modsec/diagnostics';
import type { VisualBlock } from '../modsec/model';
import type { ParsedDocument, ParsedStatement } from '../modsec/types';

/**
 * Смысловой проход как часть жизни приложения: когда его вести и чем платить.
 *
 * Компиляция обязана закончиться до отрисовки — от неё зависят и модель
 * конструктора, и доступность вкладки. Смысловой проход не обязан ничем:
 * ошибок он не выдаёт, а предупреждение, появившееся на кадр позже, никому
 * ничего не испортит. Разница в том, что стоят они примерно одинаково, и на
 * большом файле это разница между «редактор открылся» и «редактор задумался».
 *
 * Поэтому проход ведётся по частям в паузах — но только там, где это имеет
 * смысл. На небольшом файле он занимает единицы миллисекунд, и откладывать
 * было бы чистым проигрышем: сложность есть, выигрыша нет, а диагностика
 * приходит с запозданием там, где могла прийти сразу.
 */

/**
 * До какого числа правил проход идёт синхронно.
 *
 * Двести исполняемых блоков — это порядка десяти миллисекунд: незаметно даже
 * при наборе текста. Настоящие файлы CRS начинаются от тысячи.
 */
const SYNC_LIMIT = 200;

/**
 * Пауза после последней правки.
 *
 * Пока человек печатает, результат прохода всё равно устареет к следующему
 * нажатию. Сто двадцать миллисекунд — это уже не «в процессе набора», но и не
 * заметное ожидание после того, как набирать перестали.
 */
const IDLE_DELAY_MS = 120;

/**
 * Сколько работы делается за один присест.
 *
 * Кадр — шестнадцать миллисекунд, и отдавать проходу весь кадр нельзя: в нём
 * ещё браузеру рисовать. Шесть — компромисс между «не мешает прокрутке» и
 * «не тянется вечно из-за накладных расходов на каждый присест».
 */
const SLICE_BUDGET_MS = 6;

/** Разбор документа целиком: структура сразу, смысл — как получится. */
export interface Analysis {
  /** Структурные и смысловые замечания вместе, в порядке строк файла. */
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  /** Советы считаются отдельно: они не должны красить сводку. */
  adviceCount: number;
  /**
   * Смысловой проход ещё идёт, список неполон.
   *
   * Неполный счётчик, выглядящий как полный, — ровно тот случай, когда
   * молчание хуже цифры: «замечаний нет» и «замечаний пока не нашли» человек
   * должен различать.
   */
  inspecting: boolean;
  /** Замечания по правилам: ключ блока модели → его список. */
  byRule: Map<string, Diagnostic[]>;
}

const NO_STATEMENTS: ParsedStatement[] = [];
const NO_DIAGNOSTICS: Diagnostic[] = [];

function isExecutable(block: VisualBlock): boolean {
  return block.kind === 'rule' || block.kind === 'action';
}

/**
 * Отложенная работа в паузах браузера.
 *
 * Три способа по убыванию осведомлённости. `requestIdleCallback` знает про
 * паузы больше, чем можно узнать самому, но есть не везде. `MessageChannel`
 * паузы не ищет, зато отдаёт управление браузеру между присестами — а это
 * главное, чего мы хотим. `setTimeout` тормозит вложенные вызовы на несколько
 * миллисекунд, поэтому он последний, но и он делает своё дело.
 */
function schedule(task: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(task, { timeout: 200 });
    return () => cancelIdleCallback(id);
  }

  if (typeof MessageChannel === 'function') {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => task();
    channel.port2.postMessage(null);
    return () => {
      channel.port1.onmessage = null;
    };
  }

  const id = window.setTimeout(task, 0);
  return () => window.clearTimeout(id);
}

/** Ход отложенного прохода. `source` — блоки, о которых он рассказывает. */
interface Progress {
  source: VisualBlock[];
  diagnostics: Diagnostic[];
  done: boolean;
}

export function useInspection(compiled: CompileResult, parsed: ParsedDocument | null): Analysis {
  const blocks = compiled.blocks;
  const statements = parsed?.statements ?? NO_STATEMENTS;

  const deferred = useMemo(() => blocks.filter(isExecutable).length > SYNC_LIMIT, [blocks]);

  const immediate = useMemo(
    () => (deferred ? null : inspectDocument(blocks, statements)),
    [deferred, blocks, statements],
  );

  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!deferred) return;

    let cancelled = false;
    let cancelSlice: (() => void) | null = null;

    const start = window.setTimeout(() => {
      const slices = inspectSlices(blocks, statements);
      const found: Diagnostic[] = [];

      const step = () => {
        cancelSlice = null;
        if (cancelled) return;

        const until = performance.now() + SLICE_BUDGET_MS;
        let done = false;
        do {
          const next = slices.next();
          if (next.done === true) {
            done = true;
            break;
          }
          found.push(...next.value);
        } while (performance.now() < until);

        // Копия, а не сам накопитель: следующий присест допишет в него, и
        // React не заметил бы изменения в том же массиве.
        setProgress({ source: blocks, diagnostics: [...found], done });
        if (!done) cancelSlice = schedule(step);
      };

      cancelSlice = schedule(step);
    }, IDLE_DELAY_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(start);
      cancelSlice?.();
    };
  }, [deferred, blocks, statements]);

  // Ход прохода годится только для тех блоков, по которым он шёл: правка
  // текста делает прежние замечания рассказом о другом документе.
  const current = progress !== null && progress.source === blocks ? progress : null;
  const semantic = immediate ?? current?.diagnostics ?? NO_DIAGNOSTICS;
  const inspecting = deferred && !(current?.done ?? false);

  return useMemo(() => {
    const diagnostics = byLine([...compiled.diagnostics, ...semantic]);

    // Раскладка по правилам считается здесь один раз. Раньше каждая карточка
    // фильтровала весь список сама: тысяча карточек на три тысячи сообщений —
    // это три миллиона сравнений на каждый рендер.
    const byRule = new Map<string, Diagnostic[]>();
    let errorCount = 0;
    let warningCount = 0;
    let adviceCount = 0;

    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === 'error') errorCount++;
      else if (diagnostic.severity === 'warning') warningCount++;
      else adviceCount++;

      const key = diagnostic.anchor?.ruleKey;
      if (key === undefined) continue;
      const list = byRule.get(key);
      if (list === undefined) byRule.set(key, [diagnostic]);
      else list.push(diagnostic);
    }

    return { diagnostics, errorCount, warningCount, adviceCount, inspecting, byRule };
  }, [compiled.diagnostics, semantic, inspecting]);
}
