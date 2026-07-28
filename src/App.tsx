import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import Divider from '@mui/material/Divider';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import RuleEditor from './components/RuleEditor';
import { DocumentBar } from './components/DocumentBar';
import { DebugPanel } from './components/DebugPanel';
import { EditorToolbar, HistoryButtons } from './components/EditorToolbar';
import { VisualBuilder } from './components/builder/VisualBuilder';
import { modsecExamples } from './data/modsecExamples';
import { useI18n } from './i18n/useI18n';
import { LOCALE_LABELS, type Locale } from './i18n/translations';
import { RuleProvider } from './context/RuleProvider';
import { useRule } from './context/ruleContext';
import { BuilderViewProvider } from './context/BuilderViewProvider';
import { EditorViewProvider } from './context/EditorViewProvider';
import { useEditorView } from './context/editorViewContext';
import type { EditorTab } from './context/editorViewContext';

/**
 * Две вкладки редактора поверх одного и того же текста.
 *
 * Визуальная вкладка доступна только тогда, когда правило компилируется:
 * конструктор умеет работать лишь с корректной моделью, а притворяться,
 * что он понимает сломанный текст, — худший из возможных вариантов.
 * Если правило сломали уже внутри конструктора, вкладка не переключается
 * сама — там появляется объяснение и предложение вернуться в текст.
 */
function EditorTabs() {
  const { t } = useI18n();
  const { compiled } = useRule();
  const { tab, setTab } = useEditorView();

  const visualBlocked = !compiled.ok;

  return (
    <>
      <DocumentBar />

      {/* Панель режима живёт в строке вкладок, а не над содержимым: своей
          полосы она не заработала, а вкладки её высоту всё равно задают.
          Порядок в строке — от общего к частному: история документа, взгляд
          на него, что умеет этот взгляд, главное действие. */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 1,
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <HistoryButtons />
        <Divider orientation="vertical" sx={{ height: 20 }} />

        <Tabs
          value={tab}
          onChange={(_, next: EditorTab) => setTab(next)}
          sx={{ flexShrink: 0 }}
        >
          <Tab value="text" label={t('tab.text')} />
          <Tab
            value="visual"
            label={
              <Tooltip title={visualBlocked ? t('tab.visualBlocked') : ''}>
                <span>{t('tab.visual')}</span>
              </Tooltip>
            }
            disabled={visualBlocked && tab !== 'visual'}
          />
        </Tabs>

        <EditorToolbar tab={tab} />
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {tab === 'text' ? <RuleEditor /> : <VisualBuilder />}
      </Box>
    </>
  );
}

/**
 * Оболочка приложения.
 *
 * Внешне это диалог, но закрывать его некуда: за ним нет ни страницы, ни
 * способа открыть редактор заново, а весь текст правил живёт в памяти
 * вкладки. Поэтому обработчика закрытия у диалога нет вовсе: без него ни
 * Escape, ни клик по фону ничего не делают, и случайное нажатие не стоит
 * пользователю работы.
 */
function App() {
  const { t, locale, setLocale, locales } = useI18n();

  return (
    <Dialog open maxWidth="xl" fullWidth>
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}
      >
        <span>{t('app.title')}</span>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={locale}
          onChange={(_, next: Locale | null) => next && setLocale(next)}
          aria-label={t('app.language')}
        >
          {locales.map((l) => (
            <ToggleButton key={l} value={l} sx={{ px: 1.5, py: 0.25 }}>
              {LOCALE_LABELS[l]}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </DialogTitle>

      <DialogContent
        dividers
        sx={{ height: '85vh', p: 0, display: 'flex', flexDirection: 'column' }}
      >
        <RuleProvider persist initialSource={modsecExamples[0].code}>
          <EditorViewProvider>
            {/* Раскрытие карточек живёт выше вкладок: уйти в текст и вернуться —
                не повод забыть, какие правила были открыты. */}
            <BuilderViewProvider>
              <EditorTabs />
              <DebugPanel />
            </BuilderViewProvider>
          </EditorViewProvider>
        </RuleProvider>
      </DialogContent>
    </Dialog>
  );
}

export default App;
