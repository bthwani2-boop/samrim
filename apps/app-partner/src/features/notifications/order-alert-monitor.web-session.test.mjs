import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope.ts";

const source = readFileSync(new URL("./order-alert-monitor.web.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("order-alert-monitor.web.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
assert.equal(ast.parseDiagnostics.length, 0);

function actualOrderOpenHandler(runtime) {
  let arrow = "";
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "openOrders") {
      arrow = node.initializer?.getText(ast) ?? "";
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(arrow, "web notification click handler is missing");
  const compiled = ts.transpileModule(
    "const openOrders = " + arrow + "; openOrders;",
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
  ).outputText;
  return runInNewContext(compiled, { ...runtime });
}

test("the web Partner notification scope is session-bound before and after every async read", () => {
  assert.match(source, /return partnerSetupSessionKey\(currentIdentityState\(\)\)/);
  assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionKey, \(\) => ""\)/);
  assert.match(source, /currentPartnerSessionKey\(\) !== sessionKey/g);
  assert.match(source, /cursor.receive\("partner", sessionKey, recent\)/);
  assert.match(source, /notice.sessionKey !== sessionKey/);
  assert.match(source, /\[actorId, sessionKey\]/);
});

test("click on a stale same-actor web alert cannot navigate or clear the new session's notice", () => {
  const before = partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "store-owner", sessionId: "first" } });
  const after = partnerSetupSessionKey({ kind: "authenticated", identity: { role: "partner", subject: "store-owner", sessionId: "second" } });
  assert.notEqual(before, after);
  let current = after;
  const routes = [];
  const cleared = [];
  const runtime = {
    sessionKey: before,
    currentPartnerSessionKey: () => current,
    setNotice: value => cleared.push(value),
    notice: { sessionKey: before, actorId: "store-owner", orderId: "order-1", storeId: "store-1" },
    router: { push: target => routes.push(target) },
  };
  actualOrderOpenHandler(runtime)();
  assert.deepEqual(routes, []);
  assert.deepEqual(cleared, []);
  current = before;
  actualOrderOpenHandler(runtime)();
  assert.equal(cleared.length, 1);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].pathname, "/orders");
  assert.equal(routes[0].params.orderId, "order-1");
});

test("public OS notification payload never receives a Partner Identity session key", () => {
  const native = readFileSync(new URL("./order-alert-monitor.tsx", import.meta.url), "utf8");
  assert.match(native, /data: \{ orderId: item.orderId, notificationId: item.id, actorId: actor, source: "partner-foreground" \}/);
  assert.doesNotMatch(native, /data: \{[^}]*sessionId/);
});
