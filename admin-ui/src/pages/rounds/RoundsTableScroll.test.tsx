import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import RoundsTableScroll from './RoundsTableScroll';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const result = render(
    <RoundsTableScroll>
      <table>
        <tbody>
          <tr>
            <th>Филиал</th>
            <td>Обход</td>
          </tr>
        </tbody>
      </table>
    </RoundsTableScroll>,
  );
  const viewport = screen.getByRole('region', { name: 'Календарь обходов' });
  const size = { width: 800, content: 3000 };
  Object.defineProperties(viewport, {
    clientWidth: { get: () => size.width },
    scrollWidth: { get: () => size.content },
    offsetTop: { value: 450 },
  });
  const scrollBy = vi.fn();
  viewport.scrollBy = scrollBy;
  act(() => resized());
  return { ...result, viewport, size, resized, disconnect, scrollBy };
}

it('keeps the upper scrollbar and arrows in sync with native table scrolling', () => {
  const { viewport, scrollBy } = setup();
  const slider = screen.getByRole('slider', { name: 'Прокрутка по дням' });
  const left = screen.getByRole('button', { name: 'Прокрутить дни влево' });
  const right = screen.getByRole('button', { name: 'Прокрутить дни вправо' });
  expect(left).toBeDisabled();
  expect(right).toBeEnabled();
  expect(slider).toHaveAttribute('max', '2200');
  expect(slider).toHaveAttribute('aria-controls', viewport.id);
  fireEvent.change(slider, { target: { value: '1200' } });
  expect(viewport.scrollLeft).toBe(1200);
  expect(left).toBeEnabled();
  viewport.scrollLeft = 2200;
  fireEvent.scroll(viewport);
  expect(slider).toHaveValue('2200');
  expect(right).toBeDisabled();
  fireEvent.click(left);
  expect(scrollBy).toHaveBeenCalledWith({ left: -630, behavior: 'smooth' });
  viewport.scrollLeft = 0;
  fireEvent.scroll(viewport);
  expect(left).toBeDisabled();
  expect(slider).toHaveValue('0');
});

it('updates the available range on resize and hides unnecessary controls', () => {
  const { size, resized, unmount, disconnect } = setup();
  size.width = 1200;
  act(() => resized());
  expect(screen.getByRole('slider')).toHaveAttribute('max', '1800');
  size.content = 1000;
  act(() => resized());
  expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  size.width = 700;
  act(() => resized());
  expect(screen.getByRole('slider')).toHaveAttribute('max', '300');
  unmount();
  expect(disconnect).toHaveBeenCalled();
});

it('fits the remaining window height and avoids animated scrolling with reduced motion', () => {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: () => false,
  }));
  const { viewport, scrollBy } = setup();
  expect(viewport.style.maxHeight).toBe(`${Math.max(240, window.innerHeight - 482)}px`);
  fireEvent.click(screen.getByRole('button', { name: 'Прокрутить дни вправо' }));
  expect(scrollBy).toHaveBeenCalledWith({ left: 630, behavior: 'instant' });
  vi.stubGlobal('innerHeight', 600);
  fireEvent(window, new Event('resize'));
  expect(viewport.style.maxHeight).toBe('240px');
});
