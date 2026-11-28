import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  readdirSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync,
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
  const reader = join(root, "tools", "security", "verify-secrets.mjs");
  mkdirSync(dirname(reader), { recursive: true });
  copyFileSync(fileURLToPath(new URL("../security/verify-secrets.mjs", import.meta.url)), reader);
  copyFileSync(templateSource, template);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, infra, script, template, dest: join(infra, ".env") };
}

const moduleUrl = new URL("./setup-env.mjs", import.meta.url).href;
const invocation = 'import { initializeEnvironment } from ' + JSON.stringify(moduleUrl) +
  '; console.log(initializeEnvironment(process.argv[1]));';
const isolatedArgs = f => ["--input-type=module", "-e", invocation, f.infra];

function run(f, cli = false) {
  return spawnSync(process.execPath, cli ? [f.script] : isolatedArgs(f), { encoding: "utf8", timeout: 10000 });
}

function runAsync(f) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, isolatedArgs(f), { stdio: ["ignore", "pipe", "pipe"] });
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
  const result = run(f, true);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "REFOUNDATION_ENV_CREATED_LOCAL_ONLY");
  assertCreated(f, [result]);
});

test("a changed public port and bucket are reflected without a generator edit", t => {
  const f = fixture(t);
  const source = readFileSync(f.template, "utf8");
  writeFileSync(f.template, source.replace(/^REF_MEDIA_PORT=.*$/m, "REF_MEDIA_PORT=4321")
    .replace(/^REF_MEDIA_BUCKET=.*$/m, "REF_MEDIA_BUCKET=fixture-bucket"));
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assertCreated(f, [result]);
});

test("invalid template never publishes a new credential file", async t => {
  for (const [name, change] of [
    ["missing base key", s => s.replace(/^REF_POSTGRES_DB=.*\r?\n/m, "")],
    ["duplicate port", s => `${s}\nREF_MEDIA_PORT=4321\n`],
    ["nonblank secret slot", s => s.replace(/^REF_MEDIA_SECRET_KEY=.*$/m, "REF_MEDIA_SECRET_KEY=not-a-secret")],
    ["invalid port", s => s.replace(/^REF_MEDIA_PORT=.*$/m, "REF_MEDIA_PORT=65536")],
    ["duplicate port value", s => s.replace(/^REF_MEDIA_PORT=.*$/m, "REF_MEDIA_PORT=3226")],
    ["malformed port", s => s.replace(/^REF_MEDIA_PORT=.*$/m, "REF_MEDIA_PORT=abc")],
    ["missing port", s => s.replace(/^REF_MEDIA_PORT=.*\r?\n/m, "")],
    ["malformed entry", s => s + "\nnot-an-assignment"],
  ]) await t.test(name, sub => {
    const f = fixture(sub);
    writeFileSync(f.template, change(readFileSync(f.template, "utf8")));
    const result = run(f);
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
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "REFOUNDATION_ENV_EXISTS_UNTOUCHED");
  assert.deepEqual(readFileSync(f.dest), existing);
});

test("existing directory is rejected and retained", t => {
  const f = fixture(t);
  mkdirSync(f.dest);
  const result = run(f);
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
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not a regular file/);
  assert.ok(lstatSync(f.dest).isSymbolicLink());
  assert.equal(readFileSync(target, "utf8"), "protected-original-data");
});

test("eight concurrent processes publish exactly one complete file, never replace it", async t => {
  const f = fixture(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => runAsync(f)));
  assert.ok(results.every(r => r.code === 0), results.map(r => r.stderr).join("\n"));
  assert.equal(results.filter(r => r.stdout.trim() === "REFOUNDATION_ENV_CREATED_LOCAL_ONLY").length, 1);
  assert.equal(results.filter(r => r.stdout.trim() === "REFOUNDATION_ENV_EXISTS_UNTOUCHED").length, 7);
  assertCreated(f, results);
});
test("redirected infrastructure directory is rejected before creating credentials", t => {
  const f = fixture(t);
  const redirected = join(f.root, "redirected-infra");
  renameSync(f.infra, redirected);
  symlinkSync(redirected, f.infra, process.platform === "win32" ? "junction" : "dir");
  const result = run(f);
  assert.notEqual(result.status, 0, "redirected destination was accepted");
  assert.ok(!existsSync(join(redirected, ".env")));
  assert.deepEqual(readdirSync(redirected), [".env.example"]);
  assert.ok(lstatSync(f.infra).isSymbolicLink());
});

test("aliased template cannot become the source of new credentials", t => {
  const f = fixture(t);
  const alias = join(f.root, "template-alias");
  linkSync(f.template, alias);
  const result = run(f);
  assert.notEqual(result.status, 0, "hard-linked template was accepted");
  assert.ok(!existsSync(f.dest));
  assert.equal(lstatSync(f.template).nlink, 2);
});

test("existing hard-linked environment is left untouched without claiming content admission", t => {
  const f = fixture(t);
  const other = join(f.root, "retained-file");
  const bytes = Buffer.from("unrelated-retained-data");
  writeFileSync(other, bytes);
  linkSync(other, f.dest);
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "REFOUNDATION_ENV_EXISTS_UNTOUCHED");
  assert.deepEqual(readFileSync(other), bytes);
  assert.deepEqual(readFileSync(f.dest), bytes);
  assert.equal(lstatSync(f.dest).nlink, 2);
});
function fault(f, body) {
  // Test-only scheduling/failure injection. The publication and filesystem
  // operations still run through the actual Node native filesystem API.
  const code = 'import fs from "node:fs"; import { syncBuiltinESMExports } from "node:module";' +
    'import { join } from "node:path"; import { initializeEnvironment } from ' + JSON.stringify(moduleUrl) +
    '; const infra=process.argv[1]; const dest=join(infra,".env");' + body +
    '; syncBuiltinESMExports(); console.log(initializeEnvironment(infra));';
  return spawnSync(process.execPath, ["--input-type=module", "-e", code, f.infra], { encoding: "utf8", timeout: 10000 });
}

test("a publication race preserves the actual existing file and cleans only its own candidate", t => {
  const f = fixture(t);
  const result = fault(f, 'const link=fs.linkSync; fs.linkSync=(from,to)=>{fs.writeFileSync(to,"retained", {flag:"wx"});return link(from,to)}');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "REFOUNDATION_ENV_EXISTS_UNTOUCHED");
  assert.equal(readFileSync(f.dest, "utf8"), "retained");
  assert.deepEqual(readdirSync(f.infra).sort(), [".env", ".env.example"]);
});

test("an unavailable publication cannot replace a directory at the destination", t => {
  const f = fixture(t);
  const result = fault(f, 'const link=fs.linkSync; fs.linkSync=(from,to)=>{fs.mkdirSync(to);return link(from,to)}');
  assert.notEqual(result.status, 0);
  assert.ok(lstatSync(f.dest).isDirectory());
  assert.deepEqual(readdirSync(f.infra).sort(), [".env", ".env.example"]);
});

test("an interrupted candidate write cleans its own partial file and leaves no published environment", t => {
  const f = fixture(t);
  const result = fault(f, 'const write=fs.writeFileSync;fs.writeFileSync=(fd)=>{write(fd,"partial");throw new Error("TEST_INTERRUPTED_WRITE")}');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TEST_INTERRUPTED_WRITE/);
  assert.deepEqual(readdirSync(f.infra), [".env.example"]);
});

test("a replaced infrastructure directory cannot receive a candidate from the previous observation", t => {
  const f = fixture(t);
  const result = fault(f, 'const close=fs.closeSync;let n=0;fs.closeSync=fd=>{close(fd);if(++n===1){fs.renameSync(infra,infra+"-moved");fs.mkdirSync(infra)}}');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Infrastructure path identity changed/);
  assert.deepEqual(readdirSync(f.infra), []);
  assert.deepEqual(readdirSync(f.infra + "-moved"), [".env.example"]);
});

test("a replaced candidate cannot be published or removed as though still owned", t => {
  const f = fixture(t);
  const result = fault(f, 'const close=fs.closeSync;let n=0;fs.closeSync=fd=>{close(fd);if(++n===2){const scratch=fs.readdirSync(infra).find(x=>x.startsWith(".env.prepare-"));const candidate=join(infra,scratch,".env");fs.renameSync(candidate,candidate+".original");fs.writeFileSync(candidate,"retained")}}');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Environment publication and cleanup failed/);
  assert.ok(!existsSync(f.dest));
  const scratch = readdirSync(f.infra).find(x => x.startsWith(".env.prepare-"));
  assert.equal(readFileSync(join(f.infra, scratch, ".env"), "utf8"), "retained");
  assert.ok(existsSync(join(f.infra, scratch, ".env.original")));
});

test("a candidate directory is never published or recursively removed", t => {
  const f = fixture(t);
  const result = fault(f, 'const close=fs.closeSync;let n=0;fs.closeSync=fd=>{close(fd);if(++n===2){const scratch=fs.readdirSync(infra).find(x=>x.startsWith(".env.prepare-"));const candidate=join(infra,scratch,".env");fs.renameSync(candidate,candidate+".original");fs.mkdirSync(candidate)}}');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsafe infrastructure candidate/);
  assert.ok(!existsSync(f.dest));
  const scratch = readdirSync(f.infra).find(x => x.startsWith(".env.prepare-"));
  assert.ok(lstatSync(join(f.infra, scratch, ".env")).isDirectory());
});
test("a native link failure never leaves a candidate or a published environment", t => {
  const f = fixture(t);
  const result = fault(f, 'const link=fs.linkSync;fs.linkSync=(from)=>link(from,join(infra,"absent-parent",".env"))');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert.deepEqual(readdirSync(f.infra), [".env.example"]);
});

test("cleanup failure after publication retains the published environment and foreign scratch data", t => {
  const f = fixture(t);
  const result = fault(f, 'const link=fs.linkSync;fs.linkSync=(from,to)=>{link(from,to);fs.writeFileSync(from+".retained","unrelated") }');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOTEMPTY/);
  const bytes = readFileSync(f.dest);
  const scratch = readdirSync(f.infra).find(x => x.startsWith(".env.prepare-"));
  assert.equal(readFileSync(join(f.infra, scratch, ".env.retained"), "utf8"), "unrelated");
  const retry = run(f);
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(retry.stdout.trim(), "REFOUNDATION_ENV_EXISTS_UNTOUCHED");
  assert.deepEqual(readFileSync(f.dest), bytes);
});

test("malformed UTF-8 in the template is rejected before publication", t => {
  const f = fixture(t);
  writeFileSync(f.template, Buffer.concat([readFileSync(f.template), Buffer.from([10, 35, 0xff])]));
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.deepEqual(readdirSync(f.infra), [".env.example"]);
});
test("in-place candidate content corruption is rejected before publication", t => {
  const f = fixture(t);
  const result = fault(f, 'const close=fs.closeSync;let n=0;fs.closeSync=fd=>{close(fd);if(++n===2){const scratch=fs.readdirSync(infra).find(x=>x.startsWith(".env.prepare-"));fs.writeFileSync(join(infra,scratch,".env"),"corrupted")}}');
  assert.notEqual(result.status, 0);
  assert.ok(!existsSync(f.dest));
  assert.deepEqual(readdirSync(f.infra), [".env.example"]);
});

test("a replaced destination is not reported as a successful publication", t => {
  const f = fixture(t);
  const result = fault(f, 'const link=fs.linkSync;fs.linkSync=(from,to)=>{link(from,to);fs.unlinkSync(to);fs.writeFileSync(to,"retained") }');
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(f.dest, "utf8"), "retained");
  assert.deepEqual(readdirSync(f.infra).sort(), [".env", ".env.example"]);
});
test("a same-inode change after linking invalidates success without removing the published path", t => {
  const f = fixture(t);
  const result = fault(f, 'const link=fs.linkSync;fs.linkSync=(from,to)=>{link(from,to);fs.writeFileSync(to,"retained-edit") }');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Published infrastructure candidate changed/);
  assert.equal(readFileSync(f.dest, "utf8"), "retained-edit");
  assert.deepEqual(readdirSync(f.infra).sort(), [".env", ".env.example"]);
});
