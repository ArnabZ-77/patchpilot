import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligibleForFreeShipping } from "../src/lib/eligibility.js";

test("a loyalty member with a $60 order is eligible", () => {
  assert.equal(isEligibleForFreeShipping(60, true), true);
});

test("a non-member with a $10 order is not eligible", () => {
  assert.equal(isEligibleForFreeShipping(10, false), false);
});
