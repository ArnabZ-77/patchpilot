/**
 * Demo helper: send a planted bug's request to the running shop and show
 * whether the answer is right. Run it before PatchPilot's fix (❌) and again
 * on the PR branch (✅) for a before/after on the exact same request.
 *
 * Usage:
 *   npm run demo:try           # all bugs
 *   npm run demo:try -- 01     # one bug
 * Env: DEMO_URL (default http://localhost:5050)
 */
const DEMO_URL = process.env.DEMO_URL || "http://localhost:5050";

interface Check {
  id: string;
  what: string;
  /** Requests to send in order; the last response is judged. */
  steps: Array<{ method: "GET" | "POST"; path: string; body?: unknown }>;
  expect: string;
  ok: (status: number, body: any) => boolean;
}

const q = (o: Record<string, unknown>) =>
  "?" + Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(typeof v === "string" ? v : JSON.stringify(v))}`).join("&");

const CHECKS: Check[] = [
  {
    id: "01",
    what: "cart total with a missing line",
    steps: [{ method: "POST", path: "/api/orders/total", body: { items: [{ price: 10, quantity: 2 }, null, { price: 5, quantity: 1 }] } }],
    expect: '200 {"total":25}',
    ok: (s, b) => s === 200 && b?.total === 25,
  },
  {
    id: "02",
    what: "profile city for a user with no address",
    steps: [{ method: "GET", path: "/api/users/1/city" + q({ user: { name: "Rahul" } }) }],
    expect: "200 (no city, no crash)",
    ok: (s) => s === 200,
  },
  {
    id: "03",
    what: "12.5% discount on ₹100",
    steps: [{ method: "POST", path: "/api/orders/discount", body: { price: 100, discount: "12.5" } }],
    expect: '200 {"price":87.5}',
    ok: (s, b) => s === 200 && b?.price === 87.5,
  },
  {
    id: "04",
    what: 'refund of "$19.99"',
    steps: [{ method: "GET", path: "/api/orders/refund" + q({ amount: "$19.99", fee: "0" }) }],
    expect: '200 {"refund":19.99}',
    ok: (s, b) => s === 200 && b?.refund === 19.99,
  },
  {
    id: "05",
    what: "first page of 3 from [1..6]",
    steps: [{ method: "GET", path: "/api/catalog/page" + q({ items: [1, 2, 3, 4, 5, 6], page: "0", size: "3" }) }],
    expect: '200 {"items":[1,2,3]}',
    ok: (s, b) => s === 200 && JSON.stringify(b?.items) === "[1,2,3]",
  },
  {
    id: "06",
    what: "chunks of 2 from [1,2,3,4]",
    steps: [{ method: "GET", path: "/api/catalog/chunk" + q({ items: [1, 2, 3, 4], size: "2" }) }],
    expect: '200 {"chunks":[[1,2],[3,4]]}',
    ok: (s, b) => s === 200 && JSON.stringify(b?.chunks) === "[[1,2],[3,4]]",
  },
  {
    id: "07",
    what: "sign-up with an empty email",
    steps: [{ method: "POST", path: "/api/users/signup", body: { name: "Bad", email: "" } }],
    expect: "rejected (error status)",
    ok: (s) => s >= 400,
  },
  {
    id: "08",
    what: "update email with no email field",
    steps: [
      { method: "POST", path: "/api/users/signup", body: { name: "Asha", email: "asha@example.com" } },
      { method: "POST", path: "/api/users/{lastId}/email", body: {} },
    ],
    expect: "rejected (error status)",
    ok: (s) => s >= 400,
  },
  {
    id: "09",
    what: "free shipping: ₹500 order, not a member",
    steps: [{ method: "POST", path: "/api/billing/eligibility", body: { orderTotal: 500, isLoyaltyMember: false } }],
    expect: '200 {"eligible":false}',
    ok: (s, b) => s === 200 && b?.eligible === false,
  },
  {
    id: "10",
    what: "checkout with one item out of stock",
    steps: [{ method: "POST", path: "/api/billing/checkout", body: { cart: [{ inStock: true }, { inStock: false }] } }],
    expect: '200 {"canCheckout":false}',
    ok: (s, b) => s === 200 && b?.canCheckout === false,
  },
];

async function run(check: Check): Promise<boolean> {
  let status = 0;
  let body: any;
  let lastId: unknown;
  for (const step of check.steps) {
    const res = await fetch(DEMO_URL + step.path.replace("{lastId}", String(lastId ?? 1)), {
      method: step.method,
      headers: step.body ? { "content-type": "application/json" } : undefined,
      body: step.body ? JSON.stringify(step.body) : undefined,
    });
    status = res.status;
    const text = await res.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
    if (body && typeof body === "object" && "id" in body) lastId = body.id;
  }
  const pass = check.ok(status, body);
  const got = `${status} ${typeof body === "string" ? body : JSON.stringify(body)}`;
  console.log(`${pass ? "✅" : "❌"} ${check.id}  ${check.what}`);
  console.log(`      got:      ${got.slice(0, 120)}`);
  if (!pass) console.log(`      expected: ${check.expect}`);
  return pass;
}

async function main(): Promise<void> {
  const only = process.argv[2];
  const checks = only ? CHECKS.filter((c) => c.id.startsWith(only)) : CHECKS;
  if (!checks.length) {
    console.error(`No check "${only}". Known: ${CHECKS.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  try {
    await fetch(DEMO_URL + "/healthz");
  } catch {
    console.error(`The shop isn't running at ${DEMO_URL}. Start it first (npm run demo:shop or npm run demo).`);
    process.exit(1);
  }
  let passed = 0;
  for (const c of checks) if (await run(c)) passed++;
  console.log(`\n${passed}/${checks.length} correct at ${DEMO_URL}`);
}

main();
