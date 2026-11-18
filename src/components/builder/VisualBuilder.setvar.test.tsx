import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderBuilder, source, openActions } from './VisualBuilder.testkit';
import { setFullList } from './fullList';

// Режим полного списка живёт вне React и переживает размонтирование —
// иначе тест, развернувший список, менял бы условия для следующих.
beforeEach(() => setFullList(false));

describe('VisualBuilder — установка переменных', () => {
  const setvarAction = (record: string) =>
    `SecAction "id:1001,phase:1,pass,nolog,setvar:${record}"\n`;

  it('разбирает присваивание на поля', () => {
    renderBuilder(setvarAction('tx.anomaly_score=+%{tx.critical_anomaly_score}'));

    expect(screen.getByRole('combobox', { name: 'Коллекция' })).toHaveValue('TX — транзакция');
    expect(screen.getByRole('combobox', { name: 'Переменная' })).toHaveValue('anomaly_score');
    expect(screen.getByRole('combobox', { name: 'Запись' })).toHaveValue('=+ прибавить');
    expect(screen.getByRole('combobox', { name: 'Значение' })).toHaveValue(
      '%{tx.critical_anomaly_score}',
    );
  });

  // Разница между `=1` и `=+1` — один символ и целый смысл: первое затирает
  // накопленный счёт. Поэтому вид записи выбирают, а не набирают.
  it('меняет вид записи выбором', async () => {
    const user = userEvent.setup();
    renderBuilder(setvarAction('tx.score=+1'));

    await user.click(screen.getByRole('combobox', { name: 'Запись' }));
    await user.click(await screen.findByRole('option', { name: /задать/ }));

    await waitFor(() => expect(source()).toContain('setvar:tx.score=1'));
  });

  it('правит имя переменной, не тронув остального', async () => {
    const user = userEvent.setup();
    renderBuilder(setvarAction('tx.score=+1'));

    const name = screen.getByRole('combobox', { name: 'Переменная' });
    await user.clear(name);
    await user.type(name, 'own_score');
    await user.tab();

    await waitFor(() => expect(source()).toContain('setvar:tx.own_score=+1'));
  });

  // Заготовка обязана быть готовой записью: пустой `setvar` не переживает
  // обхода через текст, а имя ей подбирает редактор — как имя новой метке.
  it('заводит присваивание с незанятым именем', async () => {
    const user = userEvent.setup();
    renderBuilder(setvarAction('tx.var=1'));

    await user.click(screen.getByRole('button', { name: 'Выставить переменную' }));

    await waitFor(() => expect(source()).toContain('setvar:tx.var_2=1'));
    expect(source()).toContain('setvar:tx.var=1');
  });

  it('убирает присваивание', async () => {
    const user = userEvent.setup();
    renderBuilder(setvarAction('tx.score=+1'));

    await user.click(screen.getByRole('button', { name: 'Убрать присваивание' }));

    await waitFor(() => expect(source()).not.toContain('setvar'));
  });

  it('гасит значение у удаления', async () => {
    renderBuilder(setvarAction('!ip.dos_counter'));

    expect(screen.getByRole('combobox', { name: 'Запись' })).toHaveValue('! удалить');
    expect(screen.getByRole('combobox', { name: 'Значение' })).toBeDisabled();
  });

  // Форма, показывающая меньше, чем есть в записи, сохранила бы ровно то, что
  // показала: имени с макросом полями не собрать.
  it('оставляет строкой запись, разбор которой не сошёлся', () => {
    renderBuilder(setvarAction('tx.%{rule.id}_flag=1'));

    expect(screen.queryByRole('combobox', { name: 'Коллекция' })).toBeNull();
    expect(screen.getByDisplayValue('tx.%{rule.id}_flag=1')).toBeInTheDocument();
  });

  it('называет место, где переменную читают', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecAction "id:1001,phase:1,pass,nolog,setvar:tx.flag=1"',
        '',
        'SecRule TX:flag "@eq 1" "id:1002,phase:2,deny,msg:\'flag\'"',
        '',
      ].join('\n'),
    );

    await user.hover(screen.getAllByRole('button', { name: 'Что набор знает о переменной' })[0]);

    expect(await screen.findByText('Читается')).toBeInTheDocument();
    // Слева файл и строка — в текстовую вкладку, справа чип номера — в
    // конструктор. Ищем в подсказке: тот же номер уже стоит на карточке.
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByRole('button', { name: 'Показать правило 1002' })).toBeInTheDocument();
    expect(within(tip).getByRole('button', { name: 'Показать строку 3' })).toBeInTheDocument();
    expect(within(tip).getByText('Правило : 1002')).toBeInTheDocument();
  });

  // Выставленная и никем не читаемая переменная — не ошибка конфигурации:
  // правило с ней загрузится и будет работать, просто накопленное ею никто
  // не проверяет. Сказать об этом можно только по всему набору.
  it('говорит, что переменную никто не читает', async () => {
    const user = userEvent.setup();
    renderBuilder(setvarAction('tx.flag=1'));

    await user.hover(screen.getByRole('button', { name: 'Что набор знает о переменной' }));

    expect(
      await screen.findByText('нигде — накопленное этой записью никто не проверяет'),
    ).toBeInTheDocument();
  });

  // Сотни правил CRS списком ссылок в подсказке не читаются — нажатие
  // открывает то же окно исходников, что у исключений.
  it('открывает список связанных правил из отметки переменной', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecAction "id:1001,phase:1,pass,nolog,setvar:tx.flag=1"',
        '',
        'SecRule TX:flag "@eq 1" "id:1002,phase:2,deny,msg:\'flag\'"',
        '',
      ].join('\n'),
    );

    await user.click(screen.getAllByRole('button', { name: 'Что набор знает о переменной' })[0]);

    const dialog = await screen.findByRole('dialog', {
      name: /tx\.flag · связанные правила · 2/,
    });
    // Значки перед чипом: какое правило пишет, какое читает.
    expect(within(dialog).getByLabelText('Задаёт переменную')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Читает переменную')).toBeInTheDocument();
  });
});

describe('VisualBuilder — теги', () => {
  it('называет другое правило с тем же тегом', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecRule ARGS "@rx a" "id:1001,phase:2,deny,tag:\'OWASP_CRS\'"',
        'SecRule ARGS "@rx b" "id:1002,phase:2,deny,tag:\'OWASP_CRS\'"',
        '',
      ].join('\n'),
    );

    await openActions(user);
    await user.hover(screen.getAllByRole('button', { name: 'Что набор знает о теге' })[0]);

    expect(await screen.findByText('На правилах')).toBeInTheDocument();
    const tip = screen.getByRole('tooltip');
    expect(within(tip).getByText('Правило : 1002')).toBeInTheDocument();
  });

  it('называет исключение, которое выбирает по тегу', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        'SecRule ARGS "@rx a" "id:1001,phase:2,deny,tag:\'attack-sqli\'"',
        'SecRuleRemoveByTag attack-sqli',
        '',
      ].join('\n'),
    );

    await openActions(user);
    await user.hover(screen.getByRole('button', { name: 'Что набор знает о теге' }));

    expect(await screen.findByText('Выбирают')).toBeInTheDocument();
    const tip = screen.getByRole('tooltip');
    // Чип справа, а не токен в строке кода: имя директивы там встречается дважды.
    expect(
      within(tip).getByRole('button', { name: 'SecRuleRemoveByTag' }),
    ).toBeInTheDocument();
  });
});
