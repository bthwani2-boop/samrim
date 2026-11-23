// Read the locally indexed graph even when Git has pending changes.
// Provenance/coverage warnings never silently claim current-source proof.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
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
  // Only trusted provenance can authorize reading the index for this checkout.
  const blocked = (reason) => ({ status: "BLOCKED", queryable: false, reason });
  if (stored?.version !== 1) return blocked("unverified local Graphify index");
  if (stored.repository !== current.repository) return blocked("indexed repository differs");
  if (stored.branch !== current.branch) return blocked("indexed branch differs");
  const gaps = [];
  if (stored.graphSha256 !== graphHash) gaps.push("graph changed since last verified local stamp; revision is unverified");
  if (stored.head !== current.head) gaps.push("indexed HEAD differs from current HEAD");
  if (stored.worktree !== current.worktree) gaps.push("local tracked, staged or untracked changes are not proven indexed");
  return {
    status: gaps.length ? "INVALIDATED" : "PASS",
    queryable: true,
    reason: gaps.length ? gaps.join("; ") : null,
  };
}

export function rejectUntrackedFiles(names) {
  // A refresh may ask Graphify to open untracked symlinks; a read-only query never does.
  if (names.length > 0) {
    throw new Error("BLOCKED: review untracked files before refreshing the Graphify index");
  }
}

function currentState() {
  const beginning = branchAndHead();
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  const diff = git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--");
  // Git reports untracked names in status; do not open their contents or follow symlinks.
  const hash = createHash("sha256").update(status).update(diff);
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
  if (!existsSync(graph)) throw new Error("BLOCKED: local graph file is absent");
  return sha256(readFileSync(graph));
}

function readStamp() {
  try {
    return JSON.parse(readFileSync(stamp, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error("BLOCKED: local Graphify index stamp is unreadable");
  }
}

function validate() {
  const current = currentState();
  const indexed = readStamp();
  const graphDigest = graphHash();
  return { current, indexed, graphDigest, assessment: evaluateIndex(indexed, current, graphDigest) };
}

function refresh() {
  // Exclusive local refresh; never contend with another invocation of this runner.
  const lock = join(root, "graphify-out", ".local-refresh.lock");
  const descriptor = openSync(lock, "wx");
  closeSync(descriptor);
  try {
  // Only explicit refresh may scan source; reject untracked paths without opening them.
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean);
  rejectUntrackedFiles(untracked);
  const before = currentState();
  // --no-cluster uses the local AST extractor and avoids LLM community labeling.
  const output = execute(graphifyExe, ["update", ".", "--no-cluster"], 180000);
  const after = currentState();
  rejectUntrackedFiles(git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean));
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
  if (!before.assessment.queryable) throw new Error("BLOCKED: " + before.assessment.reason);
  let output;
  try {
    output = execute(graphifyExe, ["query", question, "--graph", graph], 45000);
  } catch (error) {
    throw new Error("BLOCKED: local Graphify CLI query failed: " + error.message);
  }
  const after = validate();
  if (!after.assessment.queryable || before.current.repository !== after.current.repository || before.current.branch !== after.current.branch) {
    throw new Error("BLOCKED: repository, branch or index trust changed during query");
  }
  const changedDuringQuery = JSON.stringify(before) !== JSON.stringify(after);
  if (before.assessment.status === "INVALIDATED" || changedDuringQuery) {
    const reason = [before.assessment.reason, changedDuringQuery ? "source or graph changed during query" : null].filter(Boolean).join("; ");
    process.stderr.write("INVALIDATED index evidence: " + reason + ". Results come from the available local graph; its revision or coverage may differ from current source. Verify affected paths directly.\n");
  }
  process.stdout.write(output.toString("utf8"));
}

function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "refresh" && args.length === 0) return refresh();
  if (action === "status" && args.length === 0) {
    const { current, indexed, assessment } = validate();
    process.stdout.write(JSON.stringify({
      status: assessment.status, queryable: assessment.queryable,
      reason: assessment.reason, branch: current.branch, head: current.head,
      indexedHead: indexed?.head ?? null, dirty: current.dirty,
      coverage: assessment.status === "PASS" ? "NOT_RUN" : "INVALIDATED",
    }, null, 2) + "\n");
    if (!assessment.queryable) process.exitCode = 2;
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
