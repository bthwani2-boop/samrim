import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("./git-turn.mjs", import.meta.url));
const targetBranch = "refoundation/clean-house-20261112";

function workspace(t, branch = targetBranch) {
  const root = mkdtempSync(path.join(os.tmpdir(), "bthwani-git-turn-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const room = path.join(root, "room");
  mkdirSync(repo);
  mkdirSync(path.join(room, "claims"), { recursive: true });
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
  };
  git("init", "-b", branch);
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "fixture");
  return { repo, room, lock: path.join(room, "claims", "GIT-TURN") };
}

function run(repo, ...args) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: repo, encoding: "utf8", windowsHide: true,
  });
  return { ...r, json: r.stdout.trim() ? JSON.parse(r.stdout.trim()) : null };
}

test("acquire is exclusive, reports the source branch, verifies ownership, and rejects a second claimant", (t) => {
  const { repo, room, lock } = workspace(t);
  const first = run(repo, "acquire", room, "session-01");
  assert.equal(first.status, 0, first.stderr);
  assert.equal(first.json.status, "ACQUIRED");
  assert.equal(first.json.branch, targetBranch);
  assert.match(first.json.token, /^[0-9a-f-]{36}$/);
  const original = readFileSync(path.join(lock, "owner.md"), "utf8");
  const second = run(repo, "acquire", room, "session-02");
  assert.equal(second.status, 3);
  assert.equal(second.json.status, "BLOCKED");
  assert.equal(readFileSync(path.join(lock, "owner.md"), "utf8"), original);
  assert.equal(run(repo, "verify", room, "session-01", first.json.token).status, 0);
});

test("wrong owner or token cannot release, and the original owner can release and hand off", (t) => {
  const { repo, room, lock } = workspace(t);
  const original = run(repo, "acquire", room, "session-05").json;
  assert.equal(run(repo, "verify", room, "session-02", original.token).status, 3);
  assert.equal(run(repo, "release", room, "session-02", original.token).status, 3);
  assert.equal(run(repo, "release", room, "session-05", "00000000-0000-0000-0000-000000000000").status, 3);
  assert.ok(existsSync(path.join(lock, "owner.md")));
  const released = run(repo, "release", room, "session-05", original.token);
  assert.equal(released.status, 0, released.stderr);
  assert.equal(released.json.status, "RELEASED");
  assert.equal(existsSync(lock), false);
  assert.ok(readdirSync(path.join(room, "claims")).some((s) => s.startsWith("GIT-TURN-RELEASED-SESSION05-")));
  assert.equal(run(repo, "acquire", room, "session-02").status, 0);
});

test("read-only status creates no Git turn or feature state", (t) => {
  const { repo, room, lock } = workspace(t);
  const s = run(repo, "status", room);
  assert.equal(s.status, 0, s.stderr);
  assert.equal(s.json.status, "FREE");
  assert.equal(existsSync(lock), false);
  assert.equal(existsSync(path.join(repo, ".specify")), false);
});

test("refuses the donor branch and creates no claim", (t) => {
  const { repo, room, lock } = workspace(t, "41");
  const result = run(repo, "acquire", room, "session-03");
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(lock), false);
});

test("two simultaneous claimants yield exactly one winner", async (t) => {
  const { repo, room, lock } = workspace(t);
  const invoke = (owner) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, "acquire", room, owner], {
      cwd: repo, windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (b) => { stdout += b; });
    child.stderr.on("data", (b) => { stderr += b; });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
  const results = await Promise.all([invoke("session-01"), invoke("session-02")]);
  assert.deepEqual(results.map((r) => r.status).sort(), [0, 3]);
  const winner = JSON.parse(results.find((r) => r.status === 0).stdout);
  assert.ok(readFileSync(path.join(lock, "owner.md"), "utf8").includes(`OWNER: ${winner.owner}`));
  assert.ok(readFileSync(path.join(lock, "owner.md"), "utf8").includes(`TOKEN: ${winner.token}`));
});
