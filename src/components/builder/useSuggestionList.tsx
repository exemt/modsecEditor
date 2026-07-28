import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { createFilterOptions } from '@mui/material/Autocomplete';
import type { AutocompleteRenderGroupParams } from '@mui/material/Autocomplete';
import type { HTMLAttributes, Key } from 'react';
import { useLabel } from './useLabel';
import { ListSection } from './ListSection';
import type { Suggestion } from '../../modsec/suggestions';

/**
 * Отбор вариантов по набранному тексту.
 *
 * Ищем не только по значению, но и по пояснению, и сразу на обоих языках:
 * тот, кто не помнит написание `X-Forwarded-For`, наберёт «прокси» или
 * «proxy» — вариант всё равно должен найтись.
 */
export const filterSuggestions = createFilterOptions<Suggestion>({
  stringify: (option) => `${option.value} ${option.hint.en} ${option.hint.ru}`,
  trim: true,
});

/**
 * Оформление выпадающего списка готовых вариантов.
 *
 * Вынесено из полей, потому что список подсказок появляется не в одном
 * месте: поле ввода и набор чипов подсказывают одинаково, и выглядеть эти
 * списки обязаны тоже одинаково.
 *
 * Значение варианта стоит первым и моноширинным — его предстоит увидеть в
 * тексте правила буква в букву. Пояснение идёт строкой ниже и отвечает на
 * вопрос «а это что», ради которого список и заведён.
 */
export function useSuggestionList(suggestions: Suggestion[]) {
  const localize = useLabel();
  const grouped = suggestions.some((item) => item.group !== undefined);

  return {
    // Ширину панели список берёт по содержимому, а не по полю: колонка
    // конструктора узкая, и пояснение — то, ради чего список открыли, —
    // обрезалось бы на втором слове.
    slotProps: {
      popper: {
        placement: 'bottom-start' as const,
        style: { width: 'fit-content', minWidth: 280, maxWidth: 'min(460px, 90vw)' },
      },
    },
    groupBy: grouped ? (option: Suggestion) => localize(option.group, '') : undefined,
    // Заголовок раздела тот же, что и в списках базы знаний: разделены эти
    // списки по-разному, но выглядеть по-разному им незачем. Цвета у
    // подсказок нет — ни один их раздел не «подходит больше» остальных.
    renderGroup: (params: AutocompleteRenderGroupParams) => (
      <ListSection key={params.key} title={params.group}>
        {params.children}
      </ListSection>
    ),
    renderOption: (
      props: HTMLAttributes<HTMLLIElement> & { key: Key },
      option: Suggestion,
    ) => {
      const { key, ...rest } = props;
      return (
        <Box component="li" key={key} {...rest}>
          <Stack sx={{ minWidth: 0 }}>
            <Typography
              variant="body2"
              noWrap
              sx={{ fontFamily: 'ui-monospace, Consolas, monospace' }}
            >
              {option.value}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {localize(option.hint, '')}
            </Typography>
          </Stack>
        </Box>
      );
    },
  };
}
