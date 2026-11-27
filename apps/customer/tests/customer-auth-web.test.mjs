import assert from "node:assert/strict";
import { test } from "node:test";
import { DELETE, GET, POST } from "../app/api/customer-auth+api.ts";

const owner = "http://127.0.0.1:33221";
const host = "http://localhost:18101";
const token = Buffer.alloc(32, 11).toString("base64url");
const ticket = "f".repeat(48);
const expiry = new Date(Date.now() + 120000).toISOString();
const verified = { actorId: "customer-a", role: "customer", sessionExpiresAt: expiry };
const success = value => Response.json(value, { headers: { "Cache-Control": "no-store" } });
const cookie = "bthwani_customer_auth=" + token;
const request = (method = "GET", body, options = {}) => new Request(host + "/api/customer-auth" + (options.query ?? ""), {
  method,
  headers: {
    ...(options.cookie === false ? {} : { Cookie: cookie }),
    ...(method !== "GET" ? { Origin: options.origin ?? host } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function mockOwner(t, handler) {
  process.env.CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN = owner;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    const path = new URL(url).pathname;
    calls.push({ path, method: opts.method, bearer: opts.headers.Authorization });
    return handler(path, opts);
  });
  return calls;
}

test("Customer guest GET does not contact Identity or expose credentials", async t => {
  mockOwner(t, () => assert.fail("guest read must not fetch owner"));
  const res = await GET(request("GET", undefined, { cookie: false }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, session: null });
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("Customer session GET returns only verified Customer role, never opaque bearer", async t => {
  const calls = mockOwner(t, (path, opts) => {
    assert.equal(path, "/v1/sessions/current");
    assert.equal(opts.headers.Authorization, "Bearer " + token);
    return success(verified);
  });
  const res = await GET(request());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { enabled: true, session: verified });
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(JSON.stringify(await GET(request())).includes(token), false);
  assert.equal(calls.length, 2);
});

for (const status of [401, 403]) {
  test(`Customer stale owner session ${status} clears only local cookie`, async t => {
    mockOwner(t, () => Response.json({ error: "UNAUTHORIZED" }, {
      status, headers: { "Cache-Control": "no-store" },
    }));
    const res = await GET(request());
    assert.equal(res.status, status === 401 ? 200 : 403);
    assert.match(res.headers.get("Set-Cookie") ?? "", /^bthwani_customer_auth=; Path=\/api\/customer-auth; HttpOnly; SameSite=Strict; Max-Age=0/);
  });
}

test("Merchant bearer cannot be accepted as Customer session", async t => {
  mockOwner(t, () => success({ ...verified, role: "merchant" }));
  const res = await GET(request());
  assert.equal(res.status, 403);
  assert.match(res.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
});

test("Cross-site POST and DELETE cannot mutate Customer sessions", async t => {
  const calls = mockOwner(t, () => assert.fail("cross-site must not reach Identity"));
  assert.equal((await POST(request("POST", { phone: "+967770000077" }, { origin: "https://attacker.example" }))).status, 403);
  assert.equal((await DELETE(request("DELETE", undefined, { origin: "https://attacker.example" }))).status, 403);
  assert.equal(calls.length, 0);
});

test("Customer phone challenge uses bounded local BFF and returns no session", async t => {
  const calls = mockOwner(t, (path, opts) => {
    assert.equal(path, "/v1/customer-auth/phone-challenges");
    assert.equal(opts.method, "POST");
    assert.equal(opts.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(opts.body), { phone: "+967770000077" });
    return Response.json({ ticket }, { status: 201, headers: { "Cache-Control": "no-store" } });
  });
  const res = await POST(request("POST", { phone: "+967770000077" }, { cookie: false }));
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { ticket });
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(calls.length, 1);
});

test("Valid Identity phone OTP produces app-specific HttpOnly Customer cookie", async t => {
  const calls = mockOwner(t, (path, opts) => {
    if (path === "/v1/customer-auth/phone-verification") {
      assert.deepEqual(JSON.parse(opts.body), { ticket, code: "123456" });
      return success({ accessToken: token, sessionExpiresAt: expiry });
    }
    if (path === "/v1/sessions/current" && opts.method === "GET") {
      assert.equal(opts.headers.Authorization, "Bearer " + token);
      return success(verified);
    }
    if (path === "/v1/sessions/persistent" && opts.method === "POST") {
      assert.equal(opts.headers.Authorization, "Bearer " + token);
      return Response.json({refreshToken:Buffer.alloc(32,23).toString("base64url"),
        refreshExpiresAt:new Date(Date.now()+30*24*60*60_000).toISOString()},
        {status:201,headers:{"Cache-Control":"no-store"}});
    }
    assert.fail(`Unexpected Identity call ${opts.method} ${path}`);
  });
  const res = await POST(request("POST", { ticket, code: "123456" }, { cookie: false }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { session: verified });
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.match(res.headers.get("Set-Cookie") ?? "", /^bthwani_customer_auth=[A-Za-z0-9_-]+; Path=\/api\/customer-auth; HttpOnly; SameSite=Strict; Max-Age=/);
  assert.deepEqual(calls.map(x => x.path), ["/v1/customer-auth/phone-verification", "/v1/sessions/current", "/v1/sessions/persistent"]);
  assert.match(res.headers.get("Set-Cookie") ?? "", /bthwani_customer_auth\.refresh=[A-Za-z0-9_-]{43}/);
});

test("Identity response of wrong role after phone proof revokes issued token", async t => {
  let revoked = false;
  mockOwner(t, (path, opts) => {
    if (path === "/v1/customer-auth/phone-verification") return success({ accessToken: token, sessionExpiresAt: expiry });
    if (opts.method === "GET") return success({ ...verified, role: "captain" });
    if (opts.method === "DELETE") { revoked = true; return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }); }
    assert.fail(path);
  });
  const res = await POST(request("POST", { ticket, code: "123456" }, { cookie: false }));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.equal(revoked, true);
});

test("Active Customer cookie must sign out before issuing another Customer credential", async t => {
  const calls = mockOwner(t, path => {
    assert.equal(path, "/v1/sessions/current");
    return success(verified);
  });
  const res = await POST(request("POST", { ticket, code: "123456" }));
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { code: "SIGN_OUT_REQUIRED" });
  assert.equal(calls.length, 1);
});

test("Revocation only affects verified Customer bearer and expires BFF cookie", async t => {
  const calls = mockOwner(t, (path, opts) => {
    assert.equal(path, "/v1/sessions/current");
    if (opts.method === "GET") return success(verified);
    if (opts.method === "DELETE") return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    assert.fail(opts.method);
  });
  const res = await DELETE(request("DELETE"));
  assert.equal(res.status, 204);
  assert.match(res.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
  assert.deepEqual(calls.map(x => x.method), ["GET", "DELETE"]);
});

test("Identity 503 outage preserves Customer cookie for safe retry", async t => {
  mockOwner(t, () => Response.json({ error: "OWNER_UNAVAILABLE" }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  }));
  const res = await DELETE(request("DELETE"));
  assert.equal(res.status, 503);
  assert.equal(res.headers.get("Set-Cookie"), null);
});

test("Unknown query parameters, unconfigured host and oversized body fail closed", async t => {
  mockOwner(t, () => assert.fail("invalid request must not reach Identity"));
  assert.equal((await GET(request("GET", undefined, { query: "?admin=1" }))).status, 400);
  const oversized = new Request(host + "/api/customer-auth", {
    method: "POST", headers: { Origin: host, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: "a".repeat(1024) }),
  });
  assert.equal((await POST(oversized)).status, 400);
  const remote = new Request("https://bthwani.example/api/customer-auth");
  assert.deepEqual(await (await GET(remote)).json(), { enabled: false, session: null });
});

test("Customer phone POST abandons an aborted stalled JSON body before Identity", async t => {
  const calls = mockOwner(t, () => assert.fail("incomplete body must not reach Identity"));
  let streamController;
  const pendingBody = new ReadableStream({
    start(controller) { streamController = controller; },
  });
  const abort = new AbortController();
  const request = new Request(`${host}/api/customer-auth`, {
    method: "POST", duplex: "half", signal: abort.signal,
    headers: { Origin: host, "Content-Type": "application/json" },
    body: pendingBody,
  });
  const pending = POST(request);
  abort.abort();
  const outcome = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve("STALLED"), 1000)),
  ]);
  if (outcome === "STALLED") {
    streamController.close();
    await pending;
  }
  assert.notEqual(outcome, "STALLED");
  assert.equal(outcome.status, 400);
  assert.equal(calls.length, 0);
});

test("Customer phone POST expires an unfinished JSON stream without forwarding any proof", async t => {
  const calls = mockOwner(t, () => assert.fail("partial JSON must never reach Identity"));
  let streamController;
  const body = new ReadableStream({
    start(controller) { streamController = controller; },
  });
  const request = new Request(`${host}/api/customer-auth`, {
    method: "POST", duplex: "half",
    headers: { Origin: host, "Content-Type": "application/json" },
    body,
  });
  const pending = POST(request);
  const outcome = await Promise.race([
    pending,
    new Promise(resolve => setTimeout(() => resolve("DEADLINE_MISSED"), 3500)),
  ]);
  if (outcome === "DEADLINE_MISSED") {
    streamController.close();
    await pending;
  }
  assert.notEqual(outcome, "DEADLINE_MISSED");
  assert.equal(outcome.status, 400);
  assert.equal(calls.length, 0);
});

test("Expired Customer access renews from HttpOnly refresh cookie without phone verification", async t => {
  const refresh = Buffer.alloc(32, 24).toString("base64url");
  const nextRefresh = Buffer.alloc(32, 25).toString("base64url");
  const nextAccess = Buffer.alloc(32, 26).toString("base64url");
  const newPrincipal = {actorId:"customer-a",role:"customer",sessionExpiresAt:new Date(Date.now()+15*60_000).toISOString()};
  const calls=mockOwner(t, (path, opts) => {
    if (path === "/v1/sessions/current" && opts.headers.Authorization === "Bearer "+token)
      return Response.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
    if (path === "/v1/sessions/refresh") {
      assert.equal(opts.method,"POST");
      assert.equal(opts.headers.Authorization,"Bearer "+refresh);
      return success({accessToken:nextAccess,sessionExpiresAt:newPrincipal.sessionExpiresAt,
        refreshToken:nextRefresh,refreshExpiresAt:new Date(Date.now()+30*24*60*60_000).toISOString()});
    }
    if (path === "/v1/sessions/current" && opts.headers.Authorization === "Bearer "+nextAccess)
      return success(newPrincipal);
    assert.fail(path+" "+opts.method);
  });
  const req = new Request(host+"/api/customer-auth", {headers:{
    Cookie: cookie+"; bthwani_customer_auth.refresh="+refresh,
  }});
  const res=await GET(req);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{enabled:true,session:newPrincipal});
  const setCookie=res.headers.get("Set-Cookie")??"";
  assert.match(setCookie,/bthwani_customer_auth=/);
  assert.ok(setCookie.includes("bthwani_customer_auth.refresh="));
  assert.equal(calls.map(x=>x.path).join(","),"/v1/sessions/current,/v1/sessions/refresh,/v1/sessions/current");
  assert.equal(JSON.stringify(newPrincipal).includes(nextRefresh),false);
});

test("Customer logout revokes the long-lived refresh family even when access has expired", async t=>{
  const refresh=Buffer.alloc(32,31).toString("base64url");
  const paths=[];
  mockOwner(t,(path,opts)=>{
    paths.push(path);
    if(path==="/v1/sessions/refresh" && opts.method==="DELETE"){
      assert.equal(opts.headers.Authorization,"Bearer "+refresh);
      return new Response(null,{status:204,headers:{"Cache-Control":"no-store"}});
    }
    if(path==="/v1/sessions/current" && opts.method==="GET")
      return Response.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
    assert.fail(path);
  });
  const req=new Request(host+"/api/customer-auth",{method:"DELETE",
    headers:{Origin:host,Cookie:cookie+"; bthwani_customer_auth.refresh="+refresh}});
  const res=await DELETE(req);
  assert.equal(res.status,204);
  assert.deepEqual(paths,["/v1/sessions/refresh","/v1/sessions/current"]);
  const cookies=res.headers.get("Set-Cookie")??"";
  assert.ok(cookies.includes("bthwani_customer_auth.refresh=; "));
  assert.match(cookies,/Max-Age=0/);
});

test("Customer failed refresh never destroys a recoverable cookie on temporary Identity outage", async t=>{
  const refresh=Buffer.alloc(32,42).toString("base64url");
  mockOwner(t,(path)=>{
    if(path==="/v1/sessions/current") return Response.json({error:"UNAUTHORIZED"},{status:401,headers:{"Cache-Control":"no-store"}});
    if(path==="/v1/sessions/refresh") return Response.json({error:"OWNER_UNAVAILABLE"},{status:503,headers:{"Cache-Control":"no-store"}});
    assert.fail(path);
  });
  const req=new Request(host+"/api/customer-auth",{headers:{Cookie:cookie+"; bthwani_customer_auth.refresh="+refresh}});
  const res=await GET(req);
  assert.equal(res.status,503);
  assert.equal(res.headers.get("Set-Cookie"),null);
});

test("Concurrent Customer refresh conflict leaves session cookies intact for the winning request", async t => {
  const refresh = Buffer.alloc(32, 58).toString("base64url");
  mockOwner(t,(path, options) => {
    if (path==="/v1/sessions/current") return Response.json({ error: "UNAUTHORIZED" }, {
      status:401, headers:{"Cache-Control":"no-store"},
    });
    if (path==="/v1/sessions/refresh") {
      assert.equal(options.method,"POST");
      assert.equal(options.headers.Authorization,"Bearer "+refresh);
      return Response.json({error:"CONFLICT"},{status:409,headers:{"Cache-Control":"no-store"}});
    }
    assert.fail(path);
  });
  const req=new Request(host+"/api/customer-auth",{headers:{
    Cookie:cookie+"; bthwani_customer_auth.refresh="+refresh,
  }});
  const res=await GET(req);
  assert.equal(res.status,409);
  assert.equal(res.headers.get("Set-Cookie"),null);
});

test("Customer must explicitly sign out before phone verification when only a refresh cookie remains", async t => {
  const calls = mockOwner(t, () => assert.fail("existing session family must not consume another proof"));
  const refresh = Buffer.alloc(32, 67).toString("base64url");
  for (const existing of ["", cookie + "; "]) {
    const res = await POST(new Request(host + "/api/customer-auth", {
      method: "POST",
      headers: { Origin: host, "Content-Type": "application/json",
        Cookie: existing + "bthwani_customer_auth.refresh=" + refresh },
      body: JSON.stringify({ ticket, code: "123456" }),
    }));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), { code: "SIGN_OUT_REQUIRED" });
    assert.equal(res.headers.get("Set-Cookie"), null);
  }
  assert.equal(calls.length, 0);
});

test("Fresh Customer proof cannot return successful access-only login when enrollment fails", async t => {
  const calls = mockOwner(t, (path, opts) => {
    if (path === "/v1/customer-auth/phone-verification") return success({ accessToken: token, sessionExpiresAt: expiry });
    if (path === "/v1/sessions/current" && opts.method === "DELETE") {
      assert.equal(opts.headers.Authorization, "Bearer " + token);
      return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
    }
    if (path === "/v1/sessions/current") return success(verified);
    if (path === "/v1/sessions/persistent") return Response.json({ error: "OWNER_UNAVAILABLE" },
      { status: 503, headers: { "Cache-Control": "no-store" } });
    assert.fail(path);
  });
  const res = await POST(new Request(host + "/api/customer-auth", {
    method: "POST",
    headers: { Origin: host, "Content-Type": "application/json", Cookie: "bthwani_customer_auth.refresh=invalid" },
    body: JSON.stringify({ ticket, code: "123456" }),
  }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { code: "OWNER_UNAVAILABLE" });
  assert.equal(res.headers.get("Set-Cookie"), null);
  assert.deepEqual(calls.map(x => x.method + " " + x.path), ["POST /v1/customer-auth/phone-verification", "GET /v1/sessions/current", "POST /v1/sessions/persistent", "DELETE /v1/sessions/current"]);
});

test("Customer cookie namespace is canonical even with retired environment settings", async t => {
  const previous = process.env.BTHWANI_SURFACE_PREVIEW;
  t.after(() => {
    if (previous === undefined) delete process.env.BTHWANI_SURFACE_PREVIEW;
    else process.env.BTHWANI_SURFACE_PREVIEW = previous;
  });
  process.env.BTHWANI_SURFACE_PREVIEW = "1";
  const { customerCookieName, bearerForCustomerRequest } = await import("../src/features/access/customer-session-cookie.ts?retired-surface");
  const retired = "bthwani_surface_customer_auth=" + "x".repeat(43);
  const req = cookie => new Request(host + "/api/customer-auth", { headers: { Cookie: cookie } });
  assert.equal(customerCookieName, "bthwani_customer_auth");
  assert.equal(bearerForCustomerRequest(req(retired)), null);
  assert.equal(bearerForCustomerRequest(req(retired + "; " + cookie)), token);
});

test("Customer phone POST rejects unadmitted length and media metadata before Identity",async t=>{
  const calls=mockOwner(t,()=>Response.json({ticket},{status:201,headers:{"Cache-Control":"no-store"}}));
  for(const metadata of [
    {"Content-Type":"application/json","Content-Length":"257"},
    {"Content-Type":"application/json","Content-Length":""},
    {"Content-Type":"text/plain"},
  ]){
    let cancelled=0;
    const bytes=new TextEncoder().encode(JSON.stringify({phone:"+967770000077"}));
    const body=new ReadableStream({start(s){s.enqueue(bytes);},cancel(){cancelled++;}});
    const abort=new AbortController();
    const req=new Request(host+"/api/customer-auth",{method:"POST",duplex:"half",signal:abort.signal,headers:{Origin:host,...metadata},body});
    const pending=POST(req);
    // Keep the fixture open for rejected metadata; bounded the test even if the old parser attempts to consume it.
    const res=await pending;
    assert.equal(res.status,400);
    assert.equal(cancelled,1);
    assert.equal(body.locked,false);
  }
  assert.equal(calls.length,0);
});

test("Customer phone POST rejects locked request bodies without taking another reader",async t=>{
  const calls=mockOwner(t,()=>assert.fail("locked body must not reach Identity"));
  const req=request("POST",{phone:"+967770000077"},{cookie:false});
  const reader=req.body.getReader();
  try {assert.equal((await POST(req)).status,400);assert.equal(req.body.locked,true);}
  finally {await reader.cancel();reader.releaseLock();}
  assert.equal(calls.length,0);
});
