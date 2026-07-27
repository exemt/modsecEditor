import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  LOCALES,
  translations,
  type Locale,
  type TranslationKey,
} from './translations';
import { I18nContext, type I18nContextValue } from './context';

const STORAGE_KEY = 'exeditor.locale';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage может быть недоступен (приватный режим) — не падаем.
  }

  const nav = window.navigator?.language?.toLowerCase() ?? '';
  return nav.startsWith('ru') ? 'ru' : 'en';
}

interface I18nProviderProps {
  children: ReactNode;
  /** Принудительная локаль — удобно для тестов и Storybook. */
  initialLocale?: Locale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(
    () => initialLocale ?? detectInitialLocale(),
  );

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Игнорируем ошибки записи в localStorage.
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string>) => {
      const template = translations[locale][key] ?? translations.en[key] ?? key;
      if (!params) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) => params[name] ?? match);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, locales: LOCALES }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
