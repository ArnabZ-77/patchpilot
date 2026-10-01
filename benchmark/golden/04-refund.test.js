import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateRefund } from "../../src/lib/refund.js";

test("[golden] calculateRefund accepts a currency-formatted amount", () => {
  assert.equal(calculateRefund("$19.99", "0"), 19.99);
});
