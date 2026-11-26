import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readdirSync, readFileSync,rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

const scriptSource = fileURLToPath(new URL("./setup-env.mjs", import.meta.url));
const templateSource = fileURLToPath(new URL("../../infra/.env.example", import.meta.url));
const secrets = ["REF_POSTGRES_PASSWORD", "REF_MEDIA_ACCESS_KEY", "REF_MEDIA_SECRET_KEY"];
const baseKeys = [
  "REF_POSTGRES_USER", "REF_POSTGRES_DB", "REF_MEDIA_BUCKET",
  "REF_MAILPIT_PORT", "REF_MEDIA_PORT", "REF_PAYMENT_MOCK_PORT",
  "REF_IDENTITY_VERIFIER_PORT", "REF_DSH_PORT", "REF_WLT_PORT",
];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "bthwani-env-"));
  const infra = join(root, "infra");
  const script = join(root, "tools", "dev", "setup-env.mjs");
  const template = join(infra, ".env.example");
  mkdirSync(infra);
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(scriptSource, script);
  copyFileSync(templateSource, template);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, infra, script, template, dest: join(infra, ".env") };
}

function run(script) {
  return spawnSync(process.execPath, [script], { encoding: "utf8", timeout: 10000 });
}

function runAsync(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", code => resolve({ code, stdout, stderr }));
  });
}

function assertCreated(f, results) {
  const values = parseEnv(readFileSync(f.dest, "utf8"));
  const example = parseEnv(readFileSync(f.template, "utf8"));
  assert.deepEqual(Object.keys(values).sort(), [...baseKeys, ...secrets].sort());
  for (const key of baseKeys) assert.equal(values[key], example[key], key);
  for (const key of secrets) {
    assert.match(values[key], /^[0-9a-f]{64}$/);
    for (const result of results) {
      assert.ok(!result.stdout.includes(values[key]), "secret in stdout");
      assert.ok(!result.stderr.includes(values[key]), "secret in stderr");
    }
  }
  assert.equal(new Set(secrets.map(key => values[key])).size, 3);
  assert.ok(lstatSync(f.dest).isFile());
  if (process.platform !== "win32") assert.equal(lstatSync(f.dest).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(f.infra).sort(), [".env", ".env.example"]);
}

test("creates only base credentials and defaults from the tracked template", t => {
  const f = fixture(t);
  const result = run(f.script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "REFOUNDATION_ENV_CREATED_LOCAL_ONLY");
  assertCreated(f, [result]);
});

test("a changed public port and bucket are reflected without a generator edit", t => {
  const f = fixture(t);
  const source = readFileSync(f.template, "utf8");
  writeFileSync(f.template, source.replace(/^REF_MEDIA_PORT=.*$/m, "REF_MEDIA_PORT=4321")
    .replace(/^REF_MEDIA_BUCKET=.*$/m, "REF_MEDIA_BUCKET=fixture-bucket"));
  const result = run(f.script);
  assert.equal(result.status, 0, result.stderr);
  assertCreated(f, [result]);
});

test("invalid template never publishes a new credential file", async t => {
  for (const [name, change] of [
    ["missing base key", s => s.replace(/^REF_POSTGRES_DB=.*\r?\n/m, "")],
    ["duplicate port", s => `${s}\nREF_MEDIA_PORT=4321\n`],
    ["nonblank secret slot", s => s.replace(/^REF_MEDIA_SECRET_KEY=.*$/m, "REF_MEDIA_SECRET_KEY=not-a-secret")],
    ["invalid port", s => s.replace(/^REF_MEDIA_PORT=.*$/m, "REF_MEDIA_PORT=65536")],
  ]) await t.test(name, sub => {
    const f = fixture(sub);
    writeFileSync(f.template, change(readFileSync(f.template, "utf8")));
    const result = run(f.script);
    assert.notEqual(result.status, 0);
    assert.ok(!existsSync(f.dest));
    assert.deepEqual(readdirSync(f.infra), [".env.example"]);
    assert.ok(!result.stdout.includes("CREATED"));
    assert.ok(!result.stderr.includes("not-a-secret"));
  });
});

test("existing regular file remains byte-for-byte unchanged even without template", t => {
  const f = fixture(t);
  const existing = Buffer.from("REF_POSTGRES_PASSWORD=preserved\r\n");
  writeFileSync(f.dest, existing);
  rmSync(f.template);
  const result = run(f.script);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "REFOUNDATION_ENV_EXISTS_UNTOUCHED");
  assert.deepEqual(readFileSync(f.dest), existing);
});

test("existing directory is rejected and retained", t => {
  const f = fixture(t);
  mkdirSync(f.dest);
  const result = run(f.script);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a regular file/);
  assert.ok(lstatSync(f.dest).isDirectory());
});

test("existing symbolic link never changes its target", t => {
  const f = fixture(t);
  const target = join(f.root, "protected-target");
  writeFileSync(target, "protected-original-data");
  try {
    symlinkSync(target, f.dest, "file");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) {
      t.skip("OS does not grant symlink creation");
      return;
    }
    throw error;
  }
  const result = run(f.script);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a regular file/);
  assert.ok(lstatSync(f.dest).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "protected-original-data");
});

test("eight concurrent processes publish exactly one complete file, never replace it", async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => runAsync(f.script)));
  assert.ok(results.every(r => r.code === 0), results.map(r => r.stderr).join("\n"));
  assert.equal(results.filter(r => r.stdout.trim() === "REFOUNDATION_ENV_CREATED_LOCAL_ONLY").length, 1);
  assert.equal(results.filter(r => r.stdout.trim() === "REFOUNDATION_ENV_EXISTS_UNTOUCHED").length, 7);
  assertCreated(f, results);
});
