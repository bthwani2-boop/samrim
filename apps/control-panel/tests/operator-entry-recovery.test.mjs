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
  const form = compile("src/features/access/operator-passkey-form.tsx", {
    antd: { Button: "Button" },
    react: {
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
  return { calls, redirects, render() { index = 0; return nodes(form({ recoveryOnly: true })); } };
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
