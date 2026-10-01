import { test } from "node:test";
import assert from "node:assert/strict";
import { canCheckout } from "../src/lib/checkout.js";

test("an empty cart cannot check out", () => {
  assert.equal(canCheckout([]), false);
});

test("a cart where every item is in stock can check out", () => {
  assert.equal(canCheckout([{ inStock: true }, { inStock: true }]), true);
});
