import assert from "node:assert/strict";
import test from "node:test";
import { containsHostPostgresFallback } from "./runtime-proof/identity-migration-host-fallback.mjs";

test("identity migration proof rejects host PostgreSQL fallbacks", () => {
  for (const source of [
    "postgres://localhost:5432/samrim",
    "postgresql://127.0.0.1/samrim",
    "host=localhost",
    "host=127.0.0.1",
    "postgresql://[::1]:5432/samrim",
    "host=::1",
    "[::1]:55432",
  ]) {
    assert.equal(containsHostPostgresFallback(source), true, `must reject ${source}`);
  }

  assert.equal(containsHostPostgresFallback("postgres://user:pass@postgres:5432/samrim?sslmode=disable"), false);
});
