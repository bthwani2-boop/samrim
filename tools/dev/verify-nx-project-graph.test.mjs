import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const require = createRequire(import.meta.url);
const nxPackagePath = require.resolve("nx/package.json");
const nxCli = path.resolve(path.dirname(nxPackagePath), require("nx/package.json").bin.nx);
function runNx(args) {
  // Nx arguments are data; do not invoke a Windows command interpreter.
  return spawnSync(process.execPath, [nxCli, ...args], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000,
    env: { ...process.env, NX_DAEMON: "false", NX_NO_CLOUD: "true", NX_SKIP_NX_CACHE: "true" },
  });
}


function affected(file) {
  const proc = runNx(["show", "projects", "--affected", `--files=${file}`, "--json"]);
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
    const proc = runNx(["show", "project", name, "--json"]);
    assert.equal(proc.status, 0, proc.stderr);
    return JSON.parse(proc.stdout);
  };
  assert.deepEqual(run("@bthwani/control-panel").targets.typecheck.outputs, ["{projectRoot}/.next/types"]);
  for (const name of ["@bthwani/customer", "@bthwani/merchant", "@bthwani/captain"]) {
    assert.ok(!run(name).targets.typecheck.outputs?.includes("{projectRoot}/.next/types"), name);
  }
});

test("new untracked DSH OpenAPI path affects Go, client and Customer", () => {
  const projects = affected("services/dsh/contracts/openapi/paths/future-checkout.yaml");
  for (const name of ["@bthwani/dsh", "dsh-backend", "@bthwani/customer"]) {
    assert.ok(projects.has(name), `New contract not captured for ${name}`);
  }
});

test("new untracked DSH SQL migration affects its owner, not Identity", () => {
  const projects = affected("services/dsh/database/migrations/999_future_order_test.sql");
  assert.ok(projects.has("dsh-backend"));
  assert.ok(!projects.has("identity-backend"));
});

test("new Merchant Feature changes only its own app", () => {
  const projects = affected("apps/merchant/src/features/catalog/new-product-editor.tsx");
  assert.ok(projects.has("@bthwani/merchant"));
  assert.ok(!projects.has("@bthwani/customer"));
});

test("Windows command separators inside --files remain literal file data", () => {
  const projects = affected("apps/merchant/src/features/catalog/new-file & echo NX_INJECTION > bad.txt");
  assert.ok(projects.has("@bthwani/merchant"));
});

test("dependency security gate stays strict while independent Nx proof survives audit failure", () => {
  const workflow = YAML.parse(readFileSync(path.join(root, ".github", "workflows",
    "dependency-nx-safety.yml"), "utf8"));
  const steps = workflow.jobs.dependency_and_boundaries.steps;
  const findStep = (name) => steps.find((step) => step.name === name);
  const install = findStep("Install pinned workspace without lifecycle scripts");
  const audit = findStep("Audit all JavaScript dependencies (high and critical fail)");
  assert.equal(install.id, "workspace");
  assert.ok(steps.indexOf(install) < steps.indexOf(audit));
  assert.equal(audit.run, "pnpm audit --audit-level high");
  assert.equal(audit["continue-on-error"], undefined, "Audit failure must fail the job");

  const afterAudit = "${{ !cancelled() && steps.workspace.outcome == 'success' }}";
  for (const name of [
    "Verify Nx dependency graph builds",
    "Prove actual Nx contract, Go, design and renderer impact edges",
    "Enforce existing application and service import boundaries",
  ]) {
    const step = findStep(name);
    assert.ok(steps.indexOf(step) > steps.indexOf(audit), name);
    assert.equal(step.if, afterAudit, name);
  }
  assert.equal(findStep("Report affected projects for pull requests").if,
    "${{ !cancelled() && steps.workspace.outcome == 'success' && github.event_name == 'pull_request' }}");
});
