import { test } from "node:test";
import assert from "node:assert/strict";
import { computeTotal } from "../../src/lib/total.js";

test("[golden] computeTotal skips a missing cart line instead of throwing", () => {
  const total = computeTotal([{ price: 10, quantity: 2 }, undefined, { price: 5, quantity: 1 }]);
  assert.equal(total, 25);
});
