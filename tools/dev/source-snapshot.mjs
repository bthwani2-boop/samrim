// One checked-out source identity for native tests and local Graphify.
// This binds evidence to actual bytes and Git inventory, not Git's stat cache.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { containsLikelySecret, forbiddenName } from "../security/verify-secrets.mjs";

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function samePath(left, right) {
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
}
export function readVerifiedFile(path, limit) {
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

// Source evidence binds the actual regular-file bytes, not Git stat-cache
// assertions. Tracked deletions are part of the fingerprint. Unknown new files
// are not admitted, and neither tracked nor untracked credentials/links enter
// the proof. This inventory is not a substitute for native extraction coverage.
const sourceExtension = /^(?:\.[cm]?[jt]sx?|\.go|\.sql|\.mdx?|\.ya?ml|\.json|\.css|\.ps1|\.sh|\.py|\.toml)$/i;
export function admittedPath(checkout, name, untracked) {
  const parts = name.split("/");
  if (forbiddenName(name) || parts.some(part =>
    !part || part === "." || part === ".." || /[\\:]/.test(part) ||
    /^(?:\.git|\.ssh|\.secrets|secrets|credentials|node_modules|graphify-out|\.next|\.expo|\.nx|dist|build|coverage)$/i.test(part) ||
    [...part].some(char => char.charCodeAt(0) < 32))) throw new Error("unsafe source path");
  if (untracked && (!sourceExtension.test(extname(name)) ||
    !(parts.length === 1 || /^(?:apps|services|packages|tools|infra|docs|governance|specs|tests|\.github|\.specify|\.agents)$/.test(parts[0])))) {
    throw new Error("unsupported untracked source");
  }
  let path = checkout;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() ||
        (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1) ||
        !samePath(realpathSync(path), resolve(path))) throw new Error("redirected source");
  }
  const { bytes } = readVerifiedFile(path, 4 * 1024 * 1024);
  if ((untracked && bytes.includes(0)) ||
      (!bytes.includes(0) && containsLikelySecret(bytes.toString("utf8")))) throw new Error("sensitive source");
  return bytes;
}

export function inspectSourceFiles(checkout, tracked, untracked) {
  const digest = createHash("sha256");
  const unsafeTracked = [], unsafeUntracked = [], files = [];
  const candidates = new Map();
  for (const entry of tracked) {
    const match = /^(100644|100755) [0-9a-f]{40,64} 0\t(.+)$/.exec(entry);
    if (!match) { unsafeTracked.push(entry.split("\t").at(-1)); continue; }
    candidates.set(match[2], false);
  }
  for (const name of untracked) if (!candidates.has(name)) candidates.set(name, true);
  for (const [name, isNew] of [...candidates].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) {
    digest.update(name).update("\0").update(isNew ? "untracked\0" : "tracked\0");
    try {
      digest.update(sha256(admittedPath(checkout, name, isNew))).update("\0");
      files.push(name);
    } catch (error) {
      // A removed tracked path is an authored deletion, not an external file.
      // Missing directory/file entries are allowed only when the whole lexical
      // path was admitted up to the first genuinely absent entry.
      if (!isNew && error.code === "ENOENT") digest.update("deleted\0");
      else {
        (isNew ? unsafeUntracked : unsafeTracked).push(name);
        digest.update("unsafe\0");
      }
    }
  }
  return { digest: digest.digest("hex"), unsafeTracked, unsafeUntracked, files };
}


export function captureSourceSnapshot(checkout, { requireBranch = false } = {}) {
  const root = resolve(checkout);
  function git(...args) {
    const result = spawnSync(process.platform === "win32" ? "git.exe" : "git", args, {
      cwd: root, encoding: "buffer", windowsHide: true, timeout: 30000, maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error || result.status !== 0) throw new Error("SOURCE_SNAPSHOT_GIT_FAILED " + args[0]);
    return result.stdout;
  }
  const gitText = (...args) => git(...args).toString("utf8").trim();
  function identity() {
    const actual = gitText("rev-parse", "--show-toplevel").replaceAll("\\", "/");
    if (!samePath(actual, root.replaceAll("\\", "/"))) throw new Error("BLOCKED: command must run against its own local checkout");
    const branch = gitText("rev-parse", "--abbrev-ref", "HEAD");
    if (branch.startsWith("archive/") || (requireBranch && branch === "HEAD")) throw new Error("BLOCKED: source branch is not admitted");
    return { branch, head: gitText("rev-parse", "HEAD") };
  }
  const before = identity();
  const status = git("status", "--porcelain=v1", "-z", "--untracked-files=all");
  const index = git("ls-files", "--stage", "-z");
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z");
  const admission = inspectSourceFiles(root,index.toString("utf8").split("\0").filter(Boolean),untracked.toString("utf8").split("\0").filter(Boolean));
  const worktree = createHash("sha256").update("graph-source-v2\0").update(index).update(status).update(admission.digest).digest("hex");
  const after = identity();
  if (before.branch !== after.branch || before.head !== after.head ||
      !index.equals(git("ls-files", "--stage", "-z")) ||
      !status.equals(git("status", "--porcelain=v1", "-z", "--untracked-files=all")) ||
      !untracked.equals(git("ls-files", "--others", "--exclude-standard", "-z"))) {
    throw new Error("INVALIDATED: checkout changed during fingerprinting");
  }
  return {
    repository: root.replaceAll("\\", "/").toLowerCase(),
    ...before, worktree, dirty: status.length !== 0,
    unsafeTracked: admission.unsafeTracked.length,
    unsafeUntracked: admission.unsafeUntracked.length,
    files: admission.files,
  };
}
