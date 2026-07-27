import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import { BRACKET_WIDTH } from './layout';
import { CONTROL_HEIGHT } from '../../theme';

/** Насколько скобка выступает за крайние строки — чтобы охват был виден. */
const OVERHANG = 10;

interface BracketLineProps {
  /** То же имя, что у обнимающей скобки. */
  name: string;
  /** Смещение строки полей от верха элемента группы. */
  top?: number | string;
  /** Высота отмечаемой строки, если она ниже поля — например, у кнопки. */
  height?: number | string;
}

/**
 * Невидимая отметка строки полей для {@link Bracket}.
 *
 * Строка полей элемента группы не имеет собственного бокса — это несколько
 * ячеек сетки. Отметка даёт скобке то, что можно замерить, и ничего не
 * занимает в раскладке.
 */
export function BracketLine({ name, top = 0, height = CONTROL_HEIGHT }: BracketLineProps) {
  return (
    <Box
      aria-hidden
      data-bracket-line={name}
      sx={{
        position: 'absolute',
        left: 0,
        top,
        width: 0,
        height,
        pointerEvents: 'none',
      }}
    />
  );
}

interface BracketProps {
  /** Подпись связки: «И» или «ИЛИ». */
  label: string;
  /** Цвет скобки — красный для И, оранжевый для ИЛИ. */
  color: string;
  /**
   * Имя строк, которые скобка обнимает. Элементы группы помечают свою
   * строку полей атрибутом `data-bracket-line` с этим значением.
   */
  line: string;
  children: ReactNode;
}

/**
 * Логическая связка в виде скобки: подпись слева, вертикальная линия,
 * охватывающая все элементы группы, и короткий отвод к подписи.
 *
 * Скобка — единственный способ показать приоритет операций так, чтобы его
 * не приходилось читать: всё, что линия обнимает, объединено этой связкой.
 *
 * Охват считается по строкам полей, а не по высоте группы. Элемент группы
 * выше своей первой строки: под ним и пояснение к переменной, и исключения,
 * которые растут по мере добавления. Если считать по высоте, подпись связки
 * уезжает под эти служебные строки, причём на разное расстояние в каждой
 * группе — поэтому центры первой и последней строки замеряются по факту.
 */
export function Bracket({ label, color, line, children }: BracketProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [span, setSpan] = useState<{ top: number; bottom: number } | null>(null);

  const measure = useCallback(() => {
    const host = hostRef.current;
    if (host === null) return;

    const lines = host.querySelectorAll<HTMLElement>(`[data-bracket-line="${line}"]`);
    if (lines.length === 0) {
      setSpan(null);
      return;
    }

    const origin = host.getBoundingClientRect().top;
    const first = lines[0].getBoundingClientRect();
    const last = lines[lines.length - 1].getBoundingClientRect();
    const next = {
      top: first.top - origin + first.height / 2,
      bottom: last.top - origin + last.height / 2,
    };
    setSpan((prev) =>
      prev !== null && prev.top === next.top && prev.bottom === next.bottom ? prev : next,
    );
  }, [line]);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(host);
    host
      .querySelectorAll<HTMLElement>(`[data-bracket-line="${line}"]`)
      .forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [children, line, measure]);

  // До первого замера скобка растягивается по группе: так она не мигает
  // при первом кадре и остаётся осмысленной, если строк не нашлось.
  const top = span === null ? OVERHANG : span.top - OVERHANG;
  const bottom = span === null ? OVERHANG : undefined;
  const height = span === null ? undefined : span.bottom - span.top + OVERHANG * 2;
  const center = span === null ? '50%' : `${(span.top + span.bottom) / 2}px`;

  return (
    // Замеряем от внешней обёртки: отметки строк лежат в children, а не в
    // колонке скобки. Верх у обёртки и колонки общий (`stretch`), поэтому
    // смещения переносятся в колонку без пересчёта.
    <Box ref={hostRef} sx={{ display: 'flex', alignItems: 'stretch' }}>
      <Box sx={{ position: 'relative', width: BRACKET_WIDTH, flexShrink: 0 }}>
        <Box
          sx={{
            position: 'absolute',
            left: BRACKET_WIDTH - 10,
            top,
            bottom,
            height,
            borderLeft: '1px solid',
            borderColor: color,
            opacity: 0.7,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: center,
            left: BRACKET_WIDTH - 16,
            width: 6,
            borderTop: '1px solid',
            borderColor: color,
            opacity: 0.7,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            top: center,
            left: 0,
            transform: 'translateY(-50%)',
            px: 0.75,
            py: 0.125,
            borderRadius: 1,
            bgcolor: color,
            color: 'common.black',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            lineHeight: '18px',
          }}
        >
          {label}
        </Box>
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>{children}</Box>
    </Box>
  );
}
