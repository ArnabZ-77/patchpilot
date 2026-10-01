import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../../src/lib/discount.js";

test("[golden] applyDiscount honors a fractional percent instead of truncating it", () => {
  // 100 * (1 - 12.5/100) = 87.5, not 88 (which is what parseInt("12.5") -> 12 would give)
  assert.equal(applyDiscount(100, "12.5"), 87.5);
});
