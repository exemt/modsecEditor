import { render, screen } from '@testing-library/react';
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

describe('App', () => {
  it('renders the XL modal open by default with the localized title', () => {
    renderApp('en');
    expect(screen.getByText('ModSecurity Rule Editor')).toBeInTheDocument();
  });

  it('renders the Russian title when locale is ru', () => {
    renderApp('ru');
    expect(screen.getByText('Редактор правил ModSecurity')).toBeInTheDocument();
  });
});
