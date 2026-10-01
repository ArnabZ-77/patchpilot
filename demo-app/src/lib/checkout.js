/**
 * BUG #10 (wrong conditional): checkout should be allowed only when the
 * cart is non-empty AND every item is in stock. canCheckout uses `.some`
 * instead of `.every`, so a cart with even one in-stock item is allowed
 * through even if other items in the same cart are out of stock.
 */
export function canCheckout(cart) {
  if (cart.length === 0) return false;
  return cart.some((item) => item.inStock);
}
