import { test } from "node:test";
import assert from "node:assert/strict";
import { isEligibleForFreeShipping } from "../../src/lib/eligibility.js";

test("[golden] a non-member with a large order is NOT eligible (AND, not OR)", () => {
  assert.equal(isEligibleForFreeShipping(500, false), false);
});
