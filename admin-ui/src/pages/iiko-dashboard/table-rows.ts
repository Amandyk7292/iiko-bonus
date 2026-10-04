export function tableRows(
  rows: Record<string, unknown>[],
  fields: string[],
  search: string,
  sort: { field: string; direction: number },
) {
  if (!fields.length) return [];
  const needle = search.toLocaleLowerCase();
  const filtered = needle
    ? rows.filter((row) =>
        fields.some((field) =>
          String(row[field] ?? '')
            .toLocaleLowerCase()
            .includes(needle),
        ),
      )
    : rows;
  if (!sort.field) return filtered;
  // Construct ICU's numeric collation once, instead of for every comparison.
  const collator = new Intl.Collator(undefined, { numeric: true });
  const result = filtered === rows ? [...rows] : filtered;
  result.sort((a, b) => {
    const av = a[sort.field];
    const bv = b[sort.field];
    return (
      (typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : collator.compare(String(av ?? ''), String(bv ?? ''))) * sort.direction
    );
  });
  return result;
}
