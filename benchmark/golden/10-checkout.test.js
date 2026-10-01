import { test } from "node:test";
import assert from "node:assert/strict";
import { canCheckout } from "../../src/lib/checkout.js";

test("[golden] a cart with one out-of-stock item cannot check out", () => {
  assert.equal(canCheckout([{ inStock: true }, { inStock: false }]), false);
});
