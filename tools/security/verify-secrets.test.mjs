import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { containsLikelySecret, forbiddenName } from "./verify-secrets.mjs";

const script = fileURLToPath(new URL("./verify-secrets.mjs", import.meta.url));
const gitExecutable = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
const marker = "ghp_" + "a".repeat(30);
const safe = "ordinary authored source\n";
function git(cwd, ...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  const result = spawnSync(gitExecutable, args, { cwd, env, encoding: "utf8", windowsHide: true, timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "bthwani-secret-index-"));
  try {
    git(dir, "init", "--quiet");
    const target = join(dir, "tools", "security", "verify-secrets.mjs");
    mkdirSync(join(dir, "tools", "security"), { recursive: true });
    copyFileSync(script, target);
    const file = join(dir, "sample.txt");
    writeFileSync(file, safe);
    git(dir, "add", "--", "sample.txt");
    const run = (withoutPath = false) => {
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (key.startsWith("GIT_") || (withoutPath && key.toLowerCase() === "path")) delete env[key];
      }
      if (withoutPath) env.PATH = "/untrusted-no-git";
      const result = spawnSync(process.execPath, [target], { cwd: dir, env, encoding: "utf8", windowsHide: true, timeout: 10000 });
      assert.equal(result.error, undefined);
      assert.ok(!(result.stdout + result.stderr).includes(marker), "secret value must not enter logs");
      return result;
    };
    fn({ dir, file, run, stage: () => git(dir, "add", "--", "sample.txt") });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
test("reject actual credential filenames but permit examples and ordinary source", () => {
  for (const name of ["apps/customer/google-services.json", ".env", "services/dsh/secret.p12",
    "apps/customer/credentials.json", "apps/customer/cert.pem", "apps\\captain\\.env.local"]) {
    assert.equal(forbiddenName(name), true, name);
  }
  assert.equal(forbiddenName("apps/customer/.env.example"), false);
  assert.equal(forbiddenName("services/dsh/clients/index.ts"), false);
});
test("private keys and provider markers remain detected; ordinary labels remain admissible", () => {
  for (const value of ["-----BEGIN " + "OPENSSH PRIVATE " + "KEY-----", '{"private_' + 'key":"synthetic"}',
    marker, "github_pat_" + "a".repeat(30), "sk_live_" + "a".repeat(20), "AKIA" + "A".repeat(16)]) {
    assert.equal(containsLikelySecret(value), true);
  }
  assert.equal(containsLikelySecret("const color = '#112233';"), false);
  assert.equal(containsLikelySecret("C:/BTHWANI-Secrets/env/mobile.env"), false);
});
test("clean actual index succeeds using trusted Git even with an untrusted PATH", () => fixture(({ run }) => {
  const result = run(true);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TRACKED_SECRET_MARKERS_PASS files=1/);
}));
test("staged secret cannot be concealed by replacing working bytes with safe content", () => fixture(({ file, stage, run }) => {
  writeFileSync(file, marker);
  stage();
  writeFileSync(file, safe);
  const result = run();
  assert.notEqual(result.status, 0, "staged secret must reject even with safe working bytes");
  assert.match(result.stderr, /likely secret marker in staged bytes/);
}));
test("working secret is rejected even with a clean index, and repair restores admission", () => fixture(({ file, run }) => {
  writeFileSync(file, marker);
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /working bytes/);
  writeFileSync(file, safe);
  assert.equal(run().status, 0);
}));
test("deleted working file still requires safe staged content", () => fixture(({ file, stage, run }) => {
  rmSync(file);
  assert.equal(run().status, 0);
  writeFileSync(file, marker);
  stage();
  rmSync(file);
  assert.notEqual(run().status, 0);
}));
test("NUL-bearing and UTF-16 encoded marker cannot bypass the guard", () => fixture(({ file, stage, run }) => {
  for (const bytes of [Buffer.concat([Buffer.from([0]), Buffer.from(marker)]),
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(marker, "utf16le")])]) {
    writeFileSync(file, bytes);
    stage();
    writeFileSync(file, safe);
    assert.notEqual(run().status, 0);
  }
}));
test("credential filename and non-regular staged entries fail closed", () => fixture(({ dir, run }) => {
  writeFileSync(join(dir, ".env"), safe);
  git(dir, "add", "--", ".env");
  assert.notEqual(run().status, 0);
  git(dir, "rm", "--cached", "--", ".env");
  const oid = git(dir, "rev-parse", ":sample.txt");
  git(dir, "update-index", "--add", "--cacheinfo", "120000," + oid + ",redirect");
  assert.notEqual(run().status, 0);
}));

test("working secret cannot be hidden by a path substitution at the old read boundary", () => fixture(({ dir, file }) => {
  const actual = marker;
  const ordinary = "x".repeat(actual.length);
  writeFileSync(file, actual);
  const preload = join(dir, "race.cjs");
  writeFileSync(preload, [
    'const fs = require("node:fs");',
    'const { syncBuiltinESMExports } = require("node:module");',
    'const target = ' + JSON.stringify(file) + ';',
    'const ordinary = ' + JSON.stringify(ordinary) + ';',
    'const original = fs.readFileSync;',
    'fs.readFileSync = function (path, ...args) {',
    '  if (path === target) {',
    '    const displaced = target + ".displaced";',
    '    fs.renameSync(target, displaced);',
    '    try { fs.writeFileSync(target, ordinary); return original.call(this, path, ...args); }',
    '    finally { fs.unlinkSync(target); fs.renameSync(displaced, target); }',
    '  }',
    '  return original.call(this, path, ...args);',
    '}; syncBuiltinESMExports();',
  ].join("\n"));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  const result = spawnSync(process.execPath, ["--require", preload, join(dir, "tools", "security", "verify-secrets.mjs")], {
    cwd: dir, env, encoding: "utf8", windowsHide: true, timeout: 10000,
  });
  assert.notEqual(result.status, 0, "substitution must not conceal actual tracked working secret");
  assert.match(result.stderr, /likely secret marker in working bytes/);
  assert.ok(!(result.stdout + result.stderr).includes(marker), "secret value must not enter logs");
}));

test("native Windows 8.3 spelling admits the same regular file without relaxing link safety", { skip: process.platform !== "win32" }, async () => {
  const { readVerifiedFile } = await import("./verify-secrets.mjs");
  const { lstatSync, realpathSync } = await import("node:fs");
  fixture(({ file }) => {
    const command = 'for %I in ("' + file + '") do @echo %~sI';
    const result = spawnSync("C:\\Windows\\System32\\cmd.exe", ["/d", "/c", command], {
      encoding: "utf8", windowsHide: true, windowsVerbatimArguments: true, timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr);
    const alias = result.stdout.trim();
    assert.ok(alias, "Windows native file spelling unavailable");
    const original = lstatSync(file, { bigint: true });
    const spelling = lstatSync(alias, { bigint: true });
    assert.equal(spelling.dev, original.dev);
    assert.equal(spelling.ino, original.ino);
    assert.equal(realpathSync.native(alias).toLowerCase(), realpathSync.native(file).toLowerCase());
    assert.deepEqual(readVerifiedFile(alias, 4096).bytes, Buffer.from(safe));
    assert.deepEqual(readVerifiedFile(file, 4096).bytes, Buffer.from(safe));
  });
});

test("verified descriptor rejects hard links and redirected ancestors", async () => {
  const { readVerifiedFile } = await import("./verify-secrets.mjs");
  const { linkSync, symlinkSync } = await import("node:fs");
  fixture(({ dir, file }) => {
    const hard = join(dir, "hard.txt");
    linkSync(file, hard);
    assert.throws(() => readVerifiedFile(file, 4096), /unsafe file path/);
    assert.throws(() => readVerifiedFile(hard, 4096), /unsafe file path/);
    rmSync(hard);
    const alias = join(dir, "redirected");
    symlinkSync(dir, alias, process.platform === "win32" ? "junction" : "dir");
    try {
      assert.throws(() => readVerifiedFile(join(alias, "sample.txt"), 4096), /unsafe file path/);
      assert.deepEqual(readVerifiedFile(file, 4096).bytes, Buffer.from(safe));
    } finally {
      rmSync(alias, { force: true });
    }
  });
});
