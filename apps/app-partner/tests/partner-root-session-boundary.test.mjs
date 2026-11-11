import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";
import { partnerSetupSessionKey } from "../src/features/partner-onboarding/partner-setup-session-scope.ts";

const root = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("app/_layout.tsx", root, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let snapshotDeclaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "currentPartnerSessionScope") {
    snapshotDeclaration = node.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(snapshotDeclaration, "production root must expose one canonical session snapshot");
const js = ts.transpileModule(snapshotDeclaration, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
let identity = { kind: "authenticated", identity: { role: "partner", subject: "actor-a", sessionId: "session-1" } };
const readSnapshot = vm.runInNewContext(`${js}\ncurrentPartnerSessionScope`, {
  currentIdentityState: () => identity,
  partnerSetupSessionKey,
});

test("root query/navigation boundary changes for same actor new Identity session", () => {
  const initial = readSnapshot();
  identity = { ...identity, identity: { ...identity.identity, sessionId: "session-2" } };
  assert.notEqual(readSnapshot(), initial);
  identity = { ...identity, identity: { ...identity.identity, sessionId: "session-1" } };
  assert.equal(readSnapshot(), initial);
});

test("same Identity session token refresh does not destroy navigation or cached reads", () => {
  const initial = readSnapshot();
  identity = { ...identity, identity: { ...identity.identity, accessToken: "renewed-token" } };
  assert.equal(readSnapshot(), initial);
});

test("different actor, signout and role mismatch cannot reuse Partner private tree", () => {
  const initial = readSnapshot();
  identity = { ...identity, identity: { ...identity.identity, subject: "actor-b" } };
  assert.notEqual(readSnapshot(), initial);
  identity = { kind: "signed_out" };
  assert.equal(readSnapshot(), "");
  identity = { kind: "authenticated", identity: { role: "customer", subject: "actor-a", sessionId: "session-1" } };
  assert.equal(readSnapshot(), "");
});

test("root navigation and react-query cache share the exact session key and clean on remount", () => {
  assert.match(root, /useSyncExternalStore\(subscribeIdentitySession, currentPartnerSessionScope, \(\) => ""\)/);
  assert.match(root, /<PartnerActorNavigation key=\{sessionScope \|\| "signed-out"\} sessionScope=\{sessionScope\}/);
  assert.match(root, /const \[queryClient\] = useState\(createPartnerActorQueryClient\)/);
  assert.match(root, /useEffect\(\(\) => \(\) => \{ queryClient\.clear\(\); \}, \[queryClient\]\)/);
  assert.match(root, /<QueryClientProvider client=\{queryClient\}>/);
  assert.match(root, /<Stack key=\{sessionScope \|\| "signed-out"\}/);
  assert.doesNotMatch(root, /currentMobileActorID|actorID \|\| "signed-out"/);
});

test("native, web and accessibility roots are preserved and never create parallel caches", () => {
  assert.match(root, /<AppearanceProvider controller=\{appearance\}>/);
  assert.match(root, /<OrderAlertMonitor \/>/);
  assert.match(root, /<RootNavigation \/>/);
  assert.match(root, /<RootNetworkNotice \/>/);
  assert.match(root, /document\.documentElement\.dir = "rtl"/);
  assert.equal((root.match(/createPartnerActorQueryClient/g) ?? []).length, 2,
    "one import and one useState initializer only");
});
