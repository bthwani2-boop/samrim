import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { clientOrderSessionKey } from "./order-session-scope.ts";

const source = readFileSync(new URL("./order-conversation.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-conversation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated",
  identity: { role: "client", subject, sessionId },
});

function productionFunctions(names, runtime) {
  const declarations = new Map();
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) {
      declarations.set(node.name.text, node.getText(ast));
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const name of names) assert.ok(declarations.has(name), `missing production function ${name}`);
  const executable = ts.transpileModule(
    `${names.map(name => declarations.get(name)).join("\n")}\n({${names.join(",")}})`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(executable, runtime);
}

const actors = ["conversationActorID", "currentConversationSessionKey", "isCurrentActor"];

test("private media is never returned to a renewed session of the same customer", async () => {
  let current = identity("customer-a", "session-old");
  const formerKey = clientOrderSessionKey(current);
  let resolveMedia;
  const pendingMedia = new Promise(resolve => { resolveMedia = resolve; });
  let reads = 0;
  const { readPrivateMedia } = productionFunctions([...actors, "readPrivateMedia"], {
    currentIdentityState: () => current,
    clientOrderSessionKey,
    getUsableIdentityAccessToken: async () => "old-token",
    client: () => ({
      readOrderConversationMedia: async () => { reads += 1; return pendingMedia; },
    }),
  });
  const request = readPrivateMedia("order-a", "media-a", formerKey);
  for (let i = 0; i < 4 && !reads; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  current = identity("customer-a", "session-new");
  resolveMedia({ bytes: "private-media-from-former-session" });
  await assert.rejects(request, /PRIVATE_MEDIA_SESSION_CHANGED/);
  await assert.rejects(readPrivateMedia("order-a", "media-a", formerKey), /PRIVATE_MEDIA_SESSION_REQUIRED/);
  assert.equal(reads, 1);
});

test("private media is readable by its active customer session and blocked after logout", async () => {
  let current = identity("customer-a", "session-live");
  const scope = clientOrderSessionKey(current);
  const media = { contentType: "audio/m4a", bytes: "allowed" };
  const { readPrivateMedia } = productionFunctions([...actors, "readPrivateMedia"], {
    currentIdentityState: () => current,
    clientOrderSessionKey,
    getUsableIdentityAccessToken: async () => "token",
    client: () => ({ readOrderConversationMedia: async () => media }),
  });
  assert.deepEqual({ ...(await readPrivateMedia("order-a", "media-a", scope)) }, media);
  current = { kind: "unauthenticated" };
  await assert.rejects(readPrivateMedia("order-a", "media-a", scope), /PRIVATE_MEDIA_SESSION_REQUIRED/);
});

function submitRuntime(currentSession, extra = {}) {
  return {
    currentIdentityState: currentSession,
    clientOrderSessionKey,
    loadedSessionKey: clientOrderSessionKey(currentSession()),
    correctOwner: true,
    conversationRole: "client",
    orderConversationMessageAttemptStorageKey: () => "saved-message",
    setPendingAttempt: () => {},
    setBody: () => {},
    setError: () => {},
    load: async () => true,
    isDefinitiveDshMobileClientRejection: () => false,
    console: { error: () => {} },
    ...extra,
  };
}

test("session replacement during media encoding prevents a stale DSH write and preserves recovery", async () => {
  let current = identity("customer-a", "session-1");
  const formerScope = clientOrderSessionKey(current);
  let finishEncoding;
  const encoding = new Promise(resolve => { finishEncoding = resolve; });
  let writes = 0;
  let recoveryDeletes = 0;
  const runtime = submitRuntime(() => current, {
    loadedSessionKey: formerScope,
    File: class { base64() { return encoding; } },
    client: () => ({ sendOrderConversationMessage: async () => { writes++; } }),
    SecureStore: { deleteItemAsync: async () => { recoveryDeletes++; } },
  });
  const { submitAttempt } = productionFunctions([...actors, "submitAttempt"], runtime);
  const attempt = {
    actorID: "customer-a", orderID: "order-a", body: "صورة",
    mediaKind: "image", mediaContentType: "image/jpeg", mediaFileUri: "saved-image",
    idempotencyKey: "retry-key", correlationID: "correlation-key",
  };
  const pending = submitAttempt(attempt, "former-token");
  current = identity("customer-a", "session-2");
  finishEncoding("encoded-private-image");
  await pending;
  assert.equal(writes, 0);
  assert.equal(recoveryDeletes, 0);
});

test("current customer media submission retains recipient list and original retry identity", async () => {
  const current = identity("customer-a", "session-live");
  const calls = [];
  let recovered = 0;
  const runtime = submitRuntime(() => current, {
    File: class { base64() { return Promise.resolve("encoded-video"); } delete() {} },
    client: () => ({ sendOrderConversationMessage: async (...args) => { calls.push(args); } }),
    SecureStore: { deleteItemAsync: async () => { recovered++; } },
  });
  const { submitAttempt } = productionFunctions([...actors, "submitAttempt"], runtime);
  await submitAttempt({
    actorID: "customer-a", orderID: "order-a", body: "فيديو",
    mediaKind: "video", mediaContentType: "video/mp4", mediaFileUri: "video-file",
    recipientRoles: ["partner"],
    idempotencyKey: "existing-key", correlationID: "existing-correlation",
  }, "live-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "live-token");
  assert.equal(calls[0][1], "order-a");
  assert.equal(calls[0][2].mediaBase64, "encoded-video");
  assert.deepEqual(Array.from(calls[0][2].recipientRoles), ["partner"]);
  assert.deepEqual(calls[0].slice(-2), ["existing-key", "existing-correlation"]);
  assert.equal(recovered, 1);
});

test("conversation messages, media and read receipts use the same live session scope", () => {
  assert.match(source, /const activeSessionKey = clientOrderSessionKey\(identityState\)/);
  assert.match(source, /loadedSessionKey === activeSessionKey/);
  assert.match(source, /state\.kind === "ready" && !correctOwner/);
  assert.match(source, /\}, \[activeSessionKey, load\]\)/);
  assert.match(source, /const key = loadedSessionKey \+ ":" \+ orderId \+ ":" \+ last\.id/);
  assert.match(source, /orderConversationMessageAttemptStorageKey\(conversationRole, actorID, orderId\)/);
  assert.equal((source.match(/actorScope=\{activeSessionKey\}/g) ?? []).length, 2);
  assert.equal((source.match(/readPrivateMedia=\{\(mediaOrderID, mediaID\) => readPrivateMedia\(mediaOrderID, mediaID, loadedSessionKey\)\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /isCurrentActor\([^,)]*\)/);
});
