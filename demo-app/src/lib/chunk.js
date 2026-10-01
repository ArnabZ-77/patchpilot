/**
 * BUG #6 (off-by-one in pagination/windowing): chunk() walks the array with
 * a step one larger than the chunk size, skipping one element between
 * every pair of chunks.
 */
export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size + 1) {
    out.push(items.slice(i, i + size));
  }
  return out;
}
