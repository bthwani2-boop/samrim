import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("./order-conversation.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-conversation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated",
  identity: { role: "partner", subject, sessionId },
});

function productionFunctions(names, runtime) {
  const declarations = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text && names.includes(node.name.text)) {
      declarations.set(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of names) assert.ok(declarations.has(name), `missing production function ${name}`);
  const program = names.map(name => declarations.get(name)).join("\n")
    + "\n({ " + names.join(", ") + " })";
  const executable = ts.transpileModule(program, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return runInNewContext(executable, runtime);
}

const accessors = ["conversationActorID", "currentConversationSessionKey", "isCurrentActor"];
const mediaAccessors = [...accessors, "readPrivateMedia"];

test("private Order media read refuses a former same-actor session even when the read completes late", async () => {
  let current = identity("merchant-a", "first-session");
  const oldSession = partnerSetupSessionKey(current);
  let resolveMedia;
  const pendingMedia = new Promise(resolve => { resolveMedia = resolve; });
  const calls = [];
  const { readPrivateMedia } = productionFunctions(mediaAccessors, {
    currentIdentityState: () => current,
    partnerSetupSessionKey,
    getUsableIdentityAccessToken: async () => "first-token",
    client: () => ({ readOrderConversationMedia: async (...args) => {
      calls.push(args);
      return pendingMedia;
    } }),
  });
  const read = readPrivateMedia("order-a", "message-a", oldSession);
  for (let i = 0; i < 4 && !calls.length; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 1, "read reaches DSH only for the session that initiated it");
  current = identity("merchant-a", "second-session");
  resolveMedia({ contentType: "image/jpeg", bytes: "secret-from-first-session" });
  await assert.rejects(read, /PRIVATE_MEDIA_SESSION_CHANGED/);
  await assert.rejects(
    readPrivateMedia("order-a", "message-a", oldSession),
    /PRIVATE_MEDIA_SESSION_REQUIRED/,
  );
  assert.equal(calls.length, 1, "former session must never issue a second private-media request");
});

test("private Order media read works for the current session and fails closed after logout", async () => {
  let current = identity("merchant-a", "first-session");
  const session = partnerSetupSessionKey(current);
  const media = { contentType: "audio/m4a", bytes: "authorized-audio" };
  const { readPrivateMedia } = productionFunctions(mediaAccessors, {
    currentIdentityState: () => current,
    partnerSetupSessionKey,
    getUsableIdentityAccessToken: async () => "current-token",
    client: () => ({ readOrderConversationMedia: async () => media }),
  });
  assert.deepEqual({ ...(await readPrivateMedia("order", "message", session)) }, media);
  current = { kind: "unauthenticated" };
  await assert.rejects(readPrivateMedia("order", "message", session), /PRIVATE_MEDIA_SESSION_REQUIRED/);
});

test("old same-actor session cannot send a prepared media message after asynchronous encoding", async () => {
  let current = identity("merchant-a", "first-session");
  const session = partnerSetupSessionKey(current);
  let completeEncoding;
  const encoding = new Promise(resolve => { completeEncoding = resolve; });
  let writes = 0;
  let recoveryDeletes = 0;
  const attempt = {
    actorID: "merchant-a", orderID: "order-a", body: "صورة مرفقة",
    mediaKind: "image", mediaContentType: "image/jpeg", mediaFileUri: "local-file",
    idempotencyKey: "same-idempotency-key", correlationID: "same-correlation-id",
    recipientRoles: ["client"],
  };
  const callbacks = {
    currentIdentityState: () => current, partnerSetupSessionKey,
    loadedSessionKey: session, correctOwner: true,
    File: class { constructor(path) { this.path = path; } base64() { return encoding; } delete() {} },
    client: () => ({ sendOrderConversationMessage: async () => { writes++; } }),
    SecureStore: { deleteItemAsync: async () => { recoveryDeletes++; } },
    orderConversationMessageAttemptStorageKey: () => "stored-attempt",
    role: "partner",
    setPendingAttempt: () => {}, setBody: () => {}, setError: () => {},
    load: async () => true,
    isDefinitiveDshMobileClientRejection: () => false,
    console: { error: () => {} },
  };
  const { submitAttempt } = productionFunctions([...accessors, "submitAttempt"], callbacks);
  const send = submitAttempt(attempt, "first-token");
  current = identity("merchant-a", "second-session");
  completeEncoding("encoded-image-bytes");
  await send;
  assert.equal(writes, 0, "encoding completion cannot send using the wrong session");
  assert.equal(recoveryDeletes, 0, "the persisted exact-one retry record is preserved");
});

test("successful session-bound media retry retains recipients and idempotency before clearing recovery", async () => {
  const current = identity("merchant-a", "live-session");
  const session = partnerSetupSessionKey(current);
  const calls = [];
  let recoveryDeletes = 0;
  const attempt = {
    actorID: "merchant-a", orderID: "order-a", body: "مرفق",
    mediaKind: "video", mediaContentType: "video/mp4", mediaFileUri: "local-video",
    idempotencyKey: "fixed-key", correlationID: "fixed-correlation", recipientRoles: ["client"],
  };
  const { submitAttempt } = productionFunctions([...accessors, "submitAttempt"], {
    currentIdentityState: () => current, partnerSetupSessionKey,
    loadedSessionKey: session, correctOwner: true,
    File: class { base64() { return Promise.resolve("video-bytes"); } delete() {} },
    client: () => ({ sendOrderConversationMessage: async (...args) => { calls.push(args); } }),
    SecureStore: { deleteItemAsync: async () => { recoveryDeletes++; } },
    orderConversationMessageAttemptStorageKey: () => "stored-attempt", role: "partner",
    setPendingAttempt: () => {}, setBody: () => {}, setError: () => {},
    load: async () => true, isDefinitiveDshMobileClientRejection: () => false,
    console: { error: () => {} },
  });
  await submitAttempt(attempt, "live-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "live-token");
  assert.equal(calls[0][1], "order-a");
  assert.equal(calls[0][2].mediaBase64, "video-bytes");
  assert.deepEqual(Array.from(calls[0][2].recipientRoles), ["client"]);
  assert.deepEqual(calls[0].slice(-2), ["fixed-key", "fixed-correlation"]);
  assert.equal(recoveryDeletes, 1);
});

test("conversation UI and private-media components remount by live session, retaining actor-bound retry identity", () => {
  assert.match(source, /const activeSessionKey = partnerSetupSessionKey\(identityState\)/);
  assert.match(source, /loadedSessionKey === activeSessionKey/);
  assert.match(source, /\}, \[activeSessionKey, load\]\)/);
  assert.match(source, /const key = loadedSessionKey \+ ":" \+ orderId/);
  assert.match(source, /orderConversationMessageAttemptStorageKey\(role, actorID, orderId\)/);
  assert.equal((source.match(/actorScope=\{activeSessionKey\}/g) ?? []).length, 2);
  assert.equal((source.match(/readPrivateMedia=\{\(mediaOrderId, messageId\) => readPrivateMedia\(mediaOrderId, messageId, loadedSessionKey\)\}/g) ?? []).length, 2);
});
