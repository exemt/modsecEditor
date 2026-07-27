import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import { Bracket, BracketLine } from './Bracket';
import { TargetRow } from './TargetRow';
import { TransformPipeline } from './TransformPipeline';
import { OperatorValue } from './OperatorValue';
import { useI18n } from '../../i18n/useI18n';
import { CONDITION_PADDING, TRANSFORM_COLUMN } from './layout';
import { CONTROL_HEIGHT } from '../../theme';
import { DiagnosticNotes } from '../diagnostics/DiagnosticNotes';
import { conditionConstraints } from '../../modsec/semantics';
import { makeTarget } from '../../modsec/model';
import type { Diagnostic } from '../../modsec/diagnostics';
import type { VisualCondition } from '../../modsec/model';

interface ConditionRowProps {
  condition: VisualCondition;
  /** Замечания об этом звене — показываются под его полями. */
  diagnostics: Diagnostic[];
  onChange: (next: VisualCondition) => void;
  onRemove: () => void;
  canRemove: boolean;
}

/**
 * Одно условие: области проверки по ИЛИ → конвейер преобразований →
 * сравнение со значением. В тексте правила это ровно одна директива
 * `SecRule`, а несколько таких строк связываются в цепочку по И.
 *
 * Ограничения считаются здесь и раздаются вниз: подсчёт `&` в любой из
 * областей проверки гасит преобразования и сужает список операторов до
 * числовых — это и есть «одни проверки исключают другие».
 */
export function ConditionRow({
  condition,
  diagnostics,
  onChange,
  onRemove,
  canRemove,
}: ConditionRowProps) {
  const { t } = useI18n();
  const theme = useTheme();
  const constraints = conditionConstraints(condition.targets, condition.transforms);

  return (
    <Box
      sx={{
        position: 'relative',
        display: 'grid',
        // Колонки фиксируют минимальную ширину каждой части условия: поле
        // значения не должно схлопываться из-за длинного списка целей.
        gridTemplateColumns: {
          xs: '1fr',
          lg: `minmax(480px, 1.2fr) ${TRANSFORM_COLUMN}px minmax(340px, 1fr)`,
        },
        gap: 1.5,
        // Полосы выровнены по верхнему краю: первое поле каждой из них
        // встаёт на одну линию, а разная высота списков ниже ничего не
        // сдвигает. При центрировании условие «плавало» тем сильнее, чем
        // больше в нём областей проверки.
        alignItems: 'start',
        p: CONDITION_PADDING,
        pr: 5,
        borderRadius: 1.5,
        bgcolor: 'action.hover',
      }}
    >
      <BracketLine name="condition" top={theme.spacing(CONDITION_PADDING)} />

      <Box sx={{ minWidth: 0 }}>
        <Bracket label={t('builder.or')} color="warning.main" line="target">
          {/* Шаг между областями проверки держит запас под плавающую подпись:
              она стоит выше верхнего края поля и при меньшем шаге налезала
              бы на исключения предыдущей области. */}
          <Stack spacing={2}>
            {condition.targets.map((target, index) => (
              <TargetRow
                key={`${target.name}-${index}`}
                target={target}
                canRemove={condition.targets.length > 1}
                onChange={(next) =>
                  onChange({
                    ...condition,
                    targets: condition.targets.map((v, i) => (i === index ? next : v)),
                  })
                }
                onRemove={() =>
                  onChange({
                    ...condition,
                    targets: condition.targets.filter((_, i) => i !== index),
                  })
                }
              />
            ))}

            {/* Кнопка отмечена как ветвь: скобка доводится до неё, и видно,
                что добавляется именно ещё одна область проверки по ИЛИ. */}
            <Box sx={{ position: 'relative', display: 'flex' }}>
              <BracketLine name="target" height="100%" />
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<AddIcon />}
                onClick={() =>
                  onChange({ ...condition, targets: [...condition.targets, makeTarget()] })
                }
              >
                {t('builder.addOr')}
              </Button>
            </Box>
          </Stack>
        </Bracket>
      </Box>

      <TransformPipeline
        transforms={condition.transforms}
        // Конвейер начинается с того, что отдали области проверки, и
        // отбирает шаги по типу значения на каждом месте.
        baseKind={constraints.baseKind}
        targets={condition.targets}
        disabled={!constraints.transformsAllowed}
        disabledReason={t('builder.transformsBlocked')}
        onChange={(transforms) => onChange({ ...condition, transforms })}
      />

      <OperatorValue
        operator={condition.operator}
        // И список операторов, и подсказки к значению зависят от того, что
        // проверяется: у `REQUEST_METHOD` это методы, у `User-Agent` —
        // сканеры, у адреса — сети.
        targets={condition.targets}
        inputKind={constraints.inputKind}
        onChange={(operator) => onChange({ ...condition, operator })}
      />

      {/* Замечания идут под всеми тремя полосами: сообщение может касаться
          их сочетания — например, аргумента и конвейера сразу. */}
      {diagnostics.length > 0 && (
        <Box sx={{ gridColumn: '1 / -1' }}>
          <DiagnosticNotes items={diagnostics} />
        </Box>
      )}

      {/* Корзина стоит по центру первой линии полей, а не по краю блока. */}
      <Box
        sx={{
          position: 'absolute',
          // Отступ сверху равен внутреннему полю блока, иначе корзина
          // встанет выше линии, на которую опираются все три полосы.
          top: (theme) => theme.spacing(CONDITION_PADDING),
          right: (theme) => theme.spacing(1),
          height: CONTROL_HEIGHT,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <Tooltip title={t('builder.deleteCondition')}>
          <span>
            <IconButton size="small" disabled={!canRemove} onClick={onRemove}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
