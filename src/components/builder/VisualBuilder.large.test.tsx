import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderBuilder, source, manyRules, cardOf, expandedCards, collapsedCards, addBlock } from './VisualBuilder.testkit';
import { setFullList } from './fullList';

// Режим полного списка живёт вне React и переживает размонтирование —
// иначе тест, развернувший список, менял бы условия для следующих.
beforeEach(() => setFullList(false));

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
