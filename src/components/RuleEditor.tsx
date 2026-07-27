import { useCallback, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Popper from '@mui/material/Popper';
import Paper from '@mui/material/Paper';
import Chip from '@mui/material/Chip';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import { tokenize } from './syntax/modsecHighlight';
import { lookupKeyword, type KeywordDoc } from './syntax/modsecKeywords';
import { useI18n } from '../i18n/useI18n';
import { categoryKey } from '../i18n/translations';
import { useRule } from '../context/ruleContext';
import './RuleEditor.css';

interface HoverState {
  anchor: HTMLElement;
  doc: KeywordDoc;
}

/** Кнопка «разложить правило по строкам». */
function FormatButton() {
  const { t } = useI18n();
  const { formatSource, canFormat } = useRule();

  return (
    <Tooltip title={t(canFormat ? 'toolbar.formatHint' : 'toolbar.formatDone')}>
      {/* Обёртка нужна, чтобы подсказка работала и у выключенной кнопки. */}
      <span>
        <Button
          className="rule-editor__button"
          size="small"
          disabled={!canFormat}
          onClick={formatSource}
          startIcon={<AutoFixHighIcon fontSize="small" />}
        >
          {t('toolbar.format')}
        </Button>
      </span>
    </Tooltip>
  );
}

function RuleEditor() {
  const { t, locale } = useI18n();
  const { source, setSource, formatSource } = useRule();
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const tokens = useMemo(() => tokenize(source), [source]);

  const lineNumbers = useMemo(() => {
    const count = source.split('\n').length;
    return Array.from({ length: count }, (_, i) => i + 1).join('\n');
  }, [source]);

  const hitTest = useCallback(
    (clientX: number, clientY: number) => {
      const layer = highlightRef.current;
      if (!layer) return;

      const spans = layer.querySelectorAll<HTMLSpanElement>('span[data-kw]');
      for (const span of Array.from(spans)) {
        const r = span.getBoundingClientRect();
        if (
          clientX >= r.left &&
          clientX <= r.right &&
          clientY >= r.top &&
          clientY <= r.bottom
        ) {
          const doc = lookupKeyword(span.textContent ?? '');
          if (doc) {
            setHover((prev) => (prev?.anchor === span ? prev : { anchor: span, doc }));
            return;
          }
        }
      }
      setHover((prev) => (prev ? null : prev));
    },
    [],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const { clientX, clientY } = e;
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        hitTest(clientX, clientY);
      });
    },
    [hitTest],
  );

  const clearHover = useCallback(() => setHover(null), []);

  // Shift+Alt+F — привычное сочетание для «отформатировать» из редакторов кода.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyF') {
        e.preventDefault();
        formatSource();
      }
    },
    [formatSource],
  );

  return (
    <div className="rule-editor-shell">
      <div className="rule-editor__toolbar">
        <FormatButton />
        <span className="rule-editor__hint">{t('editor.hint')}</span>
      </div>

      <div className="rule-editor">
        <div className="rule-editor__inner">
          <div className="rule-editor__gutter" ref={gutterRef} aria-hidden="true">
            {lineNumbers}
          </div>
          <div
            className="rule-editor__code"
            onMouseMove={handleMouseMove}
            onMouseLeave={clearHover}
          >
            <pre className="rule-editor__highlight" ref={highlightRef} aria-hidden="true">
              <code>
                {tokens.map((token, i) => {
                  const hasDoc = lookupKeyword(token.value) !== null;
                  return (
                    <span
                      key={i}
                      className={`tok-${token.type}${hasDoc ? ' tok--doc' : ''}`}
                      data-kw={hasDoc ? '' : undefined}
                    >
                      {token.value}
                    </span>
                  );
                })}
              </code>
            </pre>
            <textarea
              className="rule-editor__textarea"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={(e) => {
                const { scrollTop, scrollLeft } = e.currentTarget;
                if (highlightRef.current) {
                  highlightRef.current.scrollTop = scrollTop;
                  highlightRef.current.scrollLeft = scrollLeft;
                }
                if (gutterRef.current) {
                  gutterRef.current.scrollTop = scrollTop;
                }
              }}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              aria-label={t('editor.ariaLabel')}
            />
          </div>
        </div>
      </div>

      <Popper
        open={hover !== null}
        anchorEl={hover?.anchor ?? null}
        placement="top-start"
        modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
        style={{ pointerEvents: 'none', zIndex: 1500 }}
      >
        {hover && (
          <Paper elevation={6} className="kw-tooltip">
            <div className="kw-tooltip__head">
              <code className="kw-tooltip__name">{hover.doc.keyword}</code>
              <Chip
                size="small"
                label={t(categoryKey(hover.doc.category))}
                className="kw-tooltip__chip"
              />
            </div>
            <Typography variant="body2" className="kw-tooltip__desc">
              {hover.doc.desc[locale] ?? hover.doc.desc.en}
            </Typography>
          </Paper>
        )}
      </Popper>
    </div>
  );
}

export default RuleEditor;
