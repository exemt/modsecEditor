import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderBuilder, source, cardOf, openActions, openDirective } from './VisualBuilder.testkit';
import { setFullList } from './fullList';

// Режим полного списка живёт вне React и переживает размонтирование —
// иначе тест, развернувший список, менял бы условия для следующих.
beforeEach(() => setFullList(false));

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
      card.getByRole('button', {
        name: 'Показать «SecRuleUpdateTargetById 942100 "!ARGS:comment"» в конструкторе',
      }),
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

  // «Прочие действия» — не пустая подпись: skipAfter в форме поля нет, но
  // чип должен остаться видимым после разнесения по компонентам.
  it('показывает skipAfter в прочих действиях', async () => {
    const user = userEvent.setup();
    renderBuilder(
      [
        `SecRule REQUEST_URI "@beginsWith /health" "id:1000,phase:1,pass,nolog,skipAfter:END"`,
        'SecMarker END',
        '',
      ].join('\n'),
    );

    await openActions(user);
    const card = within(cardOf('1000'));
    expect(card.getByText('Прочие действия')).toBeInTheDocument();
    expect(card.getByText('skipAfter:END')).toBeInTheDocument();
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
