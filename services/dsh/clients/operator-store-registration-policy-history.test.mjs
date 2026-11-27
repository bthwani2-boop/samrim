import assert from "node:assert/strict";
import { test } from "node:test";
import { DshPublicError } from "./client-core.ts";
import { isStoreRegistrationPolicyHistoryPage, listOperatorStoreRegistrationPolicyHistory } from "./operator-store-registration-policy-history.ts";

const origin = "http://127.0.0.1:33222";
const bearer = Buffer.alloc(32, 8).toString("base64url");
const row = (version, enabled = true) => ({
  version, enabled, termsVersion: "merchant-terms-v1",
  changedByActor: "operator-a", changeReason: "Reviewed policy change",
  updatedAt: "2026-11-23T10:00:00Z",
});
const page = { entries: [row(3), row(2, false)], nextBeforeVersion: "2" };
const reply = body => Response.json(body, { headers: { "Cache-Control": "no-store" } });

test("history accepts bounded descending audit including maximum safe version", () => {
  assert.equal(isStoreRegistrationPolicyHistoryPage(page, 2), true);
  assert.equal(isStoreRegistrationPolicyHistoryPage({ entries: [] }), true);
  assert.equal(isStoreRegistrationPolicyHistoryPage({ entries: [row(1)] }, 1), true);
  assert.equal(isStoreRegistrationPolicyHistoryPage({ entries: [row(Number.MAX_SAFE_INTEGER)] }, 1), true);
});

test("history rejects malformed rows and impossible continuation", () => {
  for (const bad of [
    null, [], { entries: "not-an-array" }, { entries: [null] },
    { entries: [row(2), row(3)] }, { entries: [row(2), row(2)] },
    { entries: [row(3), row(2), row(1)] }, { entries: [row(0)] },
    { entries: [row(Number.MAX_SAFE_INTEGER + 1)] },
    { entries: [row(2), { ...row(1), token: "leak" }] },
    { entries: [row(2), { ...row(1), version: "1" }] },
    { entries: [{ ...row(1), enabled: "true" }] },
    { entries: [{ ...row(1), termsVersion: "../bad" }] },
    { entries: [{ ...row(1), changedByActor: "" }] },
    { entries: [{ ...row(1), changedByActor: "x".repeat(129) }] },
    { entries: [{ ...row(1), changeReason: "" }] },
    { entries: [{ ...row(1), changeReason: "x".repeat(301) }] },
    { entries: [{ ...row(1), updatedAt: "yesterday" }] },
    { entries: [row(2)], nextBeforeVersion: "3" },
    { entries: [row(2)], nextBeforeVersion: "2", admin: true },
    { entries: [], nextBeforeVersion: "1" },
    { entries: [row(2), row(1)], nextBeforeVersion: "1" },
    { entries: [row(3), row(2)], nextBeforeVersion: 2 },
  ]) assert.equal(isStoreRegistrationPolicyHistoryPage(bad, 2), false, JSON.stringify(bad));
  for (const limit of [0, 51, 1.5]) assert.equal(isStoreRegistrationPolicyHistoryPage(page, limit), false);
});

test("history SDK builds exact read-only route, bearer and bounded keyset", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.toString(), origin + "/v1/operators/cities/sanaa/store-registration-policy/DIRECT/history?limit=2&beforeVersion=4");
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer " + bearer);
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.equal(init.body, undefined);
    return reply(page);
  });
  assert.deepEqual(await listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer, 2, "4"), page);
  assert.equal(fetch.mock.callCount(), 1);
});

test("history SDK fails before fetch for invalid actor, city, relation, limit or int64 cursor", async t => {
  const fetch = t.mock.method(globalThis, "fetch", () => assert.fail("must not call DSH"));
  for (const args of [
    [origin, "../sanaa", "DIRECT", bearer, 2],
    [origin, 123, "DIRECT", bearer, 2],
    [origin, "sanaa", "OTHER", bearer, 2],
    [origin, "sanaa", "DIRECT", "invalid", 2],
    [origin, "sanaa", "DIRECT", bearer, 0],
    [origin, "sanaa", "DIRECT", bearer, 51],
    [origin, "sanaa", "DIRECT", bearer, 2, "../1"],
    [origin, "sanaa", "DIRECT", bearer, 2, "00"],
    [origin, "sanaa", "DIRECT", bearer, 2, "9223372036854775808"],
    [origin, "sanaa", "DIRECT", bearer, 2, 4],
  ]) await assert.rejects(listOperatorStoreRegistrationPolicyHistory(...args), DshPublicError);
  assert.equal(fetch.mock.callCount(), 0);
});

test("history SDK rejects rows at or above requested cursor", async t => {
  let body = page;
  const fetch = t.mock.method(globalThis, "fetch", async () => reply(body));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer, 2, "3"), { code: "OWNER_RESPONSE_INVALID" });
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer, 2, "2"), { code: "OWNER_RESPONSE_INVALID" });
  body = { entries: [row(1)] };
  assert.deepEqual(await listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer, 2, "2"), body);
  assert.equal(fetch.mock.callCount(), 3);
});

test("history supports full owner cursor range", async t => {
  const body = { entries: [row(Number.MAX_SAFE_INTEGER)] };
  const fetch = t.mock.method(globalThis, "fetch", async url => {
    assert.ok(String(url).endsWith("beforeVersion=9223372036854775807"));
    return reply(body);
  });
  assert.deepEqual(await listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer, 2, "9223372036854775807"), body);
  assert.equal(fetch.mock.callCount(), 1);
});

test("history SDK rejects forged/cacheable reply", async t => {
  const fetch = t.mock.method(globalThis, "fetch", async () => reply({ entries: [{ ...row(1), ownerToken: "forged" }] }));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer), { code: "OWNER_RESPONSE_INVALID" });
  fetch.mock.restore();
  t.mock.method(globalThis, "fetch", async () => Response.json({ entries: [row(1)] }));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "DIRECT", bearer), { code: "OWNER_RESPONSE_INVALID" });
});

test("history SDK propagates denied read", async t => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
  await assert.rejects(listOperatorStoreRegistrationPolicyHistory(origin, "sanaa", "MARKETPLACE", bearer), { status: 403 });
});

test("history admits a complete owner-bounded page, including Go HTML-escaped Unicode text", async t => {
  const full = {entries: Array.from({length:50},(_,i)=>({
    ...row(51-i), changedByActor:"<".repeat(128),
    termsVersion:"a".repeat(80), changeReason:"&".repeat(300),
  })),nextBeforeVersion:"2"};
  const wire=JSON.stringify(full).replaceAll("<","\\u003c").replaceAll("&","\\u0026");
  assert.ok(Buffer.byteLength(wire)>96*1024);
  t.mock.method(globalThis,"fetch",async()=>new Response(wire,{
    headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  }));
  assert.deepEqual(await listOperatorStoreRegistrationPolicyHistory(origin,"sanaa","DIRECT",bearer,50),full);
});

test("history actor and reason obey the persisted Go owner constraints",()=>{
  for(const changedByActor of [" actor-a","actor-a\u0085","a\u0000b","😀".repeat(33),"\ud800"]) {
    assert.equal(isStoreRegistrationPolicyHistoryPage({entries:[{...row(1),changedByActor}]}),false);
  }
  for(const changeReason of [" reason","reason\u00a0","a\u0085b","\ud800","a\u0000b"]) {
    assert.equal(isStoreRegistrationPolicyHistoryPage({entries:[{...row(1),changeReason}]}),false);
  }
  assert.equal(isStoreRegistrationPolicyHistoryPage({entries:[{...row(1),changedByActor:"😀".repeat(32),changeReason:"\uFEFF"}]}),true);
});

test("history rejects oversized declared and streamed pages using the requested limit", async t=>{
  const read=()=>listOperatorStoreRegistrationPolicyHistory(origin,"sanaa","DIRECT",bearer,1);
  const budget=3200;
  let cancelled=0;
  let reply=new Response(new ReadableStream({cancel(){cancelled++;}}),{
    headers:{"Content-Type":"application/json","Cache-Control":"no-store","Content-Length":String(budget+1)},
  });
  t.mock.method(globalThis,"fetch",async()=>reply);
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  assert.equal(cancelled,1);
  const stream=new ReadableStream({
    start(c){c.enqueue(new Uint8Array(budget+1));},
    cancel(){cancelled++;},
  });
  reply=new Response(stream,{headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  await assert.rejects(read(),{code:"OWNER_RESPONSE_INVALID"});
  assert.equal(cancelled,2);
  assert.equal(stream.locked,false);
});

test("shared transport rejects malformed bearer before fetch without coercion",async t=>{
  const {privateOwnerRequest}=await import("./private-owner-request.ts");
  const calls=t.mock.method(globalThis,"fetch",()=>assert.fail("unexpected dispatch"));
  for(const token of [null,[],[bearer],"",bearer+" ","a b"]) {
    await assert.rejects(privateOwnerRequest(origin,"/v1/test",token,"GET"),{status:401,code:"UNAUTHENTICATED"});
  }
  assert.equal(calls.mock.callCount(),0);
});
