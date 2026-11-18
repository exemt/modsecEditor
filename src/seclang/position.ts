/**
 * Смещение в тексте ↔ строка и столбец.
 *
 * Узлы дерева хранят смещения: их дёшево считать и ими удобно резать
 * исходник. Человеку и редактору нужны строка и столбец. Таблица начал
 * строк строится один раз на текст, а дальше любой вопрос — деление
 * пополам.
 */

export interface Position {
  /** Номер строки, с единицы. */
  line: number;
  /** Номер столбца, с единицы. */
  column: number;
}

export class LineIndex {
  /** Смещение первого символа каждой строки. */
  private readonly starts: number[];
  private readonly length: number;

  constructor(source: string) {
    const starts = [0];
    for (let at = source.indexOf('\n'); at !== -1; at = source.indexOf('\n', at + 1)) {
      starts.push(at + 1);
    }
    this.starts = starts;
    this.length = source.length;
  }

  get lineCount(): number {
    return this.starts.length;
  }

  positionAt(offset: number): Position {
    const { starts } = this;
    const clamped = Math.max(0, Math.min(offset, this.length));
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (starts[middle] <= clamped) low = middle;
      else high = middle - 1;
    }
    return { line: low + 1, column: clamped - starts[low] + 1 };
  }

  /** Смещение начала строки; за пределами текста — его длина. */
  offsetOfLine(line: number): number {
    if (line <= 1) return 0;
    return line > this.starts.length ? this.length : this.starts[line - 1];
  }

  offsetAt(position: Position): number {
    const start = this.offsetOfLine(position.line);
    return Math.min(start + position.column - 1, this.offsetOfLine(position.line + 1));
  }
}
