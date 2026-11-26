import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const source = fileURLToPath(new URL("../src/features/access/admission-transport.ts", import.meta.url));
const root = path.resolve(import.meta.dirname, "../../..");
const temporary = mkdtempSync(path.join(tmpdir(), "captain-admission-coverage-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--inlineSourceMap", "--inlineSources", "--outDir", temporary,
  ], { cwd: root, timeout: 20_000, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temporary, "admission-transport.js"), "utf8");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function loadAdmissionFixture(dependencies, env) {
  // The source reads these three fixture values synchronously at module load.
  // Restore the test worker's environment before any asynchronous operation.
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    return loadMappedRenderFixture(compiled, source, dependencies).exports;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function harness() {
  const tokens = {
    customer: Buffer.alloc(32, 41).toString("base64url"),
    captain: Buffer.alloc(32, 42).toString("base64url"),
    refresh: Buffer.alloc(32, 43).toString("base64url"),
  };
  const stored = new Map();
  let writeFailure = null;
  let markerFailure = null;
  let deleteBearerFails = false;
  let revokeCaptainFails = true;
  let captainRevocationError = null;
  let ownerReads = 0;
  let ownerAdmissions = 0;
  let customerProofs = 0;
  let captainRevocationAttempts = 0;
  let enroll = async () => ({ refreshToken: tokens.refresh, refreshExpiresAt: new Date(Date.now() + 60000).toISOString() });
  let readStanding = async () => ({ status: "APPROVED" });
  let readIdentity = async (_origin, bearer) => ({
    actorId: "captain-owner-one",
    role: bearer === tokens.customer ? "customer" : "captain",
    sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  class OwnerError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const secureStore = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device",
    async getItemAsync(key) { return stored.get(key) ?? null; },
    async setItemAsync(key, value) {
      stored.set(key, value);
      if (key.endsWith(".pending.v1")) return;
      if (writeFailure === "after") throw new Error("bearer write persisted, then acknowledgment failed");
      if (writeFailure === "before") {
        stored.delete(key);
        throw new Error("bearer write failed before persistence");
      }
    },
    async deleteItemAsync(key) {
      if (key.endsWith(".pending.v1")) {
        if (markerFailure === "before") throw new Error("pending marker deletion failed");
        stored.delete(key);
        if (markerFailure === "after") throw new Error("pending marker deleted, acknowledgment failed");
        return;
      }
      if (deleteBearerFails) throw new Error("bearer cleanup unavailable");
      stored.delete(key);
    },
  };
  const dependencies = {
    "@bthwani/identity": {
      IdentityClientError: OwnerError,
      async verifyCustomerPhoneChallenge() { customerProofs++; return { accessToken: tokens.customer }; },
      async readVerifiedIdentitySession(_origin, bearer) {
        ownerReads++;
        return readIdentity(_origin, bearer);
      },
      establishPersistentIdentitySession: (_origin, bearer, signal) => {
        assert.equal(bearer, tokens.captain);
        return enroll(signal);
      },
      async readPersistentIdentityRole(origin, bearer, refresh, role) {
        assert.ok(refresh === null || refresh === tokens.refresh);
        ownerReads++;
        const session = await readIdentity(origin, bearer);
        if (session.role !== role) throw new OwnerError(403, "FORBIDDEN");
        return { session, bearer };
      },
      async revokePersistentIdentitySession(_origin, token) { assert.equal(token, tokens.refresh); },
      async admitCurrentCustomerAsCaptain() { ownerAdmissions++; return { accessToken: tokens.captain }; },
      async revokeVerifiedIdentitySession(_origin, bearer) {
        if (bearer === tokens.captain) {
          captainRevocationAttempts++;
          if (revokeCaptainFails) throw captainRevocationError ?? new OwnerError(503, "OWNER_UNAVAILABLE");
        }
      },
    },
    "expo-secure-store": secureStore,
    "react-native": { Platform: { OS: "android" } },
    "./captain-standing": {
      CaptainStandingError: OwnerError,
      async readApprovedCaptainStanding(...args) { return readStanding(...args); },
      async requestCaptainApplication() { return "PENDING"; },
    },
  };
  const reload = ({ legacySetting = false } = {}) => {
    return loadAdmissionFixture(dependencies, {
      EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN: "http://127.0.0.1:3201",
      EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN: "http://127.0.0.1:3202",
      EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW: legacySetting ? "1" : "0",
    });
  };
  return {
    tokens, stored, reload,
    setWriteFailure(value) { writeFailure = value; },
    setMarkerFailure(value) { markerFailure = value; },
    setDeleteBearerFails(value) { deleteBearerFails = value; },
    setRevokeCaptainFails(value) { revokeCaptainFails = value; },
    setCaptainRevocationError(status, code) { captainRevocationError = new OwnerError(status, code); },
    setStandingRead(callback) { readStanding = callback; },
    setEnrollment(fn) { enroll = fn; },
    currentRefresh() { return [...stored].find(([key]) => key.endsWith(".refresh.v1"))?.[1] ?? null; },
    setIdentityRead(callback) { readIdentity = callback; },
    ownerError(status, code) { return new OwnerError(status, code); },
    get ownerReads() { return ownerReads; },
    get ownerAdmissions() { return ownerAdmissions; },
    get captainRevocationAttempts() { return captainRevocationAttempts; },
    get customerProofs() { return customerProofs; },
    readToken() { return [...stored].find(([key]) => !key.endsWith(".pending.v1") && !key.endsWith(".refresh.v1"))?.[1] ?? null; },
    pending() { return [...stored].find(([key]) => key.endsWith(".pending.v1"))?.[1] ?? null; },
  };
}

test("mapped admission fixture restores worker environment on success and failure", () => {
  const env = {
    EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN: "http://127.0.0.1:3201",
    EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN: "http://127.0.0.1:3202",
    EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW: "1",
  };
  const snapshot = () => Object.keys(env).map(key => process.env[key]);
  const before = snapshot();
  harness().reload({ legacySetting: true });
  assert.deepEqual(snapshot(), before);
  assert.throws(() => loadAdmissionFixture({}, env), /unexpected fixture dependency/);
  assert.deepEqual(snapshot(), before);
});

test("retired Surface setting cannot select another Captain credential namespace", async () => {
  const h = harness();
  const installedKey = "bthwani.captain.synthetic-admission.v1";
  const retiredKey = "bthwani.captain.synthetic-admission.surface.v1";
  h.stored.set(installedKey, h.tokens.captain);
  const signal = new AbortController().signal;
  const api = h.reload({ legacySetting: true });
  assert.equal((await api.readCaptainAdmission(signal)).session?.actorId, "captain-owner-one");
  h.stored.set(retiredKey, h.tokens.customer);
  assert.equal((await api.readCaptainAdmission(signal)).session?.role, "captain");
  assert.equal(h.stored.get(installedKey), h.tokens.captain);
  assert.equal(h.stored.get(retiredKey), h.tokens.customer);
  const isolated = harness();
  isolated.stored.set(retiredKey, isolated.tokens.captain);
  const retired = isolated.reload({ legacySetting: true });
  assert.deepEqual(await retired.readCaptainAdmission(signal), { enabled: true, standingReady: true, session: null });
  await retired.leaveCaptainAdmission(signal);
  assert.equal(isolated.ownerReads, 0);
  assert.equal(isolated.captainRevocationAttempts, 0);
  assert.equal(isolated.stored.get(retiredKey), isolated.tokens.captain);
  assert.equal(h.captainRevocationAttempts, 0);
});

test("Captain account logout cannot revoke a newer or different actor", async () => {
  const h = harness();
  const controller = new AbortController();
  h.stored.set("bthwani.captain.synthetic-admission.v1", h.tokens.captain);
  await assert.rejects(h.reload().leaveCaptainAdmission(controller.signal, "earlier-captain"),
    { status: 409, code: "CAPTAIN_CONTEXT_CHANGED" });
  assert.equal(h.pending(), null);
  assert.equal(h.captainRevocationAttempts, 0);
  assert.equal(h.readToken(), h.tokens.captain);
  h.setRevokeCaptainFails(false);
  await h.reload().leaveCaptainAdmission(controller.signal, "captain-owner-one");
  assert.equal(h.captainRevocationAttempts, 1);
  assert.equal(h.readToken(), null);
});

test("Captain undelivered bearer must not resurrect after restart, even when storage and revoke fail", async () => {
  const h = harness();
  h.setWriteFailure("after");
  h.setDeleteBearerFails(true);
  await assert.rejects(h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal),
    { code: "PHONE_CHALLENGE_CONSUMED" });
  assert.equal(h.readToken(), h.tokens.captain, "token may have persisted before write error");
  assert.ok(h.pending(), "durable quarantine must survive despite failed cleanup");
  const before = h.ownerReads;
  const restored = await h.reload().readCaptainAdmission(new AbortController().signal);
  assert.deepEqual(restored, { enabled: true, standingReady: true, session: null });
  assert.equal(h.ownerReads, before, "quarantined token never reaches owner as admitted bearer");
});

test("Captain marker deletion success-then-error cannot misreport an already committed credential as rejected", async () => {
  const h = harness();
  h.setMarkerFailure("after");
  h.setDeleteBearerFails(true);
  const result = await h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal);
  assert.equal(result.state, "approved");
  assert.equal(h.pending(), null);
  assert.equal(h.readToken(), h.tokens.captain);
  const restored = await h.reload().readCaptainAdmission(new AbortController().signal);
  assert.equal(restored.session?.role, "captain");
});

test("Captain marker deletion before effect leaves approved local response but cold-start access quarantined", async () => {
  const h = harness();
  h.setMarkerFailure("before");
  h.setDeleteBearerFails(true);
  const result = await h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal);
  assert.equal(result.state, "approved");
  assert.ok(h.pending());
  assert.deepEqual(await h.reload().readCaptainAdmission(new AbortController().signal),
    { enabled: true, standingReady: true, session: null });
});

test("Captain normal admission survives process restart and pending recovery blocks proof reuse", async () => {
  const h = harness();
  const admitted = await h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal);
  assert.equal(admitted.state, "approved");
  assert.equal(h.currentRefresh(), h.tokens.refresh);
  assert.equal(h.pending(), null);
  assert.equal((await h.reload().readCaptainAdmission(new AbortController().signal)).session?.role, "captain");
  await assert.rejects(h.reload().verifyCaptainCode("ticket2", "654321", new AbortController().signal),
    { code: "SIGN_OUT_REQUIRED" });
  assert.equal(h.ownerAdmissions, 1, "must not issue a new Captain token over existing verified bearer");
  assert.equal(h.customerProofs, 1, "must not consume a second phone proof");
});

test("Captain signout must remain fail closed after owner outage and device deletion failure", async () => {
  const h = harness();
  await h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal);
  h.setDeleteBearerFails(true);
  await assert.rejects(h.reload().leaveCaptainAdmission(new AbortController().signal),
    { status: 503 });
  assert.ok(h.pending(), "signout uncertainty must remain visible to next process");
  const before = h.ownerReads;
  assert.deepEqual(await h.reload().readCaptainAdmission(new AbortController().signal),
    { enabled: true, standingReady: true, session: null });
  assert.equal(h.ownerReads, before);
});

test("Captain signout on outage retries owner revocation when connectivity returns", async () => {
  const h = harness();
  await h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal);
  await assert.rejects(h.reload().leaveCaptainAdmission(new AbortController().signal), { status: 503 });
  assert.equal(h.captainRevocationAttempts, 1);
  assert.equal(h.readToken(), h.tokens.captain, "revocation recovery requires the quarantined bearer");
  assert.ok(h.pending(), "owner outage must quarantine the bearer even when local deletion is available");
  h.setRevokeCaptainFails(false);
  const restored = await h.reload().readCaptainAdmission(new AbortController().signal);
  assert.deepEqual(restored, { enabled: true, standingReady: true, session: null });
  assert.equal(h.captainRevocationAttempts, 2, "recovery must retry actual Identity revocation");
  assert.equal(h.readToken(), null);
  assert.equal(h.pending(), null);
});

test("Captain logout keeps a quarantined bearer until the Identity contract confirms its outcome", async () => {
  for (const [status, code] of [[403, "FORBIDDEN"], [401, "OWNER_REQUEST_FAILED"]]) {
    const h = harness();
    const instance = h.reload();
    await instance.verifyCaptainCode("ticket", "123456", new AbortController().signal);
    h.setCaptainRevocationError(status, code);
    await assert.rejects(instance.leaveCaptainAdmission(new AbortController().signal), { status, code });
    assert.equal(h.readToken(), h.tokens.captain);
    assert.ok(h.pending());
    h.setCaptainRevocationError(401, "UNAUTHORIZED");
    await h.reload().leaveCaptainAdmission(new AbortController().signal);
    assert.equal(h.captainRevocationAttempts, 2);
    assert.equal(h.readToken(), null);
    assert.equal(h.pending(), null);
  }
});

test("overlapping Captain proofs issue exactly one owner admission", async () => {
  const h = harness();
  const instance = h.reload();
  const first = instance.verifyCaptainCode("ticket-a", "123456", new AbortController().signal);
  const second = instance.verifyCaptainCode("ticket-b", "654321", new AbortController().signal);
  const outcomes = await Promise.allSettled([first, second]);
  assert.equal(outcomes.filter(outcome => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(outcome => outcome.status === "rejected").length, 1);
  assert.equal(outcomes.find(outcome => outcome.status === "rejected")?.reason.code, "SIGN_OUT_REQUIRED");
  assert.equal(h.customerProofs, 1);
  assert.equal(h.ownerAdmissions, 1);
});

test("a repeated Captain signout never claims success while a quarantined bearer cannot be revoked", async () => {
  const h = harness();
  await h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal);
  h.setDeleteBearerFails(true);
  await assert.rejects(h.reload().leaveCaptainAdmission(new AbortController().signal), { status: 503 });
  assert.ok(h.pending());
  await assert.rejects(h.reload().leaveCaptainAdmission(new AbortController().signal), { status: 503 });
  assert.ok(h.pending(), "unknown owner outcome must remain quarantined for another retry");
});

test("a delayed DSH owner approval cannot resurrect a Captain session after sign-out", async () => {
  const h = harness();
  h.setRevokeCaptainFails(false);
  const instance = h.reload();
  await instance.verifyCaptainCode("ticket", "123456", new AbortController().signal);
  let started;
  const reachedStanding = new Promise(resolve => { started = resolve; });
  let approve;
  h.setStandingRead(() => {
    started();
    return new Promise(resolve => { approve = resolve; });
  });
  const current = instance.readCaptainAdmission(new AbortController().signal);
  await reachedStanding;
  await instance.leaveCaptainAdmission(new AbortController().signal);
  assert.equal(h.readToken(), null, "sign-out must discard the credential before owner read completes");
  approve({ status: "APPROVED" });
  const state = await current;
  assert.equal(state.session, null, "stale owner approval cannot restore an already revoked actor");
});

test("a delayed old-actor 401 cannot quarantine a newly installed Captain credential", async () => {
  const h = harness();
  h.setRevokeCaptainFails(false);
  const instance = h.reload();
  await instance.verifyCaptainCode("ticket", "123456", new AbortController().signal);
  let signalStarted;
  const reachedIdentity = new Promise(resolve => { signalStarted = resolve; });
  let rejectOld;
  const replacement = Buffer.alloc(32, 77).toString("base64url");
  h.setIdentityRead(async (_origin, bearer) => {
    if (bearer === h.tokens.captain) {
      signalStarted();
      return new Promise((_resolve, reject) => { rejectOld = reject; });
    }
    return {
      actorId: "new-captain-owner", role: "captain",
      sessionExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  });
  const oldRead = instance.readCaptainAdmission(new AbortController().signal);
  await reachedIdentity;
  h.stored.set("bthwani.captain.synthetic-admission.v1", replacement);
  rejectOld(h.ownerError(401, "UNAUTHORIZED"));
  await oldRead;
  assert.equal(h.readToken(), replacement, "old principal denial must not delete the replacement bearer");
  assert.equal(h.pending(), null, "old principal denial must not quarantine the newly signed-in actor");
  const current = await instance.readCaptainAdmission(new AbortController().signal);
  assert.equal(current.session?.actorId, "new-captain-owner");
});

test("Current Captain home receives the exact owner-verified DSH standing revision", async () => {
  const h = harness();
  h.stored.set("bthwani.captain.synthetic-admission.v1", h.tokens.captain);
  const standing = { actorId: "captain-owner-one", status: "APPROVED", version: 41 };
  let reads = 0;
  h.setStandingRead(async (_origin, token, role, actorId) => {
    reads++;
    assert.equal(token, h.tokens.captain);
    assert.equal(role, "captain");
    assert.equal(actorId, standing.actorId);
    return standing;
  });
  const admission = await h.reload().readCaptainAdmission(new AbortController().signal);
  assert.equal(admission.session?.actorId, standing.actorId);
  assert.deepEqual(admission.standing, standing);
  assert.equal(reads, 1, "one already-authorized DSH read supplies both admission and UI");
});

test("Captain actor switch during owner approval cannot leak the old standing", async () => {
  const h = harness();
  h.stored.set("bthwani.captain.synthetic-admission.v1", h.tokens.captain);
  h.setStandingRead(async () => {
    h.stored.delete("bthwani.captain.synthetic-admission.v1");
    return { actorId: "captain-owner-one", status: "APPROVED", version: 41 };
  });
  const admission = await h.reload().readCaptainAdmission(new AbortController().signal);
  assert.deepEqual(admission, { enabled: true, standingReady: true, session: null });
  assert.equal("standing" in admission, false, "old DSH status must not reach the next actor");
});


test("DSH refusal conceals Captain access without destroying the Identity credential", async () => {
  for (const [status, code] of [[403, "CAPTAIN_NOT_ELIGIBLE"], [401, "UNAUTHORIZED"]]) {
    const h = harness();
    h.stored.set("bthwani.captain.synthetic-admission.v1", h.tokens.captain);
    h.setStandingRead(async () => { throw h.ownerError(status, code); });
    await assert.rejects(h.reload().readCaptainAdmission(new AbortController().signal), { status, code });
    assert.equal(h.readToken(), h.tokens.captain, "DSH must not erase Identity credentials");
    assert.equal(h.pending(), null);
    assert.equal(h.captainRevocationAttempts, 0);
    h.setStandingRead(async () => ({ actorId: "captain-owner-one", status: "APPROVED", version: 2 }));
    const recovered = await h.reload().readCaptainAdmission(new AbortController().signal);
    assert.equal(recovered.session?.actorId, "captain-owner-one");
    assert.equal(recovered.standing?.status, "APPROVED");
    assert.equal(h.customerProofs, 0, "standing recovery must not consume another OTP");
  }
});

test("Captain failed persistent enrollment cannot accept an access-only login", async () => {
  const h = harness();
  h.setEnrollment(async () => { throw h.ownerError(503, "OWNER_UNAVAILABLE"); });
  await assert.rejects(h.reload().verifyCaptainCode("ticket", "123456", new AbortController().signal),
    { code: "PHONE_CHALLENGE_CONSUMED" });
  assert.equal(h.readToken(), null);
  assert.equal(h.currentRefresh(), null);
  assert.equal(h.captainRevocationAttempts, 1);
});
