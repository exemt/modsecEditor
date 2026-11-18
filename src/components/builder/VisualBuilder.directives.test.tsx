import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { store } from '../../store';
import { I18nProvider } from '../../i18n/I18nProvider';
import { WorkspaceProvider } from '../../context/WorkspaceProvider';
import { BuilderViewProvider } from '../../context/BuilderViewProvider';
import { EditorViewProvider } from '../../context/EditorViewProvider';
import { VisualBuilder } from './VisualBuilder';
import { replaceWorkspace } from '../../store/filesSlice';
import { renderBuilder, source, openDirective, addBlock, theme } from './VisualBuilder.testkit';
import { setFullList } from './fullList';

// Режим полного списка живёт вне React и переживает размонтирование —
// иначе тест, развернувший список, менял бы условия для следующих.
beforeEach(() => setFullList(false));

describe('VisualBuilder — строки без формы', () => {
  const RULE = `SecRule ARGS "@rx attack" "id:942100,phase:2,deny,msg:'SQL Injection'"`;

  /** Полоса блока — по имени директивы в её заголовке. */
  const directiveOf = (name: string) =>
    within(screen.getByText(name).closest('.MuiPaper-root') as HTMLElement);

  it('правит метку, не теряя её описания', async () => {
    const user = userEvent.setup();
    renderBuilder(['# Конец блокировок', 'SecMarker END-BLOCKING', ''].join('\n'));

    const field = screen.getByRole('textbox', { name: 'Метка' });
    expect(field).toHaveValue('SecMarker END-BLOCKING');
    expect(screen.getByRole('button', { name: 'Сохранить метку' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, 'SecMark');
    expect(screen.getByRole('button', { name: 'Сохранить метку' })).toBeDisabled();
    expect(source()).toContain('SecMarker END-BLOCKING');

    // Непарная кавычка — ошибка загрузки; толерантный разбор её «съест»,
    // но кнопка смотрит на компиляцию, а не на разбор.
    await user.clear(field);
    await user.type(field, 'SecMarker "END-REQUEST');
    expect(screen.getByRole('button', { name: 'Сохранить метку' })).toBeDisabled();

    await user.clear(field);
    await user.type(field, 'SecMarker END-REQUEST');
    expect(screen.getByRole('button', { name: 'Сохранить метку' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Сохранить метку' }));

    await waitFor(() => expect(source()).toContain('SecMarker END-REQUEST'));
    expect(source()).toContain('# Конец блокировок');
  });

  // Чип метки — исходник самой метки; значок рядом отвечает на встречный
  // вопрос: кто прыгает сюда через skipAfter.
  it('называет правило, которое прыгает на метку', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecRule ARGS "@rx x" "id:1001,phase:1,pass,nolog,skipAfter:END"',
        'SecMarker END',
        '',
      ].join('\n'),
    );

    await user.hover(screen.getByRole('button', { name: 'Что набор знает о метке' }));

    expect(await screen.findByText('Ссылаются')).toBeInTheDocument();
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByRole('button', { name: 'Показать правило 1001' })).toBeInTheDocument();
    expect(within(tip).getByText('Правило : 1001')).toBeInTheDocument();
  });

  it('говорит, что на метку никто не прыгает', async () => {
    const user = userEvent.setup();
    renderBuilder(['SecMarker ORPHAN', ''].join('\n'));

    await user.hover(screen.getByRole('button', { name: 'Что набор знает о метке' }));

    expect(
      await screen.findByText('нигде — ни один skipAfter в загруженных файлах сюда не прыгает'),
    ).toBeInTheDocument();
  });

  // Перестановка для исключения — не удобство, а единственная починка:
  // директива применяется при чтении конфигурации и своё правило видит
  // только ниже себя.
  it('переставляет исключение под его цель', async () => {
    const user = userEvent.setup();
    renderBuilder(['SecRuleRemoveById 942100', RULE, ''].join('\n'));

    expect(screen.getByText('не применяется')).toBeInTheDocument();

    await user.click(
      directiveOf('SecRuleRemoveById').getByRole('button', { name: 'Переместить ниже' }),
    );

    await waitFor(() =>
      expect(source().indexOf('id:942100')).toBeLessThan(source().indexOf('SecRuleRemoveById')),
    );
    expect(screen.queryByText('не применяется')).toBeNull();
  });

  it('дублирует строку директивы следом за ней', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecRuleRemoveById 942100', ''].join('\n'));

    await user.click(
      directiveOf('SecRuleRemoveById').getByRole('button', { name: 'Дублировать строку' }),
    );

    await waitFor(() =>
      expect(source().match(/^SecRuleRemoveById 942100$/gm)).toHaveLength(2),
    );
  });

  it('удаляет строку директивы', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecRuleRemoveById 942100', ''].join('\n'));

    await user.click(
      directiveOf('SecRuleRemoveById').getByRole('button', { name: 'Удалить строку' }),
    );

    await waitFor(() => expect(source()).not.toContain('SecRuleRemoveById'));
    expect(source()).toContain(RULE);
  });
});

describe('VisualBuilder — форма директивы', () => {
  const RULE = `SecRule ARGS "@rx attack" "id:942100,phase:2,deny,msg:'SQL Injection'"`;

  it('правит значение выбором из списка', async () => {
    const user = userEvent.setup();
    renderBuilder(['SecRuleEngine On', RULE, ''].join('\n'));

    await user.click(screen.getByRole('combobox', { name: 'Движок правил' }));
    await user.click(await screen.findByText('Только обнаружение'));

    await waitFor(() => expect(source()).toContain('SecRuleEngine DetectionOnly'));
    // Правится одна строка: правило рядом с ней остаётся как было.
    expect(source()).toContain(RULE);
  });

  // Имя — это и есть директива: сменить его значило бы завести другую, у
  // которой свой вид аргумента. Такое решение принимают строкой, а не полем
  // в общем ряду, — поэтому имени в форме нет вовсе.
  it('не даёт сменить имя стоящей директивы', () => {
    renderBuilder(['SecRequestBodyAccess Off', ''].join('\n'));

    expect(screen.getByText('SecRequestBodyAccess')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Директива' })).toBeNull();
    // Аргумент правится как раньше: неизменно только имя.
    expect(screen.getByRole('combobox', { name: 'Доступ к телу запроса' })).toHaveValue('Off');
  });

  it('краснеет на значении не из набора, но форму не убирает', () => {
    // Значение показано как есть и подсвечено: набор допустимых значений
    // редактор знает из своей таблицы, а она может отстать от движка —
    // поэтому строка остаётся правимой, а не блокирует конструктор.
    renderBuilder(['SecRuleEngine Yes', ''].join('\n'));

    const field = screen.getByRole('combobox', { name: 'Движок правил' });
    expect(field).toHaveValue('Yes');
    expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('оставляет текстовое поле там, где формы не заведено', () => {
    // Путь плюс список действий — вид ради одной директивы: она осталась
    // строкой, и правится строкой.
    renderBuilder(['SecRuleScript /opt/rules/check.lua "id:1,phase:2"', ''].join('\n'));

    expect(screen.getByRole('textbox', { name: 'Директива' })).toHaveValue(
      'SecRuleScript /opt/rules/check.lua "id:1,phase:2"',
    );
    expect(screen.queryByRole('combobox', { name: 'Директива' })).toBeNull();
  });

  it('набирает номера снимаемых правил чипами', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecRuleRemoveById 942100', ''].join('\n'));

    await openDirective(user);
    const pick = screen.getByRole('textbox', { name: 'Номера правил' });
    await user.type(pick, '942110{Enter}');

    await waitFor(() => expect(source()).toContain('SecRuleRemoveById 942100 942110'));
    expect(source()).toContain(RULE);
  });

  // Директиву заводят из того же меню, что и правило: блоков в файле два вида,
  // и до сих пор второй приходилось дописывать в текстовой вкладке.
  it('заводит директиву из меню, собрав её в окне', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    await addBlock(user, 'Добавить директиву');
    const dialog = within(await screen.findByRole('dialog'));

    // Пока имя не выбрано, добавлять нечего.
    expect(dialog.getByRole('button', { name: 'Добавить' })).toBeDisabled();

    // Список имён всплывает над окном и живёт вне него — ищем его по экрану.
    await user.type(dialog.getByRole('combobox', { name: 'Директива' }), 'Движок правил');
    await user.click(await screen.findByRole('option', { name: /Движок правил/ }));

    // Имя выбрано, значения ещё нет: такая строка не загрузится, и об этом
    // сказано словами, а не одной погасшей кнопкой.
    expect(dialog.getByRole('button', { name: 'Добавить' })).toBeDisabled();
    expect(dialog.getByText(/такая строка не загрузится/)).toBeInTheDocument();

    await user.click(dialog.getByRole('combobox', { name: 'Движок правил' }));
    await user.click(await screen.findByText('Только обнаружение'));
    await user.click(dialog.getByRole('button', { name: 'Добавить' }));

    // Строка встаёт в конец файла собранной, а правило остаётся как было.
    await waitFor(() => expect(source()).toContain('SecRuleEngine DetectionOnly'));
    expect(source().trimEnd().endsWith('SecRuleEngine DetectionOnly')).toBe(true);
    expect(source()).toContain(RULE);
  });

  // Директиве, чья форма в строку не влезает, окно даёт ту же панель, что и
  // раскрытая строка: второй, отдельно написанной формы у неё нет.
  it('заводит директиву с панелью тем же полем, что и правит', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    await addBlock(user, 'Добавить директиву');
    const dialog = within(await screen.findByRole('dialog'));

    await user.type(dialog.getByRole('combobox', { name: 'Директива' }), 'Части записи');
    await user.click(await screen.findByRole('option', { name: /Части записи журнала/ }));

    await user.type(dialog.getByRole('combobox', { name: 'Части записи' }), 'ABIJDEFHZ{Enter}');
    await user.click(dialog.getByRole('button', { name: 'Добавить' }));

    await waitFor(() => expect(source()).toContain('SecAuditLogParts ABIJDEFHZ'));
  });

  it('раскладывает умолчания фазы по полям', async () => {
    const user = userEvent.setup();
    renderBuilder(['SecDefaultAction "phase:2,log,auditlog,pass"', ''].join('\n'));

    expect(screen.getByRole('combobox', { name: 'Реакция' })).toHaveValue('Пропустить');

    await user.click(screen.getByRole('combobox', { name: 'Реакция' }));
    await user.click(await screen.findByText('Запретить'));

    await waitFor(() => expect(source()).toContain('phase:2,deny,log,auditlog'));
  });
});

// Из меню заводят все четыре вида строки, а не только те два, у которых есть
// форма: править то, чего нельзя завести, — половина работы.

describe('VisualBuilder — меню «Добавить»', () => {
  const RULE = `SecRule ARGS "@rx attack" "id:942100,phase:2,deny,msg:'SQL Injection'"`;

  it('заводит безусловное действие со свободным номером', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    await addBlock(user, 'Добавить безусловное действие');

    // Заготовка ничего не запрещает: условий у `SecAction` нет, и `deny` в
    // ней закрыл бы все запросы сразу.
    await waitFor(() => expect(source()).toContain('"id:942101,phase:1,pass,nolog"'));
    // Новое действие раскрывают сразу — в шапке поле id с подписью разряда,
    // как у правила; свёрнутый чип «Безусловное действие : N» — когда закрыто.
    expect(screen.getByText('Безусловное действие')).toBeInTheDocument();
    expect(screen.getByDisplayValue('942101')).toBeInTheDocument();
    // Замечаний заготовка не получает: иначе о ней сообщали бы в тот же миг,
    // когда её завели.
    expect(screen.queryByText(/заблокирован/)).toBeNull();
  });

  it('заводит метку, не повторяя занятое имя', async () => {
    const user = userEvent.setup();
    renderBuilder(['SecMarker MARKER', ''].join('\n'));

    await addBlock(user, 'Добавить метку');

    await waitFor(() => expect(source()).toContain('SecMarker MARKER-2'));
    // Имя правят в самой строке: у метки это всё её содержимое.
    expect(screen.getAllByRole('textbox', { name: 'Метка' })).toHaveLength(2);
    // В колонке названий — чип с превью, как у правила, а не голое слово.
    expect(screen.getByRole('button', { name: 'Показать метку MARKER' })).toHaveTextContent(
      'Метка : MARKER',
    );
    expect(screen.getByRole('button', { name: 'Показать метку MARKER-2' })).toHaveTextContent(
      'Метка : MARKER-2',
    );
  });

  it('свёрнутое безусловное действие показывает чип с номером', async () => {
    const user = userEvent.setup();
    renderBuilder('SecAction "id:1000,phase:1,pass,nolog"\n');

    // Первые блоки файла раскрыты по умолчанию — сворачиваем, чтобы увидеть
    // чип списка, как у правила.
    await user.click(screen.getByRole('button', { name: 'Свернуть блок' }));

    expect(
      screen.getByRole('button', { name: 'Показать правило 1000' }),
    ).toHaveTextContent('Безусловное действие : 1000');
  });
});

/**
 * Конструктор смотрит на один файл, а исключения приходят из набора.
 *
 * Директива из файла-надстройки снимает правило из файла правил, и отметка об
 * этом обязана назвать файл: «строка 1» без него отсылает к первой строке того
 * файла, который открыт, — то есть не туда.
 */

describe('VisualBuilder — чужой файл набора', () => {
  const RULE = `SecRule ARGS "@rx attack" "id:942100,phase:2,deny,msg:'SQL Injection'"`;

  /** Набор файлов, читаемых в этом порядке; правится первый. */
  function renderWorkspace(...files: [string, string][]) {
    store.dispatch(
      replaceWorkspace({ files: files.map(([name, source]) => ({ name, source })) }),
    );
    return render(
      <Provider store={store}>
        <I18nProvider initialLocale="ru">
          <ThemeProvider theme={theme}>
            <WorkspaceProvider>
              <EditorViewProvider>
                <BuilderViewProvider>
                  <VisualBuilder />
                </BuilderViewProvider>
              </EditorViewProvider>
            </WorkspaceProvider>
          </ThemeProvider>
        </I18nProvider>
      </Provider>,
    );
  }

  const activeName = () => {
    const { files, activeId } = store.getState().files;
    return files.find((file) => file.id === activeId)?.name;
  };

  it('называет файл в отметке о снятом правиле', async () => {
    renderWorkspace(['rules.conf', RULE], ['exclusions.conf', 'SecRuleRemoveById 942100']);

    expect(
      await screen.findByLabelText(/Снято директивой «SecRuleRemoveById» в строке 1 · в «exclusions.conf»/),
    ).toBeInTheDocument();
  });

  it('называет чужой файл у номера строки исключения и переходит к нему', async () => {
    const user = userEvent.setup();
    renderWorkspace(['rules.conf', RULE], ['exclusions.conf', 'SecRuleRemoveById 942100']);

    await user.click(await screen.findByRole('button', { name: 'Развернуть «Исключения»' }));

    // Адрес записи — с файлом: она стоит не в том файле, который открыт.
    expect(await screen.findByText('«exclusions.conf», строка 1')).toBeInTheDocument();

    // Переход к самой записи открывает её файл: правят там, где она написана.
    await user.click(
      screen.getByRole('button', {
        name: 'Показать «SecRuleRemoveById 942100» в «exclusions.conf»',
      }),
    );
    await waitFor(() => expect(activeName()).toBe('exclusions.conf'));
  });
});
