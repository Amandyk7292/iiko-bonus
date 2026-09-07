import type { OverviewData } from './Overview';
import type { Query, Report } from './model';

// Publish actual results as they arrive; a slow comparison must not hide sales.
export async function loadOverview(
  report: (query: Query, signal?: AbortSignal) => Promise<Report>,
  current: Query,
  previous: Query | undefined,
  signal: AbortSignal,
  publish: (data: OverviewData) => void,
) {
  const data: Partial<OverviewData> = {};
  const queries: [keyof OverviewData, Query][] = [
    ['summary', current],
    ['trend', { ...current, groupBy: ['OpenDate.Typed'] }],
    ...(previous
      ? ([
          ['previous', previous],
          ['previousTrend', { ...previous, groupBy: ['OpenDate.Typed'] }],
        ] as [keyof OverviewData, Query][])
      : []),
  ];
  const results = await Promise.allSettled(
    queries.map(async ([key, query]) => {
      data[key] = await report(query, signal);
      if (data.summary && !signal.aborted) publish({ ...data, summary: data.summary });
    }),
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
