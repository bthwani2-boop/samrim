import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { test } from "node:test";
import { scanRepositoryServiceBoundaries, scanServiceBoundaryFile } from "./check-service-import-boundaries.mjs";
import { resolveTrustedExecutable } from "../dev/trusted-executables.mjs";

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

test("migration SQL belongs to its own schema and ignores comments or text literals", () => {
  const dsh = "services/dsh/backend/internal/storage/postgres/migrations/190_proof.sql";
  const wlt = "services/wlt/database/migrations/090_proof.sql";
  const identity = "services/identity/database/migrations/040_proof.sql";
  assert.deepEqual(scanServiceBoundaryFile(dsh,
    "-- DSH must not claim wlt.ledger_entries\n" +
    "CREATE TABLE dsh.proof (id text); /* identity.sessions is irrelevant */\n" +
    "INSERT INTO dsh.proof(id) VALUES ('wlt.ledger_entries');\n",
  ), []);
  assert.deepEqual(scanServiceBoundaryFile(wlt, "ALTER TABLE wlt.proof ADD COLUMN id text;"), []);
  assert.deepEqual(scanServiceBoundaryFile(identity, "CREATE SCHEMA IF NOT EXISTS identity;"), []);
  assert.deepEqual(scanServiceBoundaryFile("infra/local/compose/runtime-roles.sql",
    "GRANT SELECT ON dsh.stores TO wlt_reader;"), []);
});

test("migration SQL cannot reference another service's schema", () => {
  const dsh = "services/dsh/backend/internal/storage/postgres/migrations/190_proof.sql";
  const wlt = "services/wlt/database/migrations/090_proof.sql";
  const identity = "services/identity/database/migrations/040_proof.sql";
  const crossStore = scanServiceBoundaryFile(dsh,
    "CREATE TABLE dsh.temp (id text REFERENCES wlt.ledger_entries(id));\n");
  assert.equal(crossStore.length, 1);
  assert.equal(crossStore[0].unauthorizedOwner, "wlt");
  const crossMoney = scanServiceBoundaryFile(wlt,
    "UPDATE dsh.stores SET name = 'x' WHERE id = 'a';\n");
  assert.equal(crossMoney.length, 1);
  assert.equal(crossMoney[0].unauthorizedOwner, "dsh");
  const crossIdentity = scanServiceBoundaryFile(identity,
    "CREATE SCHEMA IF NOT EXISTS wlt;\n");
  assert.equal(crossIdentity.length, 1);
  assert.equal(crossIdentity[0].unauthorizedOwner, "wlt");
  const quoted = scanServiceBoundaryFile(dsh, 'CREATE TABLE "identity"."sessions" (id text);');
  assert.equal(quoted.length, 1);
  assert.equal(quoted[0].unauthorizedOwner, "identity");
});

test("actual tracked repository honors runtime owner boundaries", () => {
  const root = resolve(import.meta.dirname, "../..");
  const result = scanRepositoryServiceBoundaries(root);
  assert.ok(result.checked > 900, "scan must cover a realistic repository, not only fixtures");
  const trackedMigrations = execFileSync(resolveTrustedExecutable("git"), [
    "ls-files", "-z", "--",
    "services/dsh/backend/internal/storage/postgres/migrations",
    "services/identity/database/migrations",
    "services/wlt/database/migrations",
  ], { cwd: root, encoding: "utf8" }).split("\0").filter((file) => file.endsWith(".sql"));
  assert.ok(trackedMigrations.length > 0, "repository must expose its canonical SQL migration sources");
  assert.ok(result.migrationsChecked >= trackedMigrations.length, "boundary scan must inspect every tracked owner-authored migration");
  assert.deepEqual(result.violations, []);
});

test("repository boundary scan rejects PATH-shadowed Git executables", () => {
  const shadowDir = mkdtempSync(join(tmpdir(), "bthwani-git-shadow-"));
  const fakeGit = join(shadowDir, process.platform === "win32" ? "git.cmd" : "git");
  const oldPath = process.env.PATH;
  try {
    writeFileSync(fakeGit, process.platform === "win32" ? "@echo off\r\nexit /b 71\r\n" : "#!/bin/sh\nexit 71\n");
    if (process.platform !== "win32") chmodSync(fakeGit, 0o700);
    assert.ok(existsSync(fakeGit));
    process.env.PATH = shadowDir + delimiter + (oldPath ?? "");
    const trusted = resolveTrustedExecutable("git");
    assert.notEqual(resolve(trusted).toLowerCase(), resolve(fakeGit).toLowerCase());
    const root = resolve(import.meta.dirname, "../..");
    const result = scanRepositoryServiceBoundaries(root);
    assert.ok(result.checked > 900);
    assert.deepEqual(result.violations, []);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(shadowDir, { recursive: true, force: true });
  }
});
