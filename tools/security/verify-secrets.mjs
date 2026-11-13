#!/usr/bin/env node
// Scan current tracked source; do not print secret values in terminal or CI logs.
// This is a defense-in-depth guard, not full provider-side secret scanning.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const forbiddenName = (name) => {
  const path = name.replaceAll("\\", "/");
  return /(^|\/)(credentials\.json|google-services\.json|GoogleService-Info\.plist)$|\.(jks|keystore|p12|p8|pem|key)$|(^|\/)\.env($|\.)/i.test(path) &&
    !/(^|\/)\.env\.example$/i.test(path);
};
export const containsLikelySecret = (text) =>
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text) ||
  /["']private_key["']\s*:/.test(text) ||
  /gh[pousr]_[A-Za-z0-9_]{20,}/.test(text) ||
  /github_pat_[A-Za-z0-9_]{20,}/.test(text) ||
  /sk_live_[A-Za-z0-9]{12,}/.test(text) ||
  /AKIA[0-9A-Z]{16}/.test(text);

const paths = execFileSync("git", ["ls-files", "-z"], {
  cwd: root, encoding: "utf8",
}).split("\0").filter(Boolean);
const problems = [];
let checked = 0;
for (const path of paths) {
  if (forbiddenName(path)) {
    problems.push(path + ": forbidden tracked credential filename");
    continue;
  }
  const data = readFileSync(resolve(root, path));
  if (data.includes(0)) continue; // Binary assets cannot be safely decoded as source.
  checked++;
  if (containsLikelySecret(data.toString("utf8"))) {
    problems.push(path + ": likely secret marker detected (value redacted)");
  }
}
assert.deepEqual(problems, [], "Tracked source secret guard failed; inspect locally without printing values.");
console.log("TRACKED_SECRET_MARKERS_PASS files=" + checked + " binary_assets_skipped=true full_history=NOT_SCANNED");
