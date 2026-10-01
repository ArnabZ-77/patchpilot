/**
 * BUG #1 (null/undefined access): computeTotal reads item.price without
 * checking the item is defined, so a sparse cart array (a deleted line
 * item, or a race with another request) throws instead of skipping it.
 */
export function computeTotal(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return Math.round(total * 100) / 100;
}
