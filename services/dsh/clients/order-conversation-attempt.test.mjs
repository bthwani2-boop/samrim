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

test("private media retry keeps the same file and audience without persisting media bytes", () => {
  const value=createOrderConversationMessageAttempt("client-1","order-1","صورة مرفقة","conversation-media-123","correlation-media-123",["operator"],
    {kind:"image",contentType:"image/jpeg",fileUri:"file:///sandbox/orders/photo.jpg"});
  const restored=parseOrderConversationMessageAttempt(JSON.stringify(value),"client-1","order-1");
  assert.equal(restored?.mediaKind,"image");
  assert.equal(restored?.mediaContentType,"image/jpeg");
  assert.equal(restored?.mediaFileUri,"file:///sandbox/orders/photo.jpg");
  assert.deepEqual(restored?.recipientRoles,["operator"]);
  assert.equal(restored?.idempotencyKey,value.idempotencyKey);
  assert.equal(JSON.stringify(value).includes("dataBase64"),false);
  assert.throws(()=>parseOrderConversationMessageAttempt(JSON.stringify({...value,mediaFileUri:undefined}),"client-1","order-1"),/MEDIA_INVALID/);
  assert.throws(()=>createOrderConversationMessageAttempt("client-1","order-1","صورة","conversation-media-123","correlation-media-123",["operator"],
    {kind:"image",contentType:"text/html",fileUri:"file:///sandbox/photo"}),/MEDIA_INVALID/);
});
