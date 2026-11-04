import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const powerShellAvailable =
  spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], {
    timeout: 10000,
    windowsHide: true,
  }).status === 0;

function invoke(sandbox, script, args, env = {}) {
  const result = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(sandbox, ".specify", "scripts", "powershell", script),
      ...args,
    ],
    {
      cwd: sandbox,
      timeout: 30000,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        SPECIFY_INIT_DIR: sandbox,
        SPECIFY_FEATURE: "",
        SPECIFY_FEATURE_DIRECTORY: "",
        SPECIFY_FEATURE_NO_PERSIST: "1",
        ...env,
      },
    },
  );
  assert.equal(result.error, undefined, result.error?.message);
  return result;
}

function successfulJson(result) {
  assert.equal(result.status, 0, result.stderr);
  try {
    return JSON.parse(result.stdout.trim());
  } catch (error) {
    const position = Number(/position (\d+)/.exec(error.message)?.[1] ?? 0);
    throw new Error(`${error.message}; around error: ${JSON.stringify(result.stdout.slice(Math.max(0, position - 90), position + 90))}`);
  }
}

test("Spec Kit is an integration-free adapter, not a second authority", () => {
  const init = JSON.parse(
    fs.readFileSync(path.join(root, ".specify", "init-options.json"), "utf8"),
  );
  const integration = JSON.parse(
    fs.readFileSync(path.join(root, ".specify", "integration.json"), "utf8"),
  );
  const constitution = fs.readFileSync(
    path.join(root, ".specify", "memory", "constitution.md"),
    "utf8",
  );
  assert.equal(init.integration, "none");
  assert.equal(init.ai, "none");
  assert.equal(integration.default_integration, "none");
  assert.deepEqual(integration.installed_integrations, ["none"]);
  for (const marker of [
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "IMPLEMENTATION_STATE_AUTHORITY: NONE",
    "AGENTS.md",
    "REPOSITORY-STRUCTURE.md",
    "docs/governance/README.md",
  ]) {
    assert.ok(constitution.includes(marker), `missing authority boundary: ${marker}`);
  }
  assert.deepEqual(constitution.match(/^[A-Z_]+_AUTHORITY:.*$/gm), [
    "SEMANTIC_AUTHORITY: NONE",
    "EXECUTION_AUTHORITY: NONE",
    "IMPLEMENTATION_STATE_AUTHORITY: NONE",
  ]);
});

test(
  "Spec Kit scripts enforce isolated feature lifecycle, validation and read-only resolution",
  () => {
    assert.equal(powerShellAvailable, true, "pwsh is required; do not silently skip Spec Kit proof");
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bthwani-spec-kit-"));
    try {
      fs.cpSync(path.join(root, ".specify"), path.join(sandbox, ".specify"), {
        recursive: true,
      });
      const specDir = path.join(sandbox, "specs");
      const featureName = "001-readiness-proof";
      const featureDir = path.join(specDir, featureName);
      const selection = path.join(sandbox, ".specify", "feature.json");
      const original = '{"feature_directory":"original-feature"}';
      fs.writeFileSync(selection, "stale sandbox selection", "utf8");
      fs.writeFileSync(selection, original, "utf8");
      const featureEnv = {
        SPECIFY_FEATURE: featureName,
        SPECIFY_FEATURE_DIRECTORY: path.join("specs", featureName),
      };

      const unicodeResult = invoke(sandbox, "create-new-feature.ps1", [
        "-DryRun",
        "-Json",
        "-Number",
        "1",
        "-ShortName",
        "واجهة-عربية",
        "Check Unicode feature naming",
      ]);
      assert.ok([...unicodeResult.stdout.trim()].every((character) => character.charCodeAt(0) <= 127), "JSON stdout must be ASCII-only");
      const unicodeDryRun = successfulJson(unicodeResult);
      assert.equal(unicodeDryRun.BRANCH_NAME, "001-واجهة-عربية");
      assert.equal(fs.existsSync(specDir), false, "Unicode dry run must not write");

      const dryRun = successfulJson(
        invoke(sandbox, "create-new-feature.ps1", [
          "-DryRun",
          "-Json",
          "-Number",
          "1",
          "-ShortName",
          "readiness-proof",
          "Proof integration boundaries",
        ]),
      );
      assert.equal(dryRun.BRANCH_NAME, featureName);
      assert.equal(dryRun.DRY_RUN, true);
      assert.equal(fs.existsSync(specDir), false, "dry run must not write");

      const created = successfulJson(
        invoke(sandbox, "create-new-feature.ps1", [
          "-Json",
          "-Number",
          "1",
          "-ShortName",
          "readiness-proof",
          "Proof integration boundaries",
        ]),
      );
      assert.equal(created.BRANCH_NAME, featureName);
      assert.ok(fs.statSync(path.join(featureDir, "spec.md")).size > 0);
      assert.equal(fs.readFileSync(selection, "utf8"), original, "NO_PERSIST must retain the existing selection");

      const invalid = invoke(sandbox, "create-new-feature.ps1", [
        "-Json",
        "-Number",
        "not-a-number",
        "Must reject invalid feature number",
      ]);
      assert.notEqual(invalid.status, 0, "invalid number must fail");

      const missingPlan = invoke(
        sandbox,
        "check-prerequisites.ps1",
        ["-Json", "-RequireSpec", "-RequireTasks"],
        featureEnv,
      );
      assert.notEqual(missingPlan.status, 0, "missing plan and tasks must fail");

      const plan = successfulJson(
        invoke(sandbox, "setup-plan.ps1", ["-Json"], featureEnv),
      );
      assert.equal(path.resolve(plan.FEATURE_DIR), path.resolve(featureDir));
      assert.ok(fs.statSync(path.join(featureDir, "plan.md")).size > 0);

      const missingTasks = invoke(
        sandbox,
        "check-prerequisites.ps1",
        ["-Json", "-RequireSpec", "-RequireTasks"],
        featureEnv,
      );
      assert.notEqual(missingTasks.status, 0, "missing tasks must fail");

      const tasks = successfulJson(
        invoke(sandbox, "setup-tasks.ps1", ["-Json"], featureEnv),
      );
      assert.ok(tasks.TASKS_TEMPLATE_CONTENT.includes("#"));
      fs.writeFileSync(
        path.join(featureDir, "tasks.md"),
        tasks.TASKS_TEMPLATE_CONTENT,
        "utf8",
      );
      const ready = successfulJson(
        invoke(
          sandbox,
          "check-prerequisites.ps1",
          ["-Json", "-RequireSpec", "-RequireTasks", "-Template", "tasks-template"],
          featureEnv,
        ),
      );
      assert.ok(ready.TEMPLATE_CONTENT.includes("#"), "template output must remain valid JSON");

      const paths = successfulJson(
        invoke(
          sandbox,
          "check-prerequisites.ps1",
          ["-PathsOnly", "-Json"],
          featureEnv,
        ),
      );
      assert.equal(path.resolve(paths.FEATURE_DIR), path.resolve(featureDir));
      assert.equal(fs.readFileSync(selection, "utf8"), original, "path-only resolution must not persist");

      const collision = successfulJson(
        invoke(sandbox, "create-new-feature.ps1", [
          "-Json",
          "-Number",
          "1",
          "-ShortName",
          "other-feature",
          "Another scoped feature",
        ]),
      );
      assert.equal(collision.FEATURE_NUM, "002", "occupied prefix must not be reused");
      assert.ok(fs.existsSync(path.join(specDir, "002-other-feature", "spec.md")));
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  },
);
