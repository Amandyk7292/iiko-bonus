import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from '../../components/BulkaIcons';
import { useReducedMotion } from '../../lib/motion';
import './rounds-scroll.css';

export default function RoundsTableScroll({ children }: { children: ReactNode }) {
  const id = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const slider = useRef<HTMLInputElement>(null);
  const [edges, setEdges] = useState({ overflow: false, start: true, end: true });
  const reducedMotion = useReducedMotion();

  const sync = () => {
    const element = viewport.current;
    if (!element) return;
    const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
    if (slider.current) {
      slider.current.max = String(maximum);
      slider.current.value = String(Math.min(maximum, Math.max(0, element.scrollLeft)));
    }
    const next = {
      overflow: maximum > 1,
      start: element.scrollLeft <= 1,
      end: element.scrollLeft >= maximum - 1,
    };
    setEdges((previous) =>
      previous.overflow === next.overflow &&
      previous.start === next.start &&
      previous.end === next.end
        ? previous
        : next,
    );
  };

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => {
      // Layout offsets exclude the page's entrance animation and page scrolling.
      let top = 0;
      let ancestor: HTMLElement | null = element;
      while (ancestor) {
        top += ancestor.offsetTop;
        ancestor = ancestor.offsetParent as HTMLElement | null;
      }
      const height = `${Math.max(240, window.innerHeight - top - 32)}px`;
      if (element.style.maxHeight !== height) element.style.maxHeight = height;
      sync();
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [children, edges.overflow]);

  const move = (direction: number) => {
    const element = viewport.current;
    if (!element) return;
    const branchWidth = element.querySelector('th')?.getBoundingClientRect().width || 170;
    element.scrollBy({
      left: direction * Math.max(155, element.clientWidth - branchWidth),
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  };

  return (
    <div className="rounds-scroll-frame">
      <div
        className="rounds-scroll-controls"
        role="group"
        aria-label="Прокрутка дней"
        hidden={!edges.overflow}
      >
        <button
          type="button"
          aria-label="Прокрутить дни влево"
          aria-controls={id}
          disabled={edges.start}
          onClick={() => move(-1)}
        >
          <ChevronLeft size={20} />
        </button>
        <input
          ref={slider}
          type="range"
          min="0"
          max="0"
          step="1"
          defaultValue="0"
          aria-label="Прокрутка по дням"
          aria-controls={id}
          onChange={(event) => {
            if (viewport.current) viewport.current.scrollLeft = Number(event.target.value);
            sync();
          }}
        />
        <button
          type="button"
          aria-label="Прокрутить дни вправо"
          aria-controls={id}
          disabled={edges.end}
          onClick={() => move(1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div
        ref={viewport}
        id={id}
        className="rounds-calendar-wrap"
        role="region"
        aria-label="Календарь обходов"
        tabIndex={0}
        onScroll={sync}
      >
        {children}
      </div>
    </div>
  );
}
