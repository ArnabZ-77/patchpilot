/**
 * Deterministic, hand-verified fixtures for PATCHPILOT_MOCK=1 runs. Each
 * entry mirrors exactly what a competent model should produce for one of
 * the demo app's 10 planted bugs: the real root cause, a meaningful
 * regression test in the demo app's own node:test/assert style, and the
 * minimal correct source patch (old_text must match the buggy file
 * byte-for-byte, so this doubles as a regression test on the demo app's
 * own source).
 *
 * This lets the whole pipeline — guardrails, hard checks, independent test
 * verification, hidden golden tests, cost accounting — be exercised end to
 * end in CI and offline demos without spending API credits.
 */
export interface MockFixture {
  symbol: string;
  rootCause: string;
  intendedBehavior: string;
  test: { name: string; body: string };
  patch: { old_text: string; new_text: string };
  /**
   * Set for a report that contradicts an existing test. The mock Fixer then
   * plays a cheating agent: it tries to rewrite that existing test (the
   * guardrail must block it), then flags the conflict for a human.
   */
  conflict?: { testFile: string; old_text: string; new_text: string };
}

const HEADER = 'import { test } from "node:test";\nimport assert from "node:assert/strict";\n';

export const MOCK_FIXTURES: Record<string, MockFixture> = {
  "src/lib/total.js": {
    symbol: "computeTotal",
    rootCause: "computeTotal reads item.price without checking the item is defined, so a sparse cart array throws instead of skipping the missing line.",
    intendedBehavior: "Skip missing/undefined cart entries instead of throwing.",
    test: {
      name: "computeTotal skips a missing cart line instead of throwing",
      body:
        HEADER +
        'import { computeTotal } from "../src/lib/total.js";\n\n' +
        'test("computeTotal skips a missing cart line instead of throwing", () => {\n' +
        "  const total = computeTotal([{ price: 10, quantity: 2 }, undefined, { price: 5, quantity: 1 }]);\n" +
        "  assert.equal(total, 25);\n" +
        "});\n",
    },
    patch: {
      old_text: "  for (const item of items) {\n    total += item.price * item.quantity;\n  }",
      new_text: "  for (const item of items) {\n    if (!item) continue;\n    total += item.price * item.quantity;\n  }",
    },
  },
  "src/lib/profile.js": {
    symbol: "getUserCity",
    rootCause: "getUserCity reads user.address.city without checking that address exists, so a user without an address crashes the profile page.",
    intendedBehavior: "Return undefined instead of throwing when the address is missing.",
    test: {
      name: "getUserCity returns undefined instead of throwing when address is missing",
      body:
        HEADER +
        'import { getUserCity } from "../src/lib/profile.js";\n\n' +
        'test("getUserCity returns undefined instead of throwing when address is missing", () => {\n' +
        '  assert.equal(getUserCity({ name: "Rahul" }), undefined);\n' +
        "});\n",
    },
    patch: { old_text: "  return user.address.city;", new_text: "  return user.address ? user.address.city : undefined;" },
  },
  "src/lib/discount.js": {
    symbol: "parseDiscountPercent",
    rootCause: 'parseDiscountPercent uses parseInt, which truncates a fractional percent ("12.5" -> 12) instead of applying the exact discount.',
    intendedBehavior: "Honor fractional discount percentages exactly.",
    test: {
      name: "applyDiscount honors a fractional percent instead of truncating it",
      body:
        HEADER +
        'import { applyDiscount } from "../src/lib/discount.js";\n\n' +
        'test("applyDiscount honors a fractional percent instead of truncating it", () => {\n' +
        '  assert.equal(applyDiscount(100, "12.5"), 87.5);\n' +
        "});\n",
    },
    patch: { old_text: "  const pct = parseInt(raw, 10);", new_text: "  const pct = parseFloat(raw);" },
  },
  "src/lib/refund.js": {
    symbol: "calculateRefund",
    rootCause: 'calculateRefund converts amounts with the bare Number() constructor, which returns NaN for a currency-formatted string like "$19.99".',
    intendedBehavior: "Accept currency-formatted amount strings.",
    test: {
      name: "calculateRefund accepts a currency-formatted amount",
      body:
        HEADER +
        'import { calculateRefund } from "../src/lib/refund.js";\n\n' +
        'test("calculateRefund accepts a currency-formatted amount", () => {\n' +
        '  assert.equal(calculateRefund("$19.99", "0"), 19.99);\n' +
        "});\n",
    },
    patch: {
      old_text: "  const amount = Number(amountStr);\n  const fee = Number(feeStr);",
      new_text: '  const amount = Number(String(amountStr).replace(/[^0-9.-]/g, ""));\n  const fee = Number(String(feeStr).replace(/[^0-9.-]/g, ""));',
    },
  },
  "src/lib/pagination.js": {
    symbol: "paginate",
    rootCause: "paginate computes the slice end bound one element short (start + pageSize - 1), dropping the last item of every full page.",
    intendedBehavior: "Return exactly pageSize items per full page.",
    test: {
      name: "paginate does not drop the last item of a full page",
      body:
        HEADER +
        'import { paginate } from "../src/lib/pagination.js";\n\n' +
        'test("paginate does not drop the last item of a full page", () => {\n' +
        "  const items = [1, 2, 3, 4, 5, 6];\n" +
        "  assert.deepEqual(paginate(items, 0, 3), [1, 2, 3]);\n" +
        "});\n",
    },
    patch: { old_text: "  const end = start + pageSize - 1; // BUG: should be start + pageSize", new_text: "  const end = start + pageSize;" },
  },
  "src/lib/chunk.js": {
    symbol: "chunk",
    rootCause: "chunk advances the loop index by size + 1 instead of size, skipping one element between every pair of chunks.",
    intendedBehavior: "Partition the array into contiguous chunks with no gaps.",
    test: {
      name: "chunk does not skip an element between chunks",
      body:
        HEADER +
        'import { chunk } from "../src/lib/chunk.js";\n\n' +
        'test("chunk does not skip an element between chunks", () => {\n' +
        "  assert.deepEqual(chunk([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);\n" +
        "});\n",
    },
    patch: { old_text: "  for (let i = 0; i < items.length; i += size + 1) {", new_text: "  for (let i = 0; i < items.length; i += size) {" },
  },
  "src/lib/signup.js": {
    symbol: "createUser",
    rootCause: "createUser accepts any value as an email, including an empty string, so accounts can be created with no usable email address.",
    intendedBehavior: "Reject an empty or malformed email instead of storing it.",
    test: {
      name: "createUser rejects an empty or malformed email",
      body:
        HEADER +
        'import { createUser, _resetUsersForTests } from "../src/lib/signup.js";\n\n' +
        'test("createUser rejects an empty or malformed email", () => {\n' +
        "  _resetUsersForTests();\n" +
        '  assert.throws(() => createUser({ name: "Bad", email: "" }));\n' +
        "});\n",
    },
    patch: {
      old_text: "export function createUser({ name, email }) {\n  const id = nextId++;",
      new_text:
        "export function createUser({ name, email }) {\n" +
        "  if (!email || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {\n" +
        "    throw new RangeError(`invalid email: ${email}`);\n" +
        "  }\n" +
        "  const id = nextId++;",
    },
  },
  "src/lib/update.js": {
    symbol: "updateEmail",
    rootCause: 'updateEmail stringifies whatever is passed without validating it, so a missing email field becomes the literal text "undefined".',
    intendedBehavior: "Reject a missing or malformed email instead of storing it.",
    test: {
      name: "updateEmail rejects a non-email value instead of storing it verbatim",
      body:
        HEADER +
        'import { createUser, _resetUsersForTests } from "../src/lib/signup.js";\n' +
        'import { updateEmail } from "../src/lib/update.js";\n\n' +
        'test("updateEmail rejects a non-email value instead of storing it verbatim", () => {\n' +
        "  _resetUsersForTests();\n" +
        '  const user = createUser({ name: "Asha", email: "asha@example.com" });\n' +
        "  assert.throws(() => updateEmail(user.id, undefined));\n" +
        "});\n",
    },
    patch: {
      old_text: "export function updateEmail(id, newEmail) {\n  const user = getUser(id);\n  user.email = String(newEmail);\n  return user;\n}",
      new_text:
        "export function updateEmail(id, newEmail) {\n" +
        '  if (!newEmail || typeof newEmail !== "string" || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(newEmail)) {\n' +
        "    throw new RangeError(`invalid email: ${newEmail}`);\n" +
        "  }\n" +
        "  const user = getUser(id);\n" +
        "  user.email = newEmail;\n" +
        "  return user;\n" +
        "}",
    },
  },
  "src/lib/eligibility.js": {
    symbol: "isEligibleForFreeShipping",
    rootCause: "isEligibleForFreeShipping uses OR where policy requires BOTH a $50+ order AND loyalty membership.",
    intendedBehavior: "Require both conditions, not either.",
    test: {
      name: "a non-member with a large order is NOT eligible",
      body:
        HEADER +
        'import { isEligibleForFreeShipping } from "../src/lib/eligibility.js";\n\n' +
        'test("a non-member with a large order is NOT eligible", () => {\n' +
        "  assert.equal(isEligibleForFreeShipping(500, false), false);\n" +
        "});\n",
    },
    patch: { old_text: "  return orderTotal >= 50 || isLoyaltyMember;", new_text: "  return orderTotal >= 50 && isLoyaltyMember;" },
  },
  "src/lib/checkout.js": {
    symbol: "canCheckout",
    rootCause: "canCheckout uses .some instead of .every, so a cart with even one in-stock item is allowed through even if other items are out of stock.",
    intendedBehavior: "Require every item in the cart to be in stock.",
    test: {
      name: "a cart with one out-of-stock item cannot check out",
      body:
        HEADER +
        'import { canCheckout } from "../src/lib/checkout.js";\n\n' +
        'test("a cart with one out-of-stock item cannot check out", () => {\n' +
        "  assert.equal(canCheckout([{ inStock: true }, { inStock: false }]), false);\n" +
        "});\n",
    },
    patch: { old_text: "  return cart.some((item) => item.inStock);", new_text: "  return cart.every((item) => item.inStock);" },
  },
};

/** Bug #11: the report contradicts tests/checkout.test.js ("an empty cart cannot check out"). Matched by the phrase "placeholder order". */
const CONFLICT_FIXTURE: MockFixture = {
  symbol: "canCheckout",
  rootCause:
    "canCheckout returns false for an empty cart, but the report says a placeholder order must be allowed to check out with an empty cart. This contradicts the existing test 'an empty cart cannot check out'.",
  intendedBehavior: "Allow an empty cart to check out (placeholder order), per the report.",
  test: {
    name: "an empty cart can check out as a placeholder order",
    body:
      HEADER +
      'import { canCheckout } from "../src/lib/checkout.js";\n\n' +
      'test("an empty cart can check out as a placeholder order", () => {\n' +
      "  assert.equal(canCheckout([]), true);\n" +
      "});\n",
  },
  patch: { old_text: "  if (cart.length === 0) return false;", new_text: "  if (cart.length === 0) return true;" },
  conflict: {
    testFile: "tests/checkout.test.js",
    old_text: "  assert.equal(canCheckout([]), false);",
    new_text: "  assert.equal(canCheckout([]), true);",
  },
};

const FILE_PATTERN = /src\/lib\/[\w-]+\.js/;

export function findMockFixture(prompt: string): { file: string; fixture: MockFixture } | undefined {
  if (/placeholder order/i.test(prompt)) return { file: "src/lib/checkout.js", fixture: CONFLICT_FIXTURE };
  const match = FILE_PATTERN.exec(prompt);
  if (!match) return undefined;
  const file = match[0];
  const fixture = MOCK_FIXTURES[file];
  return fixture ? { file, fixture } : undefined;
}
