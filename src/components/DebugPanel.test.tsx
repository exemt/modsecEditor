import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../store';
import { applyRuleSource, replaceWorkspace, selectSource } from '../store/filesSlice';
import { I18nProvider } from '../i18n/I18nProvider';
import { WorkspaceProvider } from '../context/WorkspaceProvider';
import { BuilderViewProvider } from '../context/BuilderViewProvider';
import { EditorViewProvider } from '../context/EditorViewProvider';
import { DebugPanel } from './DebugPanel';

const theme = createTheme();

function renderPanel(source: string) {
  store.dispatch(applyRuleSource(source, 'skip'));
  return renderTree();
}

/** Панель над набором файлов, читаемым в этом порядке. */
function renderWorkspace(...files: [string, string][]) {
  store.dispatch(
    replaceWorkspace({ files: files.map(([name, source]) => ({ name, source })) }),
  );
  return renderTree();
}

function renderTree() {
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <WorkspaceProvider>
            <EditorViewProvider>
              <BuilderViewProvider>
                <DebugPanel />
              </BuilderViewProvider>
            </EditorViewProvider>
          </WorkspaceProvider>
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

  /**
   * Панель говорит о наборе, а не об открытом файле.
   *
   * Замечание о промахнувшемся исключении рождается там, где смотрят на все
   * файлы сразу, и показать его только в том файле, где оно написано, значило бы
   * прятать его от того, кто правит правила.
   */
  it('показывает замечания всех файлов и называет файл в адресе', async () => {
    renderWorkspace(
      ['rules.conf', 'SecRule ARGS "@rx x" "id:1001,phase:2,deny,msg:\'x\'"'],
      // Номер из той же тысячи, что и загруженное правило: о промахе ядро
      // говорит, только когда видно, что нужная часть набора на месте.
      ['exclusions.conf', 'SecRuleRemoveById 1002'],
    );

    expect(await screen.findByText(/не подходит ни одно правило/)).toBeInTheDocument();
    // Файл назван прямо в адресе: «строка 1» без него есть в каждом файле.
    expect(screen.getByText(/в exclusions\.conf/)).toBeInTheDocument();
  });

  /**
   * Замечания приходят из ядра проверок, и говорит оно больше прежнего.
   *
   * Действие, записанное дважды, старые проверки редактора не замечали вовсе;
   * здесь оно названо — и названо по-русски, как всё остальное.
   */
  it('показывает замечание ядра, которого у редактора раньше не было', () => {
    renderPanel('SecRule ARGS "@rx \\d+" "id:1001,phase:2,deny,msg:\'x\',capture,capture"');

    expect(screen.getByText(/Действие «capture» задано несколько раз/)).toBeInTheDocument();
  });

  it('переводит и фразы, которые ядро подставляет в текст готовыми', () => {
    renderPanel('SecAction "id:1001,phase:9,pass,nolog"');

    const note = screen.getByText(/«phase» не принимает «9»/);
    expect(note.textContent).toContain('ожидается фаза от 1 до 5');
    expect(note.textContent).not.toMatch(/a phase from/);
  });
});

describe('панель диагностики — правки', () => {
  /**
   * Правка переписывает текст, а не пересобирает правило.
   *
   * Исправление ядра стирает ровно лишний шаг; раскладка правила по строкам
   * остаётся авторской.
   */
  it('чинит запись кнопкой и не трогает остальной текст', async () => {
    const user = userEvent.setup();
    renderPanel(
      [
        'SecRule ARGS "@rx \\d+" \\',
        '    "id:1001,phase:2,deny,\\',
        '    t:lowercase,t:lowercase,\\',
        "    msg:'x'\"",
      ].join('\n'),
    );

    await user.click(screen.getByRole('button', { name: 'Убрать «t:lowercase»' }));

    expect(selectSource(store.getState().files)).toBe(
      [
        'SecRule ARGS "@rx \\d+" \\',
        '    "id:1001,phase:2,deny,\\',
        '    t:lowercase,\\',
        "    msg:'x'\"",
      ].join('\n'),
    );
    expect(screen.queryByText(/применяется дважды/)).not.toBeInTheDocument();
  });

  it('правка — отдельный шаг истории: её отменяют одним нажатием', async () => {
    const user = userEvent.setup();
    const source = 'SecRule ARGS "@rx \\d+" "id:1001,phase:2,deny,msg:\'x\',capture,capture"';
    renderPanel(source);
    const steps = store.getState().files.files[0].past.length;

    await user.click(screen.getByRole('button', { name: 'Убрать повтор «capture»' }));

    const [file] = store.getState().files.files;
    expect(file.past).toHaveLength(steps + 1);
    expect(file.past[file.past.length - 1]).toBe(source);
  });

  /**
   * Правка текста работает и там, где конструктор закрыт.
   *
   * Пробел после переноса ломает саму запись: модели у такого файла нет, и
   * правке, которой нужна модель, не на что было бы опереться — ровно тогда,
   * когда кнопка нужнее всего.
   */
  it('чинит запись, из-за которой закрыт конструктор', async () => {
    const user = userEvent.setup();
    renderPanel('SecRule ARGS "@rx \\d+" \\ \n    "id:1001,phase:2,deny,msg:\'x\'"');

    await user.click(screen.getByRole('button', { name: 'Убрать пробел после «\\»' }));

    expect(selectSource(store.getState().files)).toBe(
      'SecRule ARGS "@rx \\d+" \\\n    "id:1001,phase:2,deny,msg:\'x\'"',
    );
    expect(screen.getByText('ошибок: 0, предупреждений: 0')).toBeInTheDocument();
  });

  it('чужому файлу правку не предлагает: правят только открытый', () => {
    renderWorkspace(
      ['rules.conf', 'SecRule ARGS "@rx \\d+" "id:1001,phase:2,deny,msg:\'x\'"'],
      ['other.conf', 'SecRule ARGS "@rx \\d+" "id:1002,phase:2,deny,msg:\'y\',capture,capture"'],
    );

    expect(screen.getByText(/Действие «capture» задано несколько раз/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Убрать повтор/ })).not.toBeInTheDocument();
  });
});
