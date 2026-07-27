import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useI18n } from '../../i18n/useI18n';
import { matchValue } from '../../modsec/match';
import { runPipeline, showBytes, toBytes } from '../../modsec/transform';
import type { MatchVerdict } from '../../modsec/match';
import type { VisualOperator } from '../../modsec/model';

const MONO = 'ui-monospace, Consolas, monospace';

interface PipelinePreviewProps {
  transforms: string[];
  /** Оператор условия — им заканчивается проверка примера. */
  operator: VisualOperator;
  /**
   * Открыта ли проверка.
   *
   * Состояние живёт снаружи: закрытой проверке без преобразований показывать
   * нечего, и знать об этом должен тот, кто отводит ей место в сетке
   * условия, — иначе от неё останется пустая строка.
   */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Проверка условия на примере значения.
 *
 * Диагностика умеет сказать, что `t:lowercase` рядом с `@streq POST` — это
 * проверка, которая не сработает никогда. Здесь то же самое видно: в поле
 * набрано `POST`, ниже написано `post`, а рядом с оператором — «не
 * совпадает». Прочитанное предупреждение можно счесть придиркой, увиденное
 * несовпадение — нет.
 *
 * Поэтому пример живёт только в форме и не попадает ни в модель, ни в текст
 * правила: это вопрос к правилу, а не его часть.
 */
export function PipelinePreview({
  transforms,
  operator,
  open,
  onOpenChange,
}: PipelinePreviewProps) {
  const { t } = useI18n();
  const [sample, setSample] = useState('');

  // Пустой конвейер вернул бы пример самому себе — проверять тут нечего.
  // Открытая проверка при этом остаётся на месте и краснеет: убрать её
  // вместе с набранным примером значит наказать за удаление шага, которое
  // ещё можно отменить.
  const empty = transforms.length === 0;

  const input = useMemo(() => toBytes(sample), [sample]);
  const steps = useMemo(() => runPipeline(input, transforms), [input, transforms]);
  // На выходе конвейера — то, что и увидит оператор. Пустой конвейер
  // отдаёт вход как есть, невоспроизводимый шаг не отдаёт ничего.
  const output = steps.length === 0 ? input : steps[steps.length - 1].value;
  const verdict: MatchVerdict | null =
    output === null ? null : matchValue(operator, output);

  if (!open) {
    return (
      <>
        <Divider sx={{ my: 1 }} />
        <Button
          size="small"
          color="inherit"
          startIcon={<ExpandMoreIcon />}
          onClick={() => onOpenChange(true)}
          sx={{ color: 'text.secondary', fontWeight: 400 }}
        >
          {t('builder.previewOpen')}
        </Button>
      </>
    );
  }

  return (
    <>
      <Divider sx={{ my: 1 }} />

      {/* Проверка на примере лежит в собственной карточке, темнее блока
          условия: пример — это отдельный слой поверх правила, а не ещё
          одна его полоса, и вложенная карточка показывает это на глаз. */}
      <Box
        sx={{
          position: 'relative',
          p: 1.25,
          // Справа освобождено место под крестик, чтобы поля не уходили
          // под него на узкой карточке.
          pr: 5,
          borderRadius: 1,
          bgcolor: 'background.default',
          // Рамка есть всегда, но видна только у сломанной проверки: иначе
          // карточка дёргалась бы на пиксель при удалении последнего шага.
          border: 1,
          borderColor: empty ? 'error.main' : 'transparent',
        }}
      >
        {/* Закрывается проверка крестиком внутри карточки: кнопка, которой
            её открыли, к этому моменту уже уступила ей место. Крестик стоит
            вне колонки содержимого — иначе он занял бы в ней строку. */}
        <Tooltip title={t('builder.previewClose')}>
          <IconButton
            size="small"
            onClick={() => onOpenChange(false)}
            sx={{ position: 'absolute', top: 4, right: 4, color: 'text.disabled' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <Stack spacing={1.25}>
          {/* Сообщение выглядит как замечание диагностики: цветной значок и
              обычный текст. Проверка сломана так же, как ломается правило, и
              узнаваться это должно с того же взгляда. */}
          {empty && (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
              <ErrorOutlineIcon fontSize="small" color="error" />
              <Typography variant="body2">{t('builder.previewNoTransforms')}</Typography>
            </Stack>
          )}

          <TextField
            size="small"
            fullWidth
            autoFocus
            label={t('builder.previewSample')}
            // Пояснение нужно только пустому полю: как только пример набран,
            // на вопрос «что сюда писать» отвечают строки ниже.
            helperText={sample === '' ? t('builder.previewHint') : undefined}
            // Подсказкой стоит то, что ищет оператор: чаще всего проверить
            // хотят именно его — и сразу увидеть, доживёт ли оно до сравнения.
            placeholder={operator.argument}
            value={sample}
            onChange={(event) => setSample(event.target.value)}
            slotProps={{
              inputLabel: { shrink: true },
              htmlInput: { autoComplete: 'off', spellCheck: false },
              input: { sx: { fontFamily: MONO } },
            }}
            // Поле не растягивается на всю ширину условия: пример — вопрос к
            // правилу, а не его часть, и выглядеть весомее самих полей правила
            // он не должен.
            sx={{ maxWidth: 560 }}
          />

          {!empty && sample !== '' && (
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, auto) minmax(0, 1fr)',
                columnGap: 2,
                rowGap: 0.5,
                px: 1,
                py: 0.5,
              }}
            >
              <Line label={t('builder.previewInput')} value={showBytes(input)} />

              {steps.map((step, index) => {
                // Значение показывается только когда оно новое: повторить
                // предыдущую строку — значит заставить сличать их глазами,
                // хотя ответ «шаг ничего не сделал» уже известен.
                if (step.unchanged) {
                  return (
                    <Line
                      key={`${step.name}-${index}`}
                      label={`t:${step.name}`}
                      note={t('builder.previewUnchanged')}
                    />
                  );
                }
                if (step.value === null) {
                  return (
                    <Line
                      key={`${step.name}-${index}`}
                      label={`t:${step.name}`}
                      note={step.reproducible ? undefined : t('builder.previewOpaque')}
                    />
                  );
                }
                const shown = showBytes(step.value);
                return (
                  <Line
                    key={`${step.name}-${index}`}
                    label={`t:${step.name}`}
                    value={shown === '' ? undefined : shown}
                    note={shown === '' ? t('builder.previewEmptyValue') : undefined}
                  />
                );
              })}

              {verdict !== null && (
                <Line
                  label={`${operator.negated ? '!' : ''}@${operator.name} ${operator.argument}`.trim()}
                  note={t(VERDICT_KEY[verdict])}
                  noteColor={VERDICT_COLOR[verdict]}
                />
              )}
            </Box>
          )}
        </Stack>
      </Box>
    </>
  );
}

const VERDICT_KEY = {
  match: 'builder.previewMatch',
  noMatch: 'builder.previewNoMatch',
  unknown: 'builder.previewUnknown',
} as const;

// Несовпадение окрашено предупреждением, а не ошибкой: правило может
// проверяться и на значении, которое совпасть не должно. Красный здесь
// объявлял бы ошибкой половину нормальных проверок.
const VERDICT_COLOR = {
  match: 'success.main',
  noMatch: 'warning.main',
  unknown: 'text.disabled',
} as const;

interface LineProps {
  /** Имя шага: `t:lowercase`, `@streq POST` или подпись входа. */
  label: string;
  /** Значение после шага. Не задано — показывать нечего, остаётся пометка. */
  value?: string;
  /** Пояснение на месте значения: «без изменений», «не совпадает». */
  note?: string;
  noteColor?: string;
}

/** Строка предпросмотра: слева шаг, справа то, что после него осталось. */
function Line({ label, value, note, noteColor }: LineProps) {
  return (
    <>
      <Typography
        variant="caption"
        sx={{ fontFamily: MONO, color: 'text.disabled', whiteSpace: 'nowrap' }}
      >
        {label}
      </Typography>

      <Typography
        variant="caption"
        sx={{
          fontFamily: MONO,
          // Значение показывается целиком и с переносами: обрезанный
          // результат не отвечает на вопрос, ради которого его открыли.
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {value}
        {note !== undefined && (
          <Box component="span" sx={{ color: noteColor ?? 'text.disabled' }}>
            {note}
          </Box>
        )}
      </Typography>
    </>
  );
}
