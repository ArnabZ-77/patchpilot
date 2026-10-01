/**
 * BUG #4 (wrong type conversion): calculateRefund converts amounts with the
 * bare Number() constructor, which returns NaN for currency-formatted
 * strings like "$19.99" that the mobile client sometimes still sends
 * (Number() does not strip the currency symbol the way a proper money
 * parser would).
 */
export function calculateRefund(amountStr, feeStr) {
  const amount = Number(amountStr);
  const fee = Number(feeStr);
  if (Number.isNaN(amount) || Number.isNaN(fee)) {
    throw new RangeError(`invalid refund inputs: amount=${amountStr} fee=${feeStr}`);
  }
  return Math.round((amount - fee) * 100) / 100;
}
