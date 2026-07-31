import { useMemo } from 'react';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import { tokenize, type Token } from './syntax/modsecHighlight';
import './RuleEditor.css';
import './MiniEditorPane.css';

export type MiniEditorVariant = 'compact' | 'expanded';

interface MiniEditorPaneProps {
  /** Физический исходник фрагмента. */
  text: string;
  /** Первая строка фрагмента в файле (1-based) — ею нумеруется gutter. */
  startLine: number;
  /** Имя файла для шапки; пустое — шапка называет только строку. */
  fileName: string;
  /**
   * Компактный — обрезка длинных строк и только вертикальный скролл;
   * развёрнутый — обе полосы, для окна «подробнее».
   */
  variant?: MiniEditorVariant;
  /** Подпись кнопки перехода в текстовый редактор. */
  openTextLabel?: string;
  /** Открыть этот фрагмент во вкладке текста. */
  onOpenText?: () => void;
  /** Подпись кнопки «открыть подробнее». */
  expandLabel?: string;
  /** Перейти в большой просмотр (только у компактного). */
  onExpand?: () => void;
  /** Подпись кнопки закрытия. */
  closeLabel?: string;
  /** Закрыть превью или окно. */
  onClose?: () => void;
}

/**
 * Раскладывает поток токенов по физическим строкам.
 *
 * Подсветка считается по всему фрагменту целиком — иначе строка, разрезанная
 * кавычками через `\`, окрасилась бы заново с середины. Здесь только режут
 * уже готовые токены по `\n`, тип у кусков тот же.
 */
export function tokensByLine(tokens: readonly Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.value.split('\n');
    for (let i = 0; i < parts.length; i++) {
      if (i > 0) lines.push([]);
      if (parts[i] !== '') {
        lines[lines.length - 1].push({ type: token.type, value: parts[i] });
      }
    }
  }
  return lines;
}

function TokenSpans({ tokens }: { tokens: readonly Token[] }) {
  if (tokens.length === 0) return <>{'\u00a0'}</>;
  return (
    <>
      {tokens.map((token, i) => (
        <span key={i} className={`tok-${token.type}`}>
          {token.value}
        </span>
      ))}
    </>
  );
}

/**
 * Кусок текстового редактора без правки: подсветка, номера строк, адрес.
 *
 * Компактный вид — для подсказки у чипа: длинная строка обрезается многоточием,
 * горизонтальной полосы нет. Развёрнутый — для модалки, где правило можно
 * прочитать целиком, уже со скроллом в обе стороны.
 */
export function MiniEditorPane({
  text,
  startLine,
  fileName,
  variant = 'compact',
  openTextLabel,
  onOpenText,
  expandLabel,
  onExpand,
  closeLabel,
  onClose,
}: MiniEditorPaneProps) {
  const tokens = useMemo(() => tokenize(text), [text]);
  const rows = useMemo(() => tokensByLine(tokens), [tokens]);
  const where =
    rows.length <= 1
      ? String(startLine)
      : `${startLine}–${startLine + rows.length - 1}`;

  return (
    <div className={`mini-editor mini-editor--${variant}`}>
      <div className="mini-editor__head">
        <div className="mini-editor__where">
          {fileName !== '' && <span className="mini-editor__file">{fileName}</span>}
          <span className="mini-editor__line">{where}</span>
        </div>
        <div className="mini-editor__actions">
          {onOpenText !== undefined && openTextLabel !== undefined && (
            <IconButton
              size="small"
              aria-label={openTextLabel}
              onClick={onOpenText}
              className="mini-editor__action"
            >
              <NotesOutlinedIcon fontSize="inherit" />
            </IconButton>
          )}
          {variant === 'compact' && onExpand !== undefined && expandLabel !== undefined && (
            <IconButton
              size="small"
              aria-label={expandLabel}
              onClick={onExpand}
              className="mini-editor__action"
            >
              <OpenInFullIcon fontSize="inherit" />
            </IconButton>
          )}
          {onClose !== undefined && closeLabel !== undefined && (
            <IconButton
              size="small"
              aria-label={closeLabel}
              onClick={onClose}
              className="mini-editor__action"
            >
              <CloseIcon fontSize="inherit" />
            </IconButton>
          )}
        </div>
      </div>
      <div className="mini-editor__body">
        {variant === 'compact' ? (
          <div className="mini-editor__rows">
            {rows.map((lineTokens, index) => (
              <div key={index} className="mini-editor__row">
                <div className="mini-editor__lineno" aria-hidden="true">
                  {startLine + index}
                </div>
                <div className="mini-editor__code-line">
                  <TokenSpans tokens={lineTokens} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rule-editor">
            <div className="rule-editor__inner">
              <div className="rule-editor__gutter" aria-hidden="true">
                {rows.map((_, index) => (
                  <div key={index} className="rule-editor__lineno">
                    {startLine + index}
                  </div>
                ))}
              </div>
              <div className="rule-editor__code">
                <pre className="rule-editor__highlight">
                  <code>
                    <TokenSpans tokens={tokens} />
                  </code>
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
