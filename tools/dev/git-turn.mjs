#!/usr/bin/env node
// Exclusive shared-worktree Git turn. This never stages, commits, or pushes.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, rmdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const targetBranch = "refoundation/clean-house-20261112";
const [action, roomArg, owner, token] = process.argv.slice(2);
const claimName = "GIT-TURN";

function output(status, details = {}) {
  console.log(JSON.stringify({ status, ...details }));
}

function block(reason) {
  output("BLOCKED", { reason });
  process.exitCode = 3;
}

function usage() {
  console.error("Usage: node tools/dev/git-turn.mjs acquire|status|verify|release <absolute-room> [session-01..session-08] [token-for-verify-or-release]");
  process.exitCode = 2;
}

function git(...args) {
  return execFileSync("git", args, {
    cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function currentGit() {
  const branch = git("branch", "--show-current");
  if (branch !== targetBranch) throw new Error("wrong Git branch: " + branch);
  return { branch, head: git("rev-parse", "--verify", "HEAD"), repo: git("rev-parse", "--show-toplevel") };
}

function ensureRealDir(dir) {
  if (!lstatSync(dir).isDirectory()) throw new Error("not a real directory: " + dir);
  if (realpathSync(dir) !== path.resolve(dir)) {
    // Windows realpath may canonicalize case; do not treat case alone as a redirect.
    if (realpathSync(dir).toLowerCase() !== path.resolve(dir).toLowerCase()) {
      throw new Error("symlinked coordination directory: " + dir);
    }
  }
}

function readOwner(dir) {
  ensureRealDir(dir);
  const content = readFileSync(path.join(dir, "owner.md"), "utf8");
  const fields = Object.fromEntries(content.split(/\r?\n/).filter(Boolean).map((line) => {
    const colon = line.indexOf(": ");
    return colon < 0 ? [line, ""] : [line.slice(0, colon), line.slice(colon + 2)];
  }));
  return fields;
}

function execute() {
  if (!["acquire", "verify", "release", "status"].includes(action) ||
    !roomArg || !path.isAbsolute(roomArg) ||
    (action !== "status" && (!/^session-0[1-8]$/.test(owner) ||
      (["verify", "release"].includes(action) && !/^[0-9a-f-]{36}$/.test(token ?? ""))))) {
    usage();
    return;
  }
  if ((action === "status" && (owner || token)) || (action === "acquire" && token)) {
    usage();
    return;
  }
  const room = path.resolve(roomArg);
  const claims = path.join(room, "claims");
  ensureRealDir(room);
  ensureRealDir(claims);
  const lock = path.join(claims, claimName);
  if (action === "status") {
    if (!existsSync(lock)) return output("FREE");
    const fields = readOwner(lock);
    return output("HELD", { owner: fields.OWNER || "UNKNOWN", branch: fields.BRANCH || "UNKNOWN", baseHead: fields.HEAD_AT_ACQUIRE || "UNKNOWN" });
  }
  const candidate = currentGit();
  if (action === "acquire") {
    try {
      mkdirSync(lock);
    } catch (err) {
      if (err.code === "EEXIST") return block("GIT-TURN already held; do not overwrite another owner");
      throw err;
    }
    const ownToken = randomUUID();
    try {
      writeFileSync(path.join(lock, "owner.md"), [
        "OWNER: " + owner,
        "TOKEN: " + ownToken,
        "BRANCH: " + candidate.branch,
        "HEAD_AT_ACQUIRE: " + candidate.head,
        "REPO: " + candidate.repo,
        "ACQUIRED_AT: " + new Date().toISOString(),
        "STATUS: HELD",
        "",
      ].join("\n"), { flag: "wx", encoding: "utf8" });
    } catch (err) {
      // We just created this empty directory. Never remove a nonempty foreign claim.
      try { rmdirSync(lock); } catch { /* preserve ambiguous state for inspection */ }
      throw err;
    }
    return output("ACQUIRED", { owner, token: ownToken, branch: candidate.branch, baseHead: candidate.head });
  }
  if (!existsSync(lock)) return block("GIT-TURN is not held");
  const fields = readOwner(lock);
  if (fields.OWNER !== owner || fields.TOKEN !== token) return block("owner or token mismatch; no change made");
  if (fields.BRANCH !== candidate.branch || path.normalize(fields.REPO || "").toLowerCase() !==
    path.normalize(candidate.repo).toLowerCase()) return block("turn belongs to another repository or branch");
  if (action === "verify") return output("VERIFIED", { owner, branch: candidate.branch, baseHead: fields.HEAD_AT_ACQUIRE, currentHead: candidate.head });
  const archive = path.join(claims, "GIT-TURN-RELEASED-" + owner.toUpperCase().replaceAll("-", "") + "-" + token);
  if (existsSync(archive)) return block("archive already exists; do not overwrite it");
  renameSync(lock, archive);
  const after = readOwner(archive);
  if (after.OWNER !== owner || after.TOKEN !== token) throw new Error("archived turn identity changed; inspect before retry");
  output("RELEASED", { owner, archive });
}

try {
  execute();
} catch (err) {
  block(err.message || String(err));
}
