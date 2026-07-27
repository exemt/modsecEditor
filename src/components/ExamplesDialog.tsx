import { useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { tokenize } from './syntax/modsecHighlight';
import { EXAMPLE_SECTIONS, modsecExamples } from '../data/modsecExamples';
import type { ModsecExample } from '../data/modsecExamples';
import { exampleSectionKey } from '../i18n/translations';
import { useI18n } from '../i18n/useI18n';
// Подсветка живёт в таблице стилей редактора: цвета токенов у примера и у
// текста, который он откроет, обязаны совпадать — иначе пример выглядит
// набором из другого приложения.
import './RuleEditor.css';

interface ExamplesDialogProps {
  open: boolean;
  /** Пример, который сейчас в редакторе, — с него открывается список. */
  activeId: string | null;
  onClose: () => void;
  onOpenExample: (example: ModsecExample) => void;
  onCopy: (code: string) => void;
}

/** Примеры, разложенные по разделам в порядке объявления. */
const BY_SECTION = EXAMPLE_SECTIONS.map((section) => ({
  section,
  items: modsecExamples.filter((example) => example.section === section),
}));

/** Правило, показанное так же, как в редакторе, но только для чтения. */
function Snippet({ code }: { code: string }) {
  const tokens = useMemo(() => tokenize(code), [code]);

  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        px: 2,
        py: 1.5,
        color: '#d4d4d4',
        fontFamily: "'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 1.55,
        letterSpacing: 'normal',
        whiteSpace: 'pre',
      }}
    >
      <code>
        {tokens.map((token, index) => (
          <span key={index} className={`tok-${token.type}`}>
            {token.value}
          </span>
        ))}
      </code>
    </Box>
  );
}

/**
 * Витрина учебных примеров.
 *
 * Примеров больше двух десятков, и рядом с кнопками они превратились бы в
 * стену подписей, по которой нельзя понять ни порядок изучения, ни чем один
 * пример отличается от соседнего. Здесь у каждого есть раздел, строка о том,
 * ради чего его стоит открыть, и текст целиком — выбор делается до того, как
 * пример заменит работу в редакторе, а не после.
 */
export function ExamplesDialog({
  open,
  activeId,
  onClose,
  onOpenExample,
  onCopy,
}: ExamplesDialogProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(activeId ?? modsecExamples[0].id);
  const selectedItem = useRef<HTMLDivElement | null>(null);

  const selected =
    modsecExamples.find((example) => example.id === selectedId) ?? modsecExamples[0];

  // Список открывается на том примере, который человек уже читает в
  // редакторе, — и прокручивается к нему: он может оказаться в конце.
  useEffect(() => {
    if (!open) return;
    if (activeId !== null) setSelectedId(activeId);
    selectedItem.current?.scrollIntoView({ block: 'center' });
  }, [open, activeId]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      slotProps={{ paper: { sx: { height: '82vh' } } }}
    >
      <DialogTitle
        sx={{ display: 'flex', alignItems: 'baseline', gap: 2, pb: 1 }}
        component="div"
      >
        <Typography variant="h6" component="h2">
          {t('examples.dialogTitle')}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {t('examples.hint')}
        </Typography>
        <IconButton onClick={onClose} aria-label={t('app.close')}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex', minHeight: 0 }}>
        <Box
          component="nav"
          aria-label={t('examples.list')}
          sx={{
            width: 260,
            flexShrink: 0,
            overflow: 'auto',
            borderRight: 1,
            borderColor: 'divider',
          }}
        >
          {BY_SECTION.map(({ section, items }) => (
            <Box key={section}>
              <Typography
                variant="overline"
                component="h3"
                sx={{
                  display: 'block',
                  px: 1.5,
                  pt: 1.5,
                  pb: 0.25,
                  m: 0,
                  color: 'text.secondary',
                }}
              >
                {t(exampleSectionKey(section))}
              </Typography>
              <List dense disablePadding>
                {items.map((example) => {
                  const current = example.id === selected.id;
                  return (
                    <ListItemButton
                      key={example.id}
                      ref={current ? selectedItem : null}
                      selected={current}
                      onClick={() => setSelectedId(example.id)}
                      sx={{ py: 0.25, px: 1.5 }}
                    >
                      <ListItemText
                        primary={t(example.labelKey)}
                        slotProps={{ primary: { variant: 'body2', noWrap: true } }}
                      />
                    </ListItemButton>
                  );
                })}
              </List>
            </Box>
          ))}
        </Box>

        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ px: 2, py: 1.25 }}>
            <Typography variant="subtitle2">{t(selected.labelKey)}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t(selected.noteKey)}
            </Typography>
          </Box>
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              overflow: 'auto',
              bgcolor: '#1e1e1e',
              borderTop: 1,
              borderColor: 'divider',
            }}
          >
            <Snippet code={selected.code} />
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button
          startIcon={<ContentCopyIcon fontSize="small" />}
          onClick={() => onCopy(selected.code)}
        >
          {t('toolbar.copy')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('app.close')}</Button>
        <Button variant="contained" onClick={() => onOpenExample(selected)}>
          {t('examples.open')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
