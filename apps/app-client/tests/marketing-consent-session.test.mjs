import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientSessionKey } from "../src/features/access/client-session-scope.ts";

const source = readFileSync(new URL("../src/features/account/marketing-contact-preference.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("marketing-contact-preference.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "client", subject, sessionId },
});

function production(runtime) {
  const expressions = new Map();
  function visit(node) {
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(ast);
      if (name === "load" && ts.isCallExpression(node.initializer)) {
        expressions.set(name, node.initializer.arguments[0]?.getText(ast));
      }
      if (["update", "currentConsent"].includes(name)) {
        expressions.set(name, node.initializer?.getText(ast));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of ["load", "update", "currentConsent"]) {
    assert.ok(expressions.get(name), `Missing production expression: ${name}`);
  }
  const program = "const load = " + expressions.get("load") +
    ";\nconst update = " + expressions.get("update") +
    ";\nconst currentConsent = " + expressions.get("currentConsent") +
    ";\n({load, update, currentConsent})";
  const js = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return runInNewContext(js, { clientSessionKey, ...runtime });
}

function fixture(overrides = {}) {
  let identity = actor("client-A", "session-1");
  const sessionKey = clientSessionKey(identity);
  const oldConsent = { channel: "PUSH", decision: "OPTED_OUT", version: 3 };
  const observed = { consent: [], notice: [], pending: [], fetches: [], responses: 0 };
  const runtime = {
    active: true,
    sessionKey,
    consent: oldConsent,
    pending: false,
    currentIdentityState: () => identity,
    getUsableIdentityAccessToken: async () => "session-1-token",
    fetch: async (url, options) => {
      observed.fetches.push({ url, options });
      return {
        ok: true,
        json: async () => {
          observed.responses++;
          return options?.method === "POST" ? { decision: "OPTED_IN", version: 4 } : oldConsent;
        },
      };
    },
    base: "https://dsh.invalid",
    endpoint: "https://dsh.invalid/dsh/client/marketing-consent/PUSH",
    loadRequestID: { current: 0 },
    Crypto: { randomUUID: () => "123e4567-e89b-42d3-a456-426614174000" },
    setConsent: value => { observed.consent.push(value); },
    setNotice: value => { observed.notice.push(value); },
    setPending: value => { observed.pending.push(value); },
    ...overrides,
  };
  return {
    runtime, observed, sessionKey, oldConsent,
    renew: () => { identity = actor("client-A", "session-2"); },
    differentActor: () => { identity = actor("client-B", "session-1"); },
    refresh: () => { identity = actor("client-A", "session-1"); },
    logout: () => { identity = { kind: "signed_out" }; },
  };
}

test("marketing consent source uses one canonical Identity actor+session key", () => {
  const first = clientSessionKey(actor(" client-A ", "session-1"));
  assert.equal(first, clientSessionKey(actor("client-A", "session-1")));
  assert.notEqual(first, clientSessionKey(actor("client-A", "session-2")));
  assert.notEqual(first, clientSessionKey(actor("client-B", "session-1")));
  assert.equal(clientSessionKey({ kind: "signed_out" }), "");
  assert.equal(clientSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "client-A", sessionId: "session-1" } }), "");
  assert.match(source, /subscribeIdentitySession\(\(session\) => setSessionKey\(clientSessionKey\(session\)\)\)/);
  assert.doesNotMatch(source, /marketingConsentActorID|isCurrentMarketingConsentActor|marketing-consent-session"/);
});

test("marketing consent Switch never displays a previous same-account Identity session", () => {
  const x = fixture();
  assert.equal(production(x.runtime).currentConsent?.decision, "OPTED_OUT");
  x.renew();
  assert.equal(production(x.runtime).currentConsent, null);
  x.differentActor();
  assert.equal(production(x.runtime).currentConsent, null);
  x.logout();
  assert.equal(production(x.runtime).currentConsent, null);
  assert.match(source, /value=\{currentConsent\?\.decision === "OPTED_IN"\}/);
  assert.match(source, /disabled=\{!currentConsent \|\| pending\}/);
});

test("same-session credential refresh does not change consent's visibility", () => {
  const x = fixture();
  x.refresh();
  assert.equal(production(x.runtime).currentConsent?.version, 3);
});

test("current session reads DSH PUSH consent without a parallel local writer", async () => {
  const x = fixture();
  await production(x.runtime).load();
  assert.equal(x.observed.fetches.length, 1);
  assert.equal(x.observed.fetches[0].options.headers.Authorization, "Bearer session-1-token");
  assert.deepEqual(x.observed.consent.at(-1), x.oldConsent);
});

test("same-account renewed session before token completion prevents DSH consent GET", async () => {
  let unlock;
  const x = fixture({ getUsableIdentityAccessToken: () => new Promise(resolve => { unlock = resolve; }) });
  const reading = production(x.runtime).load();
  x.renew();
  unlock("stale-token");
  await reading;
  assert.equal(x.observed.fetches.length, 0);
  assert.deepEqual(x.observed.consent, [null]);
});

test("late consent GET response cannot replace data under a renewed same-actor session", async () => {
  let finish, started;
  const requested = new Promise(resolve => { started = resolve; });
  const x = fixture();
  x.runtime.fetch = async (url, options) => {
    x.observed.fetches.push({ url, options });
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const reading = production(x.runtime).load();
  await requested;
  x.renew();
  finish({ ok: true, json: async () => x.oldConsent });
  await reading;
  assert.deepEqual(x.observed.consent, [null]);
});

test("versioned opt-in request reaches canonical DSH and requires acknowledged readback", async () => {
  const x = fixture();
  await production(x.runtime).update(true);
  const post = x.observed.fetches[0];
  assert.equal(post.options.method, "POST");
  assert.equal(post.options.headers["X-Expected-Version"], "3");
  assert.equal(post.options.headers["Idempotency-Key"], x.runtime.Crypto.randomUUID());
  assert.deepEqual(JSON.parse(post.options.body), { decision: "OPTED_IN" });
  assert.equal(x.observed.consent.at(-1)?.decision, "OPTED_IN");
  assert.equal(x.observed.consent.at(-1)?.version, 4);
  assert.equal(x.observed.pending.at(-1), false);
});

test("same-actor reauthentication before consent token completion prevents old POST", async () => {
  let unlock;
  const x = fixture({ getUsableIdentityAccessToken: () => new Promise(resolve => { unlock = resolve; }) });
  const writing = production(x.runtime).update(true);
  x.renew();
  unlock("stale-token");
  await writing;
  assert.equal(x.observed.fetches.length, 0);
  assert.ok(!x.observed.consent.some(value => value?.decision === "OPTED_IN"));
});

test("old same-actor session POST acknowledgement cannot show promotional opt-in", async () => {
  let finish, started;
  const requestStarted = new Promise(resolve => { started = resolve; });
  const x = fixture();
  x.runtime.fetch = async (url, options) => {
    x.observed.fetches.push({ url, options });
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const writing = production(x.runtime).update(true);
  await requestStarted;
  x.renew();
  finish({ ok: true, json: async () => ({ decision: "OPTED_IN", version: 4 }) });
  await writing;
  assert.ok(!x.observed.consent.some(value => value?.decision === "OPTED_IN"));
});

test("invalid DSH update response is not optimistic consent success and reconciles", async () => {
  const x = fixture();
  x.runtime.fetch = async (url, options) => {
    x.observed.fetches.push({ url, options });
    return {
      ok: true,
      json: async () => options?.method === "POST"
        ? { decision: "OPTED_IN", version: 3 }
        : x.oldConsent,
    };
  };
  await production(x.runtime).update(true);
  assert.equal(x.observed.fetches.filter(v => v.options?.method === "POST").length, 1);
  assert.equal(x.observed.fetches.filter(v => !v.options?.method).length, 1);
  assert.ok(!x.observed.consent.some(value => value?.decision === "OPTED_IN"));
  assert.deepEqual(x.observed.consent.at(-1), x.oldConsent);
});

test("signed-out actor cannot fetch or update its previous marketing consent", async () => {
  const x = fixture();
  x.logout();
  const { load, update, currentConsent } = production(x.runtime);
  await load();
  await update(true);
  assert.equal(currentConsent, null);
  assert.equal(x.observed.fetches.length, 0);
});

test("native Expo switch and server-confirmed optimistic-safety contracts remain", () => {
  assert.match(source, /import \{ Host, Switch \} from "@expo\/ui"/);
  assert.match(source, /useMobileAppearance\(\)/);
  assert.match(source, /"Idempotency-Key": Crypto\.randomUUID\(\)/);
  assert.match(source, /"X-Expected-Version": String\(consent\.version\)/);
  assert.match(source, /data\.version <= consent\.version/);
  assert.match(source, /setConsent\(\{ channel: "PUSH", decision: data\.decision, version: data\.version \}\)/);
});
