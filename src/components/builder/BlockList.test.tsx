import { act, render, screen, waitFor } from '@testing-library/react';
import { BlockList } from './BlockList';
import { COLLAPSED_STEP, segmentsOf, visibleRange } from './blockRuns';

/**
 * Окно прокрутки в jsdom высоты не имеет, поэтому виртуализация в тестах по
 * умолчанию выключена (и все остальные тесты видят список целиком). Чтобы
 * проверить её саму, приходится подсунуть геометрию руками: высоту окна и
 * положение серии относительно него.
 */
function fakeViewport(container: HTMLElement, viewHeight: number) {
  const scroller = container.firstElementChild as HTMLElement;
  const run = scroller.firstElementChild?.firstElementChild as HTMLElement;
  let scrollTop = 0;

  Object.defineProperty(scroller, 'clientHeight', {
    configurable: true,
    get: () => viewHeight,
  });
  scroller.getBoundingClientRect = () => ({ top: 0, height: viewHeight }) as DOMRect;
  run.getBoundingClientRect = () => ({ top: -scrollTop, height: 0 }) as DOMRect;

  return {
    scrollTo(next: number) {
      scrollTop = next;
      scroller.dispatchEvent(new Event('scroll'));
    },
  };
}

function renderList(count: number, open: number[] = []) {
  return render(
    <BlockList
      count={count}
      isOpen={(index) => open.includes(index)}
      render={(index) => <button type="button">{`строка ${index}`}</button>}
      dimmed={false}
    />,
  );
}

const rows = () => screen.queryAllByRole('button');

describe('visibleRange — какие строки серии попадают в окно', () => {
  it('показывает начало серии, стоящей вплотную к верху окна', () => {
    const [first, last] = visibleRange(0, 400, 50, 1000);
    expect(first).toBe(0);
    // Окно плюс запас снизу — дальше строки не нужны.
    expect(last).toBe(Math.ceil((400 + 800) / 50));
  });

  it('не показывает серию, целиком ушедшую вверх', () => {
    const [first, last] = visibleRange(-100_000, 400, 50, 1000);
    expect(last - first).toBe(0);
  });

  it('не показывает серию, до которой ещё не долистали', () => {
    const [first, last] = visibleRange(100_000, 400, 50, 1000);
    expect(last - first).toBe(0);
  });

  it('короткую серию показывает целиком', () => {
    expect(visibleRange(0, 400, 50, 3)).toEqual([0, 3]);
  });
});

describe('segmentsOf — раскрытые блоки дробят серии свёрнутых', () => {
  it('собирает свёрнутые подряд в одну серию', () => {
    expect(segmentsOf(3, () => false)).toEqual([{ open: false, from: 0, to: 3 }]);
  });

  it('разрезает серию на раскрытом блоке', () => {
    expect(segmentsOf(4, (i) => i === 1)).toEqual([
      { open: false, from: 0, to: 1 },
      { open: true, index: 1 },
      { open: false, from: 2, to: 4 },
    ]);
  });
});

describe('BlockList — что попадает в DOM', () => {
  it('без высоты окна показывает всё: считать видимость не по чему', () => {
    renderList(50);
    expect(rows()).toHaveLength(50);
  });

  it('монтирует только строки рядом с окном', async () => {
    const { container } = renderList(200);
    const view = fakeViewport(container, 400);

    view.scrollTo(0);

    // Окно и запас под ним — это десятки строк, а не двести.
    await waitFor(() =>
      expect(rows()).toHaveLength(Math.ceil((400 + 800) / COLLAPSED_STEP)),
    );
    expect(screen.getByText('строка 0')).toBeInTheDocument();
    expect(screen.queryByText('строка 199')).toBeNull();
  });

  it('доносит до конца списка ровно те строки, до которых долистали', async () => {
    const { container } = renderList(200);
    const view = fakeViewport(container, 400);

    view.scrollTo(200 * COLLAPSED_STEP);

    // Ждать надо именно исчезновения начала списка: конец в нём есть и до
    // прокрутки — пока окно неизвестно, показано всё.
    await waitFor(() => expect(screen.queryByText('строка 0')).toBeNull());
    expect(screen.getByText('строка 199')).toBeInTheDocument();
  });

  /**
   * Строку с курсором прокрутка не размонтирует.
   *
   * Поля конструктора отдают правку по потере фокуса. Строка, исчезнувшая
   * из-под курсора, унесла бы набранное с собой — а виновата была бы
   * прокрутка колесом, о которой человек и не думал.
   */
  /**
   * Список может укоротиться под руками: так набор заменяют примером.
   *
   * Серия помнит, какие её строки были видны, а увидеть это заново успевает
   * только после рендера. Помнящая больше, чем в ней осталось, она спросила бы
   * у модели блок, которого в новой уже нет.
   */
  it('не спрашивает строку, которой в укоротившемся списке уже нет', async () => {
    const { container, rerender } = renderList(200);
    const view = fakeViewport(container, 400);

    view.scrollTo(200 * COLLAPSED_STEP);
    await waitFor(() => expect(screen.queryByText('строка 0')).toBeNull());

    const short = (index: number) => {
      if (index >= 5) throw new Error(`строки ${index} в списке нет`);
      return <button type="button">{`строка ${index}`}</button>;
    };

    rerender(<BlockList count={5} isOpen={() => false} render={short} dimmed={false} />);

    view.scrollTo(0);
    await waitFor(() => expect(rows()).toHaveLength(5));
  });

  it('оставляет в DOM строку, в которой стоит курсор', async () => {
    const { container } = renderList(200);
    const view = fakeViewport(container, 400);

    view.scrollTo(0);
    await waitFor(() => expect(screen.queryByText('строка 199')).toBeNull());
    act(() => screen.getByText('строка 0').focus());

    view.scrollTo(200 * COLLAPSED_STEP);

    await waitFor(() => expect(screen.getByText('строка 199')).toBeInTheDocument());
    expect(screen.getByText('строка 0')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByText('строка 0'));
  });
});
