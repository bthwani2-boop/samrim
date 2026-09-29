import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { executeStaticCoverageOwners } from "../dev/sonar-static-coverage.mjs";

test("app-client mobile behavioral harness", async () => {
  process.argv[2] = "app-client";
  await import("./test-mobile-app.mjs");

  const root = path.resolve(import.meta.dirname, "../..");
  const {
    clearOrderConversationMessageAttempt,
    createOrderConversationMessageAttempt,
    orderConversationMessageAttemptStorageKey,
  } = await import(pathToFileURL(path.join(root, "services/dsh/clients/order-conversation-attempt.ts")).href);
  const attempt = createOrderConversationMessageAttempt(
    "usr_cleanup_001",
    "order_cleanup_001",
    "رسالة اختبار",
    "cleanup_idempotency_001",
    "cleanup_correlation_001",
  );
  let removedKey = "";
  let observedFailure = null;
  assert.equal(await clearOrderConversationMessageAttempt("client", attempt, async (key) => { removedKey = key; }, () => {}), true);
  assert.equal(removedKey, orderConversationMessageAttemptStorageKey("client", attempt.actorID, attempt.orderID));
  const storageFailure = new Error("storage unavailable");
  assert.equal(await clearOrderConversationMessageAttempt("client", attempt, async () => { throw storageFailure; }, (error_) => { observedFailure = error_; }), false);
  assert.equal(observedFailure, storageFailure);
});

test("static verifier owners execute under Sonar coverage", async () => {
  await executeStaticCoverageOwners();
});
