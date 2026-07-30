import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { filesReducer, replaceWorkspace } from '../store/filesSlice';
import { I18nProvider } from '../i18n/I18nProvider';
import { WorkspaceProvider } from '../context/WorkspaceProvider';
import { FileSetControls } from './FileSetControls';

const theme = createTheme();

/**
 * Своё хранилище на каждый прогон.
 *
 * Набор — состояние приложения, и общий на все тесты означал бы, что порядок
 * файлов в одном тесте зависит от того, что делал предыдущий.
 */
function renderBar(...files: [string, string][]) {
  const store = configureStore({ reducer: { files: filesReducer } });
  store.dispatch(
    replaceWorkspace({ files: files.map(([name, source]) => ({ name, source })) }),
  );

  const view = render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <FileSetControls />
          </WorkspaceProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
  return { ...view, store, order: () => store.getState().files.files.map((f) => f.name) };
}

/** Открывает менеджер файлов той же иконкой, какой его открывает человек. */
async function openManager(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Файлы' }));
  return within(await screen.findByRole('dialog', { name: /Файлы набора/ }));
}

/** Строка файла в списке менеджера — по имени в её заголовке. */
function row(manager: ReturnType<typeof within>, name: string) {
  const list = manager.getByRole('list', { name: 'Файлы набора' });
  const found = within(list)
    .getAllByRole('listitem')
    .find((item) => within(item).queryByText(name) !== null);
  if (found === undefined) throw new Error(`в списке нет файла ${name}`);
  return within(found);
}

/** Что за это время браузер попросили выгрузить. */
let saved: Blob[] = [];

// Выгрузка ходит через createObjectURL, которого в jsdom нет.
beforeAll(() => {
  URL.createObjectURL = jest.fn((blob: Blob) => {
    saved.push(blob);
    return 'blob:test';
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = jest.fn();
});

beforeEach(() => {
  saved = [];
});

describe('выбор раздела', () => {
  it('называет активный файл и переходит к выбранному', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', 'SecMarker A'], ['exclusions.conf', 'SecRuleRemoveById 1']);

    const section = screen.getByLabelText('Файл');
    expect(section).toHaveValue('rules.conf');

    await user.click(section);
    await user.click(await screen.findByRole('option', { name: 'exclusions.conf' }));

    await waitFor(() => expect(screen.getByLabelText('Файл')).toHaveValue('exclusions.conf'));
  });

  /**
   * Набор CRS — тридцать с лишним файлов с именами, отличающимися серединой,
   * поэтому отбор идёт по любой части имени, а не по его началу.
   */
  it('отбирает файлы по набранной части имени', async () => {
    const user = userEvent.setup();
    renderBar(
      ['REQUEST-942-APPLICATION-ATTACK-SQLI.conf', ''],
      ['REQUEST-941-APPLICATION-ATTACK-XSS.conf', ''],
      ['RESPONSE-952-DATA-LEAKAGES.conf', ''],
    );

    const section = screen.getByLabelText('Файл');
    await user.click(section);
    await user.clear(section);
    await user.type(section, 'xss');

    const shown = await screen.findAllByRole('option');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toHaveTextContent('REQUEST-941-APPLICATION-ATTACK-XSS.conf');
  });

  // Найденное открывается с клавиатуры: поиск, в котором за набором следует
  // мышь, короче прокрутки не делает.
  it('переходит к найденному файлу по Enter', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', ''], ['exclusions.conf', '']);

    const section = screen.getByLabelText('Файл');
    await user.click(section);
    await user.clear(section);
    await user.type(section, 'excl{Enter}');

    await waitFor(() => expect(screen.getByLabelText('Файл')).toHaveValue('exclusions.conf'));
  });

  it('говорит, что подходящего имени в наборе нет', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', ''], ['exclusions.conf', '']);

    const section = screen.getByLabelText('Файл');
    await user.click(section);
    await user.clear(section);
    await user.type(section, 'sqli');

    expect(await screen.findByText('В наборе нет подходящего имени')).toBeInTheDocument();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  /**
   * Набранное отбирает, а не переименовывает.
   *
   * Поле показывает имя открытого файла, и уход из него с набранным мимо
   * списка обязан вернуть это имя: переименования в редакторе нет нигде, и
   * поле выбора не должно обещать его собой.
   */
  it('возвращает имя открытого файла, если набранное ни с чем не совпало', async () => {
    const user = userEvent.setup();
    const { order } = renderBar(['rules.conf', ''], ['exclusions.conf', '']);

    const section = screen.getByLabelText('Файл');
    await user.click(section);
    await user.clear(section);
    await user.type(section, 'другое имя');
    await user.tab();

    await waitFor(() => expect(screen.getByLabelText('Файл')).toHaveValue('rules.conf'));
    expect(order()).toEqual(['rules.conf', 'exclusions.conf']);
  });
});

describe('менеджер файлов', () => {
  it('показывает файлы набора с числом строк', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', 'SecMarker A\nSecMarker B'], ['empty.conf', '']);
    const manager = await openManager(user);

    expect(row(manager, 'rules.conf').getByText(/строк: 2/)).toBeInTheDocument();
    expect(row(manager, 'empty.conf').getByText('пусто')).toBeInTheDocument();
  });

  // Номер строки — это и есть порядок чтения, поэтому он показан числом.
  it('нумерует файлы в порядке чтения', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', ''], ['exclusions.conf', '']);
    const manager = await openManager(user);

    expect(row(manager, 'rules.conf').getByText('1')).toBeInTheDocument();
    expect(row(manager, 'exclusions.conf').getByText('2')).toBeInTheDocument();
  });

  it('называет открытый файл словом, а не только рамкой', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', ''], ['exclusions.conf', '']);
    const manager = await openManager(user);

    expect(row(manager, 'rules.conf').getByText('правится')).toBeInTheDocument();
    expect(row(manager, 'exclusions.conf').queryByText('правится')).toBeNull();
  });

  it('заводит пустой файл в конце набора', async () => {
    const user = userEvent.setup();
    const { order } = renderBar(['rules.conf', 'SecMarker A']);
    const manager = await openManager(user);

    // Пополняют набор там, куда файл встанет: кнопки стоят в конце списка.
    await user.click(manager.getByRole('button', { name: 'Пустой файл' }));

    await waitFor(() => expect(order()).toHaveLength(2));
  });

  /**
   * Файлы принимаются перетаскиванием, а не только через окно выбора.
   *
   * Набор собирают из файлов, которые уже лежат рядом в проводнике, и путь
   * «кнопка — окно выбора — тот же каталог» здесь лишний.
   */
  it('добавляет файлы, перетащенные с диска', async () => {
    const user = userEvent.setup();
    const { order } = renderBar(['rules.conf', '']);
    const manager = await openManager(user);

    const dropped = new File(['SecRuleRemoveById 1'], 'dropped.conf', { type: 'text/plain' });
    await act(async () => {
      fireEvent.drop(manager.getByText(/Перетащите сюда/), {
        dataTransfer: { files: [dropped], types: ['Files'] },
      });
    });

    await waitFor(() => expect(order()).toEqual(['rules.conf', 'dropped.conf']));
  });

  // Набор целиком уходит архивом из меню: здесь этой кнопке делать нечего,
  // окно про порядок, а не про выгрузку.
  it('выгружает из строки один файл и не предлагает выгрузить всё', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', 'SecMarker A'], ['exclusions.conf', 'SecRuleRemoveById 1']);
    const manager = await openManager(user);

    expect(manager.queryByRole('button', { name: /Выгрузить все/ })).toBeNull();

    await user.click(row(manager, 'rules.conf').getByRole('button', { name: /как есть/ }));
    expect(saved).toHaveLength(1);
    expect(saved[0].type).toBe('text/plain;charset=utf-8');
  });

  // Порядок здесь и есть порядок включения: перестановка меняет то, до кого
  // дотягиваются директивы, а не только вид списка.
  it('переставляет файл стрелкой', async () => {
    const user = userEvent.setup();
    const { order } = renderBar(['rules.conf', ''], ['exclusions.conf', '']);
    const manager = await openManager(user);

    await user.click(row(manager, 'exclusions.conf').getByRole('button', { name: /Выше/ }));

    await waitFor(() => expect(order()).toEqual(['exclusions.conf', 'rules.conf']));
  });

  it('убирает нетронутый файл без вопроса', async () => {
    const user = userEvent.setup();
    const { order } = renderBar(['rules.conf', ''], ['exclusions.conf', '']);
    const manager = await openManager(user);

    await user.click(row(manager, 'exclusions.conf').getByRole('button', { name: /Убрать/ }));

    await waitFor(() => expect(order()).toEqual(['rules.conf']));
  });

  /**
   * Единственный файл не убирают, а очищают.
   *
   * Редактор без файла — это редактор без текста, и вернуться в него было бы
   * неоткуда: набор пустым не остаётся.
   */
  it('очищает единственный файл вместо удаления', async () => {
    const user = userEvent.setup();
    const { order, store } = renderBar(['rules.conf', 'SecMarker A']);
    const manager = await openManager(user);

    await user.click(row(manager, 'rules.conf').getByRole('button', { name: /Убрать/ }));
    await user.click(await screen.findByRole('button', { name: 'Очистить' }));

    await waitFor(() => expect(store.getState().files.files[0].source).toBe(''));
    expect(order()).toEqual(['rules.conf']);
  });

  it('переходит к файлу по нажатию на его имя и закрывает менеджер', async () => {
    const user = userEvent.setup();
    renderBar(['rules.conf', ''], ['exclusions.conf', '']);
    const manager = await openManager(user);

    // Имя файла — кнопка перехода: нажимают на само имя, а не на подпись рядом.
    await user.click(row(manager, 'exclusions.conf').getByText('exclusions.conf'));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByLabelText('Файл')).toHaveValue('exclusions.conf');
  });
});
