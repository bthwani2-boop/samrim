import assert from "node:assert/strict";
import test from "node:test";
import { auditSyntheticTrackedArtifacts, deriveTrackedDirectories } from "./tracked-artifact-evidence.mjs";
import { applyTrackedArtifactOwnerContract } from "./tracked-artifact-owner-contract.mjs";

test("tracked-artifact evidence fails closed for an orphaned tracked file and its directory", () => {
  const result = auditSyntheticTrackedArtifacts(
    ["tools/dev/owned.mjs", "tools/orphan/dead-artifact.bin"],
    (file) => file === "tools/dev/owned.mjs" ? "TEST_OWNER" : null,
  );

  assert.ok(result.review.includes("REVIEW_REQUIRED:FILE:tools/orphan/dead-artifact.bin"));
  assert.ok(result.review.includes("REVIEW_REQUIRED:DIRECTORY:tools/orphan"));
  assert.ok(result.review.includes("REVIEW_REQUIRED:DIRECTORY:tools"));
});

test("tracked directories pass only when every descendant has evidence", () => {
  const result = auditSyntheticTrackedArtifacts(
    ["apps/example/app/home.tsx", "apps/example/app/_layout.tsx"],
    () => "FRAMEWORK_ROUTE_ENTRY",
  );

  assert.deepEqual(result.review, []);
  assert.equal(result.directoryEvidence.get("apps/example/app"), "DESCENDANT_EVIDENCE_COMPLETE");
  assert.deepEqual(
    deriveTrackedDirectories(["a/b/c.txt", "a/d.txt"]),
    ["a", "a/b"],
  );
});

test("owner contract resolves only explicit durable artifact classes", () => {
  const result = auditSyntheticTrackedArtifacts(
    [
      "apps/control-panel/DESIGN.md",
      "services/dsh/backend/Dockerfile",
      "services/dsh/backend/go.mod",
      "services/identity/backend/internal/security/password_blocklist_source.txt",
    ],
    () => null,
  );

  applyTrackedArtifactOwnerContract(result);
  assert.deepEqual(result.review, []);
  assert.equal(result.fileEvidence.get("apps/control-panel/DESIGN.md"), "PROJECT_DOCUMENTATION_CONTRACT");
  assert.equal(result.fileEvidence.get("services/dsh/backend/Dockerfile"), "CONTAINER_BUILD_ENTRY");
  assert.equal(result.fileEvidence.get("services/dsh/backend/go.mod"), "GO_MODULE_MANIFEST");
  assert.equal(
    result.fileEvidence.get("services/identity/backend/internal/security/password_blocklist_source.txt"),
    "SECURITY_DATA_SOURCE",
  );
});

test("owner contract recognizes the declared Nx task distribution files", () => {
  const result = auditSyntheticTrackedArtifacts(
    [".nx/ci-config.yaml", ".nx/workflows/agents.yaml"],
    () => null,
  );

  applyTrackedArtifactOwnerContract(result);
  assert.deepEqual(result.review, []);
  assert.equal(result.fileEvidence.get(".nx/ci-config.yaml"), "NX_DISTRIBUTION_CONFIG");
  assert.equal(result.fileEvidence.get(".nx/workflows/agents.yaml"), "NX_DISTRIBUTION_CONFIG");
});

test("native icon type contract requires its canonical consumer", () => {
  const withConsumer = auditSyntheticTrackedArtifacts(
    [
      "packages/design-system/src/native/icons.tsx",
      "packages/design-system/src/native/icon-types.ts",
    ],
    (file) => file.endsWith("icons.tsx") ? "TEST_OWNER" : null,
  );
  applyTrackedArtifactOwnerContract(withConsumer);
  assert.deepEqual(withConsumer.review, []);
  assert.equal(
    withConsumer.fileEvidence.get("packages/design-system/src/native/icon-types.ts"),
    "DESIGN_SYSTEM_NATIVE_ICON_CONTRACT",
  );

  const withoutConsumer = auditSyntheticTrackedArtifacts(
    ["packages/design-system/src/native/icon-types.ts"],
    () => null,
  );
  applyTrackedArtifactOwnerContract(withoutConsumer);
  assert.ok(withoutConsumer.review.includes("REVIEW_REQUIRED:FILE:packages/design-system/src/native/icon-types.ts"));
});

test("owner contract does not rescue an unknown artifact", () => {
  const result = auditSyntheticTrackedArtifacts(["tools/orphan/dead-artifact.bin"], () => null);
  applyTrackedArtifactOwnerContract(result);
  assert.ok(result.review.includes("REVIEW_REQUIRED:FILE:tools/orphan/dead-artifact.bin"));
  assert.ok(result.review.includes("REVIEW_REQUIRED:DIRECTORY:tools/orphan"));
});
