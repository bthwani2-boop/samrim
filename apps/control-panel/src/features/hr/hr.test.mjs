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
import * as dsh from "@bthwani/dsh";

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


const registrationComponent = transformSync(readFileSync(new URL("./employee-registration.tsx", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022", transform: { react: { runtime: "automatic" } } },
  module: { type: "commonjs" },
}).code;
const registrationAction = transformSync(readFileSync(new URL("./register-employee-action.ts", import.meta.url), "utf8"), {
  jsc: { parser: { syntax: "typescript" }, target: "es2022" }, module: { type: "commonjs" },
}).code;
const employeeDraft = { displayName: "Synthetic Employee", department: "Operations", jobTitle: "Coordinator", startDate: "2026-11-25" };
const makeForm = values => {
  const form = new FormData();
  for (const [name, value] of Object.entries(values)) form.set(name, value);
  return form;
};
function findRegistrationNode(node, predicate) {
  if (Array.isArray(node)) return node.map(child => findRegistrationNode(child, predicate)).find(Boolean);
  if (!node || typeof node !== "object") return undefined;
  return predicate(node) ? node : findRegistrationNode(node.props?.children, predicate);
}

async function waitForRegistration(predicate) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail("Employee registration did not settle");
}
async function exerciseRegistration(scenario, { storage = new Map(), actorId = "operator-a" } = {}) {
  const hooks = [], calls = [], responses = [], destinations = [];
  let index = 0;
  const jsx = (type, props) => ({ type, props });
  const react = {
    useEffect(fn) { const at = index++; if (!(at in hooks)) hooks[at] = fn(); },
    useRef(value) { const at = index++; hooks[at] ??= { current: value }; return hooks[at]; },
    useState(initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], value => { hooks[at] = typeof value === "function" ? value(hooks[at]) : value; }];
    },
    useActionState(fn, initial) {
      const at = index++;
      if (!(at in hooks)) hooks[at] = initial;
      return [hooks[at], async form => { hooks[at] = await fn(hooks[at], form); }, false];
    },
  };
  const original = globalThis.window;
  globalThis.window = { crypto: globalThis.crypto, location: { assign: value => destinations.push(value) },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    navigator: { locks: { request: (_key, action) => action() } },
  };
  const mod = { exports: {} };
  try {
    new Function("require", "module", "exports", registrationComponent)(name => ({
      react, "react/jsx-runtime": { jsx, jsxs: jsx }, "./employees.module.css": {}, "@bthwani/dsh": dsh,
    })[name], mod, mod.exports);
    const submit = (id, form) => {
      calls.push({ id, fields: Object.fromEntries(form) });
      return new Promise((resolve, reject) => responses.push({ resolve, reject }));
    };
    const render = () => { index = 0; return mod.exports.default({ actorId, submit }); };
    const input = (name, tree = render()) => findRegistrationNode(tree, node => node.type === "input" && node.props.name === name);
    const edit = (name, value, tree = render()) => input(name, tree).props.onChange({ target: { value } });
    await waitForRegistration(() => findRegistrationNode(render(), node => node.type === "fieldset")?.props.disabled === false);
    for (const [name, value] of Object.entries(employeeDraft)) edit(name, value);
    const send = (tree = render(), values = employeeDraft) => tree.props.onSubmit
      ? tree.props.onSubmit({ preventDefault() {} })
      : tree.props.action(makeForm(values));
    const reply = async result => { await waitForRegistration(() => responses.length > 0); responses.shift().resolve(result); };
    const reject = async () => { await waitForRegistration(() => responses.length > 0); responses.shift().reject(new TypeError("synthetic transport loss")); };
    await scenario({ render, input, edit, send, reply, reject, calls, destinations, storage });
  } finally {
    for (const entry of responses.splice(0)) entry.resolve({ status: "invalid", message: "invalid" });
    if (original === undefined) delete globalThis.window; else globalThis.window = original;
  }
}

test("company registration retries an unknown result with the immutable original payload and ID", async () => {
  await exerciseRegistration(async ({ render, input, edit, send, reply, calls }) => {
    const first = send();
    reply({ status: "unknown", message: "unknown" }); await first;
    edit("displayName", "Different Employee");
    const again = send(render(), { ...employeeDraft, displayName: "Different Employee" });
    reply({ status: "unknown", message: "unknown" }); await again;
    assert.deepEqual(calls[1], calls[0]);
    assert.equal(input("displayName").props.value, employeeDraft.displayName);
    assert.equal(input("displayName").props.readOnly, true);
  });
});

test("company registration permits correction and a new operation only after a definite first rejection", async () => {
  await exerciseRegistration(async ({ edit, send, reply, calls }) => {
    const first = send();
    reply({ status: "invalid", message: "invalid" }); await first;
    edit("displayName", "Corrected Employee");
    const next = send(undefined, { ...employeeDraft, displayName: "Corrected Employee" });
    reply({ status: "invalid", message: "invalid" }); await next;
    assert.notEqual(calls[0].id, calls[1].id);
    assert.equal(calls[1].fields.displayName, "Corrected Employee");
  });
});

test("company registration is single-flight and revocation clears the private draft and blocks stale submits", async () => {
  await exerciseRegistration(async ({ render, input, send, reply, calls }) => {
    const view = render();
    const first = send(view), duplicate = send(view);
    await waitForRegistration(() => calls.length === 1);
    assert.equal(calls.length, 1);
    reply({ status: "denied", message: "denied" });
    await first; await duplicate;
    assert.equal(input("displayName")?.props.value ?? "", "");
    await send(view);
    assert.equal(calls.length, 1);
  });
});

test("company registration keeps an unknown request locked after a subsequent validation response", async () => {
  await exerciseRegistration(async ({ send, reject, reply, edit, input, calls }) => {
    const first = send();
    reject(); await first;
    const retry = send();
    reply({ status: "invalid", message: "invalid" }); await retry;
    edit("displayName", "New Employee");
    assert.equal(input("displayName").props.readOnly, true);
    assert.deepEqual(calls[0], calls[1]);
  });
});

test("company registration navigates only on a confirmed owner ID and never repeats a confirmed operation", async () => {
  await exerciseRegistration(async ({ render, send, reply, calls, destinations }) => {
    const view = render();
    const first = send(view);
    reply({ status: "confirmed", id: employeeId, message: "confirmed" }); await first;
    assert.deepEqual(destinations, [`/hr/employees/${employeeId}`]);
    await send(view);
    assert.equal(calls.length, 1);
  });
});

async function runRegistrationAction({ outcome, owner = { status: "available", actorId: "operator-a", origin: "http://127.0.0.1:3202", bearer: "synthetic" } }) {
  const calls = [], mod = { exports: {} };
  new Function("require", "module", "exports", registrationAction)(name => ({
    "@bthwani/dsh": { ...dsh, registerCompanyEmployee: async (_origin, _bearer, input) => {
      calls.push(input); if (outcome instanceof Error) throw outcome; return outcome;
    } },
    "next/navigation": { redirect: () => { throw new Error("unexpected redirect"); } },
    "./employee-owner": { employeeOwner: async () => owner },
  })[name], mod, mod.exports);
  const result = await mod.exports.registerEmployee("operator-a", employeeId, makeForm(employeeDraft));
  return { result, calls };
}

test("registration action distinguishes definite rejection, authority denial, conflict and unknown owner outcomes", async () => {
  for (const [error, status] of [
    [new DshPublicError(400, "EMPLOYEE_REGISTRATION_INVALID"), "invalid"],
    [new DshPublicError(401, "UNAUTHENTICATED"), "denied"],
    [new DshPublicError(403, "EMPLOYEE_SCOPE_FORBIDDEN"), "denied"],
    [new DshPublicError(409, "EMPLOYEE_CONFLICT"), "conflict"],
    [new DshPublicError(503, "OPERATION_RESULT_UNKNOWN"), "unknown"],
    [new TypeError("connection lost"), "unknown"],
  ]) {
    const { result, calls } = await runRegistrationAction({ outcome: error });
    assert.equal(result.status, status);
    assert.equal(calls.length, 1);
  }
  const denied = await runRegistrationAction({ owner: { status: "available", actorId: "operator-b" }, outcome: employeeId });
  assert.equal(denied.result.status, "denied");
  assert.deepEqual(denied.calls, []);
  const confirmed = await runRegistrationAction({ outcome: employeeId });
  assert.equal(confirmed.result.status, "confirmed");
  assert.equal(confirmed.result.id, employeeId);
  assert.deepEqual(confirmed.calls, [{ operationId: employeeId, ...employeeDraft }]);
});


test("a conflicted company registration stays locked and cannot issue a new operation", async () => {
  await exerciseRegistration(async ({ render, input, edit, send, reply, calls }) => {
    const first = send();
    reply({ status: "conflict", message: "conflict" }); await first;
    edit("displayName", "Another Employee");
    assert.equal(input("displayName").props.value, employeeDraft.displayName);
    assert.equal(input("displayName").props.readOnly, true);
    assert.equal(findRegistrationNode(render(), node => node.type === "fieldset").props.disabled, true);
    await send();
    assert.equal(calls.length, 1);
  });
});


test("company registration survives session denial and remount without raw employee storage", async () => {
  const storage = new Map();
  let original;
  await exerciseRegistration(async ({ send, reply, calls, input }) => {
    const first = send();
    await reply({ status: "unknown", message: "unknown" }); await first;
    original = calls[0];
    const retry = send();
    await reply({ status: "denied", message: "denied" }); await retry;
    assert.deepEqual(calls[1], original);
    assert.equal(input("displayName")?.props.value ?? "", "");
  }, { storage });
  assert.equal(storage.size, 1);
  assert.doesNotMatch([...storage.values()][0], /Synthetic Employee|Operations|Coordinator|2026-11-25|operator-a/);
  await exerciseRegistration(async ({ edit, send, reply, calls, render }) => {
    edit("displayName", "Different Employee");
    await send();
    assert.equal(calls.length, 0, "recovered identity cannot be used with different fields");
    edit("displayName", employeeDraft.displayName);
    assert.equal(findRegistrationNode(render(), node => node.type === "p" && node.props.role === "alert"), undefined);
    const retry = send();
    await reply({ status: "confirmed", id: employeeId, message: "confirmed" }); await retry;
    assert.deepEqual(calls[0], original);
  }, { storage });
  assert.equal(JSON.parse([...storage.values()][0]).settled, true);
});

test("company registration clears a definitive validation message when its draft changes", async () => {
  await exerciseRegistration(async ({ send, reply, edit, render }) => {
    const first = send();
    await reply({ status: "invalid", message: "invalid" }); await first;
    assert.ok(findRegistrationNode(render(), node => node.type === "p" && node.props.role === "alert"));
    edit("displayName", "Corrected Employee");
    assert.equal(findRegistrationNode(render(), node => node.type === "p" && node.props.role === "alert"), undefined);
  });
});
