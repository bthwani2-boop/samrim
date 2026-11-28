import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("native Git hooks inspect the actual index and every outgoing commit without requiring a clean checkout", () => {
  const fixture = mkdtempSync(join(tmpdir(), "bthwani-git-hooks-"));
  const source = join(fixture, "source");
  const remote = join(fixture, "remote.git");
  const config = join(fixture, "empty-config");
  writeFileSync(config, "");
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  function git(args, expectedRejection = null) {
    const result = spawnSync("git", args, { cwd: fixture, env, encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.ifError(result.error);
    assert.equal(typeof result.status, "number", "Git must exit normally");
    if (expectedRejection) {
      assert.notEqual(result.status, 0, "Git must reject the invalid operation");
      assert.match(result.stdout + result.stderr, expectedRejection);
    }
    else assert.equal(result.status, 0, result.stderr);
    return result.stdout.trimEnd();
  }
  const local = (args, expectedRejection = null) => git(["-C", source, ...args], expectedRejection);
  const head = () => local(["rev-parse", "HEAD"]);
  const remoteHead = () => git(["--git-dir", remote, "rev-parse", "refs/heads/fixture"]);
  const write = (name, contents) => writeFileSync(join(source, name), contents);
  function commit(contents) {
    write("main.txt", contents);
    local(["add", "--", "main.txt"]);
    local(["commit", "-qm", "synthetic fixture"]);
    return head();
  }

  try {
    git(["init", "-q", "-b", "fixture", source]);
    git(["init", "-q", "--bare", "-b", "fixture", remote]);
    local(["config", "user.name", "Synthetic fixture"]);
    local(["config", "user.email", "fixture@example.invalid"]);
    local(["config", "core.autocrlf", "false"]);
    write("main.txt", "base\n");
    write("peer.txt", "peer\n");
    local(["add", "--", "main.txt", "peer.txt"]);
    local(["commit", "-qm", "baseline"]);
    const base = head();
    local(["push", "-q", remote, `${base}:refs/heads/fixture`]);

    // Construct invalid historical objects before activating the hook in this disposable repository.
    const valid = commit("valid\n");
    commit("invalid intermediate  \n");
    const repaired = commit("repaired final tree\n");
    local(["config", "core.hooksPath", fileURLToPath(new URL("./git-hooks", import.meta.url)).replaceAll("\\", "/")]);

    write("main.txt", "invalid staged  \n");
    local(["add", "--", "main.txt"]);
    write("main.txt", "repaired working bytes\n");
    local(["commit", "-qm", "reject staged bytes"], /trailing whitespace/);
    assert.equal(head(), repaired);

    write("main.txt", "<<<<<<< HEAD\nconflict\n");
    local(["add", "--", "main.txt"]);
    local(["commit", "-qm", "reject conflict marker"], /leftover conflict marker/);
    assert.equal(head(), repaired);

    write("main.txt", "independent valid work\n");
    write("peer.txt", "unrelated invalid staged work  \n");
    local(["add", "--", "peer.txt"]);
    const peerBlob = local(["rev-parse", ":peer.txt"]);
    local(["commit", "--only", "-qm", "owned paths only", "--", "main.txt"]);
    assert.notEqual(head(), repaired);
    assert.equal(local(["rev-parse", ":peer.txt"]), peerBlob);
    assert.match(local(["status", "--short"]), /^M {2}peer\.txt$/m);

    // The explicit outgoing object, not the moving HEAD or another writer's index, controls Push.
    local(["push", "-q", remote, `${valid}:refs/heads/fixture`]);
    assert.equal(remoteHead(), valid);
    local(["push", remote, `${repaired}:refs/heads/fixture`], /PRE_PUSH_REJECT: invalid outgoing diff/);
    assert.equal(remoteHead(), valid);
    local(["push", remote, `${valid}:refs/heads/fixture-new`], /PRE_PUSH_REJECT: new ref/);
    assert.equal(remoteHead(), valid);
    assert.equal(git(["--git-dir", remote, "for-each-ref", "--format=%(refname)", "refs/heads"]), "refs/heads/fixture");

    // Exercise the native hook protocol directly without forcing a ref update.
    const protocol = join(fixture, "protocol");
    writeFileSync(protocol, `refs/heads/fixture ${base} refs/heads/fixture ${valid}\n`);
    local(["hook", "run", `--to-stdin=${protocol}`, "pre-push", "--", remote, remote], /PRE_PUSH_REJECT: not a proven fast-forward/);
    assert.equal(remoteHead(), valid);
    assert.equal(local(["rev-parse", ":peer.txt"]), peerBlob);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
