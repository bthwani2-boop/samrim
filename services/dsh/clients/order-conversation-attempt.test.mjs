import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrderConversationMessageAttempt, parseOrderConversationMessageAttempt, orderConversationMessageAttemptStorageKey } from "./order-conversation-attempt.ts";

test("targeted recipient list persists with same idempotent retry", () => {
  const request = createOrderConversationMessageAttempt("client-1","order-1","رسالة خاصة","conversation-key-123","conversation-correl-123",["operator","partner"]);
  const restored = parseOrderConversationMessageAttempt(JSON.stringify(request),"client-1","order-1");
  assert.deepEqual(restored?.recipientRoles, ["operator", "partner"]);
  assert.equal(restored?.idempotencyKey, request.idempotencyKey);
  assert.equal(restored?.body, request.body);
});
test("tampered or invalid recipients do not survive recovery", () => {
  const valid = createOrderConversationMessageAttempt("client-1","order-1","رسالة","conversation-key-123","conversation-correl-123",["partner"]);
  assert.throws(() => parseOrderConversationMessageAttempt(JSON.stringify({ ...valid, recipientRoles: ["operator","operator"] }),"client-1","order-1"), /INVALID/);
  assert.throws(() => parseOrderConversationMessageAttempt(JSON.stringify(valid),"client-2","order-1"), /SCOPE_MISMATCH/);
  assert.throws(() => createOrderConversationMessageAttempt("client-1","order-1","رسالة","conversation-key-123","conversation-correl-123",[]), /RECIPIENTS_INVALID/);
});
test("pending attempts from prior app versions preserve original audience semantics", () => {
  const old = createOrderConversationMessageAttempt("client-1","order-1","رسالة","conversation-key-123","conversation-correl-123");
  const restored = parseOrderConversationMessageAttempt(JSON.stringify(old),"client-1","order-1");
  assert.equal(restored?.recipientRoles, undefined);
  assert.equal(orderConversationMessageAttemptStorageKey("client","client-1","order-1"),"bthwani.dsh.order-conversation.v1.client.client-1.order-1");
});
