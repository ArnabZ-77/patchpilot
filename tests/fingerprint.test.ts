import { describe, it, expect } from "vitest";
import { fingerprint, isInApp, normalizeValue } from "../src/capture/fingerprint.ts";
import type { IncidentEvent } from "../src/types.ts";

function ev(overrides: Partial<IncidentEvent["exception"]["values"][number]> = {}): IncidentEvent {
  return {
    event_id: "a".repeat(32),
    timestamp: new Date().toISOString(),
    platform: "node",
    exception: {
      values: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'price')",
          stacktrace: { frames: [{ filename: "src/lib/total.js", function: "computeTotal", lineno: 10, in_app: true }] },
          ...overrides,
        },
      ],
    },
  };
}

describe("fingerprint", () => {
  it("is stable across different line numbers (grouping ignores lineno)", () => {
    const a = fingerprint(ev({ stacktrace: { frames: [{ filename: "src/lib/total.js", function: "computeTotal", lineno: 10, in_app: true }] } }));
    const b = fingerprint(ev({ stacktrace: { frames: [{ filename: "src/lib/total.js", function: "computeTotal", lineno: 99, in_app: true }] } }));
    expect(a).toBe(b);
  });

  it("differs for a different exception type", () => {
    const a = fingerprint(ev({ type: "TypeError" }));
    const b = fingerprint(ev({ type: "RangeError" }));
    expect(a).not.toBe(b);
  });

  it("differs for a different function", () => {
    const a = fingerprint(ev());
    const b = fingerprint(ev({ stacktrace: { frames: [{ filename: "src/lib/total.js", function: "other", lineno: 10, in_app: true }] } }));
    expect(a).not.toBe(b);
  });

  it("honors an explicit fingerprint override", () => {
    const base = ev();
    const withOverride: IncidentEvent = { ...base, fingerprint: ["custom-group"] };
    expect(fingerprint(withOverride)).not.toBe(fingerprint(base));
    expect(fingerprint(withOverride)).toBe(fingerprint({ ...base, fingerprint: ["custom-group"] }));
  });
});

describe("isInApp", () => {
  it("excludes node_modules frames", () => {
    expect(isInApp({ abs_path: "/repo/node_modules/express/lib/x.js" })).toBe(false);
  });
  it("excludes node: internals", () => {
    expect(isInApp({ abs_path: "node:internal/x" })).toBe(false);
  });
  it("includes repo frames", () => {
    expect(isInApp({ abs_path: "/repo/src/lib/total.js" })).toBe(true);
  });
});

describe("normalizeValue", () => {
  it("collapses numbers so values with different ids group together", () => {
    expect(normalizeValue("user 123 not found")).toBe(normalizeValue("user 456 not found"));
  });
});
