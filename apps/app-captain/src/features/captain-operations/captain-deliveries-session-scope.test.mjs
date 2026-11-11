import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey, isCurrentCaptainActor } from "../../bootstrap/captain-session-scope.ts";

const source = readFileSync(new URL("./captain-deliveries.tsx", import.meta.url), "utf8");

const deliveryAst = ts.createSourceFile("captain-deliveries.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const taskGuard = deliveryAst.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === "canActOnCaptainTask");
assert.ok(taskGuard, "current DSH task guard must belong to the delivery screen");
const taskGuardJs = ts.transpileModule(taskGuard.getText(deliveryAst) + "\n({canActOnCaptainTask})", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const { canActOnCaptainTask } = runInNewContext(taskGuardJs);
const assigned = { id: "assignment-1", state: "assigned", handoff: { state: "store_confirmed" } };
const custody = { id: "assignment-1", state: "in_custody", handoff: { state: "completed" } };

test("missing authoritative delivery task prevents custody or completion", () => {
  assert.equal(canActOnCaptainTask(assigned, undefined), false);
  assert.equal(canActOnCaptainTask(custody, undefined), false);
});

test("wrong assignment, stale delivery or stale handoff prevents mutation", () => {
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-2", deliveryState: "assigned", handoffState: "store_confirmed" }), false);
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-1", deliveryState: "in_custody", handoffState: "store_confirmed" }), false);
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-1", deliveryState: "assigned", handoffState: "pending" }), false);
  assert.equal(canActOnCaptainTask(custody, { assignmentId: "assignment-1", deliveryState: "assigned", handoffState: "completed" }), false);
});

test("matching current task admits corresponding delivery actions", () => {
  assert.equal(canActOnCaptainTask(assigned, { assignmentId: "assignment-1", deliveryState: "assigned", handoffState: "store_confirmed" }), true);
  assert.equal(canActOnCaptainTask(custody, { assignmentId: "assignment-1", deliveryState: "in_custody", handoffState: "completed" }), true);
});

const confirmationGuard = deliveryAst.statements.find(node =>
  ts.isFunctionDeclaration(node) && node.name?.text === "isConfirmedCaptainCompletion");
assert.ok(confirmationGuard, "DSH terminal result guard must belong to the delivery owner");
const confirmationGuardJs = ts.transpileModule(confirmationGuard.getText(deliveryAst) + "\n({isConfirmedCaptainCompletion})", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const { isConfirmedCaptainCompletion } = runInNewContext(confirmationGuardJs);
const completionAttempt = Object.freeze({
  actorID: "captain-a",
  assignmentID: "assignment-a",
  expectedVersion: 4,
  request: { result: "delivered" },
});
const confirmedCompletion = Object.freeze({
  assignment: {
    id: "assignment-a",
    captainActorId: "captain-a",
    state: "delivered",
    terminalResult: "delivered",
    terminalAt: "2026-11-01T01:00:00Z",
    version: 5,
  },
  idempotentReplay: false,
});

test("DSH terminal readback clears only a matching Captain attempt and idempotent replay", () => {
  assert.equal(isConfirmedCaptainCompletion(confirmedCompletion, completionAttempt), true);
  assert.equal(isConfirmedCaptainCompletion({ ...confirmedCompletion, idempotentReplay: true }, completionAttempt), true);
  assert.equal(isConfirmedCaptainCompletion({
    ...confirmedCompletion,
    assignment: { ...confirmedCompletion.assignment, state: "delivery_failed", terminalResult: "delivery_failed" },
  }, { ...completionAttempt, request: { result: "delivery_failed" } }), true);
});

test("invalid terminal readback must retain the durable attempt for reconciliation", () => {
  assert.equal(isConfirmedCaptainCompletion(null, completionAttempt), false);
  for (const assignment of [
    { ...confirmedCompletion.assignment, id: "assignment-b" },
    { ...confirmedCompletion.assignment, captainActorId: "captain-b" },
    { ...confirmedCompletion.assignment, state: "in_custody" },
    { ...confirmedCompletion.assignment, terminalResult: "delivery_failed" },
    { ...confirmedCompletion.assignment, version: 4 },
    { ...confirmedCompletion.assignment, version: 3 },
    { ...confirmedCompletion.assignment, terminalAt: null },
    { ...confirmedCompletion.assignment, terminalAt: "" },
  ]) {
    assert.equal(isConfirmedCaptainCompletion({ ...confirmedCompletion, assignment }, completionAttempt), false);
  }
});

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
  const scope = captainSessionKey(current);
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
    captainSessionKey,
  });
  assert.equal(hasCurrentDeliveryActor("captain-a", scope), true);
  current = identity("renewed-session");
  assert.equal(hasCurrentDeliveryActor("captain-a", scope), false);
  assert.equal(hasCurrentDeliveryActor("captain-a", captainSessionKey(current)), true);
  current = { kind: "unauthenticated" };
  assert.equal(hasCurrentDeliveryActor("captain-a", scope), false);
});

test("Captain delivery tasks, completion and retry require the same session readback", () => {
  assert.match(source, /loadedSessionKey === activeSessionKey && hasCurrentDeliveryActor\(loadedActorID, loadedSessionKey\)/);
  assert.match(source, /const sessionKey = captainSessionKey\(identity\);/);
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
