import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientOrderSessionKey } from "../orders/order-session-scope.ts";

const source = readFileSync(new URL("./client-share-sheet.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("client-share-sheet.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const actor = (subject, sessionId) => ({
  kind: "authenticated", identity: { role: "client", subject, sessionId },
});

const declarations = new Map();
const effects = [];
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") {
    const firstArg = node.arguments[0]?.getText(ast);
    if (firstArg) effects.push(firstArg);
  }
  ts.forEachChild(node, visit);
}
visit(ast);

function production(runtime, names) {
  const required = ["clientShareSessionKey", "clientShareTargetKey", "clientShareRequestKey", ...names];
  for (const name of required) assert.ok(declarations.has(name), `missing production function ${name}`);
  const program = required.map(name => declarations.get(name)).join("\n");
  const compiled = ts.transpileModule(`${program}\n({${names.join(", ")}})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return runInNewContext(compiled, { clientOrderSessionKey, ...runtime });
}

function fixture() {
  let identity = actor("client-a", "session-1");
  let seq = 0;
  const sessionKey = clientOrderSessionKey(identity);
  const target = { kind: "STORE", id: "store-a", title: "المتجر", link: "https://store.example/store-a" };
  const targetKey = JSON.stringify([target.kind, target.id, target.link]);
  const activeScope = JSON.stringify([sessionKey, targetKey]);
  const actions = { sent: [], successes: [], errors: [], busy: [], phones: [], inputScopes: [], notices: [], closed: 0 };
  const attempts = { current: new Map() };
  const sendingRef = { current: false };
  const requestSequence = { current: 0 };
  const targetKeyRef = { current: targetKey };
  const service = {
    sendClientShare: async (token, request, key) => {
      actions.sent.push({ token, request, key });
      return { accepted: true };
    },
  };
  const runtime = {
    currentIdentityState: () => identity,
    getUsableIdentityAccessToken: async () => "token-1",
    clientOrderSessionKey,
    target,
    targetKey,
    targetKeyRef,
    sessionKey,
    sessionKeyRef: { current: sessionKey },
    activeScope,
    phone: "+967777111222",
    visiblePhone: "+967777111222",
    visibleMessageCode: "LOOK",
    phoneValid: true,
    busy: false,
    success: false,
    attempts,
    sendingRef,
    requestSequence,
    Crypto: { randomUUID: () => `uuid-${String(++seq)}` },
    normalizeYemenPhoneE164: value => value,
    process: { env: { EXPO_PUBLIC_DSH_API_URL: "https://dsh.invalid" } },
    createDshMobileClient: () => service,
    setSuccessScope: value => actions.successes.push(value),
    setError: value => actions.errors.push(value),
    setBusy: value => actions.busy.push(value),
    setInputScope: value => actions.inputScopes.push(value),
    setPhone: value => actions.phones.push(value),
    setMessageCode: value => actions.notices.push(value),
    onClose: () => { actions.closed++; },
    Contact: {
      presentPicker: async () => null,
    },
    ...{},
  };
  return {
    runtime, actions, attempts, service, sendingRef, requestSequence, sessionKey, activeScope, target, targetKey,
    renew: () => { identity = actor("client-a", "session-2"); },
    newActor: () => { identity = actor("client-b", "session-1"); },
    signOut: () => { identity = { kind: "signed_out" }; },
    sameSessionRefresh: () => { identity = actor("client-a", "session-1"); },
    nextContext: (actorId, sessionId, contentId) => {
      identity = actor(actorId, sessionId);
      const nextTarget = { ...target, id: contentId };
      const nextTargetKey = JSON.stringify([nextTarget.kind, nextTarget.id, nextTarget.link]);
      const nextSessionKey = clientOrderSessionKey(identity);
      targetKeyRef.current = nextTargetKey;
      return {
        ...runtime, target: nextTarget, targetKey: nextTargetKey,
        sessionKey: nextSessionKey, activeScope: JSON.stringify([nextSessionKey, nextTargetKey]),
      };
    },
  };
}

test("one authenticated Client Share request reaches canonical DSH and displays only generic acceptance", async () => {
  const x = fixture();
  const { send } = production(x.runtime, ["send"]);
  await send();
  assert.equal(x.actions.sent.length, 1);
  assert.equal(x.actions.sent[0].token, "token-1");
  assert.equal(x.actions.sent[0].request.contentId, "store-a");
  assert.equal(x.actions.sent[0].request.recipientPhoneE164, "+967777111222");
  assert.equal(x.actions.sent[0].request.messageCode, "LOOK");
  const fingerprint = JSON.stringify(["client-a", x.target.kind, x.target.id, x.runtime.visiblePhone, x.runtime.visibleMessageCode]);
  assert.deepEqual(x.actions.successes, [JSON.stringify([x.activeScope, fingerprint])]);
  assert.equal(x.attempts.current.size, 0);
});

test("new same-actor session before token acquisition makes no DSH share write", async () => {
  const x = fixture();
  let releaseToken, started;
  const pendingToken = new Promise(resolve => { started = resolve; });
  x.runtime.getUsableIdentityAccessToken = () => {
    started();
    return new Promise(resolve => { releaseToken = resolve; });
  };
  const reading = production(x.runtime, ["send"]).send();
  await pendingToken;
  x.renew();
  releaseToken("old-token");
  await reading;
  assert.equal(x.actions.sent.length, 0);
  assert.equal(x.actions.successes.length, 0);
  assert.equal(x.attempts.current.size, 1, "uncertain prior-attempt key remains eligible for same actor retry");
});

test("old same-actor DSH share acknowledgement cannot mark the replacement session successful", async () => {
  const x = fixture();
  let release, started;
  const apiStarted = new Promise(resolve => { started = resolve; });
  x.service.sendClientShare = (token, request, key) => {
    x.actions.sent.push({ token, request, key });
    started();
    return new Promise(resolve => { release = resolve; });
  };
  const sending = production(x.runtime, ["send"]).send();
  await apiStarted;
  x.renew();
  release({ accepted: true });
  await sending;
  assert.equal(x.actions.sent.length, 1);
  assert.equal(x.actions.successes.length, 0);
  assert.equal(x.attempts.current.size, 1);
});

test("same-session refresh is not treated as logout or same-actor reauthentication", async () => {
  const x = fixture();
  x.sameSessionRefresh();
  await production(x.runtime, ["send"]).send();
  assert.equal(x.actions.sent.length, 1);
  const fingerprint = JSON.stringify(["client-a", x.target.kind, x.target.id, x.runtime.visiblePhone, x.runtime.visibleMessageCode]);
  assert.deepEqual(x.actions.successes, [JSON.stringify([x.activeScope, fingerprint])]);
});

test("rapid double click launches only one canonical DSH Share request", async () => {
  const x = fixture();
  let release, started;
  const sent = new Promise(resolve => { started = resolve; });
  x.service.sendClientShare = (token, request, key) => {
    x.actions.sent.push({ token, request, key });
    started();
    return new Promise(resolve => { release = resolve; });
  };
  const send = production(x.runtime, ["send"]).send;
  const first = send();
  await sent;
  await send();
  assert.equal(x.actions.sent.length, 1);
  release({ accepted: true });
  await first;
  assert.equal(x.sendingRef.current, false);
});

test("a rejected generic acknowledgement is not shown as a success", async () => {
  const x = fixture();
  x.service.sendClientShare = async () => ({ accepted: false });
  await production(x.runtime, ["send"]).send();
  assert.deepEqual(x.actions.successes, []);
  assert.match(x.actions.errors.at(-1), /لم نتأكد/);
  assert.equal(x.attempts.current.size, 1);
});

test("ambiguous retry reuses identical actor+recipient+payload idempotency key", async () => {
  const x = fixture();
  x.service.sendClientShare = async (token, input, key) => {
    x.actions.sent.push({ token, input, key });
    if (x.actions.sent.length === 1) throw new Error("NETWORK");
    return { accepted: true };
  };
  const send = production(x.runtime, ["send"]).send;
  await send();
  assert.equal(x.attempts.current.size, 1);
  await send();
  assert.equal(x.actions.sent.length, 2);
  assert.equal(x.actions.sent[0].key, x.actions.sent[1].key);
  assert.equal(x.attempts.current.size, 0);
});

test("changing Store target cannot reuse an old uncertain idempotency key", async () => {
  const x = fixture();
  x.service.sendClientShare = async (token, input, key) => {
    x.actions.sent.push({ token, input, key });
    throw new Error("NETWORK");
  };
  await production(x.runtime, ["send"]).send();
  const other = x.nextContext("client-a", "session-1", "store-b");
  await production(other, ["send"]).send();
  assert.equal(x.actions.sent.length, 2);
  assert.equal(x.actions.sent[0].input.contentId, "store-a");
  assert.equal(x.actions.sent[1].input.contentId, "store-b");
  assert.notEqual(x.actions.sent[0].key, x.actions.sent[1].key);
});

test("a changed recipient or message uses a distinct retry key, even for the same Store", async () => {
  const x = fixture();
  x.service.sendClientShare = async (token, input, key) => {
    x.actions.sent.push({ token, input, key });
    throw new Error("NETWORK");
  };
  await production(x.runtime, ["send"]).send();
  await production({ ...x.runtime, visiblePhone: "+967771111222" }, ["send"]).send();
  await production({ ...x.runtime, visibleMessageCode: "TRY" }, ["send"]).send();
  assert.equal(new Set(x.actions.sent.map(item => item.key)).size, 3);
});

test("different actor does not reuse prior actor's ambiguous idempotency evidence", async () => {
  const x = fixture();
  x.service.sendClientShare = async (token, input, key) => {
    x.actions.sent.push({ token, input, key });
    throw new Error("NETWORK");
  };
  await production(x.runtime, ["send"]).send();
  const other = x.nextContext("client-b", "session-1", "store-a");
  await production(other, ["send"]).send();
  assert.notEqual(x.actions.sent[0].key, x.actions.sent[1].key);
  assert.equal(x.attempts.current.size, 2);
});

test("same actor reauthentication preserves the original ambiguous retry key", async () => {
  const x = fixture();
  x.service.sendClientShare = async (token, input, key) => {
    x.actions.sent.push({ token, input, key });
    throw new Error("NETWORK");
  };
  await production(x.runtime, ["send"]).send();
  const other = x.nextContext("client-a", "session-2", "store-a");
  await production(other, ["send"]).send();
  assert.equal(x.actions.sent[0].key, x.actions.sent[1].key);
});

test("definitive invalid-input result discards idempotency evidence for corrected next attempt", async () => {
  const x = fixture();
  x.service.sendClientShare = async () => {
    throw Object.assign(new Error("invalid"), { code: "INVALID_INPUT" });
  };
  await production(x.runtime, ["send"]).send();
  assert.equal(x.attempts.current.size, 0);
  assert.match(x.actions.errors.at(-1), /المحتوى لم يعد متاحًا/);
});

test("an old Contact picker result cannot populate a replacement session's recipient", async () => {
  const x = fixture();
  let finish, started;
  const invoked = new Promise(resolve => { started = resolve; });
  x.runtime.Contact.presentPicker = () => {
    started();
    return new Promise(resolve => { finish = resolve; });
  };
  const choosing = production(x.runtime, ["chooseContact"]).chooseContact();
  await invoked;
  x.renew();
  finish({ getPhones: async () => [{ number: "777111222" }] });
  await choosing;
  assert.deepEqual(x.actions.phones, []);
  assert.deepEqual(x.actions.inputScopes, []);
});

test("closing during pending DSH write cannot discard in-flight retry evidence", async () => {
  const x = fixture();
  x.sendingRef.current = true;
  production(x.runtime, ["resetAndClose"]).resetAndClose();
  assert.equal(x.actions.closed, 0);
  assert.equal(x.requestSequence.current, 0);
  x.sendingRef.current = false;
  production(x.runtime, ["resetAndClose"]).resetAndClose();
  assert.equal(x.actions.closed, 1);
  assert.equal(x.requestSequence.current, 1);
});

test("authenticated session subscription resets private recipient, feedback and stale request sequence", () => {
  const x = fixture();
  let cb;
  const events = [];
  const runtime = {
    ...x.runtime,
    subscribeIdentitySession: value => { cb = value; return () => {}; },
    setSessionKey: value => events.push(["session", value]),
    setSuccessScope: value => events.push(["success", value]),
    setError: value => events.push(["error", value]),
    setBusy: value => events.push(["busy", value]),
  };
  const effect = effects.find(item => item.includes("subscribeIdentitySession"));
  assert.ok(effect);
  const helpers = ["clientShareSessionKey"].map(n => declarations.get(n)).join("\n");
  const js = ts.transpileModule(`${helpers}\nconst subscribe = ${effect};\nsubscribe;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(js, { clientOrderSessionKey, ...runtime })();
  x.sameSessionRefresh();
  cb();
  assert.equal(x.requestSequence.current, 0);
  assert.equal(events.length, 0);
  x.renew();
  cb();
  assert.equal(x.requestSequence.current, 1);
  assert.equal(x.sendingRef.current, false);
  assert.equal(events[0][0], "session");
});

test("native contacts and outside sharing are still preserved, but the client never impersonates recipient eligibility", () => {
  assert.match(source, /Contact\.presentPicker\(\)/);
  assert.match(source, /Clipboard\.setStringAsync\(target\.link\)/);
  assert.match(source, /Share\.share\(\{ message:/);
  assert.match(source, /if \(!response\.accepted\) throw new Error\("SHARE_NOT_ACCEPTED"\)/);
  assert.match(source, /const visiblePhone = activeScope && inputScope === activeScope \? phone : ""/);
  assert.match(source, /disabled=\{busy \|\| !activeScope\}/);
  assert.doesNotMatch(source, /idempotencyKey\.current/);
});


test("target transition invalidates old operations and clears private recipient fields", () => {
  const x = fixture();
  const effect = effects.find(item => item.includes("targetKeyRef.current = targetKey"));
  assert.ok(effect, "real target-change cleanup exists");
  const compiled = ts.transpileModule(`const transition = ${effect};\ntransition;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const next = "new-target-key";
  runInNewContext(compiled, { ...x.runtime, targetKey: next })();
  assert.equal(x.requestSequence.current, 1);
  assert.equal(x.sendingRef.current, false);
  assert.equal(x.runtime.targetKeyRef.current, next);
  assert.equal(x.actions.phones.at(-1), "");
  assert.equal(x.actions.successes.at(-1), "");
  assert.equal(x.actions.inputScopes.at(-1), "");
});

test("signed-out Client session never starts a DSH Share request, even with an old form", async () => {
  const x = fixture();
  x.signOut();
  await production(x.runtime, ["send"]).send();
  assert.equal(x.actions.sent.length, 0);
  assert.equal(x.attempts.current.size, 0);
});

test("revoked actor/target during pending contact lookup cannot reveal stale recipient", async () => {
  const x = fixture();
  let releasePhones, started;
  const phonesRequested = new Promise(resolve => { started = resolve; });
  x.runtime.Contact.presentPicker = async () => ({
    getPhones: () => {
      started();
      return new Promise(resolve => { releasePhones = resolve; });
    },
  });
  const choosing = production(x.runtime, ["chooseContact"]).chooseContact();
  await phonesRequested;
  x.requestSequence.current += 1;
  releasePhones([{ number: "777222333" }]);
  await choosing;
  assert.deepEqual(x.actions.phones, []);
  assert.deepEqual(x.actions.inputScopes, []);
});


test("success feedback is scoped to exactly submitted recipient and message, not just Store", () => {
  const expressions = new Map();
  function collect(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const name = node.name.getText(ast);
      if (["visibleRequestKey", "success"].includes(name)) expressions.set(name, node.initializer.getText(ast));
    }
    ts.forEachChild(node, collect);
  }
  collect(ast);
  assert.ok(expressions.has("visibleRequestKey") && expressions.has("success"));
  const helper = declarations.get("clientShareRequestKey");
  const program = [helper, `const visibleRequestKey = ${expressions.get("visibleRequestKey")};`,
    `const success = ${expressions.get("success")};`, "success;"].join("\n");
  const js = ts.transpileModule(program, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const x = fixture();
  const acceptedKey = JSON.stringify(["client-a", x.target.kind, x.target.id, x.runtime.visiblePhone, "LOOK"]);
  const successScope = JSON.stringify([x.activeScope, acceptedKey]);
  const current = runtime => runInNewContext(js, runtime);
  const shared = {
    activeScope: x.activeScope,
    identity: actor("client-a", "session-1"),
    target: x.target,
    phoneValid: true,
    normalizeYemenPhoneE164: value => value,
    successScope,
  };
  assert.equal(current({ ...shared, visiblePhone: x.runtime.visiblePhone, visibleMessageCode: "LOOK" }), true);
  assert.equal(current({ ...shared, visiblePhone: "+967777222333", visibleMessageCode: "LOOK" }), false);
  assert.equal(current({ ...shared, visiblePhone: x.runtime.visiblePhone, visibleMessageCode: "TRY" }), false);
  assert.equal(current({ ...shared, visiblePhone: x.runtime.visiblePhone, visibleMessageCode: "LOOK", activeScope: "different-session" }), false);
  assert.match(source, /if\(sendingRef\.current\)return;setInputScope\(activeScope\);setPhone\(value\)/);
  assert.match(source, /if\(sendingRef\.current\)return;setInputScope\(activeScope\);setMessageCode\(code\)/);
});
