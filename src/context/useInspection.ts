import { useEffect, useMemo, useState } from 'react';
import { inspectWorkspace } from '../modsec/inspect';
import { LONE_FILE, blockRef } from '../modsec/workspace';
import type { Diagnostic } from '../modsec/diagnostics';
import type { Linter } from '../modsec/inspect';
import type { WorkspaceUnit } from '../modsec/workspace';

/**
 * Проход по набору как часть жизни приложения: когда его вести и чем платить.
 *
 * Компиляция обязана закончиться до отрисовки — от неё зависят и модель
 * конструктора, и доступность вкладки. Проход по набору не обязан ничем:
 * вкладку он не закрывает, а замечание, появившееся на кадр позже, никому
 * ничего не испортит. Разница в цене: компиляция считается по одному
 * файлу — тому, который правят, — а проход каждый раз идёт по всем, потому
 * что правка одного файла меняет сказанное о других.
 *
 * На обычном файле это доли миллисекунды, и откладывать было бы чистым
 * проигрышем: сложность есть, выигрыша нет, а замечание приходит с опозданием
 * там, где могло прийти сразу. На наборе размером с CRS проход стоит десятки
 * миллисекунд — на каждое нажатие клавиши это уже заметно, поэтому там он
 * ждёт паузы в наборе текста.
 */

/**
 * До какого размера набора проход идёт сразу, в символах.
 *
 * Сто килобайт правил ядро проверяет за пять–пятнадцать миллисекунд — меньше
 * кадра. Один файл CRS в этот предел укладывается, весь CRS — нет: он в
 * несколько раз больше.
 */
const SYNC_LIMIT = 100_000;

/**
 * Пауза после последней правки.
 *
 * Пока человек печатает, результат прохода всё равно устареет к следующему
 * нажатию. Сто двадцать миллисекунд — это уже не «в процессе набора», но и не
 * заметное ожидание после того, как набирать перестали.
 */
const IDLE_DELAY_MS = 120;

/** Разбор набора целиком: то, что закрывает конструктор, сразу, остальное — как получится. */
export interface Analysis {
  /**
   * Все замечания о наборе, в порядке включения файлов.
   *
   * Всех файлов, а не только открытого: исключение, которое ни до чего не
   * дотянулось, и номер, занятый дважды, — замечания о наборе, и увидеть их
   * можно только глядя на него целиком.
   */
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  /** Советы считаются отдельно: они не должны красить сводку. */
  adviceCount: number;
  /**
   * Проход по набору ещё не закончен, список неполон.
   *
   * Неполный счётчик, выглядящий как полный, — ровно тот случай, когда
   * молчание хуже цифры: «замечаний нет» и «замечаний пока не нашли» человек
   * должен различать.
   */
  inspecting: boolean;
  /** Замечания по блокам: {@link blockRef} блока → его список. */
  byRule: Map<string, Diagnostic[]>;
}

/** Итог отложенного прохода. `source` — набор, о котором он рассказывает. */
interface Progress {
  source: readonly WorkspaceUnit[];
  diagnostics: Diagnostic[];
}

/**
 * Замечания о наборе файлов.
 *
 * `linter` держит те же файлы, что и `units`, — их разбор и есть то, по чему
 * ядро считает замечания. `blocking` — замечания всех файлов, закрывающие
 * конструктор: они уже посчитаны компиляцией и показываются, пока проход по
 * большому набору ждёт своей паузы. `size` — суммарная длина текстов: по ней
 * решается, идти проходу сразу или подождать.
 */
export function useInspection(
  linter: Linter,
  units: readonly WorkspaceUnit[],
  blocking: readonly Diagnostic[],
  size: number,
): Analysis {
  const deferred = size > SYNC_LIMIT;

  const immediate = useMemo(
    () => (deferred ? null : inspectWorkspace(units, linter)),
    [deferred, units, linter],
  );

  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    if (!deferred) return;

    const timer = window.setTimeout(() => {
      setProgress({ source: units, diagnostics: inspectWorkspace(units, linter) });
    }, IDLE_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [deferred, units, linter]);

  // Итог прохода годится только для того набора, по которому он шёл: правка
  // текста делает прежние замечания рассказом о другом документе.
  const current = progress !== null && progress.source === units ? progress.diagnostics : null;
  const complete = immediate ?? current;
  const inspecting = complete === null;

  return useMemo(() => {
    const diagnostics = complete ?? [...blocking];

    // Раскладка по блокам считается здесь один раз. Иначе каждая карточка
    // фильтровала бы весь список сама: тысяча карточек на три тысячи
    // сообщений — это три миллиона сравнений на каждый рендер.
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
      // Ключ блока считается внутри файла, поэтому в раскладке он идёт с
      // файлом: `rule-0` есть в каждом файле набора.
      const ref = blockRef(diagnostic.file ?? LONE_FILE, key);
      const list = byRule.get(ref);
      if (list === undefined) byRule.set(ref, [diagnostic]);
      else list.push(diagnostic);
    }

    return { diagnostics, errorCount, warningCount, adviceCount, inspecting, byRule };
  }, [complete, blocking, inspecting]);
}
