import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveTrustedExecutable } from "./trusted-executables.mjs";

test("trusted Git resolution returns an absolute executable outside PATH lookup", () => {
  const executable = resolveTrustedExecutable("git");
  assert.equal(path.isAbsolute(executable), true);
  assert.match(path.basename(executable), /^git(\.exe)?$/i);
});

test("trusted executable resolution fails closed for names outside the allowlist", () => {
  assert.throws(() => resolveTrustedExecutable("git.exe"), /not on the trusted allowlist/);
  assert.throws(() => resolveTrustedExecutable("docker-compose"), /not on the trusted allowlist/);
});

test("trusted Git resolution works with an empty PATH", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import { resolveTrustedExecutable } from ${JSON.stringify(new URL("./trusted-executables.mjs", import.meta.url).href)}; console.log(resolveTrustedExecutable("git"));`,
    ],
    { cwd: import.meta.dirname, encoding: "utf8", env: { ...process.env, PATH: "" } },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(path.isAbsolute(result.stdout.trim()), true);
});
