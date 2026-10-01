/**
 * BUG #3 (wrong type conversion): parseDiscountPercent uses parseInt,
 * silently truncating fractional discounts ("12.5" -> 12) instead of the
 * intended parseFloat, so promo codes with decimal percentages apply the
 * wrong discount.
 */
export function parseDiscountPercent(raw) {
  const pct = parseInt(raw, 10);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    throw new RangeError(`invalid discount percent: ${raw}`);
  }
  return pct;
}

export function applyDiscount(price, discountRaw) {
  const pct = parseDiscountPercent(discountRaw);
  return Math.round(price * (1 - pct / 100) * 100) / 100;
}
