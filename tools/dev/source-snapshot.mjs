// One checked-out source identity for native tests and local Graphify.
// This binds evidence to actual bytes and Git inventory, not Git's stat cache.
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { containsLikelySecret, forbiddenName, gitBlobIdentity, openRepositoryReader, readVerifiedFile, samePath } from "../security/verify-secrets.mjs";

export { readVerifiedFile, samePath };

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

// Git object identity is distinct from the worktree fingerprint. A CI
// attestation requires literal committed bytes; local Graphify may index edits.
export function inspectSourceFiles(checkout, tracked, untracked, objectFormat = null) {
  const digest = createHash("sha256");
  const unsafeTracked = [], unsafeUntracked = [], files = [], differentFromIndex = [];
  const candidates = new Map();
  for (const entry of tracked) {
    const match = /^(100644|100755) ([0-9a-f]{40}|[0-9a-f]{64}) 0\t(.+)$/.exec(entry);
    if (!match) { unsafeTracked.push(entry.split("\t").at(-1)); continue; }
    candidates.set(match[3], match[2]);
  }
  for (const name of untracked) if (!candidates.has(name)) candidates.set(name, null);
  for (const [name, oid] of [...candidates].sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)) {
    const isNew = oid === null;
    digest.update(name).update("\0").update(isNew ? "untracked\0" : "tracked\0");
    try {
      const bytes = admittedPath(checkout, name, isNew);
      digest.update(sha256(bytes)).update("\0");
      files.push(name);
      if (objectFormat && (isNew || gitBlobIdentity(bytes, objectFormat) !== oid)) differentFromIndex.push(name);
    } catch (error) {
      if (!isNew && error.code === "ENOENT") {
        digest.update("deleted\0");
        if (objectFormat) differentFromIndex.push(name);
      } else {
        (isNew ? unsafeUntracked : unsafeTracked).push(name);
        digest.update("unsafe\0");
      }
    }
  }
  return { digest: digest.digest("hex"), unsafeTracked, unsafeUntracked, files, differentFromIndex };
}

export function captureSourceSnapshot(checkout, { requireBranch = false, requireCommitted = false } = {}) {
  const root = resolve(checkout);
  const git = openRepositoryReader(root);
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
  const tracked = index.toString("utf8").split("\0").filter(Boolean);
  let objectFormat = null;
  let treeId = null;
  if (requireCommitted) {
    objectFormat = gitText("rev-parse", "--show-object-format");
    if (!["sha1", "sha256"].includes(objectFormat)) throw new Error("SOURCE_OBJECT_FORMAT_UNSUPPORTED");
    treeId = gitText("rev-parse", before.head + "^{tree}");
    const tree = git("ls-tree", "-r", "-z", treeId).toString("utf8").split("\0").filter(Boolean);
    const expected = tree.map(entry => entry.replace(/^([0-7]{6}) blob ([0-9a-f]+)\t/, "$1 $2 0\t"));
    if (status.length || untracked.length || expected.length !== tracked.length ||
        expected.some((entry, i) => entry !== tracked[i])) {
      throw new Error("CI_CANDIDATE_NOT_CLEAN_AND_ADMITTED");
    }
  }
  const admission = inspectSourceFiles(root, tracked, untracked.toString("utf8").split("\0").filter(Boolean), objectFormat);
  if (requireCommitted && (admission.unsafeTracked.length || admission.unsafeUntracked.length || admission.differentFromIndex.length)) {
    throw new Error("CI_CANDIDATE_NOT_CLEAN_AND_ADMITTED: actual bytes differ from committed source or are unsafe");
  }
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
    ...before, ...(requireCommitted ? { tree: treeId } : {}), worktree, dirty: status.length !== 0,
    unsafeTracked: admission.unsafeTracked.length,
    unsafeUntracked: admission.unsafeUntracked.length,
    files: admission.files,
  };
}
