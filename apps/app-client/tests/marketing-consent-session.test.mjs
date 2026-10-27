import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname, "../src/features/account");
const sessionSource = readFileSync(resolve(root, "marketing-consent-session.ts"), "utf8");
const sessionModule = ts.transpileModule(sessionSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(sessionModule, { exports });

const authenticated = (subject) => ({ kind: "authenticated", identity: { subject } });

test("marketing consent belongs to the current authenticated actor only", () => {
  assert.equal(exports.isCurrentMarketingConsentActor(true, "client-A", authenticated(" client-A ")), true);
  assert.equal(exports.isCurrentMarketingConsentActor(true, "client-A", authenticated("client-B")), false);
  assert.equal(exports.isCurrentMarketingConsentActor(true, "client-A", { kind: "signed_out" }), false);
  assert.equal(exports.isCurrentMarketingConsentActor(false, "client-A", authenticated("client-A")), false);
  assert.equal(exports.isCurrentMarketingConsentActor(true, "", authenticated("client-A")), false);
});

test("the account consent consumer rejects stale actor read and write outcomes", () => {
  const source = readFileSync(resolve(root, "marketing-contact-preference.tsx"), "utf8");
  assert.match(source, /subscribeIdentitySession\(/);
  assert.ok(source.includes("const currentConsent = isCurrentMarketingConsentActor(active, actorID, currentIdentityState()) ? consent : null;"));
  assert.match(source, /const isCurrent = \(\) => requestID === loadRequestID\.current/);
  assert.match(source, /if \(isCurrent\(\)\) setConsent\(data\)/);
  assert.match(source, /if \(data\.decision !== \(next \? "OPTED_IN" : "OPTED_OUT"\)/);
  assert.match(source, /if \(isCurrent\(\)\) setConsent\(\{ channel: "PUSH"/);
});