import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./order-conversation.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-conversation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const identity = (subject, sessionId) => ({
  kind: "authenticated",
  identity: { role: "captain", subject, sessionId },
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

test("captain private media rejects results from an expired session of the same actor", async () => {
  let current = identity("captain-a", "old-session");
  const oldScope = captainSessionKey(current);
  let resolveMedia;
  const pendingMedia = new Promise(resolve => { resolveMedia = resolve; });
  let reads = 0;
  const { readPrivateMedia } = productionFunctions([...actors, "readPrivateMedia"], {
    currentIdentityState: () => current,
    captainSessionKey,
    getUsableIdentityAccessToken: async () => "old-token",
    client: () => ({ readOrderConversationMedia: async () => { reads++; return pendingMedia; } }),
  });
  const request = readPrivateMedia("order-a", "message-a", oldScope);
  for (let i = 0; i < 4 && !reads; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  current = identity("captain-a", "new-session");
  resolveMedia({ bytes: "old-private-media" });
  await assert.rejects(request, /PRIVATE_MEDIA_SESSION_CHANGED/);
  await assert.rejects(readPrivateMedia("order-a", "message-a", oldScope), /PRIVATE_MEDIA_SESSION_REQUIRED/);
  assert.equal(reads, 1);
});

test("live Captain session reads media and logout fails closed", async () => {
  let current = identity("captain-a", "session-live");
  const scope = captainSessionKey(current);
  const media = { bytes: "current-private-media" };
  const { readPrivateMedia } = productionFunctions([...actors, "readPrivateMedia"], {
    currentIdentityState: () => current,
    captainSessionKey,
    getUsableIdentityAccessToken: async () => "token",
    client: () => ({ readOrderConversationMedia: async () => media }),
  });
  assert.deepEqual({ ...(await readPrivateMedia("order-a", "message-a", scope)) }, media);
  current = { kind: "unauthenticated" };
  await assert.rejects(readPrivateMedia("order-a", "message-a", scope), /PRIVATE_MEDIA_SESSION_REQUIRED/);
});

function submitRuntime(currentSession, extra = {}) {
  return {
    currentIdentityState: currentSession,
    captainSessionKey,
    loadedSessionKey: captainSessionKey(currentSession()),
    correctOwner: true,
    role: "captain",
    orderConversationMessageAttemptStorageKey: () => "pending-message",
    setPendingAttempt: () => {},
    setBody: () => {},
    setError: () => {},
    load: async () => true,
    isDefinitiveDshMobileClientRejection: () => false,
    console: { error: () => {} },
    ...extra,
  };
}

test("session renewal while encoding a media attachment cannot send with an old token", async () => {
  let current = identity("captain-a", "session-1");
  let finishEncoding;
  const encoding = new Promise(resolve => { finishEncoding = resolve; });
  let writes = 0;
  let recoveryDeletes = 0;
  const { submitAttempt } = productionFunctions([...actors, "submitAttempt"], submitRuntime(() => current, {
    File: class { base64() { return encoding; } },
    client: () => ({ sendOrderConversationMessage: async () => { writes++; } }),
    SecureStore: { deleteItemAsync: async () => { recoveryDeletes++; } },
  }));
  const attempt = {
    actorID: "captain-a", orderID: "order-a", body: "صورة",
    mediaKind: "image", mediaContentType: "image/jpeg", mediaFileUri: "saved-image",
    idempotencyKey: "existing-key", correlationID: "existing-correlation",
  };
  const pending = submitAttempt(attempt, "former-token");
  current = identity("captain-a", "session-2");
  finishEncoding("old-private-image");
  await pending;
  assert.equal(writes, 0);
  assert.equal(recoveryDeletes, 0);
});

test("live Captain message preserves retry identity and recipient permissions", async () => {
  const current = identity("captain-a", "session-live");
  const calls = [];
  let deletes = 0;
  const { submitAttempt } = productionFunctions([...actors, "submitAttempt"], submitRuntime(() => current, {
    File: class { base64() { return Promise.resolve("encoded-audio"); } delete() {} },
    client: () => ({ sendOrderConversationMessage: async (...args) => calls.push(args) }),
    SecureStore: { deleteItemAsync: async () => { deletes++; } },
  }));
  await submitAttempt({
    actorID: "captain-a", orderID: "order-a", body: "صوت",
    mediaKind: "audio", mediaContentType: "audio/m4a", mediaFileUri: "saved-audio",
    recipientRoles: ["client", "operator"],
    idempotencyKey: "original-idempotency", correlationID: "original-correlation",
  }, "live-token");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].mediaBase64, "encoded-audio");
  assert.deepEqual(Array.from(calls[0][2].recipientRoles), ["client", "operator"]);
  assert.deepEqual(calls[0].slice(-2), ["original-idempotency", "original-correlation"]);
  assert.equal(deletes, 1);
});

test("Captain chat, unread counters, media and read receipts share Identity session scope", () => {
  const deliveries = readFileSync(new URL("./captain-deliveries.tsx", import.meta.url), "utf8");
  assert.match(source, /const activeSessionKey = captainSessionKey\(identityState\)/);
  assert.match(source, /loadedSessionKey === activeSessionKey/);
  assert.match(source, /state\.kind === "ready" && !correctOwner/);
  assert.match(source, /\}, \[activeSessionKey, load\]\)/);
  assert.match(source, /const key = loadedSessionKey \+ ":" \+ orderId \+ ":" \+ last\.id/);
  assert.equal((source.match(/actorScope=\{activeSessionKey\}/g) ?? []).length, 2);
  assert.equal((source.match(/readPrivateMedia=\{\(mediaOrderID, mediaID\) => readPrivateMedia\(mediaOrderID, mediaID, loadedSessionKey\)\}/g) ?? []).length, 2);
  assert.match(deliveries, /useConversationUnreadCounts\(assignments\.map\(assignment => assignment\.orderId\), captainSessionKey\(identityState\)/);
  assert.doesNotMatch(source, /isCurrentActor\([^,)]*\)/);
});
