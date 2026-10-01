import { test } from "node:test";
import assert from "node:assert/strict";
import { applyDiscount } from "../src/lib/discount.js";

test("applyDiscount applies an integer percent discount", () => {
  assert.equal(applyDiscount(100, "20"), 80);
});

test("applyDiscount rejects an out-of-range percent", () => {
  assert.throws(() => applyDiscount(100, "150"));
});
