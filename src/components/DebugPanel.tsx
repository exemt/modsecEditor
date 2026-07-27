import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { DiagnosticLine } from './diagnostics/DiagnosticLine';
import { useRule } from '../context/ruleContext';
import { useI18n } from '../i18n/useI18n';
import { topicKey } from '../i18n/translations';
import type { DiagnosticTopic } from '../modsec/compile';

type DebugTab = 'diagnostics' | 'model' | 'parsed';

const OPEN_KEY = 'exeditor.debugOpen';

/**
 * Развёрнута ли панель. По умолчанию да: разбираться, куда делась
 * диагностика, хуже, чем свернуть панель один раз самому.
 */
function readOpen(): boolean {
  try {
    return window.localStorage.getItem(OPEN_KEY) !== '0';
  } catch {
    // localStorage может быть недоступен (приватный режим) — не падаем.
    return true;
  }
}

function saveOpen(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // Не сохранилось — панель всё равно слушается до конца сессии.
  }
}

/** Моноширинный вывод JSON. */
function JsonView({ value, empty }: { value: unknown; empty: string }) {
  const text = useMemo(
    () => (value === null || value === undefined ? '' : JSON.stringify(value, null, 2)),
    [value],
  );
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        px: 1.5,
        py: 1,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: 'pre',
      }}
    >
      {text || empty}
    </Box>
  );
}

/**
 * Дебаг-панель: она видна всегда, независимо от выбранной вкладки редактора.
 *
 * Диагностика идёт первой не случайно — именно она объясняет, почему
 * визуальный конструктор может быть заблокирован.
 *
 * Панель сворачивается до одной строки заголовка, но не исчезает совсем:
 * сводка об ошибках остаётся на виду, иначе свёрнутая панель молча
 * скрывала бы то единственное, ради чего её и держат внизу экрана.
 */
export function DebugPanel() {
  const { t } = useI18n();
  const { parsed, parseError, compiled } = useRule();
  const [tab, setTab] = useState<DebugTab>('diagnostics');
  const [open, setOpen] = useState(readOpen);
  const [showAdvice, setShowAdvice] = useState(true);
  /** Заглушённые темы. Пусто — показываются все. */
  const [muted, setMuted] = useState<ReadonlySet<DiagnosticTopic>>(new Set());

  // Сколько сообщений в каждой теме — заодно и список тем, которые вообще
  // встретились: показывать все семь, когда заняты две, незачем.
  const byTopic = useMemo(() => {
    const counts = new Map<DiagnosticTopic, number>();
    for (const d of compiled.diagnostics) {
      counts.set(d.topic, (counts.get(d.topic) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [compiled.diagnostics]);

  // Советы и целые темы можно убрать: при переносе чужого набора правил
  // замечания о стиле мешают разглядеть настоящие проблемы.
  const shown = compiled.diagnostics.filter(
    (d) => (showAdvice || d.severity !== 'advice') && !muted.has(d.topic),
  );

  const changeOpen = (next: boolean) => {
    setOpen(next);
    saveOpen(next);
  };

  const toggleTopic = (topic: DiagnosticTopic) =>
    setMuted((current) => {
      const next = new Set(current);
      if (!next.delete(topic)) next.add(topic);
      return next;
    });

  return (
    <Box
      sx={{
        height: open ? '26vh' : 'auto',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        borderTop: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: 'center', pr: 1.5, borderBottom: 1, borderColor: 'divider' }}
      >
        {/* Выбор вкладки у свёрнутой панели означает «покажи мне её»:
            иначе клик по вкладке не давал бы никакого видимого ответа. */}
        <Tabs
          value={tab}
          onChange={(_, next: DebugTab) => {
            setTab(next);
            if (!open) changeOpen(true);
          }}
          sx={{ minHeight: 36, flex: 1 }}
        >
          <Tab value="diagnostics" label={t('debug.tab.diagnostics')} sx={{ minHeight: 36 }} />
          <Tab value="model" label={t('debug.tab.model')} sx={{ minHeight: 36 }} />
          <Tab value="parsed" label={t('debug.tab.parsed')} sx={{ minHeight: 36 }} />
        </Tabs>
        {compiled.adviceCount > 0 && (
          <Chip
            size="small"
            variant={showAdvice ? 'filled' : 'outlined'}
            onClick={() => setShowAdvice((v) => !v)}
            title={t(showAdvice ? 'debug.adviceHide' : 'debug.adviceShow')}
            label={t('debug.advice', { advice: String(compiled.adviceCount) })}
          />
        )}
        {/* Совет не влияет на цвет сводки: зелёный здесь значит «работает
            так, как написано», а не «написано идеально». */}
        <Chip
          size="small"
          color={compiled.errorCount > 0 ? 'error' : compiled.warningCount > 0 ? 'warning' : 'success'}
          variant="outlined"
          label={t('debug.summary', {
            errors: String(compiled.errorCount),
            warnings: String(compiled.warningCount),
          })}
        />
        <IconButton
          size="small"
          onClick={() => changeOpen(!open)}
          aria-expanded={open}
          aria-label={t(open ? 'debug.collapse' : 'debug.expand')}
          title={t(open ? 'debug.collapse' : 'debug.expand')}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{ transform: open ? 'none' : 'rotate(180deg)', transition: 'transform 150ms' }}
          />
        </IconButton>
      </Stack>

      {open && tab === 'diagnostics' && byTopic.length > 1 && (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ flexWrap: 'wrap', gap: 0.5, px: 1.5, py: 0.75 }}
        >
          {byTopic.map(([topic, count]) => (
            <Chip
              key={topic}
              size="small"
              variant={muted.has(topic) ? 'outlined' : 'filled'}
              onClick={() => toggleTopic(topic)}
              label={`${t(topicKey(topic))} ${count}`}
              sx={{ opacity: muted.has(topic) ? 0.5 : 1 }}
            />
          ))}
        </Stack>
      )}

      {open && (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', py: 0.5 }}>
          {tab === 'diagnostics' &&
            (parseError !== null ? (
              <Typography variant="body2" color="error.light" sx={{ px: 1.5, py: 1 }}>
                {parseError}
              </Typography>
            ) : shown.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 1 }}>
                {t('debug.clean')}
              </Typography>
            ) : (
              <Box sx={{ px: 1.5 }}>
                {shown.map((diagnostic, index) => (
                  <DiagnosticLine key={index} diagnostic={diagnostic} showPlace />
                ))}
              </Box>
            ))}

          {tab === 'model' && <JsonView value={compiled.model} empty={t('debug.empty')} />}
          {tab === 'parsed' && <JsonView value={parsed} empty={t('debug.empty')} />}
        </Box>
      )}
    </Box>
  );
}
