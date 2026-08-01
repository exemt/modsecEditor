import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../../store';
import { applyRuleSource } from '../../store/filesSlice';
import { I18nProvider } from '../../i18n/I18nProvider';
import { WorkspaceProvider } from '../../context/WorkspaceProvider';
import { BuilderViewProvider } from '../../context/BuilderViewProvider';
import { EditorViewProvider } from '../../context/EditorViewProvider';
import { useBuilderView } from '../../context/builderViewContext';
import { EffectMark } from './EffectMark';
import type { ExclusionRef } from '../../modsec/exclusions';

const theme = createTheme();

const SOURCE = [
  'SecRule ARGS "@rx x" "id:1001,phase:2,deny"',
  'SecRuleRemoveById 1001',
  '',
].join('\n');

function Probe() {
  const { reveal } = useBuilderView();
  return <span data-testid="block">{reveal?.blockKey ?? ''}</span>;
}

function markOf(file: string): ExclusionRef {
  return {
    file,
    key: 'directive-1',
    line: 2,
    name: 'SecRuleRemoveById',
    text: 'SecRuleRemoveById 1001',
    source: 'directive',
  };
}

function renderMark() {
  store.dispatch(applyRuleSource(SOURCE, 'skip'));
  const file = store.getState().files.activeId;
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <EditorViewProvider>
              <BuilderViewProvider>
                <EffectMark mark={markOf(file)} removed />
                <Probe />
              </BuilderViewProvider>
            </EditorViewProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

describe('EffectMark', () => {
  it('ведёт к директиве исключения по клику', async () => {
    const user = userEvent.setup({ skipHover: true });
    renderMark();

    const chip = screen.getByRole('button', {
      name: /Снято директивой «SecRuleRemoveById» в строке 2/,
    });
    expect(chip).toHaveTextContent('выключено');

    await user.click(chip);

    await waitFor(() => {
      expect(screen.getByTestId('block')).toHaveTextContent('directive-1');
    });
  });

  it('на наведении показывает исходник директивы', async () => {
    const user = userEvent.setup();
    renderMark();

    await user.hover(
      screen.getByRole('button', { name: /Снято директивой «SecRuleRemoveById» в строке 2/ }),
    );
    expect(await screen.findByText('SecRuleRemoveById')).toBeInTheDocument();
  });
});
