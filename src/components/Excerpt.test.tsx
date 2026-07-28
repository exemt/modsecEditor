import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { I18nProvider } from '../i18n/I18nProvider';
import { Excerpt } from './Excerpt';

const theme = createTheme();

function renderExcerpt(text: string, limit: number) {
  return render(
    <I18nProvider initialLocale="ru">
      <ThemeProvider theme={theme}>
        <Excerpt text={text} limit={limit} title="@rx" />
      </ThemeProvider>
    </I18nProvider>,
  );
}

describe('Excerpt', () => {
  it('оставляет короткое значение простым текстом', () => {
    renderExcerpt('POST', 32);

    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('обрезает длинное значение, оставляя начало на месте', () => {
    renderExcerpt('a'.repeat(100), 32);

    expect(screen.getByRole('button')).toHaveTextContent(`${'a'.repeat(32)}…`);
  });

  it('показывает значение целиком в окне', async () => {
    const user = userEvent.setup();
    const pattern = `(?i)${'x'.repeat(100)}`;
    renderExcerpt(pattern, 32);

    await user.click(screen.getByRole('button'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(pattern);
    // Заголовок отвечает на вопрос, чьё это значение.
    expect(dialog).toHaveTextContent('@rx');
  });
});
