import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript-ast";
import { clientSessionKey } from "../../apps/app-client/src/features/access/client-session-scope.ts";
import { partnerSetupSessionKey } from "../../apps/app-partner/src/features/partner-onboarding/partner-setup-session-scope.ts";
import { captainSessionKey } from "../../apps/app-captain/src/bootstrap/captain-session-scope.ts";

const root = resolve(import.meta.dirname, "../..");
const layouts = [
  { app: "app-client", getter: "currentClientNavigationSessionKey", scope: "clientSessionKey", key: "sessionKey" },
  { app: "app-partner", getter: "currentPartnerSessionScope", scope: "partnerSetupSessionKey", key: "sessionScope" },
  { app: "app-captain", getter: "currentCaptainNavigationSessionKey", scope: "captainSessionKey", key: "sessionKey" },
];

for (const { app, getter, scope, key } of layouts) {
  test(app + " remounts private routed state whenever the Identity session changes", () => {
    const path = resolve(root, "apps", app, "app/_layout.tsx");
    const source = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0);
    assert.ok(source.includes(`return ${scope}(currentIdentityState());`), "navigation must derive its key from the app's canonical Identity session scope");
    assert.ok(source.includes(`useSyncExternalStore(subscribeIdentitySession, ${getter}, () => "")`));
    assert.ok(source.includes(`<Stack key={${key} || "signed-out"}`));
    assert.match(source, /<AppearanceProvider controller=\{appearance\}>/);
    if (app === "app-partner") {
      assert.ok(source.includes('<PartnerActorNavigation key={sessionScope || "signed-out"}'));
      assert.ok(source.includes("queryClient.clear()"), "Partner query cache must be owned by its exact session");
    }
    assert.doesNotMatch(source, /SecureStore\.deleteItemAsync|sessionStorage\.clear\(\)|retryCheckout\(/);
  });
}

test("canonical Client, Partner and Captain scope keys change on renewed same-actor sessions", () => {
  for (const [role, scope] of [
    ["client", clientSessionKey],
    ["partner", partnerSetupSessionKey],
    ["captain", captainSessionKey],
  ]) {
    const actor = (sessionId) => ({ kind: "authenticated", identity: { role, subject: "same-actor", sessionId } });
    const before = scope(actor("first-login"));
    const after = scope(actor("second-login"));
    assert.ok(before);
    assert.ok(after);
    assert.notEqual(before, after, `${role} must not reuse private screens from an old login`);
    assert.equal(scope({ kind: "unauthenticated" }), "");
    assert.equal(scope({ kind: "authenticated", identity: { role: "operator", subject: "same-actor", sessionId: "first-login" } }), "");
  }
});

test("an unkeyed navigator fixture must fail the Client session boundary", () => {
  const path = resolve(root, "apps/app-client/app/_layout.tsx");
  const source = readFileSync(path, "utf8");
  const keyed = '<Stack key={sessionKey || "signed-out"}';
  assert.ok(source.includes(keyed));
  const broken = source.replace(keyed, "<Stack");
  assert.notEqual(broken, source);
  assert.ok(!broken.includes(keyed));
});
