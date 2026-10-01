import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserCity } from "../../src/lib/profile.js";

test("[golden] getUserCity returns undefined instead of throwing when address is missing", () => {
  assert.equal(getUserCity({ name: "Rahul" }), undefined);
});
