#!/usr/bin/env node
// Verify immutable Git objects and actual tracked working bytes through one reader.
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

function regularSingleLink(stat) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n;
}

function sameFileVersion(actual, original) {
  return regularSingleLink(actual) && actual.dev === original.dev && actual.ino === original.ino &&
    actual.size === original.size && actual.mtimeNs === original.mtimeNs && actual.ctimeNs === original.ctimeNs;
}

function nameStillIdentifiesFile(file, original) {
  try {
    // The standard Node resolver rejects redirected ancestors but preserves a
    // legitimate Windows 8.3 spelling. The native resolver expands short names;
    // comparing its spelling to the input would reject the same physical file.
    return sameFileVersion(lstatSync(file, { bigint: true }), original) &&
      samePath(realpathSync(file), resolve(file));
  } catch {
    return false;
  }
}

// Opening precedes admission. All content comes from the same descriptor;
// check the descriptor and its name before and after the bounded read.
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
    const stat = fstatSync(fd, { bigint: true });
    if (!regularSingleLink(stat) || stat.size > BigInt(limit) || !nameStillIdentifiesFile(file, stat))
      throw new Error("BLOCKED: unsafe file path");

    // One additional byte detects growth without relying on a second open.
    const buffer = Buffer.alloc(Number(stat.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const count = readSync(fd, buffer, offset, buffer.length - offset, null);
      if (!count) break;
      offset += count;
    }
    if (BigInt(offset) !== stat.size || !sameFileVersion(fstatSync(fd, { bigint: true }), stat) ||
        !nameStillIdentifiesFile(file, stat))
      throw new Error("BLOCKED: unsafe or changed file");
    return { bytes: buffer.subarray(0, offset), stat };
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
    // Exact blob identity allows one read to cover both versions; otherwise
    // inspect the immutable staged object even if the working file is absent.
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
