import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wallet = readFileSync(new URL("./wallet.tsx", import.meta.url), "utf8");
const cash = readFileSync(new URL("./cash-in-panel.tsx", import.meta.url), "utf8");
const payout = readFileSync(new URL("../account/captain-payout-card.tsx", import.meta.url), "utf8");
const cashLoad = cash.slice(cash.indexOf("  const load = useCallback(async () => {"), cash.indexOf("  const createIntent = async () => {"));
const payoutLoad = payout.slice(payout.indexOf("  const load = useCallback(async () => {"), payout.indexOf("  const request = async ("));

test("wallet remounts both financial surfaces when the authenticated actor changes", () => {
  assert.match(wallet, /subscribeIdentitySession\(setIdentityState\)/);
  assert.match(wallet, /const activeActorID = identityState\.kind === "authenticated"/);
  assert.match(wallet, /<CaptainCashInPanel key=\{activeActorID\} \/>/);
  assert.match(wallet, /<CaptainPayoutCard key=\{activeActorID\} \/>/);
});

test("cash-in readback invalidates delayed results on actor switch, blur, and newer reads", () => {
  assert.match(cashLoad, /const sequence = \+\+readSequence\.current;/);
  assert.match(cashLoad, /sequence === readSequence\.current && hasCurrentFundingActor\(actorID\)/);
  assert.match(cashLoad, /SecureStore\.getItemAsync\(attemptKey\(actorID\)\);\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(cashLoad, /client\.readOwnWallet\(token\);\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(cashLoad, /client\.listWalletProviders\(token\);\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(cashLoad, /client\.readOwnFundingIntent\(token, attempt\.fundingIntentID\)\)\.intent;\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(cashLoad, /client\.reconcileOwnFundingIntent\([\s\S]*?\)\)\.intent;\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(cashLoad, /const canonicalWallet = terminal \? await client\.readOwnWallet\(token\) : walletResponse;\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(cashLoad, /storedAttempt\.idempotencyKey === attempt\.idempotencyKey/);
  assert.match(cashLoad, /storedAttempt\.correlationID === attempt\.correlationID/);
  assert.match(cash, /return \(\) => \{ readSequence\.current \+= 1; \};/);
  assert.match(cash, /const visibleWallet = currentActorReadback \? wallet : null;/);
  assert.match(cash, /if \(!isCurrentCaptainActor\(loadedActorID, actorID\)/);
});

test("payout readback is actor and sequence scoped before exposing finance results", () => {
  assert.match(payoutLoad, /const sequence = \+\+readSequence\.current;/);
  assert.match(payoutLoad, /sequence === readSequence\.current && hasCurrentPayoutActor\(actorID\)/);
  assert.match(payoutLoad, /const token = await getUsableIdentityAccessToken\(\);\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(payoutLoad, /const payoutState = \(await captainClient\(\)\.readOwnPayoutState\(token\)\)\.state;\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(payoutLoad, /payoutState\.actorType !== "captain" \|\| payoutState\.actorId !== actorID/);
  assert.match(payoutLoad, /const intakes = \(await captainClient\(\)\.listOwnSettlementIntakes\(token\)\)\.intakes;\s*if \(!stillCurrent\(\)\) return;/);
  assert.match(payoutLoad, /setPendingAttempt\(raw \? JSON\.parse\(raw\) as PayoutAttempt : null\);/);
  assert.match(payout, /return \(\) => \{ readSequence\.current \+= 1; \};/);
});

test("payout/settlement actions reject an old actor before issuing financial mutations", () => {
  const request = payout.slice(payout.indexOf('  const request = async ('), payout.indexOf('  const requestIntake = async ('));
  const intake = payout.slice(payout.indexOf('  const requestIntake = async ('), payout.indexOf('  const destinationReady ='));
  assert.match(request, /if \(!hasCurrentPayoutActor\(loadedActorID\) \|\| busy\) return;/);
  assert.match(request, /!isCurrentCaptainActor\(loadedActorID, actor\.identity\.subject\.trim\(\)\)/);
  assert.match(request, /const readback = \(await captainClient\(\)\.readOwnPayoutState\(token\)\)\.state;\s*if \(!hasCurrentPayoutActor\(actor\.identity\.subject\.trim\(\)\)\)/);
  assert.match(intake, /!isCurrentCaptainActor\(loadedActorID, actor\.identity\.subject\.trim\(\)\)/);
});
