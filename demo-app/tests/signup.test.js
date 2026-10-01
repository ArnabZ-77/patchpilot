import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createUser, getUser, _resetUsersForTests } from "../src/lib/signup.js";

beforeEach(() => _resetUsersForTests());

test("createUser stores and returns a user with a valid email", () => {
  const user = createUser({ name: "Asha", email: "asha@example.com" });
  assert.equal(getUser(user.id).email, "asha@example.com");
});
