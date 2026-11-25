import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DshPublicError, getCompanyEmployee, getCompanyEmployeeRegistrationAudit, isCompanyEmployeeId,
  listCompanyEmployees, registerCompanyEmployee,
} from "./index.ts";

const owner = "http://127.0.0.1:3202";
const token = "synthetic-test-session";
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const employee = index => ({
  id: id(index), displayName: `Employee ${index}`, department: "Operations",
  jobTitle: "Coordinator", startDate: "2026-11-20", endDate: null,
});
const json = (body, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
async function rejects(call, status, code) {
  await assert.rejects(call, error =>
    error instanceof DshPublicError && error.status === status && error.code === code);
}

test("employee IDs are canonical UUIDs, not path or query fragments", () => {
  assert.equal(isCompanyEmployeeId(id(1)), true);
  for (const bad of [null, {}, "../private", id(1).replace("4000", "4abc").toUpperCase(), `${id(1)}?all=true`]) {
    assert.equal(isCompanyEmployeeId(bad), false);
  }
});

test("employee pagination uses authorized, uncached DSH reads and preserves exact cursor", async t => {
  const items = Array.from({ length: 30 }, (_, index) => employee(index + 1));
  const captured = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    captured.push({ url: new URL(url), options });
    return json({ items, nextCursor: items.at(-1).id });
  });
  assert.deepEqual(await listCompanyEmployees(owner, token, id(0)), {
    items, nextCursor: items.at(-1).id,
  });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url.pathname, "/v1/operators/employees");
  assert.equal(captured[0].url.searchParams.get("cursor"), id(0));
  assert.equal(captured[0].options.method, "GET");
  assert.equal(captured[0].options.redirect, "error");
  assert.equal(captured[0].options.credentials, "omit");
  assert.equal(captured[0].options.cache, "no-store");
  assert.equal(captured[0].options.headers.Authorization, `Bearer ${token}`);
});

test("employee list fails closed on unscoped, reordered or malformed owner rows", async t => {
  let data = { items: [employee(1)], nextCursor: null };
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return json(data); });
  for (const bad of [
    { items: [employee(2), employee(1)], nextCursor: null },
    { items: [employee(1), employee(1)], nextCursor: null },
    { items: [{ ...employee(1), privateSalaryYer: 5000 }], nextCursor: null },
    { items: [{ ...employee(1), startDate: "2026-02-30" }], nextCursor: null },
    { items: [{ ...employee(1), endDate: "2026-11-19" }], nextCursor: null },
    { items: [employee(1)] },
    { items: [employee(1)], nextCursor: id(1) },
    { items: [], nextCursor: id(1) },
    { items: [employee(1)], nextCursor: null, secret: "hidden" },
  ]) {
    data = bad;
    await rejects(() => listCompanyEmployees(owner, token), 502, "OWNER_RESPONSE_INVALID");
  }
  await rejects(() => listCompanyEmployees(owner, token, "../private"), 400, "EMPLOYEE_QUERY_INVALID");
  assert.equal(calls, 9, "invalid cursors must never dispatch a request");
});

test("individual employee lookup validates path, identity, owner scope and 403", async t => {
  let response = json(employee(1));
  const paths = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    paths.push(new URL(url).pathname);
    assert.equal(options.credentials, "omit");
    return response;
  });
  assert.deepEqual(await getCompanyEmployee(owner, token, id(1)), employee(1));
  assert.deepEqual(paths, [`/v1/operators/employees/${id(1)}`]);
  response = json(employee(2));
  await rejects(() => getCompanyEmployee(owner, token, id(1)), 502, "OWNER_RESPONSE_INVALID");
  response = json({ code: "EMPLOYEE_FORBIDDEN" }, 403);
  await rejects(() => getCompanyEmployee(owner, token, id(1)), 403, "EMPLOYEE_FORBIDDEN");
  await rejects(() => getCompanyEmployee(owner, token, "other/employee"), 400, "EMPLOYEE_QUERY_INVALID");
  assert.equal(paths.length, 3);
});

test("registration audit reads only the selected employee and rejects unsafe owner output", async t => {
  const audit = { employeeId: id(1), registeredByActorId: "operator-a", recordedAt: "2026-11-24T01:00:00.123456Z" };
  let response = json(audit);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, `/v1/operators/employees/${id(1)}/registration-audit`);
    assert.equal(new URL(url).search, "");
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.cache, "no-store");
    return response;
  });
  assert.deepEqual(await getCompanyEmployeeRegistrationAudit(owner, token, id(1)), audit);
  for (const invalid of [
    { ...audit, employeeId: id(2) }, { ...audit, registeredByActorId: "" },
    { ...audit, recordedAt: "2026-02-30T01:00:00Z" }, { ...audit, requestHash: "hidden" },
  ]) {
    response = json(invalid);
    await rejects(() => getCompanyEmployeeRegistrationAudit(owner, token, id(1)), 502, "OWNER_RESPONSE_INVALID");
  }
  response = json({ code: "EMPLOYEE_SCOPE_FORBIDDEN" }, 403);
  await rejects(() => getCompanyEmployeeRegistrationAudit(owner, token, id(1)), 403, "EMPLOYEE_SCOPE_FORBIDDEN");
  response = json({ code: "EMPLOYEE_NOT_FOUND" }, 404);
  await rejects(() => getCompanyEmployeeRegistrationAudit(owner, token, id(1)), 404, "EMPLOYEE_NOT_FOUND");
  await rejects(() => getCompanyEmployeeRegistrationAudit(owner, token, "../other"), 400, "EMPLOYEE_QUERY_INVALID");
  assert.equal(calls, 7);
});

test("employee registration sends one idempotent authenticated write and validates the owner result", async t => {
  const input = { operationId: id(10), displayName: "Nadia",
    department: "Support", jobTitle: "Agent", startDate: "2026-11-20" };
  const calls = [];
  let response = json({ id: id(20) });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ pathname: new URL(url).pathname, options });
    return response;
  });
  assert.equal(await registerCompanyEmployee(owner, token, input), id(20));
  assert.equal(calls[0].pathname, "/v1/operators/employees");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), input);
  response = json({ id: id(20), actorId: "not-an-admission" });
  await rejects(() => registerCompanyEmployee(owner, token, input), 502, "OPERATION_RESULT_UNKNOWN");
  response = json({ code: "EMPLOYEE_CONFLICT" }, 409);
  await rejects(() => registerCompanyEmployee(owner, token, input), 409, "EMPLOYEE_CONFLICT");
  for (const bad of [
    { ...input, operationId: "new-key" },
    { ...input, displayName: "" },
    { ...input, startDate: "2026-02-30" },
  ]) {
    await rejects(() => registerCompanyEmployee(owner, token, bad), 400, "EMPLOYEE_REGISTRATION_INVALID");
  }
  assert.equal(calls.length, 3, "invalid registration is rejected before dispatch");
});

test("unconfirmed employee writes do not retry or report success on network loss and 503", async t => {
  let failMode = "network";
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    if (failMode === "network") throw new Error("lost response after commit");
    return json({ code: "OWNER_UNAVAILABLE" }, 503);
  });
  const input = { operationId: id(11), displayName: "Nadia",
    department: "Support", jobTitle: "Agent", startDate: "2026-11-20" };
  await rejects(() => registerCompanyEmployee(owner, token, input), 0, "OPERATION_RESULT_UNKNOWN");
  failMode = "server";
  await rejects(() => registerCompanyEmployee(owner, token, input), 503, "OPERATION_RESULT_UNKNOWN");
  assert.equal(calls, 2, "each explicit submission dispatches exactly one write");
});


test("Merchant employee API preserves exact Store scope and reuses employee validation", async t => {
  const input = { operationId: id(10), displayName: "Nadia", department: "Support", jobTitle: "Agent", startDate: "2026-11-20" };
  const paths = [];
  const audit = { employeeId:id(1), registeredByActorId:"merchant-a", recordedAt:"2026-11-24T01:00:00Z" };
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const path = new URL(url).pathname;
    paths.push(path);
    assert.equal(options.headers.Authorization, "Bearer " + token);
    assert.equal(options.cache,"no-store");
    if (options.method === "POST") {
      assert.deepEqual(JSON.parse(options.body),input);
      return json({id:id(1)});
    }
    if (path.endsWith("/registration-audit")) return json(audit);
    if (path.endsWith("/"+id(1))) return json(employee(1));
    return json({items:[employee(1)],nextCursor:null});
  });
  const { listMerchantEmployees, getMerchantEmployee, registerMerchantEmployee, getMerchantEmployeeRegistrationAudit } = await import("./employees.ts");
  assert.deepEqual(await listMerchantEmployees(owner,token,"store-a"),{items:[employee(1)],nextCursor:null});
  assert.deepEqual(await getMerchantEmployee(owner,token,"store-a",id(1)),employee(1));
  assert.deepEqual(await getMerchantEmployeeRegistrationAudit(owner,token,"store-a",id(1)),audit);
  assert.equal(await registerMerchantEmployee(owner,token,"store-a",input),id(1));
  await rejects(()=>listMerchantEmployees(owner,token,"../other"),400,"EMPLOYEE_QUERY_INVALID");
  await rejects(()=>registerMerchantEmployee(owner,token,"store-a",{...input,employerId:"merchant-b"}),400,"EMPLOYEE_REGISTRATION_INVALID");
  assert.deepEqual(paths,["/v1/stores/store-a/employees","/v1/stores/store-a/employees/"+id(1),"/v1/stores/store-a/employees/"+id(1)+"/registration-audit","/v1/stores/store-a/employees"]);
});


// Both renderer hosts use this public DSH recovery protocol. A shared storage
// generation is retained after settlement to invalidate stale tabs.
test("employee recovery normalizes payload, preserves legacy pending identity, and isolates actors and employers", async () => {
  const dsh = await import("./index.ts");
  assert.equal(typeof dsh.openEmployeeRegistrationRecovery, "function", "shared recovery API is missing");
  const { createHash, randomUUID } = await import("node:crypto");
  const records = new Map();
  const port = {
    read: async key => records.get(key) ?? null,
    write: async (key, value) => { records.set(key, value); },
    lock: async (_key, action) => action(),
    digest: async text => createHash("sha256").update(text).digest("hex"),
    randomUUID,
  };
  const fields = { displayName: " Employee ", department: "Operations", jobTitle: "Coordinator", startDate: "2026-11-20" };
  const normalized = { ...fields, displayName: "Employee" };
  const first = await dsh.openEmployeeRegistrationRecovery(port, "merchant", "actor-a");
  const legacyKey = "bthwani.merchant.employee-attempt." + await port.digest(JSON.stringify(["actor-a", "employee-registration"]));
  assert.equal(first.key, legacyKey);
  const fingerprint = await port.digest(JSON.stringify(Object.values(normalized)));
  records.set(legacyKey, JSON.stringify({ fingerprint, operationId: id(1) }));
  const reopened = await dsh.openEmployeeRegistrationRecovery(port, "merchant", "actor-a");
  const claim = await dsh.claimEmployeeRegistration(port, reopened, fields);
  assert.equal(claim.status, "claimed");
  assert.equal(claim.replay, true);
  assert.deepEqual(claim.input, { ...normalized, operationId: id(1) });
  assert.equal((await dsh.claimEmployeeRegistration(port, claim.recovery, { ...fields, displayName: "Different" })).status, "mismatch");
  for (const [surface, actor] of [["company", "actor-a"], ["merchant", "actor-b"]]) {
    const other = await dsh.openEmployeeRegistrationRecovery(port, surface, actor);
    assert.notEqual(other.key, legacyKey);
    assert.equal(other.attempt, null);
  }
  assert.doesNotMatch(records.get(legacyKey), /Employee|Operations|Coordinator|2026-11-20|actor-a/);
});

test("employee recovery serializes claims and rejects stale tabs even after owner confirmation", async () => {
  const dsh = await import("./index.ts");
  assert.equal(typeof dsh.claimEmployeeRegistration, "function", "shared claim API is missing");
  const { createHash, randomUUID } = await import("node:crypto");
  const records = new Map();
  let queue = Promise.resolve();
  const port = {
    read: async key => records.get(key) ?? null,
    write: async (key, value) => { records.set(key, value); },
    lock: (_key, action) => { const result = queue.then(action); queue = result.then(() => {}, () => {}); return result; },
    digest: async text => createHash("sha256").update(text).digest("hex"),
    randomUUID,
  };
  const draft = { displayName: "Employee", department: "Operations", jobTitle: "Coordinator", startDate: "2026-11-20" };
  const initial = await dsh.openEmployeeRegistrationRecovery(port, "company", "actor-a");
  const [one, two] = await Promise.all([dsh.claimEmployeeRegistration(port, initial, draft), dsh.claimEmployeeRegistration(port, initial, draft)]);
  assert.equal(one.status, "claimed");
  assert.equal(two.status, "changed");
  const settled = await dsh.settleEmployeeRegistration(port, one.recovery, "confirmed", one.replay);
  assert.equal(settled.attempt.settled, true);
  assert.equal((await dsh.claimEmployeeRegistration(port, initial, draft)).status, "changed");
  const next = await dsh.claimEmployeeRegistration(port, settled, draft);
  assert.equal(next.status, "claimed");
  assert.notEqual(next.input.operationId, one.input.operationId);
  const uncertain = await dsh.settleEmployeeRegistration(port, next.recovery, "denied", next.replay);
  assert.deepEqual(uncertain, next.recovery);
  const resumed = await dsh.openEmployeeRegistrationRecovery(port, "company", "actor-a");
  const replay = await dsh.claimEmployeeRegistration(port, resumed, draft);
  assert.equal(replay.input.operationId, next.input.operationId);
  assert.deepEqual(await dsh.settleEmployeeRegistration(port, replay.recovery, "invalid", true), replay.recovery);
  records.set(initial.key, JSON.stringify({ fingerprint: "bad", operationId: id(1) }));
  await assert.rejects(dsh.openEmployeeRegistrationRecovery(port, "company", "actor-a"), /recovery/i);
});


test("employee recovery does not persist a new attempt when cancelled during the locked read", async () => {
  const { openEmployeeRegistrationRecovery, claimEmployeeRegistration } = await import("./index.ts");
  const { createHash, randomUUID } = await import("node:crypto");
  const controller = new AbortController();
  const records = new Map();
  let abortOnRead = false;
  const port = {
    read: async key => {
      if (abortOnRead) controller.abort();
      return records.get(key) ?? null;
    },
    write: async (key, value) => { records.set(key, value); },
    lock: async (_key, action) => action(),
    digest: async text => createHash("sha256").update(text).digest("hex"),
    randomUUID,
  };
  const draft = { displayName: "Employee", department: "Operations", jobTitle: "Coordinator", startDate: "2026-11-20" };
  const recovery = await openEmployeeRegistrationRecovery(port, "merchant", "actor-a");
  abortOnRead = true;
  await assert.rejects(claimEmployeeRegistration(port, recovery, draft, controller.signal), { name: "AbortError" });
  assert.equal(records.size, 0, "cancelled read must not create a pending operation");
  abortOnRead = false;
  const reopened = await openEmployeeRegistrationRecovery(port, "merchant", "actor-a");
  const next = await claimEmployeeRegistration(port, reopened, { ...draft, displayName: "Corrected" });
  assert.equal(next.status, "claimed");
  assert.equal(next.replay, false);
});

test("employee recovery retains an opaque attempt when cancellation occurs during persistence", async () => {
  const { openEmployeeRegistrationRecovery, claimEmployeeRegistration } = await import("./index.ts");
  const { createHash, randomUUID } = await import("node:crypto");
  const controller = new AbortController();
  const records = new Map();
  const port = {
    read: async key => records.get(key) ?? null,
    write: async (key, value) => { records.set(key, value); controller.abort(); },
    lock: async (_key, action) => action(),
    digest: async text => createHash("sha256").update(text).digest("hex"),
    randomUUID,
  };
  const draft = { displayName: "Employee", department: "Operations", jobTitle: "Coordinator", startDate: "2026-11-20" };
  const recovery = await openEmployeeRegistrationRecovery(port, "merchant", "actor-a");
  await assert.rejects(claimEmployeeRegistration(port, recovery, draft, controller.signal), { name: "AbortError" });
  const reopened = await openEmployeeRegistrationRecovery(port, "merchant", "actor-a");
  assert.ok(reopened.attempt);
  assert.equal((await claimEmployeeRegistration(port, reopened, { ...draft, displayName: "Different" })).status, "mismatch");
  const replay = await claimEmployeeRegistration(port, reopened, draft);
  assert.equal(replay.status, "claimed");
  assert.equal(replay.replay, true);
  assert.equal(replay.input.operationId, reopened.attempt.operationId);
});

test("registration outcomes retire only a verified validation rejection, not an arbitrary HTTP 400", async () => {
  const { employeeRegistrationErrorOutcome } = await import("./index.ts");
  assert.equal(employeeRegistrationErrorOutcome(new DshPublicError(400, "EMPLOYEE_REGISTRATION_INVALID")), "invalid");
  assert.equal(employeeRegistrationErrorOutcome(new DshPublicError(400, "OWNER_RESPONSE_INVALID")), "unknown");
  assert.equal(employeeRegistrationErrorOutcome(new DshPublicError(400, "EMPLOYEE_QUERY_INVALID")), "unknown");
  assert.equal(employeeRegistrationErrorOutcome(new DshPublicError(401, "UNAUTHENTICATED")), "denied");
  assert.equal(employeeRegistrationErrorOutcome(new DshPublicError(409, "EMPLOYEE_CONFLICT")), "conflict");
  assert.equal(employeeRegistrationErrorOutcome(new DshPublicError(503, "OPERATION_RESULT_UNKNOWN")), "unknown");
});
