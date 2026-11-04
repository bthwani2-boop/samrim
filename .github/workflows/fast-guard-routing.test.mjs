import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./fast-guard.yml", import.meta.url), "utf8");
const gates = new Map();
for (const line of workflow.split("\n")) {
  const match = line.match(/^\s*if changed '([^']+)'; then echo '([a-z]+)=true'/);
  if (match) gates.set(match[2], new RegExp(match[1]));
}
assert.deepEqual([...gates.keys()], ["dsh", "wlt", "identity", "finance", "node"]);

function selected(file) {
  return [...gates].filter(([, pattern]) => pattern.test(file)).map(([gate]) => gate).sort();
}
function requireGates(file, expected) {
  assert.deepEqual(selected(file), expected.sort(), file);
}

test("contract-only DSH changes schedule the DSH owner and TypeScript consumers", () => {
  requireGates("services/dsh/contracts/openapi/paths/catalog.yaml", ["dsh", "node"]);
  requireGates("services/dsh/contracts/openapi/paths/beneficiary-finance.yaml", ["dsh", "finance", "node"]);
});
test("WLT contract-only changes schedule wallet financial proof and generated consumers", () => {
  requireGates("services/wlt/contracts/openapi/wlt.openapi.yaml", ["wlt", "finance", "node"]);
});
test("Identity contract-only changes schedule identity and consumer verification", () => {
  requireGates("services/identity/contracts/openapi/identity.openapi.yaml", ["identity", "node"]);
});
test("checkout and financial client changes select disposable PostgreSQL proof", () => {
  for (const file of [
    "apps/app-client/src/features/cart-checkout/cart-checkout.tsx",
    "apps/app-client/src/features/wallet/cash-in-panel.tsx",
    "apps/app-client/src/features/orders/order-detail.tsx",
    "apps/app-captain/src/features/wallet/cash-in-panel.tsx",
    "apps/app-partner/src/features/account/partner-payout-card.tsx",
    "apps/app-partner/src/features/order-management/order-management.tsx",
    "services/dsh/clients/mobile.ts",
    "services/wlt/clients/example.ts",
  ]) {
    requireGates(file, ["finance", "node"]);
  }
  requireGates("apps/app-client/src/features/store-discovery/store-detail.tsx", ["node"]);
  assert.match(workflow, /TestCaptainWalletBalanceLockSerializesTransactions/);
});

test("financial integration proof cannot silently skip selected tests", () => {
  assert.match(workflow, /financial_go_proof\(\)/);
  assert.match(workflow, /TestCaptainMissionLocationOwnerLatestAndTerminalPurge/);
  assert.match(workflow, /TestPendingCancellationRequestsPaginationOverHundred/);
  assert.match(workflow, /TestOrderHTTPActorScopeAndPartnerTransitionRetry/);
  assert.match(workflow, /TestLocationHTTPRejectsAuthenticatedCrossActorAddressAndStoreAccess/);
  assert.match(workflow, /TestNotificationsAreIsolatedByActorAndStore/);
  assert.match(workflow, /No financial integration test executed/);
  assert.match(workflow, /Financial integration test skipped/);
  assert.equal((workflow.match(/financial_go_proof services\/(?:wlt|dsh)\/backend/g) ?? []).length, 4);
});

test("unrelated docs are not misclassified as an executable service change", () => {
  requireGates("docs/reference/design/example.md", []);
});
test("CI protection does not silently execute invalid retired script remnants", () => {
  assert.doesNotMatch(workflow, /\+\[string\]\[char\]10/);
  assert.match(workflow, /apps\/control-panel\/tests\/historical-field-finance-readonly\.test\.mjs/);
  assert.match(workflow, /apps\/control-panel\/tests\/retired-field-wallet-destination-boundary\.test\.mjs/);
  assert.match(workflow, /\.github\/workflows\/fast-guard-routing\.test\.mjs/);
});

test("PowerShell is verified before the mandatory Spec Kit governance test", () => {
  const setup = "      - name: Ensure PowerShell for mandatory Spec Kit proof";
  const governance = "      - name: Verify repository governance and CI routing";
  const start = workflow.indexOf(setup);
  const end = workflow.indexOf(governance, start);
  assert.ok(start >= 0 && end > start, "PowerShell setup must precede governance verification");
  const step = workflow.slice(start, end);
  assert.match(step, /command -v pwsh/);
  assert.match(step, /sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y powershell/);
  assert.match(step, /pwsh -NoProfile -NonInteractive -Command 'exit 0'/);
  assert.doesNotMatch(step, /^\s+continue-on-error: true$/m);
  const mutant = workflow.replace(setup, "      - name: Removed mandatory PowerShell setup");
  assert.throws(() => assert.match(mutant, /      - name: Ensure PowerShell for mandatory Spec Kit proof/), assert.AssertionError);
});

test("governance verification runs in CI even without a Node project change", () => {
  const stepName = "      - name: Verify repository governance and CI routing";
  const start = workflow.indexOf(stepName);
  assert.ok(start >= 0, "CI governance gate must exist");
  const nextStep = workflow.indexOf("\n      - name:", start + stepName.length);
  const step = workflow.slice(start, nextStep >= 0 ? nextStep : undefined);
  const command = /^\s+node tools\/governance\/verify-governance\.mjs$/m;
  assert.match(step, /^\s+run: \|$/m);
  assert.match(step, command);
  assert.match(step, /^\s+node --test \.github\/workflows\/fast-guard-routing\.test\.mjs$/m);
  assert.match(step, /^\s+node --test tools\/governance\/spec-kit-integration\.test\.mjs$/m);
  assert.doesNotMatch(step, /^\s+if:/m, "must not depend on changed-project classification");
  // Negative control: removing the check must fail this exact assertion.
  const mutant = step.replace("node tools/governance/verify-governance.mjs", "node --version");
  assert.throws(() => assert.match(mutant, command), assert.AssertionError);
});

// The Sonar scan must reject a red server-side Quality Gate, not just upload analysis.
test("SonarCloud Quality Gate failure is not silently reported as a successful scan", () => {
  const sonar = readFileSync(new URL("./sonar-observe.yml", import.meta.url), "utf8");
  const wait = /^\s+-Dsonar\.qualitygate\.wait=true$/m;
  assert.match(sonar, /^name: Sonar Quality Gate$/m);
  assert.match(sonar, /^\s+name: SonarQube Cloud Quality Gate$/m);
  assert.match(sonar, /uses: SonarSource\/sonarqube-scan-action@[0-9a-f]{40}/);
  assert.match(sonar, wait);
  assert.match(sonar, /^\s+-Dsonar\.qualitygate\.timeout=300$/m);
  assert.doesNotMatch(sonar, /continue-on-error:\s*true/);
  const mutant = sonar.replace("-Dsonar.qualitygate.wait=true", "-Dsonar.qualitygate.wait=false");
  assert.throws(() => assert.match(mutant, wait), assert.AssertionError);
});

// Guard against accidentally limiting PR checks to main and losing feedback on
// short-lived integration bases such as 35 / integration/*.
test("Fast Guard includes PRs targeting integration branches", () => {
  const triggers = workflow.match(/^on:\n([\s\S]*?)\npermissions:/m)?.[1];
  assert.ok(triggers, "workflow events must be declared");
  assert.match(triggers, /^  pull_request:\n  push:/m);
  const broken = triggers.replace("  pull_request:\n  push:", "  pull_request:\n    branches: [main]\n  push:");
  assert.throws(() => assert.match(broken, /^  pull_request:\n  push:/m), assert.AssertionError);
});

test("Sonar review for PRs into branch 36 remains enabled", () => {
  const sonar = readFileSync(new URL("./sonar-observe.yml", import.meta.url), "utf8");
  assert.match(workflow, /^\s+branches: \[main\]$/m, "main push gate remains unchanged");
  assert.match(sonar, /^\s+- '36'$/m);
  assert.match(sonar, /github\.event\.pull_request\.base\.ref == '36' \|\|/);
  assert.match(sonar, /github\.event\.pull_request\.base\.ref == 'main' && github\.event\.pull_request\.draft == false/);
  assert.match(sonar, /github\.event\.pull_request\.draft == false/);
  assert.match(sonar, /github\.ref == 'refs\/heads\/main'/);
});
