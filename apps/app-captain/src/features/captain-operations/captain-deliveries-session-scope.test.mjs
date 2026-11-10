import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import test from "node:test";
import { captainOrderSessionKey, isCurrentCaptainActor } from "./captain-session-scope.ts";

const source = readFileSync(new URL("./captain-deliveries.tsx", import.meta.url), "utf8");

function mutationBody(name) {
  const start = source.indexOf(`  async function ${name}(`);
  assert.notEqual(start, -1, `missing ${name} mutation`);
  const next = source.indexOf("\n  async function ", start + 1);
  const render = source.indexOf("\n  if (!currentActorReadback)", start + 1);
  const end = next !== -1 ? next : render;
  assert.notEqual(end, -1);
  return source.slice(start, end);
}

test("late captain mutation failures do not publish errors into another actor's session", () => {
  for (const name of [
    "confirmArrival",
    "pickup",
    "complete",
    "retryPendingCompletion",
    "replaceRejectedCompletionAfterReadback",
  ]) {
    const body = mutationBody(name);
    const catchBlock = body.split("} catch (cause) {")[1];
    assert.ok(catchBlock, `${name} catch missing`);
    const actor = ["retryPendingCompletion", "replaceRejectedCompletionAfterReadback"].includes(name)
      ? "attempt.actorID" : "loadedActorID";
    assert.ok(catchBlock.includes(`if (!hasCurrentDeliveryActor(${actor}, loadedSessionKey)) return;`),
      `${name} must revalidate actor before applying rejected-response state`);
  }
});

test("reconciliation does not show a late completion status after the actor changes", () => {
  const body = mutationBody("replaceRejectedCompletionAfterReadback");
  const afterLoad = body.slice(body.indexOf("await load();"));
  assert.match(afterLoad, /await load\(\);\s*if \(!hasCurrentDeliveryActor\(attempt\.actorID, loadedSessionKey\)\) return;\s*setError\(/);
});

test("a late result from captain A is not applied to captain B", async () => {
  const screen = { actorID: "synthetic-captain-A", message: "" };
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  const response = pending.catch(() => {
    if (isCurrentCaptainActor("synthetic-captain-A", screen.actorID)) {
      screen.message = "failed A";
    }
  });
  screen.actorID = "synthetic-captain-B";
  reject(new Error("synthetic network failure"));
  await response;
  assert.equal(screen.message, "");
});

test("Captain delivery readback rejects an old session even for the same actor", () => {
  const identity = (sessionId) => ({
    kind: "authenticated",
    identity: { subject: "captain-a", role: "captain", sessionId },
  });
  let current = identity("first-session");
  const scope = captainOrderSessionKey(current);
  const ast = ts.createSourceFile("captain-deliveries.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node =>
    ts.isFunctionDeclaration(node) && node.name?.text === "hasCurrentDeliveryActor");
  assert.ok(declaration, "production delivery guard must exist");
  const script = ts.transpileModule(
    declaration.getText(ast) + "\n({hasCurrentDeliveryActor})",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  const { hasCurrentDeliveryActor } = runInNewContext(script, {
    currentIdentityState: () => current,
    isCurrentCaptainActor,
    captainOrderSessionKey,
  });
  assert.equal(hasCurrentDeliveryActor("captain-a", scope), true);
  current = identity("renewed-session");
  assert.equal(hasCurrentDeliveryActor("captain-a", scope), false);
  assert.equal(hasCurrentDeliveryActor("captain-a", captainOrderSessionKey(current)), true);
  current = { kind: "unauthenticated" };
  assert.equal(hasCurrentDeliveryActor("captain-a", scope), false);
});

test("Captain delivery tasks, completion and retry require the same session readback", () => {
  assert.match(source, /loadedSessionKey === activeSessionKey && hasCurrentDeliveryActor\(loadedActorID, loadedSessionKey\)/);
  assert.match(source, /const sessionKey = captainOrderSessionKey\(identity\);/);
  assert.match(source, /const stillCurrent = \(\) => sequence === readSequence\.current && hasCurrentDeliveryActor\(actorID, sessionKey\)/);
  assert.match(source, /\}, \[activeSessionKey, load\]\)/);
  assert.match(source, /!hasCurrentDeliveryActor\(attempt\.actorID, loadedSessionKey\)/);
  assert.match(source, /setChatOrderId\(""\)/);
  assert.doesNotMatch(source, /hasCurrentDeliveryActor\((?:loadedActorID|attempt\.actorID|actorID)\)/);
});

test("old Captain mutation completions cannot release a newer session operation", () => {
  assert.match(source, /mutationSequence\.current \+= 1;\s*mutationInFlight\.current = false;\s*setBusy\(""\)/);
  assert.equal((source.match(/const mutationID = \+\+mutationSequence\.current/g) ?? []).length, 5);
  assert.equal((source.match(/if \(mutationSequence\.current === mutationID\)/g) ?? []).length, 5);
});
