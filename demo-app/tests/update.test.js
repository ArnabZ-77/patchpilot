import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createUser, _resetUsersForTests } from "../src/lib/signup.js";
import { updateEmail } from "../src/lib/update.js";

beforeEach(() => _resetUsersForTests());

test("updateEmail sets a new valid email", () => {
  const user = createUser({ name: "Asha", email: "asha@example.com" });
  const updated = updateEmail(user.id, "asha.new@example.com");
  assert.equal(updated.email, "asha.new@example.com");
});
