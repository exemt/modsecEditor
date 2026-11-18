import { lint, parse } from './index';
import type { SecRuleNode } from './ast';

/**
 * Время работы обязано расти вместе с текстом, а не с его квадратом.
 *
 * Пороги здесь нарочно на порядки выше обычного времени: тест ловит не
 * замедление на треть, а алгоритм, который на большом входе не кончается.
 */
const GENEROUS_MS = 3000;

function timed(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('масштаб', () => {
  it('большой файл из обычных правил', () => {
    const rules: string[] = [];
    for (let id = 1; id <= 20000; id++) {
      rules.push(
        // Шаблон у каждого правила свой: одинаковые были бы повтором.
        `SecRule ARGS|!ARGS:token "@rx (?i)union\\s+select_${id}\\b" \\`,
        `    "id:${id},phase:2,block,t:none,t:urlDecodeUni,t:lowercase,\\`,
        `    msg:'SQLi %{MATCHED_VAR_NAME}',setvar:'tx.score=+5'"`,
      );
    }
    const source = rules.join('\n');

    let found = -1;
    expect(timed(() => (found = lint(source).length))).toBeLessThan(GENEROUS_MS);
    expect(found).toBe(0);
    expect(parse(source).statements).toHaveLength(20000);
  });

  it('одно правило с огромным списком действий на тысячи строк', () => {
    const lines = ['SecRule ARGS "@rx a" \\', '    "id:1,phase:2,pass,\\'];
    for (let i = 0; i < 5000; i++) lines.push(`    setvar:tx.v${i}=${i},\\`);
    lines.push('    t:none"');
    const source = lines.join('\n');

    let rule: SecRuleNode | undefined;
    expect(
      timed(() => {
        rule = parse(source).statements[0] as SecRuleNode;
        lint(source);
      }),
    ).toBeLessThan(GENEROUS_MS);

    const actions = rule?.actions?.items ?? [];
    expect(actions).toHaveLength(5004);
    // Границы последнего узла верны и после пяти тысяч вырезанных переносов.
    const last = actions[actions.length - 1];
    expect(source.slice(last.start, last.end)).toBe('t:none');
    expect(source.slice(actions[2500].start, actions[2500].end)).toBe('setvar:tx.v2497=2497');
  });

  it('вырожденный ввод', () => {
    const inputs = [
      `SecRule ARGS "@rx ${'a'.repeat(1_000_000)}" "id:1,phase:2,pass"`,
      `SecRule ${'ARGS|'.repeat(100_000)}ARGS "@rx a" "id:1,phase:2,pass"`,
      `SecAction "id:1,phase:1,pass,${'t:lowercase,'.repeat(3000)}nolog"`,
      '"\\'.repeat(200_000),
      `SecAction "${"'".repeat(100_000)}"`,
      `SecAction "msg:'${'%{'.repeat(100_000)}'"`,
      '\\\n'.repeat(100_000),
      '#\n'.repeat(200_000),
    ];
    for (const input of inputs) {
      expect(timed(() => lint(input))).toBeLessThan(GENEROUS_MS);
    }
  });
});
