import { test } from "node:test";
import assert from "node:assert/strict";
import { getUserCity } from "../src/lib/profile.js";

test("getUserCity returns the address city for a complete user", () => {
  assert.equal(getUserCity({ name: "Asha", address: { city: "Pune" } }), "Pune");
});
