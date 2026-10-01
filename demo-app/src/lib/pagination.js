/**
 * BUG #5 (off-by-one in pagination): paginate() computes the slice end
 * bound one element short, so the last item of every page except the final
 * one is silently dropped.
 */
export function paginate(items, page, pageSize) {
  const start = page * pageSize;
  const end = start + pageSize - 1; // BUG: should be start + pageSize
  return items.slice(start, end);
}
