import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = readFileSync(new URL("../src/features/access/admission-transport.ts", import.meta.url), "utf8");
const compiled = stripTypeScriptTypes(source, { mode: "transform" })
  .replace(/import\s+\{([^}]*)\}\s+from\s+["']([^"']+)["'];/gs,
    (_match, names, moduleName) => `const {${names}} = require("${moduleName}");`)
  .replace(/import\s+\*\s+as\s+(\w+)\s+from\s+["']([^"']+)["'];/g,
    (_match, name, moduleName) => `const ${name} = require("${moduleName}");`)
  .replace(/export async function (\w+)\(/g, "async function $1(") +
  "\nmodule.exports = { verifyCaptainCode };";

test("Captain post-verification cleanup revokes using a fresh bounded signal", async () => {
  const calls = [];
  let deadlines = 0;
  class OwnerError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const mocks = {
    "@bthwani/identity": {
      IdentityClientError: OwnerError,
      async verifyCustomerPhoneChallenge() { return {accessToken:"temporary-customer"}; },
      async readVerifiedIdentitySession() { return {actorId:"captain-one",role:"customer"}; },
      async revokeVerifiedIdentitySession(_origin, bearer, signal) {
        calls.push({ bearer, signal });
        assert.ok(signal instanceof AbortSignal,"cleanup must pass independent abort signal");
        await new Promise(resolve => signal.addEventListener("abort",resolve,{once:true}));
      },
    },
    "expo-secure-store": { WHEN_UNLOCKED_THIS_DEVICE_ONLY:"device" },
    "react-native": { Platform: {OS:"android"} },
    "./captain-standing": {
      CaptainStandingError: OwnerError,
      async readApprovedCaptainStanding() { throw new OwnerError(403,"CAPTAIN_NOT_ELIGIBLE"); },
      async requestCaptainApplication() { return "PENDING"; },
    },
  };
  const mod = { exports:{} };
  new Function("require","module","exports","process","setTimeout","clearTimeout",compiled)(
    key => {
      assert.ok(Object.hasOwn(mocks,key),"unexpected dependency "+key);
      return mocks[key];
    },mod,mod.exports,{
      env:{
        EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN:"http://127.0.0.1:3201",
        EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN:"http://127.0.0.1:3202",
      },
    },(fn,ms)=>{
      assert.equal(ms,2000);
      deadlines++;
      queueMicrotask(fn);
      return 1;
    },()=>undefined
  );
  const outcome = await mod.exports.verifyCaptainCode("synthetic-ticket","123456",new AbortController().signal);
  assert.deepEqual(outcome,{state:"pending"});
  assert.equal(deadlines,1);
  assert.equal(calls.length,1);
  assert.equal(calls[0].bearer,"temporary-customer");
  assert.equal(calls[0].signal.aborted,true);
});


test("consumed Captain phone proof requires a fresh ticket while incorrect code remains retryable", async () => {
  class OwnerError extends Error {
    constructor(status, code) { super(code); this.status=status; this.code=code; }
  }
  for (const incorrectCode of [true,false]) {
    let challenges=0;
    const deps={
      "@bthwani/identity":{
        IdentityClientError:OwnerError,
        async verifyCustomerPhoneChallenge(){
          challenges++;
          if (incorrectCode) throw new OwnerError(401,"UNAUTHORIZED");
          return {accessToken:"synthetic-customer-token"};
        },
        async readVerifiedIdentitySession(){
          return {actorId:"captain-one",role:"customer"};
        },
        async revokeVerifiedIdentitySession(){},
      },
      "expo-secure-store":{ WHEN_UNLOCKED_THIS_DEVICE_ONLY:"device" },
      "react-native":{ Platform:{OS:"android"} },
      "./captain-standing":{
        CaptainStandingError:OwnerError,
        async readApprovedCaptainStanding(){
          throw new OwnerError(503,"OWNER_UNAVAILABLE");
        },
        async requestCaptainApplication(){ throw new Error("should not apply after owner outage"); },
      },
    };
    const mod={exports:{}};
    new Function("require","module","exports","process",compiled)(
      key=>deps[key],mod,mod.exports,{
        env:{
          EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN:"http://127.0.0.1:3201",
          EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN:"http://127.0.0.1:3202",
        }
      }
    );
    await assert.rejects(
      mod.exports.verifyCaptainCode("ticket","123456",new AbortController().signal),
      {code:incorrectCode?"UNAUTHORIZED":"PHONE_CHALLENGE_CONSUMED"}
    );
    assert.equal(challenges,1);
  }
});

test("definitive DSH suspension is reported as ineligible, not an incorrect phone proof", async () => {
  class IdentityError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  class StandingError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
  }
  const revoked = [];
  const mocks = {
    "@bthwani/identity": {
      IdentityClientError: IdentityError,
      async verifyCustomerPhoneChallenge() { return { accessToken: "temporary-customer" }; },
      async readVerifiedIdentitySession() { return { actorId: "captain-one", role: "customer" }; },
      async revokeVerifiedIdentitySession(_origin, bearer) { revoked.push(bearer); },
    },
    "expo-secure-store": { WHEN_UNLOCKED_THIS_DEVICE_ONLY: "device" },
    "react-native": { Platform: { OS: "android" } },
    "./captain-standing": {
      CaptainStandingError: StandingError,
      async readApprovedCaptainStanding() { throw new StandingError(403, "CAPTAIN_NOT_ELIGIBLE"); },
      async requestCaptainApplication() { throw new StandingError(403, "CAPTAIN_NOT_ELIGIBLE"); },
    },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", "process", "setTimeout", "clearTimeout", compiled)(
    name => {
      assert.ok(Object.hasOwn(mocks, name));
      return mocks[name];
    },
    mod, mod.exports,
    { env: {
      EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN: "http://127.0.0.1:3201",
      EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN: "http://127.0.0.1:3202",
    } },
    setTimeout, clearTimeout,
  );
  await assert.rejects(
    mod.exports.verifyCaptainCode("synthetic-ticket", "123456", new AbortController().signal),
    error => error instanceof StandingError && error.status === 403 && error.code === "CAPTAIN_NOT_ELIGIBLE",
    "owner-confirmed suspension must be reported distinctly from a consumed phone challenge",
  );
  assert.deepEqual(revoked, ["temporary-customer"], "temporary Customer proof is revoked even after DSH refusal");
});
