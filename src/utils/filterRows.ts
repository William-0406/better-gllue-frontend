export function filterRows<T>(rows: T[], query: string, fields: Array<(row: T) => unknown>) {
  const keyword = query.trim().toLowerCase();
  if (!keyword) return rows;
  return rows.filter((row) =>
    fields.some((field) =>
      String(field(row) ?? '')
        .toLowerCase()
        .includes(keyword),
    ),
  );
}
