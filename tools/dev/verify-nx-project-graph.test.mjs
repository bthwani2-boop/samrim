import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function affected(file) {
  const proc = spawnSync("pnpm", ["exec", "nx", "show", "projects", "--affected", `--files=${file}`, "--json"], {
    cwd: root, encoding: "utf8", windowsHide: true, shell: process.platform === "win32",
    timeout: 30000,
    env: { ...process.env, NX_DAEMON: "false", NX_NO_CLOUD: "true", NX_SKIP_NX_CACHE: "true" },
  });
  assert.equal(proc.status, 0, `Nx affected failed for ${file}: ${proc.stderr}`);
  return new Set(JSON.parse(proc.stdout));
}

test("DSH OpenAPI changes invalidate the Go owner and actual customer", () => {
  const projects = affected("services/dsh/contracts/openapi/paths/stores.yaml");
  for (const name of ["@bthwani/dsh", "dsh-backend", "@bthwani/customer"]) {
    assert.ok(projects.has(name), `Missing affected project ${name}`);
  }
  assert.ok(!projects.has("identity-backend"), "Unrelated Identity backend must not be affected");
});

test("Identity OpenAPI changes invalidate its Go backend", () => {
  const projects = affected("services/identity/contracts/openapi/paths/session.yaml");
  assert.ok(projects.has("@bthwani/identity"));
  assert.ok(projects.has("identity-backend"));
  assert.ok(!projects.has("dsh-backend"));
});

test("Go-only DSH source changes do not spuriously affect the customer", () => {
  const projects = affected("services/dsh/backend/internal/discovery/http.go");
  assert.ok(projects.has("dsh-backend"));
  assert.ok(!projects.has("@bthwani/customer"));
});

test("DSH SQL migrations invalidate their owner backend without affecting Identity", () => {
  const projects = affected("services/dsh/database/migrations/005_store_operational_policy_commands.sql");
  assert.ok(projects.has("@bthwani/dsh"));
  assert.ok(projects.has("dsh-backend"));
  assert.ok(!projects.has("identity-backend"));
});

test("Design source changes affect real renderer consumers", () => {
  const projects = affected("packages/design-system/src/brand/colors.ts");
  for (const name of ["@bthwani/design-system", "@bthwani/tamagui-config", "@bthwani/customer", "@bthwani/merchant", "@bthwani/captain", "@bthwani/control-panel"]) {
    assert.ok(projects.has(name), `Missing affected project ${name}`);
  }
});

test("Next typecheck outputs are project-scoped, not applied to Expo", () => {
  const run = (name) => {
    const proc = spawnSync("pnpm", ["exec", "nx", "show", "project", name, "--json"], {
      cwd: root, encoding: "utf8", windowsHide: true, shell: process.platform === "win32", timeout: 30000,
      env: { ...process.env, NX_DAEMON: "false", NX_NO_CLOUD: "true", NX_SKIP_NX_CACHE: "true" },
    });
    assert.equal(proc.status, 0, proc.stderr);
    return JSON.parse(proc.stdout);
  };
  assert.deepEqual(run("@bthwani/control-panel").targets.typecheck.outputs, ["{projectRoot}/.next/types"]);
  for (const name of ["@bthwani/customer", "@bthwani/merchant", "@bthwani/captain"]) {
    assert.ok(!run(name).targets.typecheck.outputs?.includes("{projectRoot}/.next/types"), name);
  }
});
