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
import Typography from '@mui/material/Typography';
import RuleEditor from './components/RuleEditor';
import { DebugPanel } from './components/DebugPanel';
import { EditorToolbar, HistoryButtons } from './components/EditorToolbar';
import { FileMenu } from './components/FileMenu';
import { FileSetControls } from './components/FileSetControls';
import { VisualBuilder } from './components/builder/VisualBuilder';
import { modsecExamples } from './data/modsecExamples';
import { useI18n } from './i18n/useI18n';
import { LOCALE_LABELS, type Locale } from './i18n/translations';
import { WorkspaceProvider } from './context/WorkspaceProvider';
import { exampleFile } from './data/exampleFile';
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
      {/* Панель режима живёт в строке вкладок, а не над содержимым: своей
          полосы она не заработала, а вкладки её высоту всё равно задают.
          Порядок в строке — от общего к частному: набор целиком, история
          документа, взгляд на него, что умеет этот взгляд, главное действие. */}
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
        <FileMenu />
        <Divider orientation="vertical" sx={{ height: 20 }} />

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
      {/* Набор объявлен выше заголовка: имя правимого файла стоит в заголовке
          рядом с языком, а значит, о наборе должны знать оба — и заголовок, и
          содержимое. */}
      <WorkspaceProvider persist initialFile={exampleFile(modsecExamples[0])}>
        <EditorViewProvider>
          {/* Раскрытие карточек живёт выше вкладок: уйти в текст и вернуться —
              не повод забыть, какие правила были открыты. */}
          <BuilderViewProvider>
            <DialogTitle
              sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}
              component="div"
            >
              <Typography variant="h6" component="h1" sx={{ flex: 1, minWidth: 0 }} noWrap>
                {t('app.title')}
              </Typography>

              {/* Справа — то, что отвечает на «где я»: какой файл набора открыт,
                  вход в набор, язык интерфейса. Действия над набором сюда не
                  ставятся: они в меню «Файл» над содержимым. */}
              <FileSetControls />

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
              <EditorTabs />
              <DebugPanel />
            </DialogContent>
          </BuilderViewProvider>
        </EditorViewProvider>
      </WorkspaceProvider>
    </Dialog>
  );
}

export default App;
