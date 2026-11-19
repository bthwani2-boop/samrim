// Query only the local Graphify CLI after proving index provenance against this worktree.
// Refresh is explicit: repository governance prohibits automatic reindexing.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const graph = join(root, "graphify-out", "graph.json");
const stamp = join(root, "graphify-out", "local-index-state.json");
const gitExe = process.platform === "win32" ? "git.exe" : "git";
const graphifyExe = process.platform === "win32" ? "graphify.exe" : "graphify";

function execute(program, args, timeout = 30000) {
  const result = spawnSync(program, args, {
    cwd: root, encoding: "buffer", shell: false, windowsHide: true,
    timeout, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const message = result.error?.code || (result.stderr || Buffer.alloc(0)).toString("utf8").slice(0, 500);
    throw new Error(program + " failed: " + (message || "exit " + result.status));
  }
  return result.stdout;
}

function git(...args) {
  return execute(gitExe, args);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitString(...args) {
  return git(...args).toString("utf8").trim();
}

function branchAndHead() {
  const checkout = gitString("rev-parse", "--show-toplevel").replaceAll("\\", "/");
  if (checkout.toLowerCase() !== root.replaceAll("\\", "/").toLowerCase()) {
    throw new Error("BLOCKED: command must run against its own local checkout");
  }
  const branch = gitString("symbolic-ref", "--quiet", "--short", "HEAD");
  if (branch.startsWith("archive/")) {
    throw new Error("BLOCKED: historical archive is read-only");
  }
  return { branch, head: gitString("rev-parse", "HEAD") };
}

export function evaluateIndex(stored, current, graphHash) {
  if (stored?.version !== 1) return "INVALIDATED: no verified local Graphify index";
  if (stored.repository !== current.repository) return "INVALIDATED: repository changed";
  if (stored.branch !== current.branch) return "INVALIDATED: active branch changed";
  if (stored.head !== current.head) return "INVALIDATED: HEAD changed";
  if (stored.worktree !== current.worktree) return "INVALIDATED: working tree changed";
  if (stored.graphSha256 !== graphHash) return "INVALIDATED: graph changed outside local refresh";
  return null;
}

function currentState() {
  const beginning = branchAndHead();
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  const diff = git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8")
    .split("\0").filter(Boolean).sort();
  const hash = createHash("sha256").update(status).update(diff);
  for (const name of untracked) {
    const file = join(root, name);
    const info = lstatSync(file);
    hash.update("\0" + name + "\0");
    if (info.isSymbolicLink()) hash.update(readlinkSync(file));
    else if (info.isFile()) hash.update(readFileSync(file));
    else throw new Error("BLOCKED: unsupported untracked file: " + name);
  }
  const ending = branchAndHead();
  if (beginning.branch !== ending.branch || beginning.head !== ending.head) {
    throw new Error("INVALIDATED: checkout changed during fingerprinting");
  }
  return {
    repository: root.replaceAll("\\", "/").toLowerCase(),
    branch: beginning.branch,
    head: beginning.head,
    worktree: hash.digest("hex"),
    dirty: status.length !== 0,
  };
}

function graphHash() {
  if (!existsSync(graph)) throw new Error("INVALIDATED: local graph file is absent");
  return sha256(readFileSync(graph));
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stamp, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("INVALIDATED: local Graphify index stamp is unreadable");
  }
}

function validate() {
  const current = currentState();
  const reason = evaluateIndex(readStamp(), current, graphHash());
  return { current, reason };
}

function refresh() {
  // Exclusive local refresh; never contend with another invocation of this runner.
  const lock = join(root, "graphify-out", ".local-refresh.lock");
  const descriptor = openSync(lock, "wx");
  closeSync(descriptor);
  try {
  const before = currentState();
  // --no-cluster uses the local AST extractor and avoids LLM community labeling.
  const output = execute(graphifyExe, ["update", ".", "--no-cluster"], 180000);
  const after = currentState();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("INVALIDATED: checkout changed during local Graphify indexing");
  }
  const parsed = JSON.parse(readFileSync(graph, "utf8"));
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error("FAIL: local Graphify refresh produced no nodes");
  }
  const next = {
    version: 1, repository: after.repository, branch: after.branch,
    head: after.head, worktree: after.worktree, graphSha256: graphHash(),
  };
  const temp = stamp + "." + process.pid + ".tmp";
  try {
    writeFileSync(temp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
    renameSync(temp, stamp);
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
  process.stdout.write(output.toString("utf8"));
  process.stdout.write("\nPASS: local index matches " + after.branch + " @ " + after.head.slice(0, 12) +
    (after.dirty ? " (including current local edits)" : "") + "\n");
  } finally {
    unlinkSync(lock);
  }
}

function query(question) {
  const before = validate();
  if (before.reason) throw new Error(before.reason + ". Run: node tools/dev/graphify-local.mjs refresh");
  const output = execute(graphifyExe, ["query", question, "--graph", graph], 45000);
  const after = validate();
  if (after.reason || JSON.stringify(before.current) !== JSON.stringify(after.current)) {
    throw new Error("INVALIDATED: source or index changed during query; results discarded");
  }
  process.stdout.write(output.toString("utf8"));
}

function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "refresh" && args.length === 0) return refresh();
  if (action === "status" && args.length === 0) {
    const { current, reason } = validate();
    process.stdout.write(JSON.stringify({
      status: reason ? "INVALIDATED" : "PASS",
      reason, branch: current.branch, head: current.head, dirty: current.dirty,
    }, null, 2) + "\n");
    if (reason) process.exitCode = 2;
    return;
  }
  if (action === "query" && args.length === 1 && args[0].trim()) return query(args[0]);
  throw new Error("Usage: node tools/dev/graphify-local.mjs status | refresh | query \"question\"");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 2;
  }
}
