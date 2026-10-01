import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../../src/lib/chunk.js";

test("[golden] chunk does not skip an element between chunks", () => {
  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
});
