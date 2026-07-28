import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../store';
import { applyRuleSource } from '../store/ruleSlice';
import { I18nProvider } from '../i18n/I18nProvider';
import { RuleProvider } from '../context/RuleProvider';
import { BuilderViewProvider } from '../context/BuilderViewProvider';
import { EditorViewProvider } from '../context/EditorViewProvider';
import { DebugPanel } from './DebugPanel';

const theme = createTheme();

function renderPanel(source: string) {
  store.dispatch(applyRuleSource(source, 'skip'));
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <RuleProvider>
            <EditorViewProvider>
              <BuilderViewProvider>
                <DebugPanel />
              </BuilderViewProvider>
            </EditorViewProvider>
          </RuleProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

/**
 * Правила, каждое из которых заведомо вызывает несколько замечаний.
 *
 * Нужен не реалистичный файл, а много сообщений при небольшом числе правил:
 * так проверяется потолок панели, а не скорость разбора.
 */
function noisyRules(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(
      `SecRule ARGS "@streq TWO" "id:${2000 + i},phase:2,deny,t:lowercase,t:uppercase"`,
    );
  }
  return lines.join('\n');
}

describe('панель диагностики', () => {
  it('называет сводку числами', () => {
    renderPanel('SecRule ARGS "@rx foo" "id:1001,phase:2,deny,msg:\'x\'"');
    expect(screen.getByText('ошибок: 0, предупреждений: 0')).toBeInTheDocument();
  });

  /**
   * Панель рисует не всё, и говорит об этом.
   *
   * Три тысячи сообщений не читает никто, а нарисовать их стоит примерно как
   * весь редактор. Умолчать об остатке было бы обманом: «замечаний двести» и
   * «показано двести из тысячи» — разные утверждения.
   */
  it('показывает потолок и остаток, когда сообщений слишком много', () => {
    renderPanel(noisyRules(80));

    const notice = screen.getByText(/показано 200 из \d+/);
    expect(notice).toBeInTheDocument();

    const total = Number(/из (\d+)/.exec(notice.textContent ?? '')?.[1]);
    expect(total).toBeGreaterThan(200);
    // Нарисовано ровно двести строк, а не столько, сколько нашлось.
    expect(screen.getAllByRole('button', { name: /^строка \d+$/ })).toHaveLength(200);
  });
});
