/**
 * BUG #9 (wrong conditional): policy is "free shipping requires an order of
 * at least $50 AND loyalty-program membership". isEligibleForFreeShipping
 * uses OR, so a $5 order from a loyalty member — or a $500 order from a
 * non-member — both incorrectly qualify.
 */
export function isEligibleForFreeShipping(orderTotal, isLoyaltyMember) {
  return orderTotal >= 50 || isLoyaltyMember;
}
