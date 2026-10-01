import { test } from "node:test";
import assert from "node:assert/strict";
import { paginate } from "../../src/lib/pagination.js";

test("[golden] paginate does not drop the last item of a full page", () => {
  const items = [1, 2, 3, 4, 5, 6];
  assert.deepEqual(paginate(items, 0, 3), [1, 2, 3]);
});
