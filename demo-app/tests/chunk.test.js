import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk } from "../src/lib/chunk.js";

test("chunk splits a short array into one chunk", () => {
  assert.deepEqual(chunk([1, 2], 5), [[1, 2]]);
});
