import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript-ast";

const root = resolve(import.meta.dirname, "../..");
const apps = ["app-client", "app-partner", "app-captain"];

for (const app of apps) {
  test(app + " remounts routed React state whenever authenticated actor changes", () => {
    const path = resolve(root, "apps", app, "app/_layout.tsx");
    const source = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0);
    assert.match(source, /useSyncExternalStore\(subscribeIdentitySession, currentMobileActorID, \(\) => ""\)/);
    assert.match(source, /session\.kind === "authenticated" \? session\.identity\.subject\.trim\(\) : ""/);
    assert.match(source, /<Stack key=\{actorID \|\| "signed-out"\}/);
    assert.match(source, /<AppearanceProvider controller=\{appearance\}>/);
    assert.doesNotMatch(source, /SecureStore\.deleteItemAsync|sessionStorage\.clear\(\)|retryCheckout\(/);
  });
}

test("an unkeyed navigator fixture must fail the actor switch guard", () => {
  const path = resolve(root, "apps/app-client/app/_layout.tsx");
  const source = readFileSync(path, "utf8");
  const broken = source.replace('<Stack key={actorID || "signed-out"}', "<Stack");
  assert.notEqual(broken, source);
  assert.doesNotMatch(broken, /<Stack key=\{actorID \|\| "signed-out"\}/);
});
