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
