import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { captainSessionKey, isCurrentCaptainActor } from "./captain-session-scope.ts";

test("captain readback stays scoped to original authenticated actor", () => {
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a"), true);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-b"), false);
  assert.equal(isCurrentCaptainActor("captain-a", ""), false);
  assert.equal(isCurrentCaptainActor("", "captain-a"), false);
  assert.equal(isCurrentCaptainActor("captain-a", "captain-a "), false);
});

test("Captain root navigation remounts for renewed sessions of the same actor", () => {
  const layout = readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("_layout.tsx", layout, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find((node) => ts.isFunctionDeclaration(node)
    && node.name?.text === "currentCaptainNavigationSessionKey");
  assert.ok(declaration, "Captain navigation must read the canonical session boundary");
  const compiled = ts.transpileModule(
    declaration.getText(ast) + "\n({ currentCaptainNavigationSessionKey })",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  let current = { kind: "authenticated", identity: { role: "captain", subject: "captain-a", sessionId: "first" } };
  const { currentCaptainNavigationSessionKey } = runInNewContext(compiled, {
    captainSessionKey,
    currentIdentityState: () => current,
  });
  const oldSessionKey = currentCaptainNavigationSessionKey();
  assert.equal(oldSessionKey, captainSessionKey(current));
  current = { ...current, identity: { ...current.identity, sessionId: "second" } };
  assert.notEqual(currentCaptainNavigationSessionKey(), oldSessionKey,
    "renewing the same actor must discard former navigation state");
  current = { kind: "unauthenticated" };
  assert.equal(currentCaptainNavigationSessionKey(), "");
  assert.match(layout, /useSyncExternalStore\(subscribeIdentitySession, currentCaptainNavigationSessionKey, \(\) => ""\)/);
  assert.match(layout, /<Stack key=\{sessionKey \|\| "signed-out"\}/);
  assert.doesNotMatch(layout, /currentMobileActorID|<Stack key=\{actorID/);
});

test("Captain private Order scope changes for same actor after session renewal", () => {
  const session = (subject, sessionId, role = "captain") =>
    ({ kind: "authenticated", identity: { role, subject, sessionId } });
  const first = captainSessionKey(session("captain-a", "session-a"));
  assert.ok(first);
  assert.notEqual(first, captainSessionKey(session("captain-a", "session-b")));
  assert.notEqual(first, captainSessionKey(session("captain-b", "session-a")));
  assert.equal(first, captainSessionKey(session("captain-a", "session-a")));
  assert.equal(captainSessionKey(session("captain-a", "session-a", "client")), "");
  assert.equal(captainSessionKey(session("captain-a", "")), "");
  assert.equal(captainSessionKey({ kind: "unauthenticated" }), "");
});
