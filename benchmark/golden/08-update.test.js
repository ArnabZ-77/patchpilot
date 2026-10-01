import { test } from "node:test";
import assert from "node:assert/strict";
import { createUser, _resetUsersForTests } from "../../src/lib/signup.js";
import { updateEmail } from "../../src/lib/update.js";

test("[golden] updateEmail rejects a non-email value instead of storing it verbatim", () => {
  _resetUsersForTests();
  const user = createUser({ name: "Asha", email: "asha@example.com" });
  assert.throws(() => updateEmail(user.id, undefined));
});
