#!/usr/bin/env node
// Defense-in-depth: inspect both the exact staged Git blobs and tracked
// working bytes. Never substitute a clean working file for a dirty index.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const gitExecutable = process.platform === "win32"
  ? "C:\\Program Files\\Git\\cmd\\git.exe"
  : "/usr/bin/git";
const maxBytes = 64 * 1024 * 1024;

export const forbiddenName = name => {
  const path = name.replaceAll("\\", "/");
  return /(^|\/)(credentials\.json|google-services\.json|GoogleService-Info\.plist)$|\.(jks|keystore|p12|p8|pem|key)$|(^|\/)\.env($|\.)/i.test(path) &&
    !/(^|\/)\.env\.example$/i.test(path);
};
export const containsLikelySecret = text =>
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
  /["']private_key["']\s*:/.test(text) ||
  /gh[pousr]_[A-Za-z0-9_]{20,}/.test(text) ||
  /github_pat_[A-Za-z0-9_]{20,}/.test(text) ||
  /sk_live_[A-Za-z0-9]{12,}/.test(text) ||
  /AKIA[0-9A-Z]{16}/.test(text);

function git(args) {
  return execFileSync(gitExecutable, args, { cwd: root, maxBuffer: maxBytes, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
}
const comparable = name => process.platform === "win32" ? name.toLowerCase() : name;
function inspectBytes(bytes) {
  // ASCII markers may also be present in binary files; never let a NUL
  // byte suppress detection. Handle UTF-16 text with its encoding marker.
  if (containsLikelySecret(bytes.toString("latin1"))) return true;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return containsLikelySecret(bytes.toString("utf16le", 2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const content = Buffer.from(bytes.subarray(2, bytes.length - bytes.length % 2));
    return containsLikelySecret(content.swap16().toString("utf16le"));
  }
  return false;
}
function stagedEntries(inventory, objectFormat) {
  const entries = [];
  const seen = new Set();
  const length = objectFormat === "sha256" ? 64 : 40;
  const pattern = new RegExp("^(100644|100755) ([a-f0-9]{" + length + "}) 0\\t(.+)$");
  for (const entry of inventory.toString("utf8").split("\0").filter(Boolean)) {
    const match = pattern.exec(entry);
    assert.ok(match, "Secret guard rejects unresolved or non-regular index entries");
    const [, , oid, name] = match;
    const parts = name.split("/");
    assert.ok(parts.every(part => part && part !== "." && part !== ".." && !/[\\:]/.test(part) && ![...part].some(char => char.charCodeAt(0) < 32)), "Unsafe tracked path");
    assert.ok(!seen.has(comparable(name)), "Ambiguous tracked path");
    seen.add(comparable(name));
    entries.push({ name, oid });
  }
  return entries;
}
function workingBytes(name) {
  const file = resolve(root, name);
  let entry;
  try { entry = lstatSync(file); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Tracked file unavailable");
  }
  assert.ok(entry.isFile() && !entry.isSymbolicLink() && entry.nlink === 1 &&
    comparable(realpathSync(file)) === comparable(file) && entry.size <= maxBytes,
    "Secret guard rejects redirected or unsupported tracked files");
  const bytes = readFileSync(file);
  assert.equal(bytes.length, entry.size, "Tracked file changed during read");
  return bytes;
}
function blobIdentity(bytes, format) {
  return createHash(format).update("blob " + bytes.length + "\0").update(bytes).digest("hex");
}
function verifyTrackedSecrets() {
  assert.equal(comparable(git(["rev-parse", "--show-toplevel"]).toString("utf8").trim().replaceAll("/", "\\")),
    comparable(root.replaceAll("/", "\\")), "Wrong checkout");
  const format = git(["rev-parse", "--show-object-format"]).toString("ascii").trim();
  assert.ok(format === "sha1" || format === "sha256", "Unsupported Git object format");
  const inventory = git(["ls-files", "--stage", "-z"]);
  const entries = stagedEntries(inventory, format);
  const problems = [];
  let staged = 0, working = 0;
  for (const { name, oid } of entries) {
    // Do not place potential credential values or a sensitive filename in logs.
    const label = containsLikelySecret(name) ? "[redacted path]" : name;
    if (forbiddenName(name) || containsLikelySecret(name)) {
      problems.push(label + ": forbidden tracked credential filename");
      continue;
    }
    const actual = workingBytes(name);
    if (actual !== null) {
      working++;
      if (inspectBytes(actual)) problems.push(label + ": likely secret marker in working bytes (value redacted)");
    }
    // Exact Git object identity proves when a working read covers the staged
    // bytes too. Otherwise explicitly read the staged immutable blob.
    if (actual === null || blobIdentity(actual, format) !== oid) {
      const indexed = git(["cat-file", "blob", oid]);
      assert.equal(blobIdentity(indexed, format), oid, "Index object identity mismatch");
      if (inspectBytes(indexed)) problems.push(label + ": likely secret marker in staged bytes (value redacted)");
    }
    staged++;
  }
  assert.ok(inventory.equals(git(["ls-files", "--stage", "-z"])), "Index changed during secret verification");
  assert.deepEqual(problems, [], "Tracked source secret guard failed; inspect locally without printing values.");
  console.log("TRACKED_SECRET_MARKERS_PASS files=" + staged + " staged=" + staged +
    " working=" + working + " binary_markers_scanned=true full_history=NOT_SCANNED");
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) verifyTrackedSecrets();
