import { useSearchParams } from '../lib/router';
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
const validDay = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 10) === v;
export function useSettlementFilters() {
  const [params, setParams] = useSearchParams();
  const end = today(),
    start = `${end.slice(0, 7)}-01`;
  const rawFrom = params.get('from') || start,
    rawTo = params.get('to') || end;
  const valid =
    validDay(rawFrom) &&
    validDay(rawTo) &&
    rawFrom <= rawTo &&
    Date.parse(rawTo) - Date.parse(rawFrom) <= 366 * 86400000;
  const from = valid ? rawFrom : start,
    to = valid ? rawTo : end;
  const rawBranch = params.get('branch') || '';
  const branch = /^[a-f0-9-]{36}$/i.test(rawBranch) ? rawBranch : '';
  const rawOffset = Number(params.get('offset') || 0);
  const offset =
    Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 100000 ? rawOffset : 0;
  const update = (key: string, value: string) => {
    const next = new URLSearchParams({ from, to, branch, offset: String(offset) });
    next.set(key, value);
    if (key !== 'offset') next.set('offset', '0');
    if (!next.get('branch')) next.delete('branch');
    setParams(next, { replace: true });
  };
  return {
    from,
    to,
    branch,
    offset,
    setFrom: (v: string) => update('from', v),
    setTo: (v: string) => update('to', v),
    setBranch: (v: string) => update('branch', v),
    setOffset: (v: number) => update('offset', String(v)),
  };
}
