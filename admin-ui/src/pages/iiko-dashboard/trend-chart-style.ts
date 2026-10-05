import type { ChartOptions, ScriptableContext } from 'chart.js';

export const trendColors = {
  current: '#69391f',
  comparison: '#b17b20',
  grid: '#e8ded3',
  text: '#685749',
  tooltip: '#432819',
};

export function trendReveal(
  pointCount: number,
  reduced: boolean,
): Pick<ChartOptions<'line'>, 'animation' | 'animations'> {
  if (reduced) return { animation: false };
  const count = Math.max(1, pointCount);
  const total = Math.min(1050, Math.max(700, count * 80));
  const step = total / count;
  const delayFor = () => {
    const started = new WeakSet<object>();
    return (context: ScriptableContext<'line'>) => {
      if (context.type !== 'data' || started.has(context)) return 0;
      started.add(context);
      return Math.min(count - 1, context.dataIndex) * step;
    };
  };
  return {
    animation: { duration: total, easing: 'easeOutQuart' },
    animations: {
      x: { type: 'number', easing: 'linear', duration: step, from: NaN, delay: delayFor() },
      y: {
        type: 'number',
        easing: 'easeOutQuad',
        duration: step,
        from: (context: ScriptableContext<'line'>) => {
          if (context.type !== 'data') return 0;
          const previous = context.chart.getDatasetMeta(context.datasetIndex).data[
            context.dataIndex - 1
          ];
          const previousY = previous?.getProps(['y'], true).y;
          return Number.isFinite(previousY)
            ? previousY
            : (context.chart.scales.y?.getPixelForValue(context.parsed?.y ?? 0) ?? 0);
        },
        delay: delayFor(),
      },
    },
  };
}

export function trendFill(context: ScriptableContext<'line'>) {
  const { ctx, chartArea } = context.chart;
  if (!chartArea) return 'rgba(215, 155, 42, 0.13)';
  const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, 'rgba(215, 155, 42, 0.25)');
  gradient.addColorStop(1, 'rgba(215, 155, 42, 0.015)');
  return gradient;
}
