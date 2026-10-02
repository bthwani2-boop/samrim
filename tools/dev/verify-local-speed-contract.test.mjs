import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { localSpeedContractReport, verifyLocalSpeedContract } from "./verify-local-speed-contract.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("accepts the canonical repository speed contract", () => {
  const result = verifyLocalSpeedContract(root);
  assert.equal(result.failures.length, 0, result.failures.join("\n"));
  assert.equal(result.checks.length, 46);
  assert.equal(localSpeedContractReport(result).exitCode, 0);
});

test("rejects a local check that starts Docker", (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "samrim-speed-contract-"));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  for (const relative of [
    "package.json",
    "tools/dev/dev.ps1",
    "tools/dev/check-local.ps1",
    "tools/dev/verify-local-candidate.ps1",
    "tools/dev/safe-push.ps1",
    "tools/dev/start-surface.mjs",
  ]) {
    const target = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
  }
  const localCheckPath = path.join(scratch, "tools/dev/check-local.ps1");
  fs.appendFileSync(localCheckPath, "\ndocker compose up\n");

  const result = verifyLocalSpeedContract(scratch);
  assert.ok(result.failures.some((failure) => failure.includes("inner-loop check must not contain")));
  const report = localSpeedContractReport(result);
  assert.equal(report.exitCode, 1);
  assert.match(report.lines[0], /LOCAL_SPEED_CONTRACT=FAIL/);
});
