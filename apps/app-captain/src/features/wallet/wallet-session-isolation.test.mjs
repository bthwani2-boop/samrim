import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const wallet = readFileSync(new URL("./wallet.tsx", import.meta.url), "utf8");
const cash = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const payout = readFileSync(new URL("./captain-payout-card.tsx", import.meta.url), "utf8");
const cashLoad = cash.slice(cash.indexOf("  const load = useCallback(async () => {"), cash.indexOf("  const createIntent = async () => {"));
const payoutLoad = payout.slice(payout.indexOf("  const load = useCallback(async () => {"), payout.indexOf("  const request = async ("));
const identity = (subject, sessionId) => ({ kind: "authenticated", identity: { subject, sessionId, role: "captain" } });

test("wallet re-mounts independently on actor switch AND same-actor Identity renewal", () => {
  const first = captainSessionKey(identity("captain-a", "login-1"));
  assert.notEqual(first, captainSessionKey(identity("captain-a", "login-2")));
  assert.notEqual(first, captainSessionKey(identity("captain-b", "login-1")));
  assert.match(wallet, /subscribeIdentitySession\(setIdentityState\)/);
  assert.match(wallet, /const activeSessionKey = captainSessionKey\(identityState\)/);
  assert.match(wallet, /const currentSessionKey = activeSessionKey && captainSessionKey\(currentIdentityState\(\)\) === activeSessionKey/);
  assert.match(wallet, /currentSessionKey \? <>/);
  assert.match(wallet, /cash-in:\$\{currentSessionKey\}/);
  assert.match(wallet, /payout:\$\{currentSessionKey\}/);
  assert.doesNotMatch(wallet, /activeActorID/);
});

test("cash-in source rejects private readback from a superseded Identity session", () => {
  assert.match(cashLoad, /const sequence = \+\+readSequence\.current/);
  assert.match(cashLoad, /const requestSession = captainSessionKey\(identity\)/);
  assert.match(cashLoad, /sequence === readSequence\.current && hasCurrentFundingSession\(requestSession\)/);
  assert.match(cashLoad, /setLoadedSessionKey\(requestSession\)/);
  assert.match(cashLoad, /SecureStore\.getItemAsync\(attemptKey\(actorID\)\);\s*if \(!stillCurrent\(\)\) return/);
  assert.match(cashLoad, /client\.readOwnWallet\(token\);\s*if \(!stillCurrent\(\)\) return/);
  assert.match(cashLoad, /client\.listWalletProviders\(token\);\s*if \(!stillCurrent\(\)\) return/);
  assert.match(cashLoad, /client\.readOwnFundingIntent\(token, attempt\.fundingIntentID\)\)\.intent;\s*if \(!stillCurrent\(\)\) return/);
  assert.match(cashLoad, /const canonicalWallet = terminal \? await client\.readOwnWallet\(token\) : walletResponse;\s*if \(!stillCurrent\(\)\) return/);
  assert.match(cash, /return \(\) => \{ readSequence\.current \+= 1; \}/);
  assert.match(cash, /const visibleWallet = currentSessionReadback \? wallet : null/);
  assert.doesNotMatch(cash, /hasCurrentFundingActor|loadedActorID|currentActorReadback/);
});

test("payout source hides WLT-backed balances, retries and intake from former session", () => {
  assert.match(payoutLoad, /const requestSession = captainSessionKey\(identity\)/);
  assert.match(payoutLoad, /sequence === readSequence\.current && hasCurrentPayoutSession\(requestSession\)/);
  assert.match(payoutLoad, /setLoadedSessionKey\(requestSession\)/);
  assert.match(payoutLoad, /const payoutState = \(await captainClient\(\)\.readOwnPayoutState\(token\)\)\.state;\s*if \(!stillCurrent\(\)\) return/);
  assert.match(payoutLoad, /payoutState\.actorType !== "captain" \|\| payoutState\.actorId !== actorID/);
  assert.match(payoutLoad, /const intakes = \(await captainClient\(\)\.listOwnSettlementIntakes\(token\)\)\.intakes;\s*if \(!stillCurrent\(\)\) return/);
  assert.match(payout, /const state = currentSessionReadback \? loadedState : null/);
  assert.match(payout, /const pendingAttempt = currentSessionReadback \? savedPendingAttempt : null/);
  assert.match(payout, /const pendingIntakeAttempt = currentSessionReadback \? savedIntakeAttempt : null/);
  assert.match(payout, /const intake = currentSessionReadback \? loadedIntake : null/);
  assert.match(payout, /return \(\) => \{ readSequence\.current \+= 1; \}/);
  assert.doesNotMatch(payout, /hasCurrentPayoutActor|loadedActorID/);
});

test("both financial intents preserve actor-owned durable retry keys but check the session", () => {
  const request = payout.slice(payout.indexOf("  const request = async ("), payout.indexOf("  const requestIntake = async ("));
  const intake = payout.slice(payout.indexOf("  const requestIntake = async ("), payout.indexOf("  const destinationReady ="));
  assert.match(request, /if \(!hasCurrentPayoutSession\(loadedSessionKey\) \|\| busy\) return/);
  assert.match(request, /captainSessionKey\(actor\) !== requestSession/);
  assert.match(intake, /loadedSessionKey !== requestSession/);
  assert.match(request, /bthwani\.captain\.payout\.pending\.v1\.\$\{encodeURIComponent\(actor\.identity\.subject\)\}/);
  assert.match(intake, /bthwani\.captain\.settlement-intake\.pending\.v1\.\$\{encodeURIComponent\(actor\.identity\.subject\)\}/);
  assert.match(cash, /bthwani\.captain\.cash-in\.pending\.v1\.\$\{encodeURIComponent\(actorID\)\}/);
});
