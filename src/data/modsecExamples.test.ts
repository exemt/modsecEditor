import { parseModsec } from '../modsec/parser';
import { compileDocument } from '../modsec/compile';
import { modsecExamples } from './modsecExamples';
import type { DiagnosticCode } from '../modsec/diagnostics';

/** Замечания к примеру: код и строка — по ним ошибку и ищут. */
function diagnostics(code: string) {
  return compileDocument(parseModsec(code)).diagnostics.map((d) => `${d.code}@${d.line ?? '?'}`);
}

/**
 * Единственное замечание, которое исправному примеру позволено вызывать.
 *
 * `initcol`, `expirevar`, `skipAfter` и `ctl` конструктор не редактирует и
 * честно об этом говорит — но правила они пишут верные, и без них нельзя
 * показать ни счётчик на адрес, ни переход через блок.
 */
const ALLOWED: ReadonlySet<DiagnosticCode> = new Set(['unknownAction']);

describe('учебные примеры', () => {
  it('дают уникальные имена и разделы', () => {
    const ids = modsecExamples.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Пример, который не компилируется, запирает визуальную вкладку — то есть
  // ровно то, ради чего его и открыли.
  it('компилируются без ошибок', () => {
    for (const example of modsecExamples) {
      const errors = compileDocument(parseModsec(example.code)).diagnostics.filter(
        (d) => d.severity === 'error',
      );
      expect({ id: example.id, errors }).toEqual({ id: example.id, errors: [] });
    }
  });

  // Раздел с намеренными ошибками — исключение, и только он: в остальных
  // замечание означает, что пример учит не тому, что обещает.
  it('не оставляют замечаний, кроме раздела с намеренными ошибками', () => {
    for (const example of modsecExamples) {
      if (example.section === 'mistakes') continue;
      const noise = diagnostics(example.code).filter(
        (note) => !ALLOWED.has(note.split('@')[0] as DiagnosticCode),
      );
      expect({ id: example.id, noise }).toEqual({ id: example.id, noise: [] });
    }
  });

  it('оставляют в разделе ошибок по замечанию на правило', () => {
    for (const example of modsecExamples) {
      if (example.section !== 'mistakes') continue;
      expect(diagnostics(example.code).length).toBeGreaterThan(0);
    }
  });
});
