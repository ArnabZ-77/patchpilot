import express from "express";
import { fileURLToPath, pathToFileURL } from "node:url";
import { patchpilot } from "../sdk/patchpilot-express.js";
import { computeTotal } from "./src/lib/total.js";
import { getUserCity } from "./src/lib/profile.js";
import { applyDiscount } from "./src/lib/discount.js";
import { calculateRefund } from "./src/lib/refund.js";
import { paginate } from "./src/lib/pagination.js";
import { chunk } from "./src/lib/chunk.js";
import { createUser, getUser } from "./src/lib/signup.js";
import { updateEmail } from "./src/lib/update.js";
import { isEligibleForFreeShipping } from "./src/lib/eligibility.js";
import { canCheckout } from "./src/lib/checkout.js";

const PORT = Number(process.env.DEMO_PORT || 5050);
const app = express();
app.use(express.json());

// Wrap each handler so a thrown error reaches Express's error pipeline
// (and therefore the PatchPilot capture middleware) instead of crashing
// the process, matching how a real production service behaves.
const h = (fn) => (req, res, next) => {
  try {
    fn(req, res);
  } catch (err) {
    next(err);
  }
};

app.post("/api/orders/total", h((req, res) => res.json({ total: computeTotal(req.body.items) })));
app.get("/api/users/:id/city", h((req, res) => res.json({ city: getUserCity(JSON.parse(req.query.user)) })));
app.post("/api/orders/discount", h((req, res) => res.json({ price: applyDiscount(req.body.price, req.body.discount) })));
app.get("/api/orders/refund", h((req, res) => res.json({ refund: calculateRefund(req.query.amount, req.query.fee) })));
app.get("/api/catalog/page", h((req, res) => res.json({ items: paginate(JSON.parse(req.query.items), Number(req.query.page), Number(req.query.size)) })));
app.get("/api/catalog/chunk", h((req, res) => res.json({ chunks: chunk(JSON.parse(req.query.items), Number(req.query.size)) })));
app.post("/api/users/signup", h((req, res) => res.status(201).json(createUser(req.body))));
app.post("/api/users/:id/email", h((req, res) => res.json(updateEmail(Number(req.params.id), req.body.email))));
app.get("/api/users/:id", h((req, res) => res.json(getUser(Number(req.params.id)))));
app.post("/api/billing/eligibility", h((req, res) => res.json({ eligible: isEligibleForFreeShipping(req.body.orderTotal, req.body.isLoyaltyMember) })));
app.post("/api/billing/checkout", h((req, res) => res.json({ canCheckout: canCheckout(req.body.cart) })));
app.get("/healthz", (_req, res) => res.json({ ok: true }));

// PatchPilot's own capture middleware — must be registered after routes.
app.use(
  patchpilot({
    endpoint: process.env.PATCHPILOT_ENDPOINT || "http://localhost:4747/api/incidents",
    repo: "demo-app",
    root: fileURLToPath(new URL(".", import.meta.url)),
    environment: "demo",
  }),
);
// Final handler so the client still gets a 500 instead of a hung connection.
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Express 5 passes listen errors (e.g. port already in use) to this callback.
  app.listen(PORT, (err) => {
    if (err) {
      console.error(`[demo-app] could not start on port ${PORT}: ${err.code ?? err.message}. Is another server already running there?`);
      process.exit(1);
    }
    console.log(`[demo-app] listening on http://localhost:${PORT}`);
  });
}

export default app;
