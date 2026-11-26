#!/usr/bin/env node
// Verify actual tracked working bytes and immutable staged Git objects.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const gitExecutable = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
const maxBytes = 64 * 1024 * 1024;
const comparable = name => process.platform === "win32" ? name.toLowerCase() : name;
export const samePath = (left, right) => comparable(left) === comparable(right);

// Shared source/evidence reader: open once, validate that descriptor, read
// bounded bytes from it, then verify both descriptor and pathname identities.
// A deleted working file is permitted only before opening, never mid-read.
export function readVerifiedFile(file, limit, { allowMissing = false } = {}) {
  assert.ok(Number.isSafeInteger(limit) && limit >= 0, "Invalid verified read bound");
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (allowMissing && error.code === "ENOENT" && !lstatSync(file, { throwIfNoEntry: false })) return null;
    throw error;
  }
  try {
    const initial = fstatSync(fd, { bigint: true });
    const matches = entry => entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1n &&
      entry.dev === initial.dev && entry.ino === initial.ino && entry.size === initial.size &&
      entry.mtimeNs === initial.mtimeNs && entry.ctimeNs === initial.ctimeNs;
    const pathMatches = () => {
      try {
        const entry = lstatSync(file, { bigint: true });
        return matches(entry) && samePath(realpathSync.native(file), resolve(file));
      } catch {
        return false;
      }
    };
    if (!initial.isFile() || initial.nlink !== 1n || initial.size > BigInt(limit) || !pathMatches())
      throw new Error("BLOCKED: unsafe file path");
    const bytes = Buffer.alloc(Number(initial.size) + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      if (!count) break;
      offset += count;
    }
    if (BigInt(offset) !== initial.size || !matches(fstatSync(fd, { bigint: true })) || !pathMatches())
      throw new Error("BLOCKED: unsafe or changed file");
    return { bytes: bytes.subarray(0, offset), stat: initial };
  } finally {
    closeSync(fd);
  }
}

export function forbiddenName(name) {
  const path = name.replaceAll("\\", "/");
  return /(^|\/)(credentials\.json|google-services\.json|GoogleService-Info\.plist)$|\.(jks|keystore|p12|p8|pem|key)$|(^|\/)\.env($|\.)/i.test(path) &&
    !/(^|\/)\.env\.example$/i.test(path);
}

export function containsLikelySecret(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
    /["']private_key["']\s*:/.test(text) ||
    /gh[pousr]_[A-Za-z0-9_]{20,}/.test(text) ||
    /github_pat_[A-Za-z0-9_]{20,}/.test(text) ||
    /sk_live_[A-Za-z0-9]{12,}/.test(text) ||
    /AKIA[0-9A-Z]{16}/.test(text);
}

function hasMarker(bytes) {
  if (containsLikelySecret(bytes.toString("latin1"))) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return containsLikelySecret(bytes.toString("utf16le", 2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const end = bytes.length - bytes.length % 2;
    return containsLikelySecret(Buffer.from(bytes.subarray(2, end)).swap16().toString("utf16le"));
  }
  return false;
}

function git(...args) {
  return execFileSync(gitExecutable, args, {
    cwd: root, maxBuffer: maxBytes, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
}

function parseIndex(inventory, format) {
  const entries = new Map();
  const oidLength = format === "sha256" ? 64 : 40;
  const regular = new RegExp("^(100644|100755) ([a-f0-9]{" + oidLength + "}) 0\\t(.+)$");
  for (const record of inventory.toString("utf8").split("\0").filter(Boolean)) {
    const match = regular.exec(record);
    assert.ok(match, "Secret guard rejects unresolved or non-regular index entries");
    const [, , oid, name] = match;
    assert.ok(name.split("/").every(part => part && part !== "." && part !== ".." &&
      !/[\\:]/.test(part) && ![...part].some(char => char.charCodeAt(0) < 32)), "Unsafe tracked path");
    const key = comparable(name);
    assert.ok(!entries.has(key), "Ambiguous tracked path");
    entries.set(key, { name, oid });
  }
  return entries.values();
}

function blobIdentity(bytes, format) {
  return createHash(format).update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}

function verifyTrackedSecrets() {
  const checkout = git("rev-parse", "--show-toplevel").toString("utf8").trim();
  assert.ok(samePath(resolve(checkout), root), "Wrong checkout");
  const format = git("rev-parse", "--show-object-format").toString("ascii").trim();
  assert.ok(["sha1", "sha256"].includes(format), "Unsupported Git object format");
  const inventory = git("ls-files", "--stage", "-z");
  const violations = [];
  let staged = 0;
  let working = 0;
  for (const { name, oid } of parseIndex(inventory, format)) {
    const nameContainsMarker = containsLikelySecret(name);
    const label = nameContainsMarker ? "[redacted path]" : name;
    if (forbiddenName(name) || nameContainsMarker) {
      violations.push(label + ": forbidden tracked credential filename");
      continue;
    }
    let actual;
    try {
      actual = readVerifiedFile(resolve(root, name), maxBytes, { allowMissing: true });
    } catch {
      violations.push(label + ": secret guard rejects redirected, changed or unsupported tracked file");
      continue;
    }
    if (actual) {
      working++;
      if (hasMarker(actual.bytes)) violations.push(label + ": likely secret marker in working bytes (value redacted)");
    }
    // Identical Git blob identity proves the working bytes also cover the index.
    // Otherwise verify the immutable staged object independently, even on deletion.
    if (!actual || blobIdentity(actual.bytes, format) !== oid) {
      const indexed = git("cat-file", "blob", oid);
      assert.equal(blobIdentity(indexed, format), oid, "Index object identity mismatch");
      if (hasMarker(indexed)) violations.push(label + ": likely secret marker in staged bytes (value redacted)");
    }
    staged++;
  }
  assert.ok(inventory.equals(git("ls-files", "--stage", "-z")), "Index changed during secret verification");
  assert.deepEqual(violations, [], "Tracked source secret guard failed; inspect locally without printing values.");
  console.log("TRACKED_SECRET_MARKERS_PASS files=" + staged + " staged=" + staged +
    " working=" + working + " binary_markers_scanned=true full_history=NOT_SCANNED");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) verifyTrackedSecrets();
