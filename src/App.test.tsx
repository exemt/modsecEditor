import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { store } from './store';
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
 * Подсовывает файл в скрытый input.
 *
 * Нажатие на «Открыть» вызывает системное окно выбора, которого в тесте
 * нет и быть не может, поэтому проверяем всё, что происходит после выбора.
 */
async function choose(root: HTMLElement, name: string, text: string) {
  const input = root.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error('в панели нет поля выбора файла');

  const file = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    fireEvent.change(input);
  });
}

/**
 * Выбирает пример в витрине.
 *
 * Витрина — отдельное окно: её нужно открыть, выбрать пример в списке и
 * подтвердить выбор. Эти три шага повторяются в каждом тесте про примеры.
 */
async function pickExample(user: ReturnType<typeof userEvent.setup>, name: string) {
  // Подпись кнопки перекрыта её же подсказкой — так работает Tooltip в MUI.
  await user.click(screen.getByRole('button', { name: 'Open the learning examples' }));
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

    expect(screen.queryByText('Replace the current text?')).toBeNull();
    await waitFor(() => expect(editor()).toHaveValue(store.getState().rule.source));
    expect(store.getState().rule.source).toContain('@detectSQLi');
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
    expect(await screen.findByText('Replace the current text?')).toBeInTheDocument();

    // Отказ оставляет работу на месте.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitForElementToBeRemoved(() =>
      screen.queryByText('Replace the current text?'),
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

    expect(await screen.findByRole('textbox', { name: 'Destination' })).toHaveValue(
      '/blocked.html',
    );

    // Правка в тексте немедленно доходит до формы.
    await user.click(screen.getByRole('tab', { name: 'Text' }));
    await user.clear(editor());
    await user.paste('SecRule ARGS "@rx evil" "id:1,phase:2,deny"');
    await user.click(screen.getByRole('tab', { name: 'Visual' }));

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
    await waitFor(() => expect(window.localStorage.getItem('exeditor.draft')).toContain(
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

    await choose(baseElement, 'my-rules.conf', 'SecRule ARGS "@rx fromdisk" "id:42"');

    await waitFor(() => expect(editor.value).toContain('fromdisk'));
    // Имя открытого файла видно в панели: под ним же документ и выгрузится.
    expect(screen.getByText('my-rules.conf')).toBeInTheDocument();
  });

  it('asks before a file discards edited text', async () => {
    const user = userEvent.setup();
    const { baseElement } = renderApp('en');
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'ModSecurity rules editor',
    });

    await user.clear(editor);
    await user.paste('SecRule ARGS "@rx mine" "id:9001"');

    await choose(baseElement, 'other.conf', 'SecRule ARGS "@rx fromdisk" "id:42"');

    expect(await screen.findByText('Replace the current text?')).toBeInTheDocument();
    expect(editor.value).toContain('mine');

    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(editor.value).toContain('fromdisk'));
  });

  it('copies the whole text to the clipboard', async () => {
    const user = userEvent.setup();
    renderApp('en');

    await user.click(screen.getByRole('button', { name: /^Copy/ }));

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

    await user.click(screen.getByRole('button', { name: /^Copy/ }));

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
