import { TRANSFORM_NAMES } from './semantics';
import {
  OPAQUE_TRANSFORMS,
  pipelineResult,
  runPipeline,
  showBytes,
  toBytes,
} from './transform';

/** Прогон значения через конвейер и показ результата — как в предпросмотре. */
function run(value: string, transforms: string[]): string {
  const result = pipelineResult(toBytes(value), transforms);
  return result === null ? '<нет>' : showBytes(result);
}

/** Результат одного преобразования. */
function apply(name: string, value: string): string {
  return run(value, [name]);
}

describe('регистр и пробелы', () => {
  it('приводит регистр только у латиницы', () => {
    expect(apply('lowercase', 'POST Привет')).toBe('post Привет');
    expect(apply('uppercase', 'post')).toBe('POST');
  });

  it('схлопывает и убирает пробелы', () => {
    expect(apply('compressWhitespace', 'union\t\n  select')).toBe('union select');
    expect(apply('removeWhitespace', 'union select')).toBe('unionselect');
    expect(apply('trim', '  value  ')).toBe('value');
    expect(apply('trimLeft', '  value  ')).toBe('value  ');
  });
});

describe('декодирование', () => {
  it('раскрывает проценты и плюс', () => {
    expect(apply('urlDecode', '%2Fetc+passwd')).toBe('/etc passwd');
  });

  it('оставляет незавершённую последовательность как есть', () => {
    expect(apply('urlDecode', '100%25 %zz')).toBe('100% %zz');
  });

  it('собирает многобайтовый символ из процентов', () => {
    expect(apply('urlDecode', '%D0%B0')).toBe('а');
  });

  it('понимает %uXXXX только в варианте с Unicode', () => {
    expect(apply('urlDecodeUni', '%u003Cscript')).toBe('<script');
    expect(apply('urlDecode', '%u003Cscript')).toBe('%u003Cscript');
  });

  it('сводит полноширинные формы к обычным', () => {
    expect(apply('urlDecodeUni', '%uFF1Cscript')).toBe('<script');
  });

  it('раскрывает HTML-сущности всех трёх видов', () => {
    expect(apply('htmlEntityDecode', '&lt;a&#62;&#x3c;b&gt')).toBe('<a><b>');
  });

  it('раскрывает escape-последовательности', () => {
    expect(apply('escapeSeqDecode', '\\x3cscript\\t')).toBe('<script\\x09');
    expect(apply('jsDecode', '\\u003cscript')).toBe('<script');
  });

  it('строгий Base64 останавливается на постороннем символе', () => {
    expect(apply('base64Decode', 'c2VsZWN0!!!')).toBe('select');
    expect(apply('base64DecodeExt', 'c2Vs ZWN0')).toBe('select');
  });

  it('шестнадцатеричное кодирование обратимо', () => {
    expect(apply('hexEncode', 'AB')).toBe('4142');
    expect(apply('hexDecode', '4142')).toBe('AB');
  });
});

describe('комментарии', () => {
  it('замена оставляет пробел вместо комментария', () => {
    expect(apply('replaceComments', 'un/**/ion')).toBe('un ion');
  });

  it('удаление склеивает соседние слова', () => {
    expect(apply('removeComments', 'un/**/ion')).toBe('union');
  });

  it('незакрытый комментарий съедает остаток значения', () => {
    expect(apply('replaceComments', 'select/*rest')).toBe('select ');
  });

  it('однострочный комментарий обрывает значение', () => {
    expect(apply('removeComments', "1' or 1=1 -- rest")).toBe("1' or 1=1 ");
  });

  it('удаление только меток оставляет содержимое', () => {
    expect(apply('removeCommentsChar', 'un/**/ion')).toBe('union');
  });
});

describe('пути и командная строка', () => {
  it('свёртывает обход каталога', () => {
    expect(apply('normalizePath', '/var/www/../../etc/passwd')).toBe('/etc/passwd');
    expect(apply('normalizePath', '/a/./b//c')).toBe('/a/b/c');
  });

  it('в варианте для Windows разделителем считается и обратная косая', () => {
    expect(apply('normalizePathWin', 'a\\..\\b')).toBe('b');
    expect(apply('normalizePath', 'a\\..\\b')).toBe('a\\..\\b');
  });

  it('нормализует команду, разобранную оболочкой', () => {
    expect(apply('cmdLine', 'C^M^D  /c "d""ir"')).toBe('cmd/c dir');
  });
});

describe('число и байты', () => {
  it('длина считается в байтах, а не в символах', () => {
    expect(apply('length', 'привет')).toBe('12');
    expect(apply('length', 'abc')).toBe('3');
  });

  it('непечатаемые байты показываются кодом', () => {
    expect(apply('hexDecode', '00410a')).toBe('\\x00A\\x0a');
  });
});

describe('конвейер целиком', () => {
  it('шаги идут слева направо', () => {
    expect(run('%41%42', ['urlDecode', 'lowercase'])).toBe('ab');
  });

  it('порядок декодирования и нормализации значим', () => {
    expect(run('/var/..%2fetc', ['urlDecode', 'normalizePath'])).toBe('/etc');
    expect(run('/var/..%2fetc', ['normalizePath', 'urlDecode'])).toBe('/var/../etc');
  });

  it('t:none возвращает исходное значение', () => {
    const steps = runPipeline(toBytes('Value'), ['lowercase', 'none', 'trim']);
    expect(showBytes(steps[1].value as Uint8Array)).toBe('Value');
  });

  it('отмечает шаг, который ничего не изменил', () => {
    const steps = runPipeline(toBytes('post'), ['lowercase', 'trim']);
    expect(steps[0].unchanged).toBe(true);
    expect(steps[1].unchanged).toBe(true);
  });

  it('невоспроизводимый шаг гасит значение до конца конвейера', () => {
    const steps = runPipeline(toBytes('value'), ['md5', 'hexEncode']);

    expect(steps[0].reproducible).toBe(false);
    expect(steps[0].value).toBeNull();
    // Следующий шаг воспроизводим сам по себе, но применять его уже не к чему.
    expect(steps[1].reproducible).toBe(true);
    expect(steps[1].value).toBeNull();
  });
});

describe('полнота таблицы', () => {
  it('каждое известное преобразование либо считается, либо объявлено непоказуемым', () => {
    const unhandled = TRANSFORM_NAMES.filter(
      (name) =>
        !OPAQUE_TRANSFORMS.has(name) &&
        runPipeline(toBytes('value'), [name])[0].reproducible === false,
    );

    expect(unhandled).toEqual([]);
  });
});
