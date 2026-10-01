import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotal } from "../src/lib/total.js";

test("computeTotal sums price * quantity across items", () => {
  const total = computeTotal([
    { price: 10, quantity: 2 },
    { price: 5, quantity: 1 },
  ]);
  assert.equal(total, 25);
});

test("computeTotal returns 0 for an empty cart", () => {
  assert.equal(computeTotal([]), 0);
});
