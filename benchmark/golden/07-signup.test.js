import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, _resetUsersForTests } from "../../src/lib/signup.js";

test("[golden] createUser rejects an empty or malformed email", () => {
  _resetUsersForTests();
  assert.throws(() => createUser({ name: "Bad", email: "" }));
  assert.throws(() => createUser({ name: "Bad", email: "not-an-email" }));
});
