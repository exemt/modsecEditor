import { regexReason, reviewRegex, translateRegex } from './regex';

/** Что шаблон ловит после перевода. */
function matches(pattern: string, value: string): boolean {
  const regex = reviewRegex(pattern).regex;
  if (regex === null) throw new Error(`шаблон не собрался: ${pattern}`);
  return regex.test(value);
}

describe('встроенные флаги', () => {
  it('(?i) переносится во флаги, а не ломает шаблон', () => {
    const translated = translateRegex('(?i)select');
    expect(translated.source).toBe('select');
    expect(translated.flags).toBe('i');
    expect(matches('(?i)select', 'SELECT')).toBe(true);
  });

  it('шаблон CRS с (?i) в начале признаётся рабочим', () => {
    const crs = String.raw`(?i)(?:^|b["'\)\[\x5c]*(?:(?:(?:\|\||&&)[\s\x0b]*)?\$[!#\(\*\-0-9\?@_a-\{]*)?\x5c?u)`;
    expect(() => new RegExp(crs)).toThrow();
    expect(reviewRegex(crs).regex).not.toBeNull();
  });

  it('снимает флаг обратно и понимает групповую форму', () => {
    expect(translateRegex('(?i)(?-i)a').flags).toBe('');
    expect(translateRegex('(?i:abc)').source).toBe('(?:abc)');
  });

  it('(?x) выбрасывает пробелы и комментарии', () => {
    expect(translateRegex('(?x) a b  # хвост\nc').source).toBe('abc');
  });
});

describe('кванторы и группы', () => {
  it('сверхжадный квантор становится обычным', () => {
    expect(translateRegex('a++b*+c?+d{2,3}+').source).toBe('a+b*c?d{2,3}');
    expect(matches('a++b', 'aaab')).toBe(true);
  });

  it('ленивый квантор не путается со сверхжадным', () => {
    expect(translateRegex('a+?b??').source).toBe('a+?b??');
  });

  it('атомарная группа становится обычной', () => {
    expect(translateRegex('(?>ab)+c').source).toBe('(?:ab)+c');
  });

  it('обычные группы и просмотры не трогаются', () => {
    const kept = '(?:a)(?=b)(?!c)(?<=d)(?<!e)(?<name>f)(g)';
    expect(translateRegex(kept).source).toBe(kept);
  });

  it('именованная группа Python-образца переписывается', () => {
    expect(translateRegex('(?P<tag>a)(?P=tag)').source).toBe('(?<tag>a)\\k<tag>');
  });

  it('комментарий выбрасывается', () => {
    expect(translateRegex('a(?# что-то )b').source).toBe('ab');
  });
});

describe('классы символов', () => {
  it('POSIX-класс раскрывается в диапазон', () => {
    expect(translateRegex('[[:digit:]]+').source).toBe('[0-9]+');
    expect(matches('^[[:alpha:]]+$', 'abcDEF')).toBe(true);
    expect(matches('^[[:alpha:]]+$', 'abc1')).toBe(false);
  });

  it('закрывающая скобка сразу после открывающей — обычный символ', () => {
    expect(matches('[]a]', ']')).toBe(true);
  });

  it('квантор внутри класса остаётся символом', () => {
    expect(translateRegex('[a+*?]').source).toBe('[a+*?]');
  });

  it('\\h внутри класса и снаружи означает одно и то же', () => {
    expect(matches('^\\h$', '\t')).toBe(true);
    expect(matches('^[\\ha]$', ' ')).toBe(true);
  });
});

describe('якоря и сокращения', () => {
  it('\\A и \\z становятся якорями JavaScript', () => {
    expect(translateRegex('\\Aabc\\z').source).toBe('^abc$');
  });

  it('\\Z допускает завершающий перевод строки', () => {
    expect(matches('abc\\Z', 'abc\n')).toBe(true);
    expect(matches('abc\\Z', 'abc!')).toBe(false);
  });

  it('\\R ловит перевод строки любого вида', () => {
    expect(matches('a\\Rb', 'a\r\nb')).toBe(true);
    expect(matches('a\\Rb', 'a\nb')).toBe(true);
  });

  it('\\Q...\\E — обычный текст, а не шаблон', () => {
    expect(matches('\\Qa.c\\E', 'a.c')).toBe(true);
    expect(matches('\\Qa.c\\E', 'abc')).toBe(false);
  });
});

describe('чего перевести нельзя', () => {
  it('\\K и рекурсия называются прямо', () => {
    expect(reviewRegex('a\\Kb').unsupported).toBe('\\K');
    expect(reviewRegex('(a)(?R)').unsupported).toBe('(?R)');
  });

  it('непереводимое — не то же самое, что сломанное', () => {
    const review = reviewRegex('a\\Kb');
    expect(review.regex).toBeNull();
    expect(review.reason).toBeNull();
  });
});

describe('сообщение об ошибке', () => {
  it('сломанный шаблон объясняется без самого шаблона', () => {
    const review = reviewRegex('a(b');
    expect(review.regex).toBeNull();
    expect(review.reason).not.toContain('a(b');
    expect(review.detail).toContain('a(b');
  });

  it('причина отделяется от шаблона, даже если в нём есть косые черты', () => {
    expect(regexReason('Invalid regular expression: /a\\/: b/: Unterminated group')).toBe(
      'Unterminated group',
    );
  });

  it('незнакомый формат сообщения остаётся как есть', () => {
    expect(regexReason('invalid regexp group')).toBe('invalid regexp group');
  });
});

describe('шаблон без записей PCRE', () => {
  it('проходит через перевод неизменным', () => {
    const plain = '^/admin/[a-z0-9_-]+\\.php(\\?.*)?$';
    const translated = translateRegex(plain);
    expect(translated.source).toBe(plain);
    expect(translated.rewrites).toEqual([]);
  });
});
