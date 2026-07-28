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

/** Карточка правила с этим номером — по полю номера в её заголовке. */
function cardOf(id: string): HTMLElement {
  const field = screen
    .getAllByRole('textbox', { name: 'ID правила' })
    .find((input) => (input as HTMLInputElement).value === id);
  if (field === undefined) throw new Error(`нет карточки правила ${id}`);
  return field.closest('.MuiPaper-root') as HTMLElement;
}

const expandedCards = () => screen.queryAllByRole('button', { name: 'Свернуть правило' });
const collapsedCards = () => screen.queryAllByRole('button', { name: 'Развернуть правило' });

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

    await user.click(screen.getByRole('button', { name: 'Добавить' }));
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

    await user.click(screen.getByRole('button', { name: 'Добавить' }));

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

    const message = screen.getByRole('textbox', { name: 'Сообщение' });
    await user.clear(message);
    await user.type(message, 'Новое сообщение');

    // Пока поле в фокусе, текст правила не трогаем.
    expect(source()).toContain("msg:'Bad bot detected'");

    await user.tab();
    await waitFor(() => expect(source()).toContain("msg:'Новое сообщение'"));
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
  it('раскрывает первые десять правил, остальные показывает строкой', () => {
    renderBuilder(manyRules(13));

    expect(expandedCards()).toHaveLength(10);
    expect(collapsedCards()).toHaveLength(3);
  });

  // Проверка идёт по самому DOM, а не по дереву доступности: спрятанное поле
  // из запросов по роли тоже исчезает, а стоит столько же, сколько показанное.
  it('не держит в DOM полей свёрнутого правила', () => {
    renderBuilder(manyRules(13));

    // У свёрнутой карточки остаётся одно поле — номер правила в заголовке.
    expect(cardOf('1013').querySelectorAll('input')).toHaveLength(1);
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
    expect(screen.getByText('Раскрыто 10 из 13')).toBeInTheDocument();
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

    expect(expandedCards()).toHaveLength(10);

    await user.click(screen.getByRole('button', { name: 'Добавить правило' }));

    await waitFor(() => expect(expandedCards()).toHaveLength(11));
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
