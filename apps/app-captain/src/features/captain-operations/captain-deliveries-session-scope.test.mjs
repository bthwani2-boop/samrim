import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isCurrentCaptainActor } from "./captain-session-scope.ts";

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
    assert.ok(catchBlock.includes(`if (!hasCurrentDeliveryActor(${actor})) return;`),
      `${name} must revalidate actor before applying rejected-response state`);
  }
});

test("reconciliation does not show a late completion status after the actor changes", () => {
  const body = mutationBody("replaceRejectedCompletionAfterReadback");
  const afterLoad = body.slice(body.indexOf("await load();"));
  assert.match(afterLoad, /await load\(\);\s*if \(!hasCurrentDeliveryActor\(attempt\.actorID\)\) return;\s*setError\(/);
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
