import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  assert.match(workflow, /TestLegacyCODV61UpgradePreservesHistoricalCollectedPayment/);
  const isolatedWltTests = workflow.match(/financial_go_proof services\/wlt\/backend \.\/internal\/storage\/postgres -run "([^"\n]+)"/)?.[1];
  assert.ok(isolatedWltTests, "WLT isolated PostgreSQL proof must execute real Go tests");
  assert.match(isolatedWltTests, /\|TestFinancialStatementSnapshotLedgerReadbackAndActorIsolation\|/, "a torn WLT statement snapshot must block Fast Guard");
  assert.match(isolatedWltTests, /\|TestStoreRelationCommercialModelDefaultPersistedIsolation\|/, "store relation financial policy versioning and replay must block Fast Guard");
  assert.match(workflow, /BTHWANI_IMPORT_SCALE_PROOF_ISOLATED=1/);
  assert.match(workflow, /TestStoreCatalogImport5000RowsPartialCommitReadback/);
  assert.equal((workflow.match(/financial_go_proof services\/(?:wlt|dsh)\/backend/g) ?? []).length, 6);
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

test("Fast Guard executes committed session-isolation and finance CSV regression tests", () => {
  const start = workflow.indexOf("      - name: Protect checkout, finance, access, and user-facing handoffs");
  const end = workflow.indexOf("\n      - name: Lint and typecheck affected projects", start);
  assert.ok(start >= 0 && end > start, "protected Node test step must exist");
  const step = workflow.slice(start, end);
  for (const path of [
    "apps/app-captain/src/features/captain-operations/captain-home-session.test.mjs",
    "apps/app-captain/src/bootstrap/captain-session-scope.test.mjs",
    "apps/app-captain/src/features/captain-operations/captain-presence-session.test.mjs",
    "apps/app-captain/src/features/captain-operations/captain-readiness.test.mjs",
    "apps/app-captain/src/features/captain-operations/captain-offers-session.test.mjs",
    "apps/app-captain/src/features/wallet/wallet-session-isolation.test.mjs",
    "apps/app-captain/src/features/wallet/captain-financial-session-races.test.mjs",
    "apps/app-captain/src/features/captain-operations/captain-offer-mission-suppression.test.mjs",
    "apps/app-captain/src/features/captain-operations/captain-offer-poll-freshness.test.mjs",
    "apps/app-captain/src/features/captain-operations/captain-offer-response-freshness.test.mjs",
    "apps/app-client/src/features/sharing/client-share-sheet-session.test.mjs",
    "apps/app-partner/src/features/partner-onboarding/store-commercial-agreements-session.test.mjs",
    "apps/app-partner/src/features/store-offer/catalog-offer-read-model.test.mjs",
    "apps/app-partner/src/features/store-offer/catalog-product-pages.test.mjs",
    "apps/app-partner/tests/partner-home-metrics-session.test.mjs",
    "apps/control-panel/tests/store-workbench-relation.test.mjs",
    "apps/app-captain/src/features/wallet/captain-cash-in-session.test.mjs",
    "apps/control-panel/tests/finance-report-csv-safety.test.mjs",
  ]) {
    assert.ok(step.includes(`          ${path}\n`), `missing protected regression test: ${path}`);
  }
  const protectedPaths = [...step.matchAll(/^\s{10}((?:apps|services|tools)\/[^\s]+\.test\.mjs)$/gm)]
    .map((match) => match[1]);
  assert.ok(protectedPaths.length >= 30, "mandatory Node protection must remain broad");
  for (const file of protectedPaths) {
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)),
      `Fast Guard still selects a retired test path: ${file}`);
  }
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
  assert.doesNotMatch(step, /^\s+if:/m, "PowerShell setup must not be conditional");
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
  const triggers = workflow.match(/^on:\r?\n([\s\S]*?)\r?\npermissions:/m)?.[1];
  assert.ok(triggers, "workflow events must be declared");
  assert.match(triggers, /^  pull_request:\r?\n  push:/m);
  const broken = triggers.replace(/  pull_request:\r?\n  push:/, "  pull_request:\n    branches: [main]\n  push:");
  assert.throws(() => assert.match(broken, /^  pull_request:\r?\n  push:/m), assert.AssertionError);
});

test("Sonar scans same-repository Draft PRs into main, 36, 37 and 38", () => {
  const sonar = readFileSync(new URL("./sonar-observe.yml", import.meta.url), "utf8");
  assert.match(workflow, /^\s+branches: \[main\]$/m, "main push gate remains unchanged");
  assert.match(sonar, /^\s+- '36'$/m);
  assert.match(sonar, /^\s+- '37'$/m);
  assert.match(sonar, /^\s+- '38'$/m);
  assert.match(sonar, /^\s+- converted_to_draft$/m);
  assert.match(sonar, /github\.event\.pull_request\.base\.ref == '36' \|\|/);
  assert.match(sonar, /github\.event\.pull_request\.base\.ref == '37' \|\|/);
  assert.match(sonar, /github\.event\.pull_request\.base\.ref == '38' \|\|/);
  assert.match(sonar, /github\.event\.pull_request\.base\.ref == 'main'\)/);
  assert.match(sonar, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.doesNotMatch(sonar, /github\.event\.pull_request\.draft == false/);
  assert.doesNotMatch(sonar, /pull_request_target:/);
  assert.match(sonar, /github\.ref == 'refs\/heads\/main'/);
});
