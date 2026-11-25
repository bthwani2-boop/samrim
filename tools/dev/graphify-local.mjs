// Read the locally indexed graph even when Git has pending changes.
// Provenance/coverage warnings never silently claim current-source proof.
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { containsLikelySecret, forbiddenName } from "../security/verify-secrets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const graph = join(root, "graphify-out", "graph.json");
const stamp = join(root, "graphify-out", "local-index-state.json");
const lock = join(root, "graphify-out", ".local-refresh.lock");
const candidate = join(root, "graphify-out", ".candidate");
const candidateGraph = join(candidate, "graph.json");
const hookNames = ["post-commit", "post-checkout", "post-merge", "post-rewrite"];
const gitExe = process.platform === "win32" ? "git.exe" : "git";
const graphifyExe = process.platform === "win32" ? "graphify.exe" : "graphify";

function execute(program, args, timeout = 30000, env = process.env) {
  const result = spawnSync(program, args, {
    cwd: root, env, encoding: "buffer", shell: false, windowsHide: true,
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
  if (current.unsafeUntracked) gaps.push("untracked paths require safe admission");
  if (stored.graphSha256 !== graphHash) gaps.push("graph changed since last verified local stamp; revision is unverified");
  if (stored.head !== current.head) gaps.push("indexed HEAD differs from current HEAD");
  if (stored.worktree !== current.worktree) gaps.push("local tracked, staged or untracked changes are not proven indexed");
  return {
    status: gaps.length ? "INVALIDATED" : "PASS",
    queryable: true,
    reason: gaps.length ? gaps.join("; ") : null,
  };
}

// Admit ordinary repository source only, never credentials, binary dumps,
// external links or arbitrary untracked data. Hash file bytes, not just names.
export function inspectUntracked(checkout, names) {
  const hash = createHash("sha256");
  const unsafe = [];
  for (const name of [...new Set(names)].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)) {
    hash.update(name).update("\0");
    const parts = name.split("/");
    const supported = /^(?:\.[cm]?[jt]sx?|\.go|\.sql|\.mdx?|\.ya?ml|\.json|\.css|\.ps1|\.sh|\.py|\.toml)$/i.test(extname(name));
    const sourceRoot = parts.length === 1 || /^(?:apps|services|packages|tools|infra|docs|governance|specs|tests|\.github|\.specify|\.agents)$/.test(parts[0]);
    try {
      if (!supported || !sourceRoot || forbiddenName(name) || parts.some(part =>
        !part || part === "." || part === ".." || /[\\:]/.test(part) ||
        /^(?:\.git|\.env.*|\.ssh|\.secrets|secrets|credentials|node_modules|graphify-out|\.next|\.expo|\.nx|dist|build|coverage)$/i.test(part))) {
        throw new Error("unsafe source path");
      }
      let path = checkout;
      for (const [i, part] of parts.entries()) {
        path = join(path, part);
        const st = lstatSync(path);
        if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile() || st.size > 4 * 1024 * 1024)) {
          throw new Error("unsafe source file");
        }
        if (!samePath(realpathSync(path), resolve(path))) throw new Error("redirected source path");
      }
      const bytes = readFileSync(path);
      if (bytes.length > 4 * 1024 * 1024 || bytes.includes(0) || containsLikelySecret(bytes.toString("utf8"))) {
        throw new Error("sensitive or unsupported source");
      }
      hash.update(sha256(bytes)).update("\0");
    } catch {
      unsafe.push(name);
      hash.update("unsafe\0");
    }
  }
  return { digest: hash.digest("hex"), unsafe };
}

function currentState() {
  const beginning = branchAndHead();
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  const diff = git("diff", "--no-ext-diff", "--no-textconv", "--binary", "HEAD", "--");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").toString("utf8").split("\0").filter(Boolean);
  const admission = inspectUntracked(root, untracked);
  const hash = createHash("sha256").update(status).update(diff).update(admission.digest);
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
    unsafeUntracked: admission.unsafe.length,
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

export function planSync(indexed, current, graphDigest) {
  // A previously initialized local repository is required. A branch mismatch
  // authorizes a rebuild of this checkout, never a query against the old branch.
  if (indexed?.version !== 1) throw new Error("BLOCKED: unverified local Graphify index; explicit refresh required");
  if (indexed.repository !== current.repository) throw new Error("BLOCKED: indexed repository differs");
  if (current.unsafeUntracked) return "deferred";
  return evaluateIndex(indexed, current, graphDigest).status === "PASS" ? "current" : "refresh";
}

export function withRefreshLock(path, operation) {
  let descriptor;
  try {
    descriptor = openSync(path, "wx");
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("BLOCKED: local Graphify refresh is already in progress or requires lock recovery");
    throw error;
  }
  try {
    try {
      // Keep a durable owner record: a crashed process no longer leaves an
      // anonymous lock indistinguishable from a live refresh.
      writeFileSync(descriptor, JSON.stringify({ version: 1, pid: process.pid, startedAt: new Date().toISOString() }) + "\n");
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    return operation();
  } finally {
    unlinkSync(path);
  }
}

function readVerifiedFile(path, limit) {
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const stat = fstatSync(fd, { bigint: true });
    const matches = entry => entry.isFile() && !entry.isSymbolicLink() &&
      entry.nlink === 1n && entry.dev === stat.dev && entry.ino === stat.ino &&
      entry.size === stat.size && entry.mtimeNs === stat.mtimeNs && entry.ctimeNs === stat.ctimeNs;
    if (!stat.isFile() || stat.nlink !== 1n || stat.size > BigInt(limit) ||
        !matches(lstatSync(path, { bigint: true })) || !samePath(realpathSync(path), resolve(path))) {
      throw new Error("BLOCKED: unsafe file path");
    }
    const buffer = Buffer.alloc(Number(stat.size) + 1);
    let count = 0;
    while (count < buffer.length) {
      const n = readSync(fd, buffer, count, buffer.length - count, null);
      if (!n) break;
      count += n;
    }
    if (BigInt(count) !== stat.size || !matches(fstatSync(fd, { bigint: true })) ||
        !matches(lstatSync(path, { bigint: true })) || !samePath(realpathSync(path), resolve(path))) {
      throw new Error("BLOCKED: unsafe or changed file");
    }
    return { bytes: buffer.subarray(0, count), stat };
  } finally { closeSync(fd); }
}

function inspectRefreshLock(path) {
  const { bytes, stat } = readVerifiedFile(path, 4096);
  const digest = sha256(bytes);
  let owner = null;
  if (bytes.length) {
    try { owner = JSON.parse(bytes.toString("utf8")); } catch {
      throw new Error("BLOCKED: unreadable refresh lock owner");
    }
    if (owner?.version !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 ||
        !Number.isFinite(Date.parse(owner.startedAt))) {
      throw new Error("BLOCKED: invalid refresh lock owner");
    }
  }
  return { digest, owner, identity: [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.birthtimeNs].map(String) };
}

// Recovery is a separate, explicitly reviewed operation by the sole local
// coordinator. A dead PID alone is not sufficient: a native child can survive.
export function recoverRefreshLock(path, expectedDigest, assertNoWriters) {
  const initial = inspectRefreshLock(path);
  if (!/^[a-f0-9]{64}$/.test(expectedDigest) || initial.digest !== expectedDigest) {
    throw new Error("BLOCKED: reviewed refresh lock changed");
  }
  if (initial.owner) {
    try {
      process.kill(initial.owner.pid, 0);
      throw new Error("BLOCKED: refresh lock owner is alive");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  }
  assertNoWriters();
  const current = inspectRefreshLock(path);
  if (JSON.stringify(current) !== JSON.stringify(initial)) {
    throw new Error("BLOCKED: reviewed refresh lock changed");
  }
  // Keep the interrupted attempt's evidence rather than deleting it. All
  // regular writers still acquire the same exclusive lock.
  const saved = path + ".recovered-" + randomUUID();
  renameSync(path, saved);
  return saved;
}

function assertNoLocalGraphifyWriters() {
  if (process.platform !== "win32" || process.env.COMPUTERNAME?.toUpperCase() !== "BTHWANI") {
    throw new Error("BLOCKED: refresh recovery requires the authorized Surface process inventory");
  }
  const script = '$ErrorActionPreference="Stop"; $writers = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ' +
    process.pid + ' -and ($_.Name -match "^graphify.*\\.exe$" -or ($_.Name -match "^(node|pythonw?|uv|uvx).*\\.exe$" -and ' +
    '(-not $_.CommandLine -or $_.CommandLine -match "graphify"))) }); if ($writers.Count -gt 0) { exit 3 }';
  execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], 15000);
}

function refresh(automatic = false) {
  return withRefreshLock(lock, () => {
    const initial = currentState();
    const stored = readStamp();
    if (stored && stored.repository !== initial.repository) throw new Error("BLOCKED: indexed repository differs");
    if (automatic) {
      const action = planSync(stored, initial, existsSync(graph) ? graphHash() : null);
      if (action === "deferred") {
        throw new Error("BLOCKED: untracked paths require safe admission");
      }
      if (action === "current") {
        process.stdout.write("PASS: local Graphify index already matches current checkout\n");
        return;
      }
    }
    // Build against the actual checkout with the native incremental AST cache,
    // but never let an interrupted extraction replace the published graph.
    if (initial.unsafeUntracked) throw new Error("BLOCKED: untracked paths require safe admission");
    const before = currentState();
    if (JSON.stringify(initial) !== JSON.stringify(before)) {
      throw new Error("INVALIDATED: checkout changed before refresh");
    }
    mkdirSync(candidate, { recursive: true });
    if (!lstatSync(candidate).isDirectory() || !samePath(realpathSync(candidate), resolve(candidate))) {
      throw new Error("BLOCKED: redirected candidate directory");
    }
    const oldGraph = existsSync(graph) ? readFileSync(graph) : null;
    // Replace the candidate directory entry, never truncate a path after a
    // separate validation. The existing exclusive refresh lock owns it.
    try {
      const info = lstatSync(candidateGraph);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
        throw new Error("BLOCKED: non-regular candidate graph");
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (oldGraph) {
      const seed = candidateGraph + "." + randomUUID() + ".seed";
      const seedDescriptor = openSync(seed, "wx");
      try {
        try { writeFileSync(seedDescriptor, oldGraph); } finally { closeSync(seedDescriptor); }
        renameSync(seed, candidateGraph);
      } finally { rmSync(seed, { force: true }); }
    } else {
      try { unlinkSync(candidateGraph); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const env = { ...process.env, GRAPHIFY_OUT: "graphify-out/.candidate" };
    delete env.GRAPHIFY_CHANGED;
    delete env.GRAPHIFY_FORCE;
    const output = execute(graphifyExe, ["update", ".", "--no-cluster"], 180000, env);
    const after = currentState();
    if (after.unsafeUntracked || JSON.stringify(before) !== JSON.stringify(after)) {
      throw new Error("INVALIDATED: checkout changed during local Graphify indexing");
    }
    const graphBytes = readVerifiedFile(candidateGraph, 64 * 1024 * 1024).bytes;
    const parsed = JSON.parse(graphBytes.toString("utf8"));
    if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
      throw new Error("FAIL: local Graphify refresh produced no nodes");
    }
    const next = {
      version: 1, repository: after.repository, branch: after.branch,
      head: after.head, worktree: after.worktree, graphSha256: sha256(graphBytes),
    };
    const tempGraph = graph + "." + process.pid + ".tmp";
    const tempStamp = stamp + "." + process.pid + ".tmp";
    const rollback = graph + "." + process.pid + ".rollback";
    let graphPublished = false;
    try {
      if (oldGraph) writeFileSync(rollback, oldGraph, { flag: "wx" });
      writeFileSync(tempGraph, graphBytes, { flag: "wx" });
      writeFileSync(tempStamp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
      renameSync(tempGraph, graph);
      graphPublished = true;
      renameSync(tempStamp, stamp);
    } catch (error) {
      if (graphPublished) {
        if (oldGraph) renameSync(rollback, graph);
        else unlinkSync(graph);
      }
      throw error;
    } finally {
      for (const path of [tempGraph, tempStamp, rollback]) if (existsSync(path)) unlinkSync(path);
    }
    process.stdout.write(output.toString("utf8"));
    process.stdout.write("\nPASS: local index matches " + after.branch + " @ " + after.head.slice(0, 12) +
      (after.dirty ? " (including current local edits)" : "") + "\n");
  });
}

export function hookSource(name) {
  if (!hookNames.includes(name)) throw new Error("Unsupported Graphify hook");
  const checkout = name === "post-checkout" ? '[ "$3" = "1" ] || exit 0\n' : "";
  const drain = name === "post-rewrite" ? "cat >/dev/null\n" : "";
  return [
    "#!/bin/sh",
    "# bthwani-graphify-hook-start",
    '[ "${GRAPHIFY_SKIP_HOOK:-0}" != "1" ] || exit 0',
    checkout.trimEnd(),
    drain.trimEnd(),
    'root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0',
    'gitdir=$(git rev-parse --absolute-git-dir 2>/dev/null) || exit 0',
    '[ "$gitdir" = "$root/.git" ] || exit 0',
    'branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || exit 0',
    'case "$branch" in archive/*) exit 0 ;; esac',
    'for marker in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD; do',
    '  [ ! -e "$gitdir/$marker" ] || exit 0',
    'done',
    'cd "$root" || exit 0',
    '[ -f tools/dev/graphify-local.mjs ] || exit 0',
    'node tools/dev/graphify-local.mjs sync || echo "[Graphify] index not current; inspect status and retry safely" >&2',
    'exit 0',
    "# bthwani-graphify-hook-end",
    "",
  ].join("\n");
}

export function canReplaceHook(content, name) {
  if (content === null) return true;
  const normalized = content.replaceAll("\r\n", "\n").trimEnd();
  if (normalized === hookSource(name).trimEnd()) return true;
  const legacy = name === "post-commit" ? "graphify-hook" : name === "post-checkout" ? "graphify-checkout-hook" : null;
  return Boolean(legacy && normalized.startsWith("#!/bin/sh\n# " + legacy + "-start\n") &&
    normalized.endsWith("\n# " + legacy + "-end"));
}

function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function installHooks() {
  branchAndHead();
  const gitDir = resolve(root, gitString("rev-parse", "--absolute-git-dir"));
  if (!samePath(gitDir, join(root, ".git"))) throw new Error("BLOCKED: hooks must belong to the primary checkout");
  const hooks = resolve(root, gitString("rev-parse", "--git-path", "hooks"));
  if (!samePath(hooks, join(gitDir, "hooks")) || !lstatSync(hooks).isDirectory() || !samePath(realpathSync(hooks), resolve(hooks))) {
    throw new Error("BLOCKED: custom or redirected hooks directory");
  }
  return withRefreshLock(lock, () => {
    const planned = hookNames.map(name => {
      const path = join(hooks, name);
      let content = null;
      try {
        content = readVerifiedFile(path, 1024 * 1024).bytes.toString("utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (!canReplaceHook(content, name)) {
        throw new Error("BLOCKED: unrelated Git hook " + name);
      }
      return { name, path, content, next: hookSource(name) };
    });
    for (const item of planned) {
      if (item.content === item.next) continue;
      if (item.content !== null) {
        const backup = item.path + ".graphify-original";
        if (!existsSync(backup)) writeFileSync(backup, item.content, { flag: "wx" });
      }
      const temp = item.path + "." + process.pid + ".tmp";
      try {
        writeFileSync(temp, item.next, { flag: "wx", mode: 0o755 });
        renameSync(temp, item.path);
      } finally {
        if (existsSync(temp)) unlinkSync(temp);
      }
      process.stdout.write("PASS: unified local Graphify hook " + item.name + "\n");
    }
  });
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

function assertCoverageScope(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length ||
      paths.some(name => typeof name !== "string" || /[\\:]/.test(name) || [...name].some(char => char.charCodeAt(0) < 32) ||
        name.split("/").some(part => !part || part === "." || part === "..") || forbiddenName(name))) {
    throw new Error("BLOCKED: invalid coverage scope; use unique repository-relative authored paths");
  }
}

export function measureFileCoverage(paths, authored, nodes) {
  assertCoverageScope(paths);
  if (!Array.isArray(nodes)) throw new Error("BLOCKED: invalid graph nodes");
  const indexed = new Set(nodes.map(node => node?.source_file).filter(name => typeof name === "string"));
  const represented = paths.filter(name => authored.has(name) && indexed.has(name));
  const missing = paths.filter(name => authored.has(name) && !indexed.has(name));
  const unadmitted = paths.filter(name => !authored.has(name));
  return { coverage: missing.length || unadmitted.length ? "FAIL" : "PASS",
    requested: [...paths], represented, missing, unadmitted };
}

function coverage(paths) {
  assertCoverageScope(paths);
  const before = validate();
  const emit = (result) => {
    process.stdout.write(JSON.stringify({
      ...result, coverageKind: "FILE_NODE_MEMBERSHIP_ONLY",
      branch: before.current.branch, head: before.current.head,
      indexedHead: before.indexed?.head ?? null, graphSha256: before.graphDigest,
      sourceFingerprint: before.current.worktree,
    }, null, 2) + "\n");
    if (result.coverage !== "PASS") process.exitCode = 2;
  };
  if (before.assessment.status !== "PASS") {
    return emit({ coverage: before.assessment.status, requested: paths, reason: before.assessment.reason });
  }
  const bytes = readFileSync(graph);
  if (sha256(bytes) !== before.graphDigest) {
    return emit({ coverage: "INVALIDATED", requested: paths, reason: "graph changed during coverage measurement" });
  }
  const authored = new Set(git("ls-files", "--cached", "--others", "--exclude-standard", "-z").toString("utf8").split("\0"));
  const admitted = new Set(paths.filter(name => {
    if (!authored.has(name)) return false;
    const path = resolve(root, name);
    try {
      return lstatSync(path).isFile() && samePath(realpathSync(path), path);
    } catch { return false; }
  }));
  const result = measureFileCoverage(paths, admitted, JSON.parse(bytes.toString("utf8")).nodes);
  const after = validate();
  if (!after.assessment.queryable || JSON.stringify(before) !== JSON.stringify(after)) {
    return emit({ coverage: after.assessment.queryable ? "INVALIDATED" : "BLOCKED",
      requested: paths, reason: "source or graph changed during coverage measurement" });
  }
  return emit(result);
}


function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === "recover-lock" && args.length === 1) {
    const { assessment } = validate();
    if (!assessment.queryable) throw new Error("BLOCKED: unverified index provenance");
    recoverRefreshLock(lock, args[0], assertNoLocalGraphifyWriters);
    process.stdout.write("PASS: reviewed orphan lock archived; existing sync remains the index writer\n");
    return;
  }
  if (action === "refresh" && args.length === 0) return refresh();
  if (action === "sync" && args.length === 0) return refresh(true);
  if (action === "install-hooks" && args.length === 0) return installHooks();
  if (action === "status" && args.length === 0) {
    const { current, indexed, assessment } = validate();
    process.stdout.write(JSON.stringify({
      status: assessment.status, queryable: assessment.queryable,
      reason: assessment.reason, branch: current.branch, head: current.head,
      indexedHead: indexed?.head ?? null, dirty: current.dirty,
      refreshing: existsSync(lock), unsafeUntracked: current.unsafeUntracked,
      lockReview: existsSync(lock) ? (() => {
        try {
          const { digest, owner } = inspectRefreshLock(lock);
          return { digest, owner };
        } catch { return null; }
      })() : null,
      coverage: assessment.status === "PASS" ? "NOT_RUN" : "INVALIDATED",
    }, null, 2) + "\n");
    if (!assessment.queryable) process.exitCode = 2;
    return;
  }
  if (action === "coverage" && args.length > 0) return coverage(args);
  if (action === "query" && args.length === 1 && args[0].trim()) return query(args[0]);
  throw new Error("Usage: node tools/dev/graphify-local.mjs status | refresh | sync | recover-lock <reviewed SHA-256> | install-hooks | coverage <repo-relative paths...> | query \"question\"");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 2;
  }
}
