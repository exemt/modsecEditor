import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import RuleEditor from './components/RuleEditor';
import { DebugPanel } from './components/DebugPanel';
import { VisualBuilder } from './components/builder/VisualBuilder';
import { modsecExamples } from './data/modsecExamples';
import { useI18n } from './i18n/useI18n';
import { LOCALE_LABELS, type Locale } from './i18n/translations';
import { RuleProvider } from './context/RuleProvider';
import { useRule } from './context/ruleContext';

type EditorTab = 'text' | 'visual';

/** Переключатель готовых примеров правил. */
function ExampleBar() {
  const { t } = useI18n();
  const { setSource } = useRule();
  const [activeId, setActiveId] = useState(modsecExamples[0].id);

  return (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        px: 1.5,
        py: 1,
        flexWrap: 'wrap',
        gap: 1,
        alignItems: 'center',
        borderBottom: 1,
        borderColor: 'divider',
      }}
    >
      <Typography variant="overline" sx={{ mr: 1, color: 'text.secondary' }}>
        {t('examples.title')}
      </Typography>
      {modsecExamples.map((example) => (
        <Button
          key={example.id}
          size="small"
          variant={example.id === activeId ? 'contained' : 'outlined'}
          onClick={() => {
            setActiveId(example.id);
            setSource(example.code);
          }}
        >
          {t(example.labelKey)}
        </Button>
      ))}
    </Stack>
  );
}

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
  const [tab, setTab] = useState<EditorTab>('text');

  const visualBlocked = !compiled.ok;

  return (
    <>
      <ExampleBar />

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tab} onChange={(_, next: EditorTab) => setTab(next)}>
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
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        {tab === 'text' ? <RuleEditor /> : <VisualBuilder />}
      </Box>
    </>
  );
}

function App() {
  const { t, locale, setLocale, locales } = useI18n();
  const [open, setOpen] = useState(true);

  return (
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xl" fullWidth>
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
        <RuleProvider initialSource={modsecExamples[0].code}>
          <EditorTabs />
          <DebugPanel />
        </RuleProvider>
      </DialogContent>
    </Dialog>
  );
}

export default App;
