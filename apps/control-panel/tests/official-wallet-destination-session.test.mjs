import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/features/finance/official-wallet-destination-manager.tsx", import.meta.url), "utf8");
const start = source.indexOf("  async function readCanonical():");
const end = source.indexOf("  const legacyStaleDestination =", start);
const readbackStart = source.indexOf("function expectedReadback(");
const readbackEnd = source.indexOf("\nexport function OfficialWalletDestinationManager(", readbackStart);
assert.ok(start >= 0 && end > start && readbackStart >= 0 && readbackEnd > readbackStart);
const runnable = source.slice(start, end)
  .replace("async function readCanonical(): Promise<Readonly<{ intent: WalletIntent; operatorActorId: string; destination: OfficialWalletDestination | null }> | null>", "async function readCanonical()")
  .replaceAll(" as IntentResponse | null", "")
  .replaceAll(" as DestinationResponse | null", "")
  .replaceAll(" as DestinationAttempt", "")
  .replace("let nextDestination: OfficialWalletDestination | null = null", "let nextDestination = null")
  .replace("let savedAttempt: DestinationAttempt | null = null", "let savedAttempt = null")
  .replace("function persistAttempt(attempt: DestinationAttempt)", "function persistAttempt(attempt)")
  .replace("async function runAttempt(existingAttempt?: DestinationAttempt, actionOverride?: DestinationAction)", "async function runAttempt(existingAttempt, actionOverride)")
  .replace("let attempt: DestinationAttempt;", "let attempt;");
const readback = source.slice(readbackStart, readbackEnd)
  .replace("attempt: DestinationAttempt, destination: OfficialWalletDestination | null): boolean", "attempt, destination)");

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const actorType = "partner", actorId = "merchant-a", operatorActorId = "finance-a", providerKey = "wallet-a";
const intent = { actorType, actorId, providerKey, sourceId: "onboarding-a" };
const activeDestination = {
  id: "destination-1", actorType, actorId, providerKey, walletIdentifierMasked: "***123",
  status: "ACTIVE_FOR_PAYOUT", verificationStatus: "VERIFIED",
};
const candidate = {
  ...activeDestination, status: "CANDIDATE", verificationStatus: "PENDING_VERIFICATION",
  submittedBy: operatorActorId, changeReason: "verified change", verificationEvidenceReference: "identity-reference",
  changeEvidenceReference: "change-reference",
};
const response = (body, status = 200) => ({
  ok: status >= 200 && status < 300, status, json: async () => body,
});
const destinationBody = (destination = activeDestination) => response({ destination });
const intentBody = () => response({ intent, operatorActorId });
const storageKey = (operator, kind, actor) => `finance-official-wallet-destination:${operator}:${kind}:${actor}`;

function manager(fetchImpl, state = {}) {
  const mounted = { current: true }, operationEpoch = { current: 0 }, inFlight = { current: false };
  const storage = new Map(), changes = [], calls = [];
  let currentNotice = "", currentError = "", currentBusy = false;
  const set = (name) => (value) => {
    changes.push([name, value]);
    if (name === "notice") currentNotice = value;
    if (name === "error") currentError = value;
    if (name === "busy") currentBusy = value;
  };
  const context = {
    mounted, operationEpoch, inFlight,
    isCurrent: (epoch) => mounted.current && operationEpoch.current === epoch,
    actorType, actorId,
    intent: state.intent ?? null,
    destination: state.destination ?? null,
    operatorActorId: state.operatorActorId ?? "",
    busy: false,
    changeReason: "verified change",
    verificationEvidenceReference: "identity-reference",
    changeEvidenceReference: "change-reference",
    independentEvidenceReference: "verify-reference",
    onReadinessChange: (value) => changes.push(["ready", value]),
    setIntent: set("intent"), setOperatorActorId: set("operator"), setDestination: set("destination"),
    setPendingAttempt: set("pending"), setNotice: set("notice"), setError: set("error"), setBusy: set("busy"),
    window: { sessionStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    } },
    storageKey,
    crypto: { randomUUID: (() => { let serial = 0; return () => `uuid-${++serial}`; })() },
    encodeURIComponent,
    isDestination: (value) => Boolean(value?.id && value.actorId && value.actorType && value.providerKey && value.walletIdentifierMasked && value.verificationStatus && value.status),
    errorMessage: (_, fallback) => fallback,
    intentPayloadIsCurrent: (saved, kind, id) => saved.actorType === kind && saved.actorId === id && Boolean(saved.providerKey.trim()),
    fetch: (url, options) => { calls.push([url, options]); return fetchImpl(url, options); },
  };
  const operations = runInNewContext(`${readback}\n${runnable}\n({readCanonical,read,runAttempt});`, context);
  return { ...operations, mounted, operationEpoch, inFlight, storage, changes, calls,
    get notice() { return currentNotice; }, get error() { return currentError; },
    get busy() { return currentBusy; },
  };
}

test("canonical wallet readiness requires current verified destination, never a previous beneficiary", async () => {
  const intentFetch = deferred();
  const m = manager((url) => url.includes("/intent?") ? intentFetch.promise : Promise.resolve(destinationBody()));
  const reading = m.read();
  assert.equal(m.busy, true);
  // A beneficiary/identity subtree change invalidates the earlier operation.
  m.mounted.current = false; m.operationEpoch.current += 1; m.inFlight.current = false;
  m.mounted.current = true;
  intentFetch.resolve(intentBody());
  await reading;
  assert.equal(m.calls.length, 1, "old read must not request a destination after remount");
  assert.equal(m.changes.some(([name, value]) => name === "ready" && value === true), false);
  assert.equal(m.changes.some(([name, value]) => name === "destination" && value !== null), false);
});

test("stale destination response cannot enable settlement of a now-closed review", async () => {
  const dest = deferred();
  const m = manager((url) => url.includes("/intent?") ? Promise.resolve(intentBody()) : dest.promise);
  const reading = m.read();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(m.calls.length, 2);
  m.mounted.current = false; m.operationEpoch.current += 1; m.inFlight.current = false;
  dest.resolve(destinationBody());
  await reading;
  assert.equal(m.changes.some(([name, value]) => name === "ready" && value === true), false);
  assert.equal(m.changes.some(([name, value]) => name === "destination" && value !== null), false);
});

test("current reviewed official destination can become ready on matching canonical readback", async () => {
  const m = manager((url) => Promise.resolve(url.includes("/intent?") ? intentBody() : destinationBody()));
  await m.read();
  assert.equal(m.changes.some(([name, value]) => name === "ready" && value === true), true);
  assert.equal(m.busy, false);
});

test("rapid double read is serialized without duplicate identity or destination queries", async () => {
  const waiting = deferred();
  const m = manager((url) => url.includes("/intent?") ? waiting.promise : Promise.resolve(destinationBody()));
  const first = m.read(), second = m.read();
  assert.equal(m.calls.length, 1);
  waiting.resolve(intentBody());
  await Promise.all([first, second]);
  assert.equal(m.calls.length, 2);
  assert.equal(m.inFlight.current, false);
});

test("same-tick double create uses one original idempotency key and canonical confirmation", async () => {
  const pending = deferred();
  const m = manager((url, options) => options?.method === "POST"
    ? pending.promise : Promise.resolve(url.includes("/intent?") ? intentBody() : destinationBody(candidate)),
  { intent, operatorActorId });
  const first = m.runAttempt(undefined, "create");
  const duplicate = m.runAttempt(undefined, "create");
  const readWhileWriting = m.read();
  assert.equal(m.calls.filter(([, options]) => options?.method === "POST").length, 1);
  const stored = storageKey(operatorActorId, actorType, actorId);
  assert.equal(m.storage.has(stored), true);
  const originallySaved = JSON.parse(m.storage.get(stored));
  assert.equal(originallySaved.idempotencyKey, "uuid-1");
  pending.resolve(destinationBody(candidate));
  await Promise.all([first, duplicate, readWhileWriting]);
  assert.equal(m.calls.filter(([, options]) => options?.method === "POST").length, 1);
  assert.equal(m.calls.filter(([url]) => url.includes("/intent?")).length, 1);
  assert.equal(m.storage.has(stored), false);
  assert.match(m.notice, /نجح الإجراء/);
  assert.equal(m.inFlight.current, false);
});

test("old POST after operator switch cannot start canonical reads, show success or delete the saved retry key", async () => {
  const pending = deferred();
  const m = manager((_url, options) => options?.method === "POST" ? pending.promise : Promise.resolve(intentBody()),
    { intent, operatorActorId });
  const posting = m.runAttempt(undefined, "create");
  const stored = storageKey(operatorActorId, actorType, actorId);
  assert.equal(m.storage.has(stored), true);
  m.mounted.current = false; m.operationEpoch.current += 1; m.inFlight.current = false;
  pending.resolve(destinationBody(candidate));
  await posting;
  assert.equal(m.calls.length, 1);
  assert.equal(m.storage.has(stored), true);
  assert.equal(m.changes.some(([name, value]) => name === "notice" && typeof value === "string" && value.includes("نجح")), false);
  assert.equal(m.changes.some(([name, value]) => name === "ready" && value === true), false);
});

test("unknown server result keeps actor-bound attempt available for safe recovery", async () => {
  const m = manager((_url, options) => options?.method === "POST"
    ? Promise.reject(new Error("transport lost")) : Promise.resolve(intentBody()),
  { intent, operatorActorId });
  await m.runAttempt(undefined, "create");
  const key = storageKey(operatorActorId, actorType, actorId);
  assert.equal(m.storage.has(key), true);
  assert.equal(JSON.parse(m.storage.get(key)).idempotencyKey, "uuid-1");
  assert.match(m.error, /تعذر تأكيد نتيجة الإجراء/);
  assert.equal(m.inFlight.current, false);
});

test("Finance cannot verify its own candidate or approve its own verification", async () => {
  const verify = manager(() => { throw new Error("should not send"); }, {
    intent, operatorActorId, destination: { ...candidate, submittedBy: operatorActorId },
  });
  await verify.runAttempt(undefined, "verify");
  assert.match(verify.error, /موظف المالية آخر/);
  assert.equal(verify.calls.length, 0);
  const approve = manager(() => { throw new Error("should not send"); }, {
    intent, operatorActorId, destination: { ...activeDestination, status: "PENDING_APPROVAL", verifiedBy: operatorActorId },
  });
  await approve.runAttempt(undefined, "activate");
  assert.match(approve.error, /موظف المالية آخر/);
  assert.equal(approve.calls.length, 0);
});

test("failed canonical refresh clears old wallet identity and destination from actionable UI", async () => {
  const m = manager(() => Promise.reject(new Error("identity is unreachable")),
    { intent, operatorActorId, destination: activeDestination });
  await m.read();
  assert.equal(m.changes.some(([name, value]) => name === "intent" && value === null), true);
  assert.equal(m.changes.some(([name, value]) => name === "operator" && value === ""), true);
  assert.equal(m.changes.some(([name, value]) => name === "destination" && value === null), true);
  assert.equal(m.changes.some(([name, value]) => name === "pending" && value === null), true);
  assert.equal(m.changes.some(([name, value]) => name === "ready" && value === true), false);
  assert.match(m.error, /تعذر قراءة الوجهة/);
});

test("success-shaped POST without matching canonical payout destination retains attempt and blocks readiness", async () => {
  const m = manager((url, options) => options?.method === "POST"
    ? Promise.resolve(destinationBody(candidate))
    : Promise.resolve(url.includes("/intent?") ? intentBody() : destinationBody(activeDestination)),
  { intent, operatorActorId });
  await m.runAttempt(undefined, "create");
  const key = storageKey(operatorActorId, actorType, actorId);
  assert.equal(m.storage.has(key), true);
  assert.equal(m.changes.some(([name, value]) => name === "ready" && value === true), false);
  assert.doesNotMatch(m.notice, /نجح الإجراء/);
  assert.match(m.error, /لم تثبت الحالة المتوقعة/);
});

test("cleanup hooks invalidate async work on beneficiary change and unmount", () => {
  assert.match(source, /return \(\) => \{\s*mounted\.current = false;\s*operationEpoch\.current \+= 1;\s*inFlight\.current = false;/);
  assert.match(source, /\}, \[actorType, actorId\]\);/);
  assert.match(source, /if \(!isCurrent\(epoch\)\) return null;/);
});
