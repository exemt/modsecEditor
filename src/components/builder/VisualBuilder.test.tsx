import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { store } from '../../store';
import { applyRuleSource } from '../../store/ruleSlice';
import { I18nProvider } from '../../i18n/I18nProvider';
import { RuleProvider } from '../../context/RuleProvider';
import { BuilderViewProvider } from '../../context/BuilderViewProvider';
import { EditorViewProvider } from '../../context/EditorViewProvider';
import { setFullList } from './fullList';
import { EditorToolbar } from '../EditorToolbar';
import { VisualBuilder } from './VisualBuilder';

const theme = createTheme();

// Режим полного списка живёт вне React и переживает размонтирование —
// иначе тест, развернувший список, менял бы условия для следующих.
beforeEach(() => setFullList(false));

function renderBuilder(source: string) {
  store.dispatch(applyRuleSource(source, 'skip'));
  return render(
    <Provider store={store}>
      <I18nProvider initialLocale="ru">
        <ThemeProvider theme={theme}>
          <RuleProvider>
            <EditorViewProvider>
              {/* Панель режима стоит в строке вкладок, но принадлежит
                  визуальному режиму: тесты видят её вместе со списком,
                  как её видит человек. */}
              <BuilderViewProvider>
                <EditorToolbar tab="visual" />
                <VisualBuilder />
              </BuilderViewProvider>
            </EditorViewProvider>
          </RuleProvider>
        </ThemeProvider>
      </I18nProvider>
    </Provider>,
  );
}

const source = () => store.getState().rule.source;

/** Документ из `count` однотипных правил с номерами от 1001. */
function manyRules(count: number): string {
  const rules: string[] = [];
  for (let i = 0; i < count; i++) {
    rules.push(`SecRule ARGS "@rx attack${i}" "id:${1001 + i},phase:2,deny,log"`, '');
  }
  return rules.join('\n');
}

/**
 * Карточка правила с этим номером — по номеру в её заголовке.
 *
 * Раскрытая держит его полем, свёрнутая — написанным: правят номер там, где
 * видно всё правило целиком.
 */
function cardOf(id: string): HTMLElement {
  const field = screen
    .queryAllByRole('textbox', { name: 'ID правила' })
    .find((input) => (input as HTMLInputElement).value === id);
  const title = field ?? screen.queryByText(`Правило ${id}`);
  if (title === null || title === undefined) throw new Error(`нет карточки правила ${id}`);
  return title.closest('.MuiPaper-root') as HTMLElement;
}

const expandedCards = () => screen.queryAllByRole('button', { name: 'Свернуть правило' });
const collapsedCards = () => screen.queryAllByRole('button', { name: 'Развернуть правило' });

/**
 * Раскрыть блок «Действия» на единственной карточке списка.
 *
 * Раскрытая карточка показывает один блок — условия, — а до полей реакции
 * доходят тем же нажатием, каким до них доходит человек.
 */
async function openActions(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Развернуть «Действия»' }));
}

/**
 * Раскрыть единственную в списке панель директивы.
 *
 * Раскрытым документ показывает первый блок, поэтому у директивы ниже правила
 * полей нет, пока её не открыли.
 */
async function openDirective(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Развернуть блок' }));
}

/**
 * Пункт меню «Добавить» на панели режима.
 *
 * Кнопку панели отличает от одноимённых кнопок внутри карточек то, что за ней
 * меню: подпись у неё та же, потому что вид блока выбирают уже в меню.
 */
async function addBlock(user: ReturnType<typeof userEvent.setup>, item: string) {
  const menu = screen
    .getAllByRole('button', { name: 'Добавить' })
    .find((button) => button.getAttribute('aria-haspopup') === 'menu');
  if (menu === undefined) throw new Error('нет кнопки «Добавить» на панели режима');

  await user.click(menu);
  await user.click(await screen.findByRole('menuitem', { name: item }));
}

const BAD_BOT = [
  '# Блокируем известного зловредного User-Agent',
  'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\',
  "    \"id:1001,phase:1,deny,status:403,msg:'Bad bot detected'\"",
  '',
].join('\n');

// Конвейер с одним шагом: только у непустого есть кнопка «добавить».
const LOWERCASED = [
  'SecRule REQUEST_HEADERS:User-Agent "@contains badbot" \\',
  '    "id:1001,phase:1,t:lowercase,deny,status:403"',
  '',
].join('\n');

// Подсчёт вместе с преобразованиями: сочетание запрещённое, но написать
// его в правиле никто не мешает — и конструктор обязан его показать.
const COUNTED = [
  'SecRule &ARGS "@lt 2" \\',
  '    "id:1001,phase:2,t:lowercase,deny"',
  '',
].join('\n');

describe('VisualBuilder — правки уходят в текст правила', () => {
  it('показывает область проверки, её параметр и значение оператора', () => {
    renderBuilder(BAD_BOT);

    expect(screen.getByRole('combobox', { name: 'Область проверки' })).toHaveValue(
      'REQUEST_HEADERS',
    );
    expect(screen.getByRole('button', { name: /ТОЛЬКО/ })).toBeInTheDocument();
    expect(screen.getByText('User-Agent')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Значение (строка)' })).toHaveValue('badbot');
    expect(screen.getByRole('textbox', { name: 'ID правила' })).toHaveValue('1001');
  });

  it('называет пустой список параметров «ВСЕ»', () => {
    renderBuilder('SecRule REQUEST_HEADERS "@contains x" "id:1001,phase:2,deny"\n');
    expect(screen.getByRole('button', { name: /ВСЕ/ })).toBeInTheDocument();
  });

  it('добавляет второй параметр из списка подсказок', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.type(screen.getByRole('combobox', { name: 'Параметры' }), 'forwarded');

    // Вариант виден вместе с пояснением, ради которого список и нужен.
    const option = await screen.findByRole('option', { name: /X-Forwarded-For/ });
    expect(option).toHaveTextContent('Адрес клиента за прокси');

    await user.click(option);

    await waitFor(() =>
      expect(source()).toContain(
        'REQUEST_HEADERS:User-Agent|REQUEST_HEADERS:X-Forwarded-For',
      ),
    );
  });

  it('переключает параметры в исключения одним нажатием', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('button', { name: /ТОЛЬКО/ }));

    await waitFor(() =>
      expect(source()).toContain('REQUEST_HEADERS|!REQUEST_HEADERS:User-Agent'),
    );
    expect(screen.getByRole('button', { name: /ВСЕ, КРОМЕ/ })).toBeInTheDocument();
  });

  it('держит выбранный режим на пустом списке и требует значения', async () => {
    const user = userEvent.setup();
    renderBuilder('SecRule REQUEST_HEADERS "@contains x" "id:1001,phase:2,deny"\n');

    await user.click(screen.getByRole('button', { name: 'ВСЕ' }));
    await user.click(screen.getByRole('button', { name: 'ТОЛЬКО' }));

    // Положение переключателя держится, хотя записать его в текст нечем,
    // и пустой список подсвечен: правило пока проверяет всю коллекцию.
    expect(screen.getByRole('button', { name: 'ВСЕ, КРОМЕ' })).toBeInTheDocument();
    const params = screen.getByRole('combobox', { name: 'Параметры' });
    expect(params).toHaveAttribute('aria-invalid', 'true');
    expect(source()).toContain('SecRule REQUEST_HEADERS "@contains x"');

    await user.type(params, 'Host,');

    await waitFor(() =>
      expect(source()).toContain('REQUEST_HEADERS|!REQUEST_HEADERS:Host'),
    );
  });

  it('собирает вычитающую область проверки рядом с перечнем', async () => {
    const user = userEvent.setup();
    renderBuilder('SecRule ARGS:test "@rx x" "id:1001,phase:2,deny"\n');

    await user.click(within(cardOf('1001')).getByRole('button', { name: 'Добавить' }));
    await waitFor(() => expect(source()).toContain('ARGS:test|ARGS'));

    // Перечень первой области уже занял «ТОЛЬКО», переключаем вторую.
    await user.click(screen.getByRole('button', { name: 'ВСЕ' }));
    await user.click(screen.getAllByRole('button', { name: 'ТОЛЬКО' })[1]);
    const params = screen.getAllByRole('combobox', { name: 'Параметры' });
    await user.type(params[1], 'test2,');

    // Перечень и вычитание — разные области проверки: в один список их
    // не сливают, иначе исключение стало бы обычным параметром.
    await waitFor(() => expect(source()).toContain('ARGS:test|ARGS|!ARGS:test2'));
    expect(screen.getByRole('button', { name: 'ТОЛЬКО' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ВСЕ, КРОМЕ' })).toBeInTheDocument();
  });

  it('подбирает подсказки значения под область проверки', async () => {
    const user = userEvent.setup();
    renderBuilder(
      'SecRule REQUEST_METHOD "@streq GET" "id:1002,phase:1,deny"\n',
    );

    await user.click(screen.getByRole('combobox', { name: 'Значение (строка)' }));

    expect(await screen.findByRole('option', { name: /^POST/ })).toHaveTextContent(
      'Отправка данных',
    );
    expect(screen.queryByRole('option', { name: /X-Forwarded-For/ })).toBeNull();
  });

  it('добавляет цель по ИЛИ, не теряя существующую', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(within(cardOf('1001')).getByRole('button', { name: 'Добавить' }));

    await waitFor(() => {
      expect(source()).toContain('SecRule REQUEST_HEADERS:User-Agent|ARGS');
    });
    expect(source()).toContain('id:1001');
    expect(source()).toContain('# Блокируем известного зловредного User-Agent');
  });

  it('добавляет условие как звено цепочки', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('button', { name: 'Добавить условие' }));

    await waitFor(() => expect(source()).toContain(',chain"'));
    expect(source().match(/^SecRule/gm)).toHaveLength(2);
  });

  it('подсчёт & гасит конвейер преобразований', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    expect(screen.getByRole('combobox', { name: 'Преобразование' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: '&' }));

    await waitFor(() => expect(source()).toContain('&REQUEST_HEADERS:User-Agent'));
    expect(screen.getByRole('combobox', { name: 'Преобразование' })).toBeDisabled();
  });

  it('гасит уже набранный конвейер, но не прячет его', () => {
    renderBuilder(COUNTED);

    // Шаг остался в правиле — значит, остаётся и на экране. Подменив его
    // пустым «Нет», конструктор соврал бы о том, что написано в правиле, и
    // замечание о подсчёте указывало бы на пустое с виду поле.
    const field = screen.getByRole('combobox', { name: 'Преобразование' });
    expect(field).toBeDisabled();
    expect(field).toHaveValue('Привести к нижнему регистру');
    expect(source()).toContain('t:lowercase');

    // Погашенного мало: шаг не ждёт своей очереди, а не сработает — и
    // помечен как негодный, наравне с любым другим негодным полем.
    expect(field).toBeInvalid();
  });

  it('показывает у преобразования и оригинал, и пояснение', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('combobox', { name: 'Преобразование' }));

    // По названию выбирают, по оригиналу потом ищут строку в тексте
    // правила, а пояснение отвечает на вопрос «а это что».
    const option = await screen.findByRole('option', {
      name: /Привести к нижнему регистру/,
    });
    expect(option).toHaveTextContent('t:lowercase');
    expect(option).toHaveTextContent('SELECT и sElEcT');
  });

  it('поднимает наверх преобразования, уместные для этой области проверки', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('combobox', { name: 'Преобразование' }));

    // У `User-Agent` это регистр и нулевые байты; редкое вроде MD5 краткий
    // список не показывает вовсе.
    await screen.findByText('Подходит этой проверке');
    expect(screen.queryByRole('option', { name: /Хеш MD5/ })).toBeNull();
  });

  it('разворачивает список до полного и обратно', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('combobox', { name: 'Преобразование' }));
    expect(screen.queryByRole('option', { name: /Хеш MD5/ })).toBeNull();

    await user.click(await screen.findByRole('button', { name: /Показать все варианты/ }));
    expect(await screen.findByRole('option', { name: /Хеш MD5/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Оставить только частые/ }));
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Хеш MD5/ })).toBeNull(),
    );
  });

  it('добавляет пустой шаг конвейера, а не подставляет преобразование', async () => {
    const user = userEvent.setup();
    renderBuilder(LOWERCASED);

    await user.click(screen.getByRole('button', { name: 'Добавить преобразование' }));

    // Новый шаг стоит незаполненным и помечен как ошибка: пока человек
    // не выбрал, применять нечего, и в правило ничего не уходит.
    const fields = screen.getAllByRole('combobox', { name: 'Преобразование' });
    expect(fields).toHaveLength(2);
    expect(fields[1]).toHaveValue('');
    expect(fields[1]).toBeInvalid();
    expect(source()).toContain('t:lowercase,deny');

    await user.type(fields[1], 'Схлопнуть');
    await user.click(await screen.findByRole('option', { name: /Схлопнуть пробелы/ }));

    await waitFor(() => expect(source()).toContain('t:lowercase,t:compressWhitespace'));
  });

  it('ищет преобразование по пояснению, а не только по имени', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    // Слова «мусорные» нет ни в одном имени преобразования — оно есть
    // только в пояснении, и поиск обязан довести до варианта по смыслу.
    await user.type(screen.getByRole('combobox', { name: 'Преобразование' }), 'мусорные');

    expect(await screen.findByRole('option', { name: /Base64/ })).toHaveTextContent(
      't:base64DecodeExt',
    );
  });

  it('не прячет несовместимый оператор, а объясняет, почему он не подходит', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('button', { name: '&' }));
    await waitFor(() => expect(source()).toContain('&REQUEST_HEADERS:User-Agent'));

    await user.click(screen.getByRole('combobox', { name: 'Оператор' }));
    await user.click(await screen.findByRole('button', { name: /Показать все варианты/ }));

    expect(
      await screen.findByRole('option', { name: /похоже на SQL-инъекцию/ }),
    ).toHaveTextContent('Здесь в руках уже число');
  });

  it('показывает на примере, что конвейер не оставил шанса совпасть', async () => {
    const user = userEvent.setup();
    renderBuilder(
      'SecRule REQUEST_METHOD "@streq POST" "id:1001,phase:1,t:lowercase,deny"\n',
    );

    await user.click(screen.getByRole('button', { name: 'Проверить на примере' }));
    await user.type(screen.getByRole('textbox', { name: 'Пример значения' }), 'POST');

    // Обе половины правила по отдельности безупречны, и только рядом видно,
    // что до оператора доезжает уже не то значение, с которым он сравнивает.
    expect(screen.getByText('post')).toBeInTheDocument();
    expect(screen.getByText('@streq POST')).toBeInTheDocument();
    expect(screen.getByText('не совпадает')).toBeInTheDocument();
  });

  // Подсказка примера — это ответ на «что сюда писать», и регулярка в ней
  // отвечала на него неверно: проверять шаблон самим шаблоном бессмысленно.
  it('подсказывает примеру значение области проверки, а не шаблон @rx', async () => {
    const user = userEvent.setup();
    renderBuilder(
      'SecRule REQUEST_HEADERS:User-Agent "@rx (?i)(?:sqlmap|nikto)" \\\n' +
        '    "id:1001,phase:1,t:lowercase,deny"\n',
    );

    await user.click(screen.getByRole('button', { name: 'Проверить на примере' }));

    expect(screen.getByRole('textbox', { name: 'Пример значения' })).toHaveAttribute(
      'placeholder',
      'sqlmap',
    );
  });

  it('отмечает шаг конвейера, который ничего не изменил', async () => {
    const user = userEvent.setup();
    renderBuilder(LOWERCASED);

    await user.click(screen.getByRole('button', { name: 'Проверить на примере' }));
    await user.type(screen.getByRole('textbox', { name: 'Пример значения' }), 'badbot');

    expect(screen.getByText('без изменений')).toBeInTheDocument();
    expect(screen.getByText('совпадает')).toBeInTheDocument();
  });

  it('не предлагает пример там, где значения нет — при подсчёте &', async () => {
    const user = userEvent.setup();
    // Правило с конвейером: без шагов проверку не предлагают и так,
    // и подсчёт было бы не с чем сравнивать.
    renderBuilder(LOWERCASED);

    expect(screen.getByRole('button', { name: 'Проверить на примере' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '&' }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Проверить на примере' })).toBeNull(),
    );
  });

  it('правит сообщение правила по завершении ввода', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await openActions(user);
    const message = screen.getByRole('textbox', { name: 'Сообщение' });
    await user.clear(message);
    await user.type(message, 'Новое сообщение');

    // Пока поле в фокусе, текст правила не трогаем.
    expect(source()).toContain("msg:'Bad bot detected'");

    await user.tab();
    await waitFor(() => expect(source()).toContain("msg:'Новое сообщение'"));
  });

  it('правит версию набора правил в форме, а не текстом', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await openActions(user);
    await user.click(screen.getByRole('button', { name: 'Ещё' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Версия набора' }),
      'OWASP_CRS/4.0.0',
    );
    await user.tab();

    await waitFor(() => expect(source()).toContain("ver:'OWASP_CRS/4.0.0'"));
  });

  // `ctl` меняет настройки движка на всю транзакцию, а поля для него в форме
  // нет. Молчать о нём нельзя дважды: соседнее поле правят, уже зная, что он
  // рядом, — и сама правка не должна стоить правилу этого действия.
  it('показывает действие без поля строкой и не теряет его при правке', async () => {
    const user = userEvent.setup();
    renderBuilder('SecRule ARGS "@rx evil" "id:1001,phase:2,deny,ctl:auditEngine=Off"\n');

    await openActions(user);
    expect(screen.getByText('ctl:auditEngine=Off')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Сообщение' }), 'Найдено');
    await user.tab();

    await waitFor(() => expect(source()).toContain("msg:'Найдено'"));
    expect(source()).toContain('ctl:auditEngine=Off');
  });

  it('дублирует правило со свободным номером', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('button', { name: 'Дублировать правило' }));

    // Копия стоит следом и получает свой id: два правила с одним номером
    // ModSecurity не примет.
    await waitFor(() => expect(source().match(/^SecRule/gm)).toHaveLength(2));
    expect(source()).toContain('id:1001');
    expect(source()).toContain('id:1002');
    expect(source().indexOf('id:1001')).toBeLessThan(source().indexOf('id:1002'));
  });

  it('меняет порядок правил в файле', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecRule ARGS "@rx first" "id:1001,phase:2,deny"',
        '',
        'SecRule ARGS "@rx second" "id:1002,phase:2,deny"',
        '',
      ].join('\n'),
    );

    await user.click(screen.getAllByRole('button', { name: 'Переместить ниже' })[0]);

    await waitFor(() =>
      expect(source().indexOf('second')).toBeLessThan(source().indexOf('first')),
    );
    // Пустая строка остаётся разделителем, а не уезжает вместе с правилом.
    expect(source()).toContain('id:1002,phase:2,deny"\n\nSecRule');
  });

  it('гасит перемещение там, где двигать некуда', () => {
    renderBuilder(BAD_BOT);

    expect(screen.getByRole('button', { name: 'Переместить выше' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Переместить ниже' })).toBeDisabled();
  });

  it('сворачивает карточку, оставляя выжимку и счёт замечаний', async () => {
    const user = userEvent.setup();
    renderBuilder('SecRule ARGS "@rx foo" "id:1001,phase:2,deny"\n');

    expect(screen.getByRole('combobox', { name: 'Оператор' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Свернуть правило' }));

    // Поля ушли, но правило по-прежнему узнаваемо, и о замечаниях сказано.
    await waitFor(() =>
      expect(screen.queryByRole('combobox', { name: 'Оператор' })).toBeNull(),
    );
    expect(screen.getByText(/ARGS @rx foo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Развернуть правило' })).toBeInTheDocument();
  });

  // Счётчик у правого края полосы — число без единицы измерения, а у «Условий»
  // их два подряд. Различить «1» и «1» можно только по подсказке, и она же
  // служит счётчику именем: без неё чтение с экрана слышит одну цифру.
  it('называет счётчики блоков словами', () => {
    renderBuilder('SecRule ARGS "@streq POST" "id:1001,phase:2,deny,nolog,t:lowercase"\n');

    expect(screen.getByLabelText(/Условий в цепочке: 1/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Замечаний об этих условиях: [1-9]/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Действий у правила: [1-9]/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Замечаний о правиле целиком: [1-9]/)).toBeInTheDocument();
  });

  it('удаляет правило вместе с его описанием', async () => {
    const user = userEvent.setup();
    renderBuilder(BAD_BOT);

    await user.click(screen.getByRole('button', { name: 'Удалить правило' }));

    await waitFor(() => expect(source()).not.toContain('SecRule'));
    expect(source()).not.toContain('Блокируем');
  });
});

describe('VisualBuilder — большой файл', () => {
  it('раскрывает первое правило, остальные показывает строкой', () => {
    renderBuilder(manyRules(13));

    expect(expandedCards()).toHaveLength(1);
    expect(collapsedCards()).toHaveLength(12);
  });

  // Проверка идёт по самому DOM, а не по дереву доступности: спрятанное поле
  // из запросов по роли тоже исчезает, а стоит столько же, сколько показанное.
  it('не держит в DOM полей свёрнутого правила', () => {
    renderBuilder(manyRules(13));

    // Поля свёрнутой карточки нет ни одного: номер и описание в ней
    // написаны, а не набираются.
    expect(cardOf('1013').querySelectorAll('input')).toHaveLength(0);
    expect(cardOf('1001').querySelectorAll('input').length).toBeGreaterThan(1);
  });

  it('сворачивает и раскрывает весь файл разом', async () => {
    const user = userEvent.setup();
    renderBuilder(manyRules(13));

    await user.click(screen.getByRole('button', { name: 'Свернуть все' }));

    // Поля отпускаются не в тот же миг: карточка сначала складывается, и
    // только по концу перехода её содержимое уходит из DOM.
    await waitFor(
      () => expect(screen.queryAllByRole('combobox', { name: 'Оператор' })).toHaveLength(0),
      { timeout: 10_000 },
    );
    expect(expandedCards()).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Раскрыть все' }));

    await waitFor(
      () => expect(screen.getAllByRole('combobox', { name: 'Оператор' })).toHaveLength(13),
      { timeout: 10_000 },
    );
    expect(collapsedCards()).toHaveLength(0);
  });

  it('считает раскрытые правила в панели', () => {
    renderBuilder(manyRules(13));
    expect(screen.getByText('Раскрыто 1 из 13')).toBeInTheDocument();
  });

  // Раскрытие помнится за номером правила, а не за его местом в файле:
  // удаление правила выше сдвигает все строки ниже, и привязка к строке
  // «переехала» бы на соседа.
  it('держит раскрытие за правилом, а не за его местом в файле', async () => {
    const user = userEvent.setup();
    renderBuilder(manyRules(12));

    expect(within(cardOf('1012')).getByRole('button', { name: 'Развернуть правило' }));
    await user.click(within(cardOf('1012')).getByRole('button', { name: 'Развернуть правило' }));
    await waitFor(() =>
      expect(within(cardOf('1012')).getByRole('button', { name: 'Свернуть правило' })),
    );

    await user.click(within(cardOf('1001')).getByRole('button', { name: 'Удалить правило' }));

    await waitFor(() => expect(source()).not.toContain('id:1001'));
    expect(within(cardOf('1012')).getByRole('button', { name: 'Свернуть правило' }));
  });

  it('показывает раскрытым только что добавленное правило', async () => {
    const user = userEvent.setup();
    renderBuilder(manyRules(12));

    expect(expandedCards()).toHaveLength(1);

    await addBlock(user, 'Добавить правило');

    await waitFor(() => expect(expandedCards()).toHaveLength(2));
  });

  /**
   * Бюджет узлов DOM.
   *
   * Развёрнутая карточка — около четырёхсот узлов, и цена свёрнутого вида
   * целиком в том, что её содержимое размонтировано, а не спрятано. Разница
   * не видна глазами: потерянный `unmountOnExit` выглядит точно так же, но
   * возвращает файлу на тысячу правил четыреста тысяч узлов. Поэтому цена
   * проверяется числом.
   */
  it('держит число узлов DOM в пределах бюджета', () => {
    const { container } = renderBuilder(manyRules(100));

    expect(container.querySelectorAll('*').length).toBeLessThan(10_000);
  });
});

describe('VisualBuilder — проверка регулярного выражения', () => {
  it('не считает поломкой встроенный флаг PCRE', () => {
    renderBuilder('SecRule ARGS "@rx (?i)select" "id:1001,phase:2,deny"\n');

    expect(screen.getByLabelText('Значение (regex)')).toBeValid();
    expect(screen.queryByText(/Шаблон не собирается/)).toBeNull();
  });

  it('красит поле сломанным шаблоном, не открывая окна', () => {
    renderBuilder('SecRule ARGS "@rx a(b" "id:1001,phase:2,deny"\n');

    expect(screen.getByLabelText('Значение (regex)')).toBeInvalid();
  });

  it('не заводит вокруг покрасневшего поля лишнего узла', () => {
    renderBuilder('SecRule ARGS "@rx a(b" "id:1001,phase:2,deny"\n');

    // Строка условия разводит поля отступом между прямыми детьми ряда.
    // Обёртка вокруг поля забрала бы этот отступ себе, и поле с ошибкой
    // встало бы вплотную к оператору.
    const field = screen.getByLabelText('Значение (regex)').closest('.MuiAutocomplete-root');
    expect(field?.parentElement).toHaveClass('MuiStack-root');
  });

  it('в окне показывает причину, пряча дословный ответ движка', async () => {
    const user = userEvent.setup();
    renderBuilder('SecRule ARGS "@rx a(b" "id:1001,phase:2,deny"\n');

    await user.click(screen.getByRole('button', { name: 'Редактировать в окне' }));
    const dialog = within(await screen.findByRole('dialog'));

    // Видна одна строка с причиной; шаблон, который движок приписывает к
    // ней целиком, ждёт за кнопкой.
    expect(dialog.getByText(/Шаблон не собирается/)).toBeInTheDocument();
    expect(dialog.queryByText(/Invalid regular expression/)).toBeNull();

    await user.click(dialog.getByRole('button', { name: 'Подробности' }));

    expect(await dialog.findByText(/Invalid regular expression/)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Применить' })).toBeDisabled();
  });
});

describe('VisualBuilder — исключения', () => {
  const RULE = `SecRule ARGS "@rx attack" "id:942100,phase:2,deny,msg:'SQL Injection'"`;

  it('показывает исключение именем из файла, а не подписью к нему', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecRuleUpdateTargetById 942100 "!ARGS:comment"', ''].join('\n'));

    // Заголовком блока стоит написание из файла: «Изменить цели по номеру»
    // пришлось бы сверять с текстовой вкладкой по памяти. Подпись с
    // пояснением остаётся в подсказке.
    expect(screen.getByText('SecRuleUpdateTargetById')).toBeInTheDocument();
    // Номер правила — не подпись, а переход к его карточке.
    expect(screen.getByLabelText('Показать правило 942100')).toBeInTheDocument();

    // Свёрнутая панель показывает остаток строки: имя уже стоит слева, и
    // повторённое оно съедало бы место у того, ради чего строку и читают.
    expect(screen.getByText('942100 "!ARGS:comment"')).toBeInTheDocument();

    // Раскрывается она в форму, и остаток строки уходит: то же значение стоит
    // теперь в поле, а дважды его показывать незачем.
    await openDirective(user);
    expect(screen.getByRole('textbox', { name: 'Номера правил' })).toBeInTheDocument();
    expect(screen.queryByText('942100 "!ARGS:comment"')).toBeNull();
  });

  it('правит обычную директиву полем, а не строкой', () => {
    renderBuilder(['SecRequestBodyAccess On', RULE, ''].join('\n'));

    expect(screen.getByText('SecRequestBodyAccess')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Доступ к телу запроса' })).toHaveValue('On');
  });

  it('помечает исключение, которое стоит выше своей цели', () => {
    renderBuilder(['SecRuleRemoveById 942100', RULE, ''].join('\n'));

    expect(screen.getByText('не применяется')).toBeInTheDocument();
  });

  it('говорит о выборке, которая никого не нашла', () => {
    renderBuilder([RULE, 'SecRuleRemoveById 999999', ''].join('\n'));

    expect(screen.getByText('правил не найдено')).toBeInTheDocument();
    expect(screen.queryByText('не применяется')).toBeNull();
  });

  it('говорит на карточке правила, что его сняли', async () => {
    renderBuilder([RULE, 'SecRuleRemoveById 942100', ''].join('\n'));

    const card = within(cardOf('942100'));
    expect(card.getByText('выключено')).toBeInTheDocument();
    expect(
      await card.findByLabelText('Снято директивой «SecRuleRemoveById» в строке 2'),
    ).toBeInTheDocument();
  });

  it('отличает правку правила от его снятия', () => {
    renderBuilder([RULE, 'SecRuleUpdateActionById 942100 "pass"', ''].join('\n'));

    const card = within(cardOf('942100'));
    expect(card.getByText('изменено')).toBeInTheDocument();
    expect(card.queryByText('выключено')).toBeNull();
  });

  /** Раскрытая секция исключений на карточке правила. */
  const exclusionsOf = async (id: string, user: ReturnType<typeof userEvent.setup>) => {
    const card = within(cardOf(id));
    await user.click(card.getByRole('button', { name: 'Развернуть «Исключения»' }));
    return card;
  };

  /** Окно, в котором у правила вычитают цель, — со второй кнопки полосы. */
  const excludeWindow = async (id: string, user: ReturnType<typeof userEvent.setup>) => {
    await user.click(within(cardOf(id)).getByRole('button', { name: 'Исключить цель' }));
    return within(await screen.findByRole('dialog'));
  };

  // Секция называет саму директиву: «изменено» без того, что именно изменено,
  // отправляет искать правщика глазами по файлу.
  it('называет на карточке правило правящую его директиву', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecRuleUpdateTargetById 942100 "!ARGS:comment"', ''].join('\n'));

    // Свёрнутая секция говорит то же самое строкой о содержимом: закрытой
    // дверью она быть не должна.
    const card = within(cardOf('942100'));
    expect(card.getByText('SecRuleUpdateTargetById 942100 "!ARGS:comment"')).toBeInTheDocument();

    await user.click(card.getByRole('button', { name: 'Развернуть «Исключения»' }));

    // Переходов два, и они в разные места: запись ведёт к своему блоку, номер
    // строки — к строке в тексте, где видно, что стоит вокруг исключения.
    expect(
      card.getByRole('button', { name: 'Показать исключение в конструкторе' }),
    ).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Показать строку 2' })).toHaveTextContent('строка 2');
  });

  it('говорит, что правило никто не правит', () => {
    renderBuilder([RULE, ''].join('\n'));

    expect(
      within(cardOf('942100')).getByText('правило никого не исключает, и его не исключают'),
    ).toBeInTheDocument();
  });

  // Выписывают исключение с полосы: развёрнутый список уже стоящих для этого не
  // нужен. Снятие целиком идёт и без окна — заполнять в нём нечего, запись
  // известна по одному номеру правила.
  it('дописывает снятие правила сразу за ним', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecMarker END', ''].join('\n'));

    await user.click(within(cardOf('942100')).getByRole('button', { name: 'Выключить правило' }));

    expect(screen.queryByRole('dialog')).toBeNull();

    // Ниже правила и выше всего остального: директива применяется при чтении
    // конфигурации и своё правило видит только выше себя.
    await waitFor(() =>
      expect(source()).toBe([RULE, 'SecRuleRemoveById 942100', 'SecMarker END', ''].join('\n')),
    );
  });

  it('дописывает вычитание цели, оставляя правило в работе', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    const dialog = await excludeWindow('942100', user);
    // У `ARGS` готовых имён параметров нет, поэтому набранное отделяет запятая,
    // а не выбор из списка.
    await user.type(dialog.getByRole('combobox', { name: 'Параметры' }), 'comment,');
    await user.click(dialog.getByRole('button', { name: 'Исключить цель' }));

    await waitFor(() =>
      expect(source()).toContain('SecRuleUpdateTargetById 942100 "!ARGS:comment"'),
    );
    expect(source()).toContain(RULE);
  });

  // Параметров бывает несколько, а строка остаётся одна: ModSecurity дописывает
  // к целям правила весь список второго аргумента, и вычитаются оба.
  it('вычитает несколько параметров одной строкой', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    const dialog = await excludeWindow('942100', user);
    await user.type(dialog.getByRole('combobox', { name: 'Параметры' }), 'comment,bio,');
    await user.click(dialog.getByRole('button', { name: 'Исключить цель' }));

    await waitFor(() =>
      expect(source()).toContain('SecRuleUpdateTargetById 942100 "!ARGS:comment|!ARGS:bio"'),
    );
  });

  // Пустой перечень — вся коллекция: так у правила снимают `REQUEST_COOKIES`
  // целиком, когда ложное срабатывание приходит не из одного поля. Третьего
  // положения, «ВСЕ, КРОМЕ», у исключения при этом нет: терм без `!` цель
  // правила не сузил бы, а дал бы ему ещё одно место для проверки.
  it('снимает коллекцию целиком, пока параметры не перечислены', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    const dialog = await excludeWindow('942100', user);
    await user.click(dialog.getByRole('button', { name: 'ВСЕ' }));
    expect(dialog.getByRole('button', { name: 'ТОЛЬКО' })).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'ТОЛЬКО' }));
    expect(dialog.queryByRole('button', { name: 'ВСЕ, КРОМЕ' })).toBeNull();

    await user.click(dialog.getByRole('button', { name: 'Исключить цель' }));

    await waitFor(() => expect(source()).toContain('SecRuleUpdateTargetById 942100 "!ARGS"'));
  });

  // Выписанное исключение — конец разговора: окно закрывается, и результат
  // человек видит в списке секции, а не в окне поверх него.
  it('закрывает окно, выписав исключение', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, ''].join('\n'));

    const dialog = await excludeWindow('942100', user);
    await user.click(dialog.getByRole('button', { name: 'Исключить цель' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const card = await exclusionsOf('942100', user);
    expect(card.getByText('SecRuleUpdateTargetById 942100 "!ARGS"')).toBeInTheDocument();
  });

  it('не даёт снять правило дважды', async () => {
    const user = userEvent.setup();
    renderBuilder([RULE, 'SecRuleRemoveById 942100', ''].join('\n'));

    const off = within(cardOf('942100')).getByRole('button', { name: 'Выключить правило' });
    expect(off).toBeDisabled();

    // Причина отказа приходит подсказкой обёртки: выключенной кнопке события
    // не доходят, и наводятся поэтому на неё.
    await user.hover(off.parentElement as HTMLElement);
    expect(await screen.findByText('Уже снято директивой в строке 2')).toBeInTheDocument();
  });

  // Исключение ссылается на правило числом, и правилу с именем вместо номера
  // его не выписать: `SecRuleRemoveById abc` не найдёт ничего.
  it('не выписывает исключение правилу без номера', () => {
    renderBuilder([`SecRule ARGS "@rx attack" "id:abc,phase:2,deny"`, ''].join('\n'));

    const card = within(cardOf('abc'));
    expect(card.getByRole('button', { name: 'Выключить правило' })).toBeDisabled();
    expect(card.getByRole('button', { name: 'Исключить цель' })).toBeDisabled();
  });

  // Главное об исключении времени запроса — не запись, а то, что оно делает:
  // `ruleRemoveTargetById=942100;ARGS:comment` приходится расшифровывать
  // глазами, и ошибка в такой записи ничем себя не выдаёт.
  it('показывает исключение правила фразой и правит его полем', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        `SecRule REQUEST_URI "@beginsWith /api" "id:1000,phase:1,pass,nolog,ctl:ruleRemoveTargetById=942100;ARGS:comment"`,
        RULE,
        '',
      ].join('\n'),
    );

    const card = await exclusionsOf('1000', user);
    // Номер правила стоит внутри самой фразы, и стоит ссылкой: до этого
    // правила запись дотянулась, и второй раз, отметкой рядом, тот же номер
    // не называется.
    expect(card.getByText(/^не проверять ARGS:comment в правиле$/)).toBeInTheDocument();
    expect(card.getByRole('button', { name: 'Показать правило 942100' })).toBeInTheDocument();
    expect(card.queryByText('правило:')).toBeNull();
    // В «Прочих действиях» этой записи больше нет: показанная дважды, она
    // заставляет искать между двумя видами разницу.
    expect(card.queryByText('Прочие действия')).toBeNull();

    const pick = card.getByLabelText('Номер правила');
    await user.clear(pick);
    await user.type(pick, '942110{Enter}');

    await waitFor(() =>
      expect(source()).toContain('ctl:ruleRemoveTargetById=942110;ARGS:comment'),
    );
  });

  // Цель в записи `ctl` ровно одна, поэтому вторая снятая цель — это вторая
  // запись. Разворачивает строку формы в них редактор: набранное руками
  // `ARGS:comment|ARGS:note` ModSecurity прочитал бы одним параметром и не
  // снял бы ни одной цели.
  it('снимает вторую цель второй записью', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        `SecRule REQUEST_URI "@beginsWith /api" "id:1000,phase:1,pass,nolog,ctl:ruleRemoveTargetById=942100;ARGS:comment"`,
        RULE,
        '',
      ].join('\n'),
    );

    const card = await exclusionsOf('1000', user);
    await user.type(card.getByRole('combobox', { name: 'Параметры' }), 'note,');

    await waitFor(() =>
      expect(source()).toContain(
        'ctl:ruleRemoveTargetById=942100;ARGS:comment,ctl:ruleRemoveTargetById=942100;ARGS:note',
      ),
    );
    // И читается это обратно одной строкой: решение снять две цели было одно.
    expect(card.getByText(/^не проверять ARGS:comment, ARGS:note в правиле$/)).toBeInTheDocument();
  });

  // Снимаемую цель ModSecurity сравнивает с целью правила по имени и параметру.
  // Ни `&`, ни `!` в это сравнение не входят, поэтому собрать их здесь нечем —
  // в отличие от целей самого правила.
  it('не даёт собрать в снимаемой цели подсчёт и вычитание', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        `SecRule REQUEST_URI "@beginsWith /api" "id:1000,phase:1,pass,nolog,ctl:ruleRemoveTargetById=942100;ARGS"`,
        RULE,
        '',
      ].join('\n'),
    );

    const card = await exclusionsOf('1000', user);
    // Переключателей `&` на карточке два: у цели самого правила и у снимаемой.
    // Нужен второй — секция исключений стоит ниже условий.
    const counters = card.getAllByRole('button', { name: '&' });
    expect(counters[counters.length - 1]).toBeDisabled();

    // Положений у переключателя два: перебор возвращается в «ВСЕ», минуя
    // «ВСЕ, КРОМЕ».
    await user.click(card.getByRole('button', { name: 'ВСЕ' }));
    expect(card.getByRole('button', { name: 'ТОЛЬКО' })).toBeInTheDocument();
    await user.click(card.getByRole('button', { name: 'ТОЛЬКО' }));
    expect(card.getByRole('button', { name: 'ВСЕ' })).toBeInTheDocument();
    expect(card.queryByRole('button', { name: 'ВСЕ, КРОМЕ' })).toBeNull();
  });

  // Вид исключения выбирают до того, как запись появится: от него зависит и
  // что она сделает с правилом, и какие поля у неё есть вовсе.
  it('заводит исключение того вида, который выбрали в меню', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [`SecRule REQUEST_URI "@beginsWith /api" "id:1000,phase:1,pass,nolog"`, RULE, ''].join('\n'),
    );

    const card = await exclusionsOf('1000', user);
    await user.click(card.getByRole('button', { name: /Добавить исключение/ }));
    // Пункт назван и написанием из правила, и тем, что оно делает: выбирают
    // здесь между «снять цель» и «снять правило целиком».
    await user.click(await screen.findByRole('menuitem', { name: /^правило по номеру/ }));

    await waitFor(() => expect(source()).toContain('ctl:ruleRemoveById='));
    expect(card.getByRole('combobox', { name: 'Что снять' })).toHaveValue('правило по номеру');

    // Снятому целиком правилу цель не нужна, и поля под неё в строке нет:
    // ModSecurity прочитал бы её как мусор в номере. Единственная на карточке
    // область проверки — та, в которую смотрит само правило.
    expect(card.getAllByRole('combobox', { name: 'Область проверки' })).toHaveLength(1);
  });

  // Правило-исключение из набора CRS: условия говорят, где исключаем, а `ctl`
  // стоит в последнем звене — и это часть смысла, а не оформление.
  it('называет звено цепочки, в котором стоит исключение', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecRule REQUEST_HEADERS:Host "@streq dev.example.test" \\',
        '    "id:20255302,phase:2,pass,nolog,chain"',
        'SecRule REQUEST_URI "@beginsWith /favicon.ico" \\',
        '    "t:none,chain,ctl:ruleRemoveById=1515300"',
        'SecRule REQUEST_HEADERS:Referer "@rx .*" \\',
        '    "t:none,ctl:ruleRemoveTargetByTag=id1515300;REQUEST_HEADERS:Referer"',
        '',
      ].join('\n'),
    );

    const card = await exclusionsOf('20255302', user);
    // Звено сказано словами и сказано по-разному: из середины цепочки
    // исключение случится, едва совпало это звено, а из последнего — только
    // когда совпала вся цепочка.
    expect(card.getByText('снять правило 1515300, едва совпадёт звено 2')).toBeInTheDocument();
    expect(
      card.getByText(
        'не проверять REQUEST_HEADERS:Referer в правилах с меткой «id1515300», когда совпадёт вся цепочка',
      ),
    ).toBeInTheDocument();
  });
});

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

    await user.clear(field);
    await user.type(field, 'SecMarker END-REQUEST{Enter}');

    await waitFor(() => expect(source()).toContain('SecMarker END-REQUEST'));
    expect(source()).toContain('# Конец блокировок');
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
    expect(screen.getByText('Безусловное действие')).toBeInTheDocument();
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
  });
});
