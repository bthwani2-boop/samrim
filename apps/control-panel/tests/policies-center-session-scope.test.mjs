import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(
  path.resolve(import.meta.dirname, "../src/features/policies/policies-center-workspace.tsx"),
  "utf8",
);
const begin = source.indexOf("  const sessionScope = JSON.stringify([");
const end = source.indexOf("\n  ]);", begin);
assert.ok(begin >= 0 && end > begin, "read the actual policy center scope expression");
const scopeExpression = source.slice(begin, end + "\n  ]);".length);

function sessionScope(subject, sessionId, permissions = ["platform_policies", "finance", "partners"], role = "operator") {
  const state = { identity: { subject, sessionId, permissions, role } };
  return runInNewContext(scopeExpression + "\nsessionScope", { state });
}

test("policy center remounts all private dialogs and policy previews on Identity session switch", () => {
  assert.match(source, /<ScopedPoliciesCenterWorkspace key=\{sessionScope\} \/>/);
  assert.match(source, /function ScopedPoliciesCenterWorkspace\(\) \{/);
  assert.notEqual(sessionScope("operator-a", "session-1"), sessionScope("operator-a", "session-2"));
  assert.notEqual(sessionScope("operator-a", "session-1"), sessionScope("operator-b", "session-1"));
  assert.match(source, /if \(state.kind !== "authenticated" \|\| !state.identity.subject \|\| !state.identity.sessionId\) return null/);
});

test("policy center drops prior financial previews and visited editors on in-place role and permission loss", () => {
  const full = sessionScope("operator-a", "session-1");
  assert.notEqual(full, sessionScope("operator-a", "session-1", ["partners", "platform_policies"]));
  assert.notEqual(full, sessionScope("operator-a", "session-1", ["partners", "finance"]));
  assert.notEqual(full, sessionScope("operator-a", "session-1", ["partners", "platform_policies", "finance"], "partner"));
  assert.match(source, /const \[previews, setPreviews\] = useState/);
  assert.match(source, /const \[visited, setVisited\] = useState/);
  assert.match(source, /const \[drawerOpen, setDrawerOpen\] = useState/);
  assert.match(source, /const \[selected, setSelected\] = useState/);
});

test("permission order does not cause spurious remounts or mutate Identity's permission array", () => {
  const unsorted = ["partners", "finance", "platform_policies"];
  const original = [...unsorted];
  const first = sessionScope("operator-a", "session-1", unsorted);
  const second = sessionScope("operator-a", "session-1", ["platform_policies", "partners", "finance"]);
  assert.equal(first, second);
  assert.deepEqual(unsorted, original);
  assert.notEqual(first, sessionScope("operator-a", "session-2", unsorted));
});

test("existing policy read effect cleanups abort old-session requests on keyed unmount", () => {
  assert.match(source, /const controller = new AbortController\(\);/);
  assert.match(source, /return \(\) => controller\.abort\(\);/);
  assert.match(source, /return \(\)=>controller\.abort\(\);/);
  assert.match(source, /window\.addEventListener\("policy:changed",refresh\)/);
  assert.match(source, /window\.removeEventListener\("policy:changed",refresh\)/);
});
