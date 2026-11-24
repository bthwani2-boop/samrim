import assert from "node:assert/strict";
import test from "node:test";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("hr: routes have the expected navigation permission boundary", () => {
  for (const path of ["/hr","/hr/employees/abc"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "hr");
  }
});

test("hr: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "hr"), false);
  assert.equal(canShowNavigation(true, [], "hr"), false);
});


// Exercise the actual server component through the installed Next/SWC and React
// renderer. Only the owner boundary is substituted; no fixture is a live E2E.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { DshPublicError, isCompanyEmployeeId } from "@bthwani/dsh";

const requirePanel = createRequire(new URL("../../../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const jsxRuntime = requirePanel("react/jsx-runtime");
const { renderToStaticMarkup } = requirePanel("react-dom/server");
const component = transformSync(readFileSync(new URL("./employee-detail.tsx", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

const employeeId = "00000000-0000-4000-8000-000000000001";
const record = { id: employeeId, displayName: "HR-private-employee", department: "Operations",
  jobTitle: "Coordinator", startDate: "2026-11-20", endDate: null };
const audit = { employeeId, registeredByActorId: "HR-private-author", recordedAt: "2026-11-24T01:00:00Z" };

async function renderDetail({ event = audit, employee = record, status = "available" } = {}) {
  const calls = [];
  const mod = { exports: {} };
  const result = async (name, value, id) => {
    assert.equal(id, employeeId);
    calls.push(name);
    if (value instanceof Error) throw value;
    return value;
  };
  const dependencies = {
    "@bthwani/dsh": { DshPublicError, isCompanyEmployeeId,
      getCompanyEmployeeRegistrationAudit: (_origin, _bearer, id) => result("audit", event, id),
      getCompanyEmployee: (_origin, _bearer, id) => result("detail", employee, id) },
    "./employee-owner": { employeeOwner: async () => ({ status, origin: "http://127.0.0.1:3202", bearer: "synthetic" }) },
    "../operator-shell/operator-shell.module.css": { workspace: "workspace" },
    "../operator-shell/workspace-unavailable": () => jsxRuntime.jsx("p", { children: "owner denied" }),
    "./employees.module.css": { details: "details" },
    "react/jsx-runtime": jsxRuntime,
  };
  new Function("require", "module", "exports", component)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, mod, mod.exports);
  const html = renderToStaticMarkup(await mod.exports.default({ id: employeeId }));
  return { html, calls };
}

test("employee detail displays the exact attributed event only after the final verified employee read", async () => {
  const { html, calls } = await renderDetail();
  assert.deepEqual(calls, ["audit", "detail"]);
  assert.match(html, /HR-private-employee/);
  assert.match(html, /HR-private-author/);
  assert.match(html, /2026-11-24T01:00:00Z/);
});

test("employee detail does not disclose either record when HR is revoked between reads", async () => {
  for (const state of [
    { event: new DshPublicError(403, "EMPLOYEE_SCOPE_FORBIDDEN") },
    { employee: new DshPublicError(401, "UNAUTHENTICATED") },
    { status: "denied" },
  ]) {
    const { html } = await renderDetail(state);
    assert.doesNotMatch(html, /HR-private-employee|HR-private-author/);
  }
});

test("an old or unavailable audit operation preserves independently authorized employee detail without fabricating an event", async () => {
  for (const event of [
    new DshPublicError(404, "STORE_OPERATION_FAILED"),
    new DshPublicError(404, "EMPLOYEE_NOT_FOUND"),
    new DshPublicError(503, "OWNER_UNAVAILABLE"),
  ]) {
    const { html, calls } = await renderDetail({ event });
    assert.deepEqual(calls, ["audit", "detail"]);
    assert.match(html, /HR-private-employee/);
    assert.doesNotMatch(html, /HR-private-author/);
    assert.match(html, /role="status"/);
  }
});
