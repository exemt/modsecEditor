import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { CODES, engineSupports, lint } from './index';
import type { DiagnosticCode, Engine, NameKind } from './index';

/**
 * Линтер против настоящих движков.
 *
 * Всё, что линтер утверждает о движке, взято из его исходников. Здесь
 * проверяется, что прочитано верно. Стенд (`scripts/engines/run.mjs`)
 * отдаёт одни и те же правила ModSecurity 2, ModSecurity 3 и Coraza и
 * записывает, что они ответили, в `stand/verdicts.json`. Этот тест сверяет
 * с записью линтер — уже без Docker, на каждом прогоне.
 *
 * Сверяются три вещи:
 *
 *  - **имена** — каждое имя каталога против каждого движка: таблицы
 *    `engines.ts` обязаны совпасть с тем, что движок действительно грузит;
 *  - **загрузка** — блоки из `cases/*.conf` и пробы из `stand/probes.conf`:
 *    что движок не загрузил, то линтер обязан назвать ошибкой, и наоборот;
 *  - **поведение** — сценарии с запросом из `scripts/engines/scenarios.json`:
 *    чем кончился запрос в каждом движке.
 *
 * Расхождения, о которых известно, перечислены ниже поимённо и с причиной.
 * Новое расхождение — либо ошибка линтера, либо новая строка в списке.
 */

const ENGINES: Engine[] = ['modsecurity2', 'modsecurity3', 'coraza'];
type Loads = Record<Engine, boolean>;

interface Verdicts {
  engines: Record<Engine, { image: string; version: string }>;
  names: Record<string, Loads>;
  load: Record<string, Loads & { where: string }>;
  behaviour: Record<string, Record<Engine, string>>;
}

const HERE = __dirname;
const verdicts = JSON.parse(readFileSync(join(HERE, 'stand', 'verdicts.json'), 'utf8')) as Verdicts;

/* ------------------------------------------------------------------ */
/* Блоки: режутся так же, как их режет стенд                           */
/* ------------------------------------------------------------------ */

interface Block {
  where: string;
  source: string;
  hash: string;
}

function blocksOf(path: string, marker: RegExp, label: (line: number, name: string) => string): Block[] {
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const found: Array<{ line: number; name: string; start: number; end: number }> = [];
  lines.forEach((text, index) => {
    const match = marker.exec(text);
    if (match === null) return;
    if (found.length > 0) found[found.length - 1].end = index;
    found.push({ line: index + 1, name: match[1].trim(), start: index + 1, end: lines.length });
  });
  return found.map((block) => {
    const source = `${lines.slice(block.start, block.end).join('\n').trimEnd()}\n`;
    return {
      where: label(block.line, block.name),
      source,
      hash: createHash('sha1').update(source).digest('hex').slice(0, 16),
    };
  });
}

const BLOCKS: Block[] = [
  ...readdirSync(join(HERE, 'cases'))
    .filter((name) => name.endsWith('.conf') && name !== 'equivalent.conf')
    .sort()
    .flatMap((file) =>
      blocksOf(
        join(HERE, 'cases', file),
        /^#\s*expect:(.*)$/,
        (line) => `${file}:${String(line).padStart(4, '0')}`,
      ),
    ),
  ...blocksOf(join(HERE, 'stand', 'probes.conf'), /^#\s*probe:(.*)$/, (_line, name) => `probe:${name}`),
];

/* ------------------------------------------------------------------ */
/* Известные расхождения                                               */
/* ------------------------------------------------------------------ */

/**
 * Движок блок не загрузил, а линтер ошибкой это не назвал — и не должен.
 *
 * Причина всякий раз вне текста правила: файла нет на стенде, сети нет,
 * блок вырван из набора. Блок узнаётся по строке из своего текста: номера
 * строк в примерах сдвигаются, текст — нет.
 */
const UNSEEN: Array<{ match: string; engines: Engine[]; why: string }> = [
  {
    match: 'SecRuleUpdateTargetBy',
    engines: ['modsecurity2', 'coraza'],
    why: 'Блок вырван из набора: правила, которое он правит, рядом нет. ModSecurity 2 не принимает правку, пока в конфигурации нет ни одного правила, Coraza — пока нет этого. Загружен ли набор целиком, линтер по одному файлу знать не может.',
  },
  {
    match: 'SecRuleUpdateActionById',
    engines: ['coraza'],
    why: 'То же: Coraza ищет правило сразу, а в отдельно взятом блоке его нет.',
  },
  {
    match: 'Include /etc/modsecurity/rules/',
    engines: ['modsecurity2'],
    why: 'Папки `rules` на стенде нет. Существуют ли подключаемые файлы, знает командная строка, а не линтер.',
  },
  {
    match: 'Include conf.d/',
    engines: ['modsecurity2', 'modsecurity3', 'coraza'],
    why: 'То же: подключаемого файла на стенде нет.',
  },
  {
    match: 'SecRuleScript',
    engines: ['modsecurity2', 'modsecurity3'],
    why: 'Сценария на Lua на стенде нет.',
  },
  {
    match: 'SecUnicodeMapFile',
    engines: ['modsecurity2', 'modsecurity3'],
    why: 'Файла `unicode.mapping` на стенде нет.',
  },
  {
    match: 'SecGeoLookupDb',
    engines: ['modsecurity3'],
    why: 'Базы GeoIP на стенде нет.',
  },
  {
    match: 'SecGuardianLog',
    engines: ['modsecurity2'],
    why: 'Программы, в которую пишется журнал, на стенде нет.',
  },
  {
    match: 'https://example.com/',
    engines: ['modsecurity2', 'modsecurity3', 'coraza'],
    why: 'Список по адресу в сети: скачать его со стенда нельзя, а Coraza таких списков не скачивает вовсе.',
  },
  {
    match: 'sql-errors.data php-errors.data',
    engines: ['coraza'],
    why: 'Несколько файлов в одном операторе Coraza читает как одно имя файла.',
  },
];

/**
 * Линтер называет это ошибкой, а движок загружает.
 *
 * Ошибка у линтера — не только «не загрузится», но и «загрузится так, что
 * правило заведомо не то, что написано». Здесь — именно такие случаи, и
 * для каждого сказано, что с правилом происходит на самом деле.
 */
const LOADS_ANYWAY: Partial<Record<DiagnosticCode, { engines: Engine[]; why: string }>> = {
  danglingChain: {
    engines: ['modsecurity2', 'modsecurity3', 'coraza'],
    why: 'Цепочка без продолжения грузится: правило просто никогда не доходит до конца.',
  },
  missingId: {
    engines: ['modsecurity3', 'coraza'],
    why: 'Третья версия требует номер только у `SecRule`, Coraza не требует вовсе. Но правило без номера нельзя ни исключить, ни найти в журнале.',
  },
  duplicateId: {
    engines: ['modsecurity3'],
    why: 'Третья версия грузит оба правила с одним номером; исключение по номеру снимет оба.',
  },
  unknownOperator: {
    engines: ['modsecurity3'],
    why: 'Третья версия незнакомый оператор не отвергает: весь аргумент становится шаблоном для `@rx`.',
  },
  unclosedValueQuote: {
    engines: ['modsecurity3', 'coraza'],
    why: 'Значение без закрывающей кавычки грузится — и забирает в себя всё до конца списка действий.',
  },
  chainLinkHeadAction: {
    engines: ['modsecurity3', 'coraza'],
    why: 'Номер, фазу и сообщение в звене третья версия и Coraza молча пропускают.',
  },
  invalidActionValue: {
    engines: ['modsecurity3', 'coraza'],
    why: 'Третья версия принимает `id:0` и `phase:0`, Coraza не проверяет значения `ctl`. Правило при этом не то, что написано.',
  },
  defaultActionIncomplete: {
    engines: ['coraza'],
    why: 'Coraza умолчания не проверяет.',
  },
  defaultActionForbidden: {
    engines: ['modsecurity3', 'coraza'],
    why: 'Coraza умолчания не проверяет; третья версия пропускает в них `msg`.',
  },
  defaultActionDeprecated: {
    engines: ['coraza'],
    why: 'Сами умолчания с преобразованием Coraza грузит; отказ приходит на первом же правиле под ними. В блоке, где правил ниже нет, его не видно.',
  },
  directiveArgCount: {
    engines: ['modsecurity2'],
    why: 'Лишнее слово после директивы без аргументов вторая версия пропускает.',
  },
  exclusionUpdateActionMetadata: {
    engines: ['modsecurity2'],
    why: 'Блок вырван из набора: без самого правила правка ничего не меняет, и отвергать её не за что.',
  },
};

/** Имена, с которыми проба не сошлась с таблицей, — и почему это не ошибка таблицы. */
const NAME_NOTES: Record<string, { engines: Engine[]; why: string }> = {
  'operator:rsub': { engines: ['modsecurity2'], why: 'Оператору нужен аргумент вида s/…/…/, проба его не знает.' },
  'operator:fuzzyHash': {
    engines: ['modsecurity2', 'modsecurity3'],
    why: 'Оператору нужен файл с хешами и порог.',
  },
  'operator:restpath': {
    engines: ['modsecurity3'],
    why: 'Третья версия незнакомый оператор грузит — как шаблон; оператора при этом нет.',
  },
  'operator:validateNid': {
    engines: ['modsecurity3', 'coraza'],
    why: 'То же для третьей версии; у Coraza оператору нужен аргумент особого вида.',
  },
  'action:exec': { engines: ['modsecurity3'], why: 'Третья версия исполняет только сценарии на Lua.' },
  'operator:ipMatchFromDataset': { engines: ['coraza'], why: 'Оператору нужен объявленный набор данных.' },
  'operator:pmFromDataset': { engines: ['coraza'], why: 'Оператору нужен объявленный набор данных.' },
  'operator:validateSchema': { engines: ['coraza'], why: 'Оператору нужна схема JSON.' },
  'directive:SecUploadKeepFiles': { engines: ['coraza'], why: 'Директиве нужна пара — `SecUploadDir`.' },
};

/* ------------------------------------------------------------------ */

describe('стенд: что записано', () => {
  it('названы движки, с которыми сверялись', () => {
    expect(verdicts.engines.modsecurity2.version).toMatch(/^ModSecurity for Apache\/2\./);
    expect(verdicts.engines.modsecurity3.version).toMatch(/^libmodsecurity\.so\.3\./);
    expect(verdicts.engines.coraza.version).toMatch(/coraza\/v3 v3\./);
  });

  it('вердикты относятся к нынешнему тексту примеров', () => {
    // Вердикт хранится по отпечатку текста блока. Поправили блок — старый
    // вердикт к нему уже не относится; когда таких наберётся много, стенд
    // пора перезапустить: `node scripts/engines/run.mjs all --write`.
    const known = BLOCKS.filter((block) => verdicts.load[block.hash] !== undefined);
    expect(BLOCKS.length).toBeGreaterThan(400);
    expect(known.length / BLOCKS.length).toBeGreaterThan(0.9);
  });
});

describe('стенд: имена каталога', () => {
  const rows = Object.entries(verdicts.names);

  it('проверено каждое имя, у которого есть что подставить в пробу', () => {
    expect(rows.length).toBeGreaterThan(300);
  });

  it.each(ENGINES)('%s: таблица совпадает с тем, что движок грузит', (engine) => {
    const wrong: string[] = [];
    for (const [key, loads] of rows) {
      const [kind, name] = key.split(':') as [NameKind, string];
      if (engineSupports(engine, kind, name) === loads[engine]) continue;
      if (NAME_NOTES[key]?.engines.includes(engine)) continue;
      wrong.push(`${key}: движок ${loads[engine] ? 'грузит' : 'не грузит'}`);
    }
    expect(wrong).toEqual([]);
  });

  it('оговорки относятся к именам, которые действительно расходятся', () => {
    for (const [key, note] of Object.entries(NAME_NOTES)) {
      const loads = verdicts.names[key];
      expect({ key, known: loads !== undefined }).toEqual({ key, known: true });
      const [kind, name] = key.split(':') as [NameKind, string];
      for (const engine of note.engines) {
        expect({ key, engine, differs: engineSupports(engine, kind, name) !== loads[engine] }).toEqual({
          key,
          engine,
          differs: true,
        });
      }
    }
  });
});

describe.each(ENGINES)('стенд: загрузка в %s', (engine) => {
  const checked = BLOCKS.filter((block) => verdicts.load[block.hash] !== undefined).map((block) => {
    // Пометки `# seclang-ignore` — разговор автора с линтером; движку до
    // них дела нет.
    const found = lint(block.source, { engine, comments: false });
    return {
      block,
      loads: verdicts.load[block.hash][engine],
      errors: found.filter((d) => d.severity === 'error').map((d) => d.code),
    };
  });

  it('что движок не загрузил, линтер называет ошибкой', () => {
    const silent = checked
      .filter((item) => !item.loads && item.errors.length === 0)
      .filter(
        (item) => !UNSEEN.some((note) => note.engines.includes(engine) && item.block.source.includes(note.match)),
      )
      .map((item) => item.block.where);
    expect(silent).toEqual([]);
  });

  it('что линтер называет ошибкой, движок не загружает — кроме оговорённого', () => {
    const loud = checked
      .filter((item) => item.loads && item.errors.length > 0)
      .filter((item) => !item.errors.every((code) => LOADS_ANYWAY[code]?.engines.includes(engine)))
      .map((item) => `${item.block.where}: ${item.errors.join(', ')}`);
    expect(loud).toEqual([]);
  });

  it('отказы движка — не редкость в примерах: сверять есть с чем', () => {
    const refused = checked.filter((item) => !item.loads).length;
    expect(refused).toBeGreaterThan(100);
    expect(checked.length - refused).toBeGreaterThan(200);
  });
});

describe('стенд: оговорки', () => {
  it('каждая оговорка о загрузке чему-то соответствует', () => {
    // Оговорка, которой нечего оговаривать, — мусор: проверка, ради которой
    // её писали, либо исправлена, либо пример исчез.
    for (const note of UNSEEN) {
      const used = BLOCKS.some((block) => {
        const loads = verdicts.load[block.hash];
        return loads !== undefined && block.source.includes(note.match) && note.engines.some((e) => !loads[e]);
      });
      expect({ match: note.match, used }).toEqual({ match: note.match, used: true });
    }
    for (const code of Object.keys(LOADS_ANYWAY)) expect(CODES[code as DiagnosticCode]).toBeDefined();
  });
});

describe('стенд: поведение на запросе', () => {
  interface Scenario {
    name: string;
    claim: string;
    rules: string[];
    expect: Record<Engine, string>;
  }
  const scenarios = JSON.parse(
    readFileSync(join(HERE, '..', '..', 'scripts', 'engines', 'scenarios.json'), 'utf8'),
  ) as Scenario[];

  it('сценариев достаточно, и у каждого записан исход', () => {
    expect(scenarios.length).toBeGreaterThan(40);
    for (const scenario of scenarios) {
      expect({ name: scenario.name, recorded: verdicts.behaviour[scenario.name] !== undefined }).toEqual({
        name: scenario.name,
        recorded: true,
      });
    }
  });

  it.each(scenarios.map((scenario) => [scenario.name, scenario]))('%s', (_name, scenario) => {
    // Ожидание записано в сценарии словами утверждения линтера; исход —
    // то, что движки сделали на самом деле.
    expect(verdicts.behaviour[scenario.name]).toEqual(scenario.expect);
  });

  it('движки расходятся там, где линтер об этом говорит', () => {
    // Сценарии, в которых исход у движков разный, — это и есть различия в
    // поведении, а не в наборе имён. Их должно быть заметное число: иначе
    // стенд проверяет только то, в чём движки и так согласны.
    const split = scenarios.filter((scenario) => new Set(Object.values(scenario.expect)).size > 1);
    expect(split.length).toBeGreaterThanOrEqual(8);
  });
});
