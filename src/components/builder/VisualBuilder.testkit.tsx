import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../../store';
import { applyRuleSource, selectSource } from '../../store/filesSlice';
import { I18nProvider } from '../../i18n/I18nProvider';
import { WorkspaceProvider } from '../../context/WorkspaceProvider';
import { BuilderViewProvider } from '../../context/BuilderViewProvider';
import { EditorViewProvider } from '../../context/EditorViewProvider';
import { EditorToolbar } from '../EditorToolbar';
import { VisualBuilder } from './VisualBuilder';

/**
 * Общее для тестов визуального режима: рендер со всеми провайдерами,
 * помощники и образцы правил.
 *
 * Тесты разложены по нескольким файлам `VisualBuilder.*.test.tsx`: в одном
 * файле их было под сотню, и jest гнал их подряд в одном воркере — дольше,
 * чем весь остальной набор вместе. Каждый файл получает свой экземпляр
 * хранилища: модули jest изолирует по файлам.
 */

export const theme = createTheme();

export function renderBuilder(source: string) {
  store.dispatch(applyRuleSource(source, 'skip'));
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <EditorViewProvider>
              {/* Панель режима стоит в строке вкладок, но принадлежит
                  визуальному режиму: тесты видят её вместе со списком,
                  как её видит человек. */}
              <BuilderViewProvider>
                <EditorToolbar tab="visual" />
                <VisualBuilder />
              </BuilderViewProvider>
            </EditorViewProvider>
          </WorkspaceProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

export const source = () => selectSource(store.getState().files);

/** Документ из `count` однотипных правил с номерами от 1001. */
export function manyRules(count: number): string {
  const rules: string[] = [];
  for (let i = 0; i < count; i++) {
    rules.push(`SecRule ARGS "@rx attack${i}" "id:${1001 + i},phase:2,deny,log"`, '');
  }
  return rules.join('\n');
}

/**
 * Карточка правила с этим номером — по номеру в её заголовке.
 *
 * Раскрытая держит его полем, свёрнутая — чипом с превью: правят номер там,
 * где видно всё правило целиком.
 */
export function cardOf(id: string): HTMLElement {
  const field = screen
    .queryAllByRole('textbox', { name: 'ID правила' })
    .find((input) => (input as HTMLInputElement).value === id);
  const title =
    field ?? screen.queryByRole('button', { name: `Показать правило ${id}` });
  if (title === null || title === undefined) throw new Error(`нет карточки правила ${id}`);
  return title.closest('.MuiPaper-root') as HTMLElement;
}

export const expandedCards = () => screen.queryAllByRole('button', { name: 'Свернуть правило' });
export const collapsedCards = () => screen.queryAllByRole('button', { name: 'Развернуть правило' });

/**
 * Раскрыть блок «Действия» на единственной карточке списка.
 *
 * Раскрытая карточка показывает один блок — условия, — а до полей реакции
 * доходят тем же нажатием, каким до них доходит человек.
 */
export async function openActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Развернуть «Действия»' }));
}

/**
 * Раскрыть единственную в списке панель директивы.
 *
 * Раскрытым документ показывает первый блок, поэтому у директивы ниже правила
 * полей нет, пока её не открыли.
 */
export async function openDirective(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Развернуть блок' }));
}

/**
 * Пункт меню «Добавить» на панели режима.
 *
 * Кнопку панели отличает от одноимённых кнопок внутри карточек то, что за ней
 * меню: подпись у неё та же, потому что вид блока выбирают уже в меню.
 */
export async function addBlock(user: ReturnType<typeof userEvent.setup>, item: string) {
  const menu = screen
    .getAllByRole('button', { name: 'Добавить' })
    .find((button) => button.getAttribute('aria-haspopup') === 'menu');
  if (menu === undefined) throw new Error('нет кнопки «Добавить» на панели режима');

  await user.click(menu);
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

export const BAD_BOT = [
  '# Блокируем известного зловредного User-Agent',
  'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\',
  "    \"id:1001,phase:1,deny,status:403,msg:'Bad bot detected'\"",
  '',
].join('\n');

// Конвейер с одним шагом: только у непустого есть кнопка «добавить».
export const LOWERCASED = [
  'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\',
  '    "id:1001,phase:1,t:lowercase,deny,status:403"',
  '',
].join('\n');

// Подсчёт вместе с преобразованиями: сочетание запрещённое, но написать
// его в правиле никто не мешает — и конструктор обязан его показать.
export const COUNTED = [
  'SecRule &ARGS "@lt 2" \\',
  '    "id:1001,phase:2,t:lowercase,deny"',
  '',
].join('\n');
