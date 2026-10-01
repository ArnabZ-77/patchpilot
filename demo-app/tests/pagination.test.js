import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../src/lib/pagination.js";

test("paginate returns everything when the page size exceeds the list", () => {
  const items = [1, 2, 3];
  assert.deepEqual(paginate(items, 0, 10), [1, 2, 3]);
});
