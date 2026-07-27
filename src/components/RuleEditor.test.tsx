import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../store';
import { applyRuleSource } from '../store/ruleSlice';
import { I18nProvider } from '../i18n/I18nProvider';
import { RuleProvider } from '../context/RuleProvider';
import { EditorViewProvider } from '../context/EditorViewProvider';
import RuleEditor from './RuleEditor';

const theme = createTheme();

function renderEditor(source: string) {
  store.dispatch(applyRuleSource(source, 'skip'));
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="en">
        <ThemeProvider theme={theme}>
          <RuleProvider>
            <EditorViewProvider>
              <RuleEditor />
            </EditorViewProvider>
          </RuleProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

/**
 * Наведение проверяется попаданием курсора в прямоугольник токена, а в jsdom
 * все прямоугольники нулевые — поэтому курсор в (0, 0) попадает в первое же
 * слово с подсказкой. Для этих правил первое слово — SecRule.
 */
async function hoverFirstKeyword(container: HTMLElement) {
  const code = container.querySelector('.rule-editor__code');
  fireEvent.mouseMove(code!, { clientX: 0, clientY: 0 });
  return screen.findByText('Core directive: creates a rule that matches a variable against an operator.');
}

const SOURCE = 'SecRule ARGS "@rx attack" "id:1001,phase:2,deny"\n';

describe('RuleEditor — подсказка по ключевому слову', () => {
  it('показывает короткое описание и обещает подробности по Alt', async () => {
    const { container } = renderEditor(SOURCE);

    await hoverFirstKeyword(container);
    expect(screen.getByText('Alt — details')).toBeInTheDocument();
    expect(screen.queryByText('Under the hood')).toBeNull();
  });

  it('раскрывает полную справку, пока Alt зажат', async () => {
    const { container } = renderEditor(SOURCE);
    await hoverFirstKeyword(container);

    fireEvent.keyDown(window, { key: 'Alt', altKey: true });

    expect(await screen.findByText('Syntax')).toBeInTheDocument();
    expect(screen.getByText('Under the hood')).toBeInTheDocument();
    expect(screen.getByText('Watch out')).toBeInTheDocument();
    expect(screen.getByText('Example')).toBeInTheDocument();
    expect(screen.getByText('See also')).toBeInTheDocument();
    expect(screen.getByText('Release Alt to collapse')).toBeInTheDocument();

    fireEvent.keyUp(window, { key: 'Alt', altKey: false });

    await waitFor(() => expect(screen.queryByText('Under the hood')).toBeNull());
  });

  // Одиночный Alt в Windows уводит фокус в меню браузера, и следующее нажатие
  // клавиши уходит уже туда. Пока подсказка раскрыта, нажатие наше.
  it('не отдаёт Alt браузеру, пока подсказку есть чем раскрыть', async () => {
    const { container } = renderEditor(SOURCE);
    await hoverFirstKeyword(container);

    const notPrevented = fireEvent.keyDown(window, { key: 'Alt', altKey: true });
    expect(notPrevented).toBe(false);
  });

  it('оставляет Alt браузеру, когда наводить не на что', () => {
    renderEditor(SOURCE);

    const notPrevented = fireEvent.keyDown(window, { key: 'Alt', altKey: true });
    expect(notPrevented).toBe(true);
  });
});
