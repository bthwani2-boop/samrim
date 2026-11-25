import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { test } from "node:test";

const requirePanel = createRequire(new URL("../package.json", import.meta.url));
const { transformSync } = requirePanel("next/dist/build/swc/index.js");
const root = resolve(import.meta.dirname, "..");
const jsx = (type, props) => ({ type, props: props ?? {} });
function compile(file, deps, bindings = {}, exportName = "default") {
  const code = transformSync(readFileSync(resolve(root, file), "utf8"), {
    jsc: { parser: { syntax: "typescript", tsx: true }, target: "es2022",
      transform: { react: { runtime: "automatic" } } },
    module: { type: "commonjs" },
  }).code;
  const mod = { exports: {} };
  new Function("require", "module", "exports", ...Object.keys(bindings), code)(
    name => {
      assert.ok(Object.hasOwn(deps, name), `unexpected dependency ${name}`);
      return deps[name];
    }, mod, mod.exports, ...Object.values(bindings));
  return mod.exports[exportName];
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
async function entry({ refresh, status = "signed-out" }) {
  const screen = compile("src/features/access/operator-entry-screen.tsx", {
    "next/headers": {
      headers: async () => new Headers({ host: "localhost:13000" }),
      cookies: async () => ({ get: () => refresh ? { value: refresh } : undefined }),
    },
    "next/navigation": { redirect: url => { throw new Error(`redirect ${url}`); } },
    "../../server/current-operator-access": { currentOperatorAccessState: async () => ({ status }) },
    "../../server/operator-passkey-bff": {
      OPERATOR_REFRESH_COOKIE: "bthwani_operator_refresh",
      canonicalOperatorEntryRedirect: () => null,
      resolveInitialOperatorBootstrapConfig: () => ({}),
      resolveIsolatedOperatorConfig: () => ({ browserOrigin: "http://localhost:13000" }),
      resolveOperatorRecoveryConfig: () => ({}),
    },
    "../operator-shell/operator-shell.module.css": { default: {} },
    "./operator-bootstrap-form": { __esModule: true, default: "Bootstrap" },
    "./operator-passkey-form": { __esModule: true, default: "Passkey" },
    "./operator-workspace-gate": { operatorIdentityUnavailableMessage: "unavailable" },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  });
  return nodes(await screen());
}

test("Operator entry with a retained refresh credential offers session recovery, not a new Passkey or bootstrap", async () => {
  const tree = await entry({ refresh: "R".repeat(43) });
  const form = tree.find(node => node.type === "Passkey");
  assert.equal(form?.props.recoveryOnly, true);
  assert.equal(tree.some(node => node.type === "Bootstrap"), false);
});

test("Operator without a usable refresh credential keeps normal approved entry", async () => {
  for (const refresh of [undefined, "malformed"]) {
    const tree = await entry({ refresh });
    assert.notEqual(tree.find(node => node.type === "Passkey")?.props.recoveryOnly, true);
    assert.equal(tree.filter(node => node.type === "Bootstrap").length, 2);
  }
});

function formHarness(response) {
  let index = 0;
  const states = [];
  const calls = [];
  const redirects = [];
  let effect;
  const locks = [];
  const form = compile("src/features/access/operator-passkey-form.tsx", {
    antd: { Button: "Button" },
    "../session/operator-browser-session": { withOperatorBrowserSession: async action => { locks.push("lock"); return action(); } },
    react: {
      useEffect(callback) { effect = callback; },
      useState(initial) {
        const at = index++;
        if (!(at in states)) states[at] = initial;
        return [states[at], value => { states[at] = value; }];
      },
      useRef(initial) {
        const at = index++;
        if (!(at in states)) states[at] = { current: initial };
        return states[at];
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  }, {
    fetch: async (url, options) => { calls.push({ url, options }); return response; },
    window: { location: { replace: url => redirects.push(url) } },
  });
  return { calls, redirects, locks, mount() { return effect?.(); }, render() { index = 0; return nodes(form({ recoveryOnly: true })); } };
}

test("Operator recovery invokes only the existing owner-backed session endpoint and reloads after verified response", async () => {
  const h = formHarness(Response.json({ authenticated: true, role: "operator" }));
  const button = h.render().find(node => node.type === "Button");
  assert.equal(button?.props.children, "استعادة الجلسة");
  await button.props.onClick();
  assert.deepEqual(h.calls, [{ url: "/api/auth/session",
    options: { method: "GET", credentials: "same-origin", cache: "no-store" } }]);
  assert.deepEqual(h.redirects, ["/"]);
});

test("Operator recovery outage stays closed and never starts a Passkey ceremony", async () => {
  const h = formHarness(Response.json({ code: "OWNER_UNAVAILABLE" }, { status: 503 }));
  await h.render().find(node => node.type === "Button").props.onClick();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.redirects, []);
  const view = h.render();
  assert.ok(view.some(node => node.props.role === "alert"));
  assert.equal(view.find(node => node.type === "Button")?.props.children, "استعادة الجلسة");
});

test("Operator recovery confirmed denial returns to canonical entry", async () => {
  const h = formHarness(Response.json({ code: "UNAUTHORIZED" }, { status: 401 }));
  await h.render().find(node => node.type === "Button").props.onClick();
  assert.deepEqual(h.redirects, ["/"]);
});

test("Operator recovery cannot navigate on a different role", async () => {
  const h = formHarness(Response.json({ authenticated: true, role: "customer" }));
  await h.render().find(node => node.type === "Button").props.onClick();
  assert.deepEqual(h.redirects, []);
  assert.ok(h.render().some(node => node.props.role === "alert"));
});


test("Concurrent recovery clicks issue a single owner request", async () => {
  const h = formHarness(Response.json({ authenticated: true, role: "operator" }));
  const button = h.render().find(node => node.type === "Button");
  await Promise.all([button.props.onClick(), button.props.onClick()]);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.redirects, ["/"]);
});

test("Operator passkey admission requires a persistent family before setting either cookie", async () => {
  const token = Buffer.alloc(32, 51).toString("base64url");
  const refresh = Buffer.alloc(32, 52).toString("base64url");
  const expires = new Date(Date.now() + 300000).toISOString();
  for (const enrollmentFails of [true, false]) {
    const revoked = [];
    const post = compile("app/api/auth/passkey/authentication/route.ts", {
      "@bthwani/identity": {
        identityOperations: { finishOperatorPasskeyAuthentication: "finish", getVerifiedIdentitySession: "current" },
        async establishPersistentIdentitySession(_origin, bearer) {
          assert.equal(bearer, token);
          if (enrollmentFails) throw new Error("persistent enrollment unavailable");
          return { refreshToken: refresh, refreshExpiresAt: expires };
        },
        async revokeVerifiedIdentitySession(_origin, bearer) { revoked.push(bearer); },
      },
      "next/server": requirePanel("next/server"),
      "../../../../../src/server/operator-passkey-bff": {
        boundedRequestBody: async () => JSON.stringify({ ceremonyId: "synthetic" }),
        boundedResponseJSON: response => response.json(),
        cookieLifetimeSeconds: () => 300,
        isTrustedOperatorRequest: () => true,
        OPERATOR_COOKIE: "bthwani_operator_session",
        OPERATOR_REFRESH_COOKIE: "bthwani_operator_refresh",
        operatorIdentityRequest: async (_config, operation) => Response.json(operation === "finish"
          ? { accessToken: token, sessionExpiresAt: expires }
          : { actorId: "operator-synthetic", role: "operator", sessionExpiresAt: expires }),
        parseIssuedOperatorToken: value => value,
        parseVerifiedOperatorPrincipal: value => value,
        resolveIsolatedOperatorConfig: () => ({ identityOrigin: "http://127.0.0.1:3201" }),
        validAssertion: () => true,
      },
      "../../../../../src/server/request-security": { unavailableSessionResponse: () => Response.json({}, { status: 503 }) },
    }, {}, "POST");
    const response = await post(new Request("http://localhost:13000/api/auth/passkey/authentication", {
      method: "POST", headers: { "content-type": "application/json" },
    }));
    assert.equal(response.status, enrollmentFails ? 503 : 200);
    if (enrollmentFails) {
      assert.equal(response.headers.get("Set-Cookie"), null);
      assert.deepEqual(revoked, [token]);
    } else {
      assert.equal(response.cookies.get("bthwani_operator_session")?.value, token);
      assert.equal(response.cookies.get("bthwani_operator_refresh")?.value, refresh);
      assert.deepEqual(revoked, []);
    }
  }
});

test("retained Operator session restores automatically through the browser session lock", async () => {
  const h = formHarness(Response.json({ authenticated: true, role: "operator" }));
  h.render();
  h.mount();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.locks, ["lock"]);
  assert.deepEqual(h.redirects, ["/"]);
});

test("document proxy does not rotate browser credentials outside the serialized session route", () => {
  const proxy = readFileSync(resolve(root, "proxy.ts"), "utf8");
  assert.doesNotMatch(proxy, /rotatePersistentIdentitySession/);
});

test("protected direct entry exposes recovery only for a signed-out session with a retained credential", async () => {
  for (const status of ["signed-out", "unavailable", "verified"]) {
    const layout = compile("app/(workspace)/layout.tsx", {
      "next/headers": { headers: async () => new Headers({ host: "localhost:13000", "x-bthwani-route": "/operations" }),
        cookies: async () => ({ get: () => ({ value: "R".repeat(43) }) }) },
      "../../src/features/access/operator-workspace-gate": { __esModule: true, default: "Gate" },
      "../../src/features/session/operator-permissions": { canEnterOperatorWorkspace: () => false },
      "../../src/server/current-operator-access": { currentOperatorAccessState: async () => status === "verified"
        ? { status, access: { actorId: "operator-a", grants: [] } } : { status },
        currentOriginalOperatorPermissions: async () => null },
      "../../src/server/operator-passkey-bff": { OPERATOR_REFRESH_COOKIE: "refresh",
        resolveIsolatedOperatorConfig: () => ({ browserOrigin: "http://localhost:13000" }) },
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
    });
    const gate = await layout({ children: "private" });
    assert.equal(Boolean(gate.props.recoverable), status === "signed-out");
    assert.equal(gate.props.children, undefined);
  }
});

test("browser session lock serializes separate callers and refuses uncoordinated fallback", async () => {
  let tail = Promise.resolve();
  const names = [];
  const locks = { request(name, options, action) {
    names.push([name, options.mode]);
    const task = tail.then(action);
    tail = task.catch(() => undefined);
    return task;
  }};
  const bindings = { navigator: { locks } };
  const one = compile("src/features/session/operator-browser-session.ts", {}, bindings, "withOperatorBrowserSession");
  const two = compile("src/features/session/operator-browser-session.ts", {}, bindings, "withOperatorBrowserSession");
  const sequence = [];
  let release;
  const first = one(async () => { sequence.push("one"); await new Promise(resolve => { release = resolve; }); sequence.push("done"); });
  const second = two(async () => sequence.push("two"));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sequence, ["one"]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(sequence, ["one", "done", "two"]);
  assert.equal(names[0][0], names[1][0]);
  assert.ok(names.every(([,mode]) => mode === "exclusive"));
  const unsupported = compile("src/features/session/operator-browser-session.ts", {}, { navigator: {} }, "withOperatorBrowserSession");
  await assert.rejects(() => unsupported(async () => assert.fail("unlocked mutation")));
});

test("Operator session route renews before expiry with same-actor proof and current grants, never returns foreign credentials", async () => {
  const token = Buffer.alloc(32, 61).toString("base64url");
  const refresh = Buffer.alloc(32, 62).toString("base64url");
  const newAccess = Buffer.alloc(32, 63).toString("base64url");
  const newRefresh = Buffer.alloc(32, 64).toString("base64url");
  const expiry = new Date(Date.now() + 300000).toISOString();
  for (const mode of ["healthy", "renew", "wrong-actor", "outage-after-renew", "denied-after-renew", "original", "original-outage"]) {
    let rotations = 0;
    const oldExpiry = new Date(Date.now() + (mode === "healthy" ? 240000 : 45000)).toISOString();
    const actor = mode === "wrong-actor" ? "operator-b" : "operator-a";
    class IdentityClientError extends Error { constructor(status, code) { super(code); this.status = status; } }
    const get = compile("app/api/auth/session/route.ts", {
      "@bthwani/identity": {
        identityOperations: {}, IdentityClientError,
        async rotatePersistentIdentitySession(_origin, supplied) {
          assert.equal(supplied, refresh); rotations++;
          return { accessToken: newAccess, refreshToken: newRefresh, sessionExpiresAt: expiry,
            refreshExpiresAt: new Date(Date.now() + 3600000).toISOString() };
        },
        async readVerifiedIdentitySession(_origin, supplied) {
          assert.equal(supplied, newAccess);
          return { actorId: actor, role: "operator", sessionExpiresAt: expiry };
        },
        async reviewOriginalOperatorPermissions(_origin, bearer, target) {
          assert.equal(bearer, mode === "healthy" ? token : newAccess); assert.equal(target, "operator-a");
          if (mode === "original") return [];
          if (mode === "original-outage") throw new IdentityClientError(503, "OWNER_UNAVAILABLE");
          throw new IdentityClientError(403, "FORBIDDEN");
        },
        revokePersistentIdentitySession: async () => {},
      },
      "next/server": requirePanel("next/server"),
      "../../../../src/server/operator-passkey-bff": {
        cookieLifetimeSeconds: date => Math.floor((Date.parse(date) - Date.now()) / 1000),
        isTrustedOperatorLoopbackTarget: () => true,
        OPERATOR_COOKIE: "bthwani_operator_session", OPERATOR_REFRESH_COOKIE: "bthwani_operator_refresh",
        resolveIsolatedOperatorConfig: () => ({ identityOrigin: "http://127.0.0.1:3201", browserOrigin: "http://localhost:13000" }),
        async readOperatorAccessState(_config, bearer) {
          if (bearer === token) return { status: "verified", access: { actorId: "operator-a", grants: ["operations"], sessionExpiresAt: oldExpiry } };
          assert.equal(bearer, newAccess);
          if (mode === "outage-after-renew") return { status: "unavailable" };
          if (mode === "denied-after-renew") return { status: "signed-out" };
          return { status: "verified", access: { actorId: actor, grants: ["operations"], sessionExpiresAt: expiry } };
        },
      },
      "../../../../src/server/request-security": { unavailableSessionResponse: () => Response.json({}, { status: 503 }) },
    }, {}, "GET");
    const request = { cookies: { get: name => ({ value: name.endsWith("refresh") ? refresh : token }) } };
    const response = await get(request);
    assert.equal(rotations, mode === "healthy" ? 0 : 1);
    const body = await response.json();
    if (mode === "healthy" || mode === "renew" || mode === "original") {
      assert.equal(response.status, 200);
      assert.deepEqual(body.grants, ["operations"]);
      assert.equal(body.actorId, "operator-a");
      assert.equal(body.originalOperator, mode === "original");
      assert.equal(response.cookies.get("bthwani_operator_refresh")?.value, mode === "healthy" ? undefined : newRefresh);
    } else if (mode === "outage-after-renew" || mode === "original-outage") {
      assert.equal(response.status, 503);
      assert.equal(body.actorId, undefined);
      assert.equal(response.cookies.get("bthwani_operator_refresh")?.value, newRefresh);
    } else {
      assert.equal(response.status, 401);
      assert.equal(body.actorId, undefined);
      assert.equal(response.cookies.get("bthwani_operator_refresh")?.value, "");
    }
    assert.ok(!JSON.stringify(body).includes(newRefresh));
  }
});
