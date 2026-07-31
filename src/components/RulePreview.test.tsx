import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../store';
import { applyRuleSource } from '../store/filesSlice';
import { I18nProvider } from '../i18n/I18nProvider';
import { WorkspaceProvider } from '../context/WorkspaceProvider';
import { BuilderViewProvider } from '../context/BuilderViewProvider';
import { EditorViewProvider } from '../context/EditorViewProvider';
import { useBuilderView } from '../context/builderViewContext';
import { useEditorView } from '../context/editorViewContext';
import { RulePreview } from './RulePreview';

const theme = createTheme();

const SOURCE = 'SecRule ARGS "@rx attack" "id:1001,phase:2,deny"\n';

/** Куда ушли просьбы показать правило — без полного редактора. */
function Probe() {
  const { reveal: builderReveal } = useBuilderView();
  const { tab, reveal } = useEditorView();
  return (
    <div>
      <span data-testid="tab">{tab}</span>
      <span data-testid="block">{builderReveal?.blockKey ?? ''}</span>
      <span data-testid="line">{reveal?.line ?? ''}</span>
    </div>
  );
}

function renderPreview() {
  store.dispatch(applyRuleSource(SOURCE, 'skip'));
  const file = store.getState().files.activeId;
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <EditorViewProvider>
              <BuilderViewProvider>
                <RulePreview id="1001" file={file} ruleKey="rule-0" />
                <Probe />
              </BuilderViewProvider>
            </EditorViewProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

describe('RulePreview', () => {
  it('на наведении показывает исходник правила', async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.hover(screen.getByRole('button', { name: 'Показать правило 1001' }));

    // Текст правила разбит по токенам подсветки — целой строки в одном
    // узле нет, и ищем по оболочке превью и слову директивы.
    const pane = await screen.findByText('SecRule');
    expect(pane.closest('.mini-editor')).not.toBeNull();
    expect(document.querySelector('.mini-editor__line')).toHaveTextContent('1');
  });

  it('по клику на номер открывает правило в конструкторе', async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(screen.getByRole('button', { name: 'Показать правило 1001' }));

    await waitFor(() => {
      expect(screen.getByTestId('tab')).toHaveTextContent('visual');
      expect(screen.getByTestId('block')).toHaveTextContent('rule-0');
    });
  });

  it('по клику на иконку текста на чипе открывает строку в текстовом редакторе', async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.click(
      screen.getByRole('button', { name: 'Показать правило 1001 в текстовом редакторе' }),
    );

    await waitFor(() => {
      expect(screen.getByTestId('tab')).toHaveTextContent('text');
      expect(screen.getByTestId('line')).toHaveTextContent('1');
    });
  });

  it('по клику на иконку в шапке превью открывает строку в текстовом редакторе', async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.hover(screen.getByRole('button', { name: 'Показать правило 1001' }));
    const opens = await screen.findAllByRole('button', {
      name: 'Показать правило 1001 в текстовом редакторе',
    });
    // На чипе одна, в шапке превью — вторая; жмём ту, что в шапке.
    const inPane = opens.find((el) => el.closest('.mini-editor') !== null);
    expect(inPane).toBeDefined();
    await user.click(inPane!);

    await waitFor(() => {
      expect(screen.getByTestId('tab')).toHaveTextContent('text');
      expect(screen.getByTestId('line')).toHaveTextContent('1');
    });
  });

  it('открывает подробный просмотр из шапки превью', async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.hover(screen.getByRole('button', { name: 'Показать правило 1001' }));
    await user.click(await screen.findByRole('button', { name: 'Открыть подробнее' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(document.querySelector('.mini-editor--expanded')).not.toBeNull();
  });

  it('закрывает компактное превью крестиком', async () => {
    const user = userEvent.setup();
    renderPreview();

    await user.hover(screen.getByRole('button', { name: 'Показать правило 1001' }));
    expect(await screen.findByText('SecRule')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Закрыть' }));

    await waitFor(() => {
      expect(document.querySelector('.mini-editor--compact')).toBeNull();
    });
  });
});
