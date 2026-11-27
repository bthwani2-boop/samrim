import assert from "node:assert/strict";
import { test } from "node:test";
import { hasActiveCaptainSession } from "./captain-session.ts";

const now = Date.parse("2026-11-17T00:00:00Z");
const valid = { actorId: "captain-1", role: "captain", sessionExpiresAt: "2026-11-18T00:00:00Z" };

test("Captain presentation accepts only a current owner session with Captain role", t => {
  t.mock.method(Date, "now", () => now);
  assert.equal(hasActiveCaptainSession(valid), true);
  for (const candidate of [
    null, {}, [], { ...valid, role: "merchant" }, { ...valid, role: "customer" },
    { ...valid, role: "operator" }, { ...valid, actorId: " " },
    { ...valid, sessionExpiresAt: "2026-01-01T00:00:00Z" },
    { ...valid, sessionExpiresAt: "2026-11-17T00:00:00Z" },
    { ...valid, sessionExpiresAt: "invalid" },
  ]) assert.equal(hasActiveCaptainSession(candidate), false);
});

test("Captain presentation rejects noncanonical owner DTOs", t => {
  t.mock.method(Date, "now", () => now);
  for (const candidate of [
    { ...valid, extra: true },
    Object.create(valid),
    { ...valid, actorId: "captain\u0000forged" },
    { ...valid, actorId: "x".repeat(129) },
    { ...valid, actorId: "\ud800" },
  ]) assert.equal(hasActiveCaptainSession(candidate), false, "must reject noncanonical session");
});
