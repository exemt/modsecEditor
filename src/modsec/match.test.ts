import { matchValue } from './match';
import { pipelineResult, toBytes } from './transform';
import type { MatchVerdict } from './match';
import type { VisualOperator } from './model';

function check(
  name: string,
  argument: string,
  value: string,
  extra: Partial<VisualOperator> = {},
): MatchVerdict {
  return matchValue({ name, argument, negated: false, ...extra }, toBytes(value));
}

describe('текстовые операторы', () => {
  it('сравнивают с учётом регистра', () => {
    expect(check('streq', 'POST', 'POST')).toBe('match');
    expect(check('streq', 'POST', 'post')).toBe('noMatch');
  });

  it('ищут подстроку где угодно', () => {
    expect(check('contains', 'select', 'union select 1')).toBe('match');
    expect(check('beginsWith', '/admin', '/admin/index.php')).toBe('match');
    expect(check('endsWith', '.php', '/admin/index.php')).toBe('match');
  });

  it('containsWord требует границ слова', () => {
    expect(check('containsWord', 'or', '1 or 1')).toBe('match');
    expect(check('containsWord', 'or', 'colored')).toBe('noMatch');
  });

  it('within проверяет вхождение значения в список, а не наоборот', () => {
    expect(check('within', 'GET POST HEAD', 'POST')).toBe('match');
    expect(check('within', 'POST', 'GET POST HEAD')).toBe('noMatch');
  });

  it('pm ищет любую фразу без учёта регистра', () => {
    expect(check('pm', 'nikto sqlmap', 'curl SQLMap/1.0')).toBe('match');
    expect(check('pm', 'nikto sqlmap', 'Mozilla/5.0')).toBe('noMatch');
  });
});

describe('регулярное выражение', () => {
  it('проверяется в любом месте значения', () => {
    expect(check('rx', 'admin\\d+', 'user=admin42')).toBe('match');
    expect(check('rx', '^admin', 'user=admin42')).toBe('noMatch');
  });

  it('понимает встроенный флаг регистра', () => {
    expect(check('rx', '(?i)select', 'SELECT 1')).toBe('match');
    expect(check('rx', 'select', 'SELECT 1')).toBe('noMatch');
  });

  it('сломанный шаблон остаётся без ответа', () => {
    expect(check('rx', '(unclosed', 'value')).toBe('unknown');
  });
});

describe('числовые сравнения', () => {
  it('сравнивают число, прочитанное из значения', () => {
    expect(check('gt', '100', '128')).toBe('match');
    expect(check('lt', '100', '128')).toBe('noMatch');
    expect(check('eq', '0', 'abc')).toBe('match');
  });
});

describe('чего не считаем', () => {
  it('оператор, зависящий от окружения', () => {
    expect(check('ipMatch', '10.0.0.0/8', '10.1.2.3')).toBe('unknown');
    expect(check('detectSQLi', '', "1' or 1=1")).toBe('unknown');
  });

  it('значение с макросом', () => {
    expect(check('streq', '%{tx.expected}', 'anything')).toBe('unknown');
  });

  it('незаполненное значение не считается совпавшим', () => {
    expect(check('contains', '', 'anything')).toBe('unknown');
  });
});

describe('отрицание', () => {
  it('переворачивает ответ, но не догадку', () => {
    expect(check('streq', 'POST', 'GET', { negated: true })).toBe('match');
    expect(check('ipMatch', '10.0.0.0/8', '10.1.2.3', { negated: true })).toBe('unknown');
  });
});

describe('вместе с конвейером', () => {
  it('показывает, почему правило с t:lowercase не сработает', () => {
    const value = pipelineResult(toBytes('POST'), ['lowercase']) as Uint8Array;

    expect(matchValue({ name: 'streq', argument: 'POST', negated: false }, value)).toBe(
      'noMatch',
    );
    expect(matchValue({ name: 'streq', argument: 'post', negated: false }, value)).toBe(
      'match',
    );
  });
});
