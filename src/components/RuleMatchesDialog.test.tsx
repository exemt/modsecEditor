import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../store';
import { applyRuleSource, replaceWorkspace } from '../store/filesSlice';
import { I18nProvider } from '../i18n/I18nProvider';
import { WorkspaceProvider } from '../context/WorkspaceProvider';
import { BuilderViewProvider } from '../context/BuilderViewProvider';
import { EditorViewProvider } from '../context/EditorViewProvider';
import { ExclusionMarks } from './builder/ExclusionMarks';
import { RuleMatchesDialog } from './RuleMatchesDialog';
import type { ExclusionEntry, ExclusionMatch } from '../modsec/exclusions';

const theme = createTheme();

function manyRules(count: number): string {
  const rules: string[] = [];
  for (let i = 0; i < count; i++) {
    rules.push(`SecRule ARGS "@rx attack${i}" "id:${1001 + i},phase:2,deny,log"`, '');
  }
  return rules.join('\n');
}

function entryWith(matches: ExclusionMatch[]): ExclusionEntry {
  const placeFile = matches[0]?.file ?? '';
  return {
    directive: {
      source: 'directive',
      place: { file: placeFile, order: 0, index: 0 },
      line: 1,
      name: 'SecRuleRemoveById',
      op: 'remove',
      selector: 'id',
      ids: matches.map((match) => ({ from: Number(match.id), to: Number(match.id) })),
      targets: [],
      actions: [],
      badIds: [],
      incomplete: false,
    },
    matches,
  };
}

/** Совпадения по id в одном файле — ключ диалогу не нужен, он идёт через ruleOf. */
function matchesIn(file: string, ids: string[]): ExclusionMatch[] {
  return ids.map((id) => ({ file, key: '', id, applies: true }));
}

function renderMarks(count: number) {
  store.dispatch(applyRuleSource(manyRules(count), 'skip'));
  const file = store.getState().files.activeId;
  const ids = Array.from({ length: count }, (_, i) => String(1001 + i));
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <EditorViewProvider>
              <BuilderViewProvider>
                <ExclusionMarks entry={entryWith(matchesIn(file, ids))} />
              </BuilderViewProvider>
            </EditorViewProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

describe('RuleMatchesDialog через ExclusionMarks', () => {
  it('называет полное число правил, а не хвост после чипов', async () => {
    const user = userEvent.setup();
    renderMarks(10);

    expect(screen.getByRole('button', { name: 'Посмотреть все · 10' })).toBeInTheDocument();
    expect(screen.queryByText('+4')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Посмотреть все · 10' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Связанные правила · 10')).toBeInTheDocument();
    // Крестик — справа: после заголовка и полей фильтра.
    const close = within(dialog).getByRole('button', { name: 'Закрыть' });
    expect(close.compareDocumentPosition(within(dialog).getByText('Связанные правила · 10'))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
    expect(within(dialog).getByLabelText('Фильтр по id')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Файл')).toBeInTheDocument();
  });

  it('фильтрует список по набранному id', async () => {
    const user = userEvent.setup();
    renderMarks(10);

    await user.click(screen.getByRole('button', { name: 'Посмотреть все · 10' }));
    const dialog = await screen.findByRole('dialog');

    await user.type(within(dialog).getByLabelText('Фильтр по id'), '1005');

    expect(within(dialog).getByText('Связанные правила · 1')).toBeInTheDocument();
    expect(dialog.querySelectorAll('.mini-editor--row')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: 'Показать правило 1005' })).toBeInTheDocument();
  });

  it('в селекторе файла показывает счётчики и прячет нулевые после фильтра id', async () => {
    const user = userEvent.setup();
    store.dispatch(
      replaceWorkspace({
        files: [
          {
            name: 'a.conf',
            source: 'SecRule ARGS "@rx a" "id:1001,phase:2,deny,log"\n',
          },
          {
            name: 'b.conf',
            source: 'SecRule ARGS "@rx b" "id:2001,phase:2,deny,log"\n',
          },
        ],
      }),
    );
    render(
      <Provider store={store}>
        <I18nProvider initialLocale="ru">
          <ThemeProvider theme={theme}>
            <WorkspaceProvider>
              <EditorViewProvider>
                <BuilderViewProvider>
                  <RuleMatchesDialog open onClose={() => undefined} ids={['1001', '2001']} />
                </BuilderViewProvider>
              </EditorViewProvider>
            </WorkspaceProvider>
          </ThemeProvider>
        </I18nProvider>
      </Provider>,
    );

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText('Файл'));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: /Все файлы/ })).toHaveTextContent('2');
    expect(within(listbox).getByRole('option', { name: /a\.conf/ })).toHaveTextContent('1');
    expect(within(listbox).getByRole('option', { name: /b\.conf/ })).toHaveTextContent('1');

    await user.keyboard('{Escape}');
    await user.type(within(dialog).getByLabelText('Фильтр по id'), '2001');
    await user.click(within(dialog).getByLabelText('Файл'));
    const narrowed = await screen.findByRole('listbox');
    expect(within(narrowed).queryByRole('option', { name: /a\.conf/ })).toBeNull();
    expect(within(narrowed).getByRole('option', { name: /b\.conf/ })).toHaveTextContent('1');
    expect(within(narrowed).getByRole('option', { name: /Все файлы/ })).toHaveTextContent('1');
  });

  it('монтирует редактор вместо шапки строки, без второй копии', async () => {
    const user = userEvent.setup();
    renderMarks(8);

    await user.click(screen.getByRole('button', { name: 'Посмотреть все · 8' }));
    const dialog = await screen.findByRole('dialog');

    expect(dialog.querySelectorAll('.mini-editor--row')).toHaveLength(8);
    expect(dialog.querySelector('.mini-editor--expanded')).toBeNull();

    await user.click(within(dialog).getAllByRole('button', { name: 'Показать исходник правила' })[0]);

    await waitFor(() => {
      expect(dialog.querySelectorAll('.mini-editor--expanded')).toHaveLength(1);
      // Раскрытая строка отдала место редактору — её шапка-строка исчезла.
      expect(dialog.querySelectorAll('.mini-editor--row')).toHaveLength(7);
      expect(
        within(dialog).getByRole('button', { name: 'Скрыть исходник правила' }),
      ).toBeInTheDocument();
    });
  });

  it('держит высоту списка по числу строк, не монтируя исходники свёрнутых', async () => {
    const user = userEvent.setup();
    renderMarks(40);

    await user.click(screen.getByRole('button', { name: 'Посмотреть все · 40' }));
    const dialog = await screen.findByRole('dialog');

    // В тестах высота окна нулевая — виртуализация показывает все шапки, но
    // ни одна не собирает исходник: редакторов столько, сколько раскрыли.
    expect(dialog.querySelectorAll('.mini-editor--row').length).toBeGreaterThan(0);
    expect(dialog.querySelector('.mini-editor--expanded')).toBeNull();
    expect(dialog.querySelector('.rule-editor__highlight')).toBeNull();
  });
});

