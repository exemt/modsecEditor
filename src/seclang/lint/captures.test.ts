import { lint, lintWorkspace } from '../index';
import type { DiagnosticCode, LintOptions } from '../index';

/**
 * Захват: `capture`, `TX.0`…`TX.9` и то, что между ними.
 *
 * Модель, которую здесь проверяют, снята с движков, а не придумана: каждое
 * «группа доживёт», «не достанет», «ещё не успеет» в этом файле — сценарий
 * `capture-…` из `scripts/engines/scenarios.json`, и все три движка отвечают
 * на него одинаково. Прежняя модель — «группа живёт внутри правила» — была
 * проще и неверна: замечание называло пустым то, что на деле чужое, и
 * ругало обычный приём «захватил в одном правиле, проверил в другом».
 */

const FAMILY: DiagnosticCode[] = [
  'captureMissing',
  'groupNeverCaptured',
  'groupFromEarlierRule',
  'captureUnused',
  'captureWithoutRegex',
  'capturingGroupUnused',
];

/** Замечания о захвате: «строка код», по порядку исходника. */
function found(lines: string[], options: LintOptions = {}): string[] {
  return lint(lines.join('\n'), { ...options, only: FAMILY }).map((d) => `${d.line} ${d.code}`);
}

/** Правило, которое захватывает первую группу и само её читает. */
const CAPTURES = 'SecRule REQUEST_HEADERS:Host "@rx ^(\\w+)" "id:1,phase:1,pass,capture,setvar:tx.host=%{TX.1}"';
/** То же, но само не читает: захват — для тех, кто ниже. */
const CAPTURES_FOR_OTHERS = 'SecRule REQUEST_HEADERS:Host "@rx ^(\\w+)" "id:1,phase:1,pass,capture"';

describe('захват: группа живёт до конца запроса', () => {
  it('чтение областью проверки или аргументом оператора — приём, а не ошибка', () => {
    expect(found([CAPTURES_FOR_OTHERS, 'SecRule TX:1 "@streq a" "id:2,phase:1,pass"'])).toEqual([]);
    expect(
      found([CAPTURES_FOR_OTHERS, 'SecRule REQUEST_HEADERS:X-Host "@streq %{TX.1}" "id:2,phase:1,pass"']),
    ).toEqual([]);
    // И в следующей фазе тоже: группу никто не стирает.
    expect(found([CAPTURES_FOR_OTHERS, 'SecRule TX:1 "@streq a" "id:2,phase:2,pass"'])).toEqual([]);
  });

  it('а в msg, logdata и setvar чужая группа выдаёт себя за свою', () => {
    for (const action of ["msg:'%{TX.1}'", "logdata:'%{TX.1}'", 'setvar:tx.x=%{TX.1}']) {
      expect(found([CAPTURES, `SecRule ARGS "@contains x" "id:2,phase:2,pass,${action}"`])).toEqual([
        '2 groupFromEarlierRule',
      ]);
    }
    // У `SecAction` своей находки нет вовсе.
    expect(found([CAPTURES, 'SecAction "id:2,phase:2,pass,setvar:tx.x=%{TX.1}"'])).toEqual([
      '2 groupFromEarlierRule',
    ]);
  });

  it('если выше никто не захватывает, читать нечего — где бы чтение ни стояло', () => {
    expect(found(['SecRule TX:1 "@streq a" "id:2,phase:1,pass"'])).toEqual(['1 groupNeverCaptured']);
    expect(found(["SecRule ARGS \"@contains x\" \"id:2,phase:2,pass,logdata:'%{TX.0}'\""])).toEqual([
      '1 groupNeverCaptured',
    ]);
  });

  it('«выше» — это раньше по исполнению: сначала фаза, потом строка', () => {
    const reader = (phase: number) => `SecRule TX:1 "@streq a" "id:2,phase:${phase},pass"`;
    const capturer = (phase: number) =>
      `SecRule REQUEST_HEADERS:Host "@rx ^(\\w+)" "id:1,phase:${phase},pass,capture"`;

    // Захват стоит ниже по тексту, но в более ранней фазе: успеет.
    expect(found([reader(2), capturer(1)])).toEqual([]);
    // Стоит выше, но в более поздней: не успеет — и сам остаётся без читателя.
    expect(found([capturer(2), reader(1)])).toEqual(['1 captureUnused', '2 groupNeverCaptured']);
    // В той же фазе решает строка.
    expect(found([reader(1), capturer(1)])).toEqual(['1 groupNeverCaptured', '2 captureUnused']);
  });

  it('группы с нужным номером может не быть ни у кого', () => {
    // Скобка одна — `TX.2` не заполнит никто.
    expect(found([CAPTURES, 'SecRule TX:2 "@streq a" "id:2,phase:1,pass"'])).toEqual([
      '2 groupNeverCaptured',
    ]);
    expect(
      found(['SecRule ARGS "@rx ^(a)(b)" "id:1,phase:2,pass,capture,setvar:tx.x=%{TX.3}"']),
    ).toEqual(['1 groupNeverCaptured']);
    // `@pm` кладёт найденное слово в `TX.0` — и только.
    expect(found(['SecRule ARGS "@pm a b" "id:1,phase:2,pass,capture,setvar:tx.x=%{TX.0}"'])).toEqual([]);
    expect(found(['SecRule ARGS "@pm a b" "id:1,phase:2,pass,capture,setvar:tx.x=%{TX.1}"'])).toEqual([
      '1 groupNeverCaptured',
    ]);
  });

  it('сколько групп в шаблоне из макроса, неизвестно — и это в пользу правила', () => {
    expect(
      found(['SecRule ARGS "@rx ^%{tx.pattern}$" "id:1,phase:2,pass,capture,setvar:tx.x=%{TX.4}"']),
    ).toEqual([]);
    // Забытым такой захват тоже не назвать.
    expect(
      found([CAPTURES, 'SecRule ARGS "@rx ^%{tx.pattern}$" "id:2,phase:2,pass,setvar:tx.x=%{TX.4}"']),
    ).toEqual(['2 groupNeverCaptured']);
  });

  it('группу, выставленную руками, захват не касается', () => {
    expect(
      found([
        'SecAction "id:1,phase:1,pass,setvar:tx.1=fallback"',
        'SecRule TX:1 "@streq fallback" "id:2,phase:1,pass"',
      ]),
    ).toEqual([]);
  });

  it('набор: захват в одном файле, чтение в другом', () => {
    const lintBoth = (first: string, second: string): string[] =>
      lintWorkspace(
        [
          { name: 'a.conf', source: first },
          { name: 'b.conf', source: second },
        ],
        { only: FAMILY },
      ).flatMap((file) => file.diagnostics.map((d) => `${file.name} ${d.code}`));

    const reader = 'SecRule TX:1 "@streq a" "id:2,phase:1,pass"';
    expect(lintBoth(CAPTURES_FOR_OTHERS, reader)).toEqual([]);
    expect(lintBoth(reader, CAPTURES_FOR_OTHERS)).toEqual([
      'a.conf groupNeverCaptured',
      'b.conf captureUnused',
    ]);
  });
});

describe('захват: забытый capture', () => {
  it('оператор группу нашёл бы, но сохранить её нечем', () => {
    const rule = "SecRule ARGS \"@rx ^(a)\" \"id:2,phase:2,pass,logdata:'%{TX.1} %{TX.0}'\"";
    // Одно замечание на правило, сколько бы групп оно ни читало.
    expect(found([rule])).toEqual(['1 captureMissing']);
    // Правило выше ничего не меняет: читается его группа, а не своя.
    expect(found([CAPTURES, rule])).toEqual(['2 captureMissing']);
  });

  it('группа при этом не лишняя: лишнее — отсутствие capture', () => {
    expect(found(['SecRule ARGS "@rx (a)b" "id:1,phase:2,pass"'])).toEqual(['1 capturingGroupUnused']);
    expect(found(['SecRule ARGS "@rx (a)b" "id:1,phase:2,pass,setvar:tx.x=%{TX.1}"'])).toEqual([
      '1 captureMissing',
    ]);
  });

  it('шаблон без нужной группы забытым захватом не объяснить', () => {
    // Скобок нет: `capture` дал бы только `TX.0`, а читают `TX.1`.
    expect(
      found([CAPTURES, "SecRule ARGS \"@rx ^admin\" \"id:2,phase:2,pass,msg:'%{TX.1}'\""]),
    ).toEqual(['2 groupFromEarlierRule']);
    expect(
      found([CAPTURES, "SecRule ARGS \"@rx ^admin\" \"id:2,phase:2,pass,msg:'%{TX.0}'\""]),
    ).toEqual(['2 captureMissing']);
  });

  it('отрицание не захватывает: оно срабатывает, когда шаблон не подошёл', () => {
    // Поэтому и группа в таком шаблоне лишняя, а `%{TX.1}` — чужая.
    expect(
      found([CAPTURES, "SecRule ARGS \"!@rx ^(a)\" \"id:2,phase:2,pass,msg:'%{TX.1}'\""]),
    ).toEqual(['2 capturingGroupUnused', '2 groupFromEarlierRule']);
  });

  it('читателем чужого захвата такое правило не считается', () => {
    // Иначе одна описка внизу набора заставила бы молчать о каждом лишнем
    // `capture` выше неё.
    expect(
      found([CAPTURES_FOR_OTHERS, "SecRule ARGS \"@rx ^(a)\" \"id:2,phase:2,pass,logdata:'%{TX.1}'\""]),
    ).toEqual(['1 captureUnused', '2 captureMissing']);
  });
});

describe('захват: capture действует на своё условие', () => {
  const chain = (head: string, link: string): string[] => [
    `SecRule REQUEST_METHOD "@streq POST" "id:1,phase:2,pass${head},chain"`,
    `    SecRule ARGS "@rx ^(a)" "t:none${link}"`,
  ];

  it('в звене — на оператор звена', () => {
    expect(found(chain('', ',capture,setvar:tx.x=%{TX.1}'))).toEqual([]);
  });

  it('в голове — до оператора звена не достаёт', () => {
    expect(found(chain(',capture', ',setvar:tx.x=%{TX.1}'))).toEqual([
      '1 captureWithoutRegex',
      '2 captureMissing',
    ]);
    // Без чтения остаётся и лишняя группа.
    expect(found(chain(',capture', ''))).toEqual(['1 captureWithoutRegex', '2 capturingGroupUnused']);
  });

  it('лишний capture рядом с рабочим никому не мешает', () => {
    // Так пишет CRS 3: `capture` и в голове с `@eq`, и в звене с `@rx`.
    expect(found(chain(',capture', ',capture,setvar:tx.x=%{TX.1}'))).toEqual([]);
  });

  it('голова захватывает — звено читает', () => {
    expect(
      found([
        'SecRule ARGS "@rx ^(a)" "id:1,phase:2,pass,capture,chain"',
        '    SecRule TX:1 "@streq a" "chain"',
        '    SecRule REQUEST_HEADERS:X "@streq %{TX.1}"',
      ]),
    ).toEqual([]);
  });

  it('звено захватывает — действие головы этого ещё не видит, а журнал видит', () => {
    // `setvar` головы исполняется, когда совпала голова.
    expect(found([CAPTURES, ...chain(',setvar:tx.x=%{TX.1}', ',capture,setvar:tx.y=%{TX.1}')])).toEqual(
      ['2 groupFromEarlierRule'],
    );
    // `logdata` раскрывается, когда совпала вся цепочка.
    expect(found(chain(",logdata:'%{TX.1}'", ',capture'))).toEqual([]);
  });

  it('область звена читает до того, как звено совпало', () => {
    // `TX:1` в звене — это группа головы или правила выше, но не своя.
    expect(
      found([
        'SecRule REQUEST_METHOD "@streq POST" "id:1,phase:2,pass,chain"',
        '    SecRule TX:1 "@rx ^(a)" "capture"',
      ]),
    ).toEqual(['2 groupNeverCaptured', '2 captureUnused']);
  });

  it('capture из SecDefaultAction считается захватом', () => {
    // Вторая версия и Coraza его исполняют, третья — нет; сказать «группу
    // никто не заполняет» здесь было бы неправдой для двух из трёх.
    const defaults = 'SecDefaultAction "phase:2,pass,log,capture"';
    expect(found([defaults, "SecRule ARGS \"@rx ^(a)\" \"id:1,phase:2,logdata:'%{TX.1}'\""])).toEqual([]);
    // И убирать его из правила неоткуда: о лишнем захвате — молчание.
    expect(found([defaults, 'SecRule ARGS "@rx ^(a)" "id:1,phase:2"'])).toEqual([]);
    // На другую фазу умолчания не действуют.
    expect(found([defaults, "SecRule ARGS \"@rx ^(a)\" \"id:1,phase:1,pass,logdata:'%{TX.1}'\""])).toEqual([
      '2 captureMissing',
    ]);
  });
});

describe('захват: читает ли его кто-нибудь', () => {
  it('своё правило или любое ниже', () => {
    expect(found([CAPTURES_FOR_OTHERS])).toEqual(['1 captureUnused']);
    expect(found([CAPTURES])).toEqual([]);
    expect(found([CAPTURES_FOR_OTHERS, 'SecRule TX:0 "@streq a" "id:2,phase:5,pass"'])).toEqual([]);
  });

  it('чтение всей коллекции — тоже чтение', () => {
    expect(found([CAPTURES_FOR_OTHERS, 'SecRule TX "@contains x" "id:2,phase:2,pass"'])).toEqual([]);
    expect(found([CAPTURES_FOR_OTHERS, 'SecRule TX:/^\\d$/ "@contains x" "id:2,phase:2,pass"'])).toEqual(
      [],
    );
    // Шаблон, под который имя группы не подходит, группу не читает.
    expect(
      found([CAPTURES_FOR_OTHERS, 'SecRule TX:/^score_/ "@contains x" "id:2,phase:2,pass"']),
    ).toEqual(['1 captureUnused']);
    // И подсчёт `&TX` значений не читает.
    expect(found([CAPTURES_FOR_OTHERS, 'SecRule &TX "@gt 0" "id:2,phase:2,pass"'])).toEqual([
      '1 captureUnused',
    ]);
  });

  it('у оператора, который не захватывает, capture лишний всегда', () => {
    expect(
      found(["SecRule ARGS \"@streq admin\" \"id:1,phase:2,pass,capture,logdata:'%{TX.0}'\""]),
    ).toEqual(['1 captureWithoutRegex']);
    // Пустая группа — следствие, а не вторая беда: о ней отдельно не говорят.
    expect(
      found([CAPTURES, "SecRule ARGS \"@streq admin\" \"id:2,phase:2,pass,capture,logdata:'%{TX.0}'\""]),
    ).toEqual(['2 captureWithoutRegex']);
  });
});

describe('захват: шаблон «что угодно»', () => {
  const everything = (lines: string[]): string[] =>
    lint(lines.join('\n'), { only: ['matchesEverything'] }).map((d) => `${d.line} ${d.code}`);

  it('нужен, чтобы взять значение или имя, — и тогда он не ошибка', () => {
    expect(everything(['SecRule ARGS "@rx .*" "id:1,phase:2,pass"'])).toEqual(['1 matchesEverything']);
    expect(everything(['SecRule ARGS "@rx (.*)" "id:1,phase:2,pass,capture,setvar:tx.x=%{TX.1}"'])).toEqual(
      [],
    );
    expect(
      everything(['SecRule TX:/^err_/ "@rx .*" "id:1,phase:2,pass,setvar:tx.last=%{MATCHED_VAR_NAME}"']),
    ).toEqual([]);
  });

  it('capture соседнего звена такой шаблон не оправдывает', () => {
    expect(
      everything([
        'SecRule ARGS "@rx .*" "id:1,phase:2,pass,chain"',
        '    SecRule ARGS:x "@rx ^(a)" "capture,setvar:tx.x=%{TX.1}"',
      ]),
    ).toEqual(['1 matchesEverything']);
  });
});
