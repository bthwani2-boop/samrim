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

const directoryComponent = transformSync(readFileSync(new URL("./employees-workspace.tsx", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
    transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;

async function renderDirectory({ cursor, failure, status = "available" } = {}) {
  const calls = [];
  const mod = { exports: {} };
  const dependencies = {
    "@bthwani/dsh": { DshPublicError, isCompanyEmployeeId,
      listCompanyEmployees: async (_origin, _bearer, requestedCursor) => {
        calls.push(requestedCursor);
        if (failure) throw failure;
        return { items: [record], nextCursor: null };
      } },
    "./employee-owner": { employeeOwner: async () => ({ status, origin: "http://127.0.0.1:3202", bearer: "synthetic", actorId: "synthetic-operator" }) },
    "../operator-shell/operator-shell.module.css": { workspace: "workspace" },
    "../operator-shell/workspace-unavailable": ({ owner }) => jsxRuntime.jsx("p", { children: `unavailable:${owner}` }),
    "./employee-registration": () => jsxRuntime.jsx("p", { children: "registration form" }),
    "./register-employee-action": { registerEmployee: () => { throw new Error("unexpected registration"); } },
    "./employees.module.css": { table: "table", tableScroll: "scroll", pagination: "pagination" },
    "react/jsx-runtime": jsxRuntime,
  };
  new Function("require", "module", "exports", directoryComponent)(name => {
    assert.ok(Object.hasOwn(dependencies, name), name);
    return dependencies[name];
  }, mod, mod.exports);
  const html = renderToStaticMarkup(await mod.exports.default({ searchParams: Promise.resolve(cursor === undefined ? {} : { cursor }) }));
  return { html, calls };
}

test("failed authorized employee continuation returns to the first page without disclosing records", async () => {
  for (const failure of [new DshPublicError(503, "OWNER_UNAVAILABLE"), new DshPublicError(502, "OWNER_RESPONSE_INVALID")]) {
    const { html, calls } = await renderDirectory({ cursor: employeeId, failure });
    assert.deepEqual(calls, [employeeId]);
    assert.match(html, /role="alert"/);
    assert.match(html, /href="\/hr\/employees"/);
    assert.doesNotMatch(html, /HR-private-employee|registration form/);
  }
});

test("employee continuation never turns authorization denial into available HR actions", async () => {
  for (const failure of [new DshPublicError(401, "UNAUTHENTICATED"), new DshPublicError(403, "EMPLOYEE_SCOPE_FORBIDDEN")]) {
    const { html, calls } = await renderDirectory({ cursor: employeeId, failure });
    assert.deepEqual(calls, [employeeId]);
    assert.match(html, /unavailable:Identity/);
    assert.doesNotMatch(html, /href="\/hr\/employees"|HR-private-employee|registration form/);
  }
  const { html, calls } = await renderDirectory({ cursor: employeeId, status: "denied" });
  assert.deepEqual(calls, []);
  assert.match(html, /unavailable:Identity/);
  assert.doesNotMatch(html, /HR-private-employee|registration form/);
});

test("first-page owner outage remains unavailable and malformed cursor never reaches DSH", async () => {
  const outage = await renderDirectory({ failure: new DshPublicError(503, "OWNER_UNAVAILABLE") });
  assert.deepEqual(outage.calls, [undefined]);
  assert.match(outage.html, /unavailable:DSH/);
  assert.doesNotMatch(outage.html, /HR-private-employee|registration form/);
  const malformed = await renderDirectory({ cursor: "invalid" });
  assert.deepEqual(malformed.calls, []);
  assert.match(malformed.html, /href="\/hr\/employees"/);
  const success = await renderDirectory();
  assert.match(success.html, /HR-private-employee/);
  assert.match(success.html, /registration form/);
});
