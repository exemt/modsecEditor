import type { ReactElement } from 'react';
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
import { MarkerPreview } from './MarkerPreview';

const theme = createTheme();

const SOURCE = [
  'SecRule REQUEST_URI "@beginsWith /health" "id:1000,phase:1,pass,nolog,skipAfter:END"',
  'SecMarker END',
  '',
].join('\n');

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

function renderMarker(ui: ReactElement) {
  store.dispatch(applyRuleSource(SOURCE, 'skip'));
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <EditorViewProvider>
              <BuilderViewProvider>
                {ui}
                <Probe />
              </BuilderViewProvider>
            </EditorViewProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

describe('MarkerPreview', () => {
  it('находит метку по имени и показывает исходник', async () => {
    const user = userEvent.setup();
    renderMarker(<MarkerPreview label="END" caption="skipAfter:END" />);

    await user.hover(screen.getByRole('button', { name: 'Показать метку END' }));

    const pane = await screen.findByText('SecMarker');
    expect(pane.closest('.mini-editor')).not.toBeNull();
  });

  it('с preText пишет подпись перед именем, как у правила', () => {
    store.dispatch(applyRuleSource(SOURCE, 'skip'));
    const file = store.getState().files.activeId;
    render(
      <Provider store={store}>
        <I18nProvider initialLocale="ru">
          <ThemeProvider theme={theme}>
            <WorkspaceProvider>
              <EditorViewProvider>
                <BuilderViewProvider>
                  <MarkerPreview
                    preText="Метка"
                    label="END"
                    file={file}
                    blockKey="marker-1"
                    preview={false}
                  />
                </BuilderViewProvider>
              </EditorViewProvider>
            </WorkspaceProvider>
          </ThemeProvider>
        </I18nProvider>
      </Provider>,
    );

    expect(screen.getByRole('button', { name: 'Показать метку END' })).toHaveTextContent(
      'Метка : END',
    );
  });

  it('по клику открывает метку в конструкторе', async () => {
    const user = userEvent.setup({ skipHover: true });
    renderMarker(<MarkerPreview label="END" caption="skipAfter:END" />);

    await user.click(screen.getByRole('button', { name: 'Показать метку END' }));

    await waitFor(() => {
      expect(screen.getByTestId('tab')).toHaveTextContent('visual');
      expect(screen.getByTestId('block')).toHaveTextContent('marker-1');
    });
  });

  it('без метки в наборе — чип без перехода', async () => {
    const user = userEvent.setup();
    store.dispatch(applyRuleSource('SecRule ARGS "@rx x" "id:1,phase:1,pass"\n', 'skip'));
    render(
      <Provider store={store}>
        <I18nProvider initialLocale="ru">
          <ThemeProvider theme={theme}>
            <WorkspaceProvider>
              <EditorViewProvider>
                <BuilderViewProvider>
                  <MarkerPreview label="NOWHERE" caption="skipAfter:NOWHERE" />
                  <Probe />
                </BuilderViewProvider>
              </EditorViewProvider>
            </WorkspaceProvider>
          </ThemeProvider>
        </I18nProvider>
      </Provider>,
    );

    expect(screen.getByText('skipAfter:NOWHERE')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Показать метку NOWHERE' })).toBeNull();

    await user.click(screen.getByText('skipAfter:NOWHERE'));
    expect(screen.getByTestId('block')).toHaveTextContent('');
  });
});
