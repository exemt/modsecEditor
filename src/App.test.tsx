import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { store } from './store';
import { packArchive } from './components/archive';
import { selectSource } from './store/filesSlice';
import { I18nProvider } from './i18n/I18nProvider';
import App from './App';

function renderApp(locale: 'en' | 'ru' = 'en') {
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale={locale}>
        <App />
      </I18nProvider>
    </Provider>,
  );
}

// Приложение помнит документ между сессиями, поэтому без очистки один тест
// подкладывал бы свой текст следующему.
beforeEach(() => window.localStorage.clear());

/**
 * Подсовывает файлы в скрытый input.
 *
 * Нажатие на «Открыть» вызывает системное окно выбора, которого в тесте
 * нет и быть не может, поэтому проверяем всё, что происходит после выбора.
 * Файлов бывает несколько сразу: набор для этого и держат открытым.
 *
 * Полей выбора в меню два, и различить их можно только фильтром: одно берёт
 * файлы правил, другое — архив.
 */
async function feed(root: HTMLElement, accept: 'conf' | 'zip', files: File[]) {
  const input = root.querySelector<HTMLInputElement>(
    `input[type="file"][accept*="${accept}"]`,
  );
  if (input === null) throw new Error(`в меню нет поля выбора (${accept})`);

  Object.defineProperty(input, 'files', { value: files, configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

async function choose(root: HTMLElement, ...picked: [string, string][]) {
  await feed(
    root,
    'conf',
    picked.map(([name, text]) => new File([text], name, { type: 'text/plain' })),
  );
}

/** Текст активного файла — то, что видно в редакторе. */
const active = () => selectSource(store.getState().files);

/**
 * Выбирает пункт в меню «Файл».
 *
 * Всё, что делают с набором целиком, живёт в этом меню, поэтому через него
 * проходит и открытие файлов, и выгрузка, и витрина примеров.
 */
async function fileMenu(user: ReturnType<typeof userEvent.setup>, item: string) {
  await user.click(screen.getByRole('button', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

/**
 * Выбирает пример в витрине.
 *
 * Витрина — отдельное окно: её нужно открыть, выбрать пример в списке и
 * подтвердить выбор. Эти три шага повторяются в каждом тесте про примеры.
 */
async function pickExample(user: ReturnType<typeof userEvent.setup>, name: string) {
  await fileMenu(user, 'Learning examples…');
  await user.click(await screen.findByRole('button', { name }));
  await user.click(screen.getByRole('button', { name: 'Open in the editor' }));
}

describe('App', () => {
  it('renders the XL modal open by default with the localized title', () => {
    renderApp('en');
    expect(screen.getByText('ModSecurity Rule Editor')).toBeInTheDocument();
  });

  it('renders the Russian title when locale is ru', () => {
    renderApp('ru');
    expect(screen.getByText('Редактор правил ModSecurity')).toBeInTheDocument();
  });

  // Редактор — это и есть всё приложение: закрыть его значит потерять текст
  // без возможности вернуться. Escape обязан остаться делом того поля,
  // в котором его нажали.
  it('survives Escape — there is nothing to close the editor into', async () => {
    const user = userEvent.setup();
    renderApp('en');

    await user.click(screen.getByRole('tab', { name: 'Visual' }));
    // Раскрытая карточка показывает условия, а поля реакции — за полосой
    // блока: до сообщения доходят тем же нажатием, каким доходит человек.
    await user.click(await screen.findByRole('button', { name: 'Expand "Actions"' }));
    const message = await screen.findByRole('textbox', { name: 'Message' });

    await user.clear(message);
    await user.type(message, 'draft{Escape}');

    expect(screen.getByText('ModSecurity Rule Editor')).toBeInTheDocument();
    expect(message).toHaveValue('Bad bot detected');
  });

  // Пример заменяет весь текст. Пока текст не тронут, вопрос был бы шумом;
  // как только в нём есть чужая работа, молча стирать её нельзя.
  it('switches examples without asking while the text is untouched', async () => {
    const user = userEvent.setup();
    renderApp('en');
    const editor = () => screen.getByRole('textbox', { name: 'ModSecurity rules editor' });

    await pickExample(user, 'SQL Injection');

    expect(screen.queryByText('Replace the whole set?')).toBeNull();
    await waitFor(() => expect(editor()).toHaveValue(active()));
    expect(active()).toContain('@detectSQLi');
  });

  it('asks before an example discards edited text', async () => {
    const user = userEvent.setup();
    renderApp('en');
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'ModSecurity rules editor',
    });

    await user.clear(editor);
    await user.type(editor, 'SecRule ARGS "@rx mine" "id:9001"');

    await pickExample(user, 'SQL Injection');
    expect(await screen.findByText('Replace the whole set?')).toBeInTheDocument();

    // Отказ оставляет работу на месте.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitForElementToBeRemoved(() =>
      screen.queryByText('Replace the whole set?'),
    );
    expect(editor).toHaveValue('SecRule ARGS "@rx mine" "id:9001"');

    await pickExample(user, 'SQL Injection');
    await user.click(await screen.findByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(editor.value).not.toContain('mine'));
  });

  // Номер строки в панели — не подпись, а адрес: по нему возвращаются
  // в текст и видят, о какой именно директиве речь.
  it('jumps from a diagnostic to its line in the text', async () => {
    const user = userEvent.setup();
    renderApp('en');
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'ModSecurity rules editor',
    });

    await user.clear(editor);
    await user.paste(
      [
        'SecRule ARGS "@rx one" "id:1,phase:2,deny,msg:\'a\'"',
        'SecRule ARGS "@streq TWO" "id:2,phase:2,deny,msg:\'b\',t:lowercase"',
      ].join('\n'),
    );

    // Замечание о регистре относится ко второй строке.
    const jump = await screen.findByRole('button', { name: 'line 2' });
    await user.click(jump);

    await waitFor(() => expect(editor).toHaveFocus());
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
    expect(selected).toContain('@streq TWO');
  });

  /**
   * Второй адрес того же замечания — карточка в конструкторе.
   *
   * Правило может быть свёрнуто, а на большом файле — и вовсе не смонтировано,
   * поэтому «перейти» здесь означает раскрыть его и подвести к нему, а не
   * просто переключить вкладку.
   */
  it('jumps from a diagnostic to its rule in the builder', async () => {
    const user = userEvent.setup();
    renderApp('en');
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'ModSecurity rules editor',
    });

    await user.clear(editor);
    // Двенадцать правил: замечание относится к последнему, а раскрытым
    // изначально бывает только первое.
    await user.paste(
      Array.from({ length: 12 }, (_, i) =>
        i === 11
          ? 'SecRule ARGS "@streq TWO" "id:12,phase:2,deny,msg:\'z\',t:lowercase"'
          : `SecRule ARGS "@rx ok" "id:${i + 1},phase:2,deny,msg:'a'"`,
      ).join('\n'),
    );

    // Сообщение адресуется строкой, поэтому и ищется по ней: у соседних
    // правил свои замечания, и «первая ссылка в панели» была бы не той.
    const lines = await screen.findAllByRole('button', { name: 'line 12' });
    const row = lines[0].parentElement;
    if (row === null) throw new Error('сообщение диагностики без строки');
    await user.click(within(row).getByRole('button', { name: 'in the builder' }));

    // Вкладка сменилась сама, и карточка того самого правила раскрыта:
    // условие видно полями, а не только выжимкой свёрнутой полосы.
    expect(await screen.findByDisplayValue('TWO')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Visual' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  // Адрес перенаправления раньше терялся при первой же правке в форме.
  it('shows the redirect destination and drops it with the reaction', async () => {
    const user = userEvent.setup();
    renderApp('en');
    // Вкладка размонтирует редактор, поэтому элемент ищем каждый раз заново.
    const editor = () =>
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ModSecurity rules editor' });

    await user.clear(editor());
    await user.paste('SecRule ARGS "@rx evil" "id:1,phase:2,redirect:/blocked.html"');
    await user.click(screen.getByRole('tab', { name: 'Visual' }));
    // Блок действий раскрывают нажатием — и после возвращения из текста снова:
    // вкладка размонтирует список, а с ним и то, что человек в нём открыл.
    const openActions = async () =>
      user.click(await screen.findByRole('button', { name: 'Expand "Actions"' }));

    await openActions();
    expect(await screen.findByRole('textbox', { name: 'Destination' })).toHaveValue(
      '/blocked.html',
    );

    // Правка в тексте немедленно доходит до формы.
    await user.click(screen.getByRole('tab', { name: 'Text' }));
    await user.clear(editor());
    await user.paste('SecRule ARGS "@rx evil" "id:1,phase:2,deny"');
    await user.click(screen.getByRole('tab', { name: 'Visual' }));
    await openActions();

    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Destination' })).toBeNull(),
    );
  });

  // Перезагрузка страницы была самым обидным способом потерять работу.
  it('restores the previous session instead of the first example', async () => {
    const user = userEvent.setup();
    const { unmount } = renderApp('en');
    const editor = () =>
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ModSecurity rules editor' });

    await user.clear(editor());
    await user.paste('SecRule ARGS "@rx survives" "id:7,phase:2,deny"');
    await waitFor(() => expect(window.localStorage.getItem('exeditor.workspace')).toContain(
      'survives',
    ));

    unmount();
    renderApp('en');

    await waitFor(() => expect(editor().value).toContain('survives'));
  });

  it('undoes and redoes text edits from the keyboard', async () => {
    const user = userEvent.setup();
    renderApp('en');
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'ModSecurity rules editor',
    });

    await user.clear(editor);
    await user.paste('first');

    // Подряд идущие правки склеиваются в один шаг истории по времени.
    // Вместо ожидания наяву переводим часы вперёд: тест не должен зависеть
    // от того, насколько занята машина.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      await user.paste(' second');
    } finally {
      Date.now = realNow;
    }
    expect(editor).toHaveValue('first second');

    await user.type(editor, '{Control>}z{/Control}');
    await waitFor(() => expect(editor).toHaveValue('first'));

    await user.type(editor, '{Control>}y{/Control}');
    await waitFor(() => expect(editor).toHaveValue('first second'));
  });

  it('loads a .conf file from disk', async () => {
    const { baseElement } = renderApp('en');
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'ModSecurity rules editor',
    });

    await choose(baseElement, ['my-rules.conf', 'SecRule ARGS "@rx fromdisk" "id:42"']);

    await waitFor(() => expect(editor.value).toContain('fromdisk'));
    // Имя открытого файла стоит в поле выбора раздела: под ним же он и выгрузится.
    expect(screen.getByLabelText('File')).toHaveValue('my-rules.conf');
  });

  it('replaces the whole set with the files that were opened', async () => {
    const { baseElement } = renderApp('en');

    await choose(
      baseElement,
      ['first.conf', 'SecRule ARGS "@rx fromdisk" "id:42"'],
      ['second.conf', 'SecRuleRemoveById 42'],
    );

    await waitFor(() => expect(active()).toContain('fromdisk'));
    expect(store.getState().files.files.map((file) => file.name)).toEqual([
      'first.conf',
      'second.conf',
    ]);
  });

  /**
   * Открытие заменяет набор, поэтому спрашивает о невыгруженной работе.
   *
   * Пополняют набор в окне файлов — там видно, куда файл встанет в порядке
   * чтения; здесь же «открыть» значит то же, что в любом приложении.
   */
  it('asks before opened files discard the edited text', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderApp('en');
    const editor = () =>
      screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'ModSecurity rules editor' });

    await user.clear(editor());
    await user.paste('SecRule ARGS "@rx mine" "id:9001"');

    await choose(baseElement, ['first.conf', 'SecRule ARGS "@rx fromdisk" "id:42"']);
    expect(await screen.findByText('Replace the whole set?')).toBeInTheDocument();

    // Отказ оставляет работу на месте.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitForElementToBeRemoved(() => screen.queryByText('Replace the whole set?'));
    expect(active()).toContain('mine');

    await choose(baseElement, ['first.conf', 'SecRule ARGS "@rx fromdisk" "id:42"']);
    await user.click(await screen.findByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(active()).toContain('fromdisk'));
    expect(store.getState().files.files).toHaveLength(1);
  });

  /**
   * Архив открывается набором, а не одной строкой.
   *
   * Набор уходит из вкладки архивом, и вернуться он должен тем же архивом:
   * иначе выгрузка есть, а загрузки нет — и порядок включения приходится
   * собирать заново руками.
   */
  it('opens a .zip archive as the whole set', async () => {
    const { baseElement } = renderApp('en');
    const zip = packArchive([
      { name: 'rules.conf', text: 'SecRule ARGS "@rx fromzip" "id:71"' },
      { name: 'exclusions.conf', text: 'SecRuleRemoveById 71' },
    ]);

    await feed(baseElement, 'zip', [
      new File([new Uint8Array(zip)], 'set.zip', { type: 'application/zip' }),
    ]);

    await waitFor(() => expect(active()).toContain('fromzip'));
    const names = store.getState().files.files.map((file) => file.name);
    expect(names).toEqual(expect.arrayContaining(['rules.conf', 'exclusions.conf']));
  });

  it('copies the whole text to the clipboard', async () => {
    const user = userEvent.setup();
    renderApp('en');

    await fileMenu(user, 'Copy the text to the clipboard');

    expect(await screen.findByText('Copied to the clipboard')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toContain('SecRule');
  });

  // Молчащая кнопка выглядит как сломанная, поэтому отказ буфера обмена
  // тоже должен быть сказан вслух.
  it('admits when the clipboard is not available', async () => {
    const user = userEvent.setup();
    renderApp('en');
    jest
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValueOnce(new Error('denied'));

    await fileMenu(user, 'Copy the text to the clipboard');

    expect(
      await screen.findByText('The browser did not allow access to the clipboard'),
    ).toBeInTheDocument();
  });

  it('keeps the editor open when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderApp('en');

    const backdrop = baseElement.querySelector('.MuiBackdrop-root');
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);

    await waitFor(() =>
      expect(screen.getByText('ModSecurity Rule Editor')).toBeInTheDocument(),
    );
  });
});
