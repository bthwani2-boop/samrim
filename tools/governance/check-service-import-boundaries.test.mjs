import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { scanRepositoryServiceBoundaries, scanServiceBoundaryFile } from "./check-service-import-boundaries.mjs";

const dshInternal = "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/storage/postgres";

test("Go own-service internal import remains permitted", () => {
  assert.deepEqual(scanServiceBoundaryFile(
    "services/dsh/backend/cmd/api/main.go",
    'package main\nimport (\n "github.com/bthwani2-boop/samrim/services/dsh/backend/internal/media"\n)\n',
  ), []);
});

test("Go foreign-service internal import is rejected", () => {
  const result = scanServiceBoundaryFile(
    "services/wlt/backend/internal/financial/service.go",
    'package financial\nimport storage "' + dshInternal + '"\n',
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].unauthorizedOwner, "dsh");
});

test("Go grouped import with aliases catches forbidden ownership", () => {
  const result = scanServiceBoundaryFile(
    "services/identity/backend/internal/auth/session.go",
    'package auth\nimport (\n "context"\n foreign "' + dshInternal + '"\n)\n',
  );
  assert.equal(result.length, 1);
});

test("TS static and dynamic imports of another service's internals are rejected", () => {
  const file = "apps/app-client/src/features/orders/unsafe.ts";
  const result = scanServiceBoundaryFile(file,
    'import { unsafe } from "../../../../../services/dsh/backend/internal/secret";\n' +
    'const another = import("services/identity/backend/internal/actor");\n' +
    'const third = require("services/wlt/backend/internal/ledger");\n',
  );
  assert.deepEqual(result.map((item) => item.unauthorizedOwner), ["dsh", "identity", "wlt"]);
});

test("public package clients and source-inspection tests remain permitted", () => {
  const result = scanServiceBoundaryFile("apps/app-captain/src/safe.test.mjs",
    'import { createDshMobileClient } from "@bthwani/dsh";\n' +
    'const backend = readFileSync("../../services/dsh/backend/internal/transport/http/captain.go", "utf8");\n',
  );
  assert.deepEqual(result, []);
});

test("actual tracked repository honors runtime owner boundaries", () => {
  const root = resolve(import.meta.dirname, "../..");
  const result = scanRepositoryServiceBoundaries(root);
  assert.ok(result.checked > 900, "scan must cover a realistic repository, not only fixtures");
  assert.deepEqual(result.violations, []);
});
