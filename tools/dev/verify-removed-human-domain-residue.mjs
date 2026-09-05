import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const retiredDomain = ["work", "force"].join("").toLowerCase();
const tracked = execFileSync("git", ["ls-files", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((item) => item.replaceAll("\\", "/"));

const failures = [];
let historicalReferenceMatches = 0;
let diagnosticVocabularyFiles = 0;

const currentAuthorityPatterns = [
  {
    label: "CURRENT_DOMAIN_PATH_REFERENCE",
    regex: new RegExp(
      "(?:services|core|packages)/" + retiredDomain + "(?:/|\\b)",
      "i",
    ),
  },
  {
    label: "CURRENT_DOMAIN_PACKAGE_REFERENCE",
    regex: new RegExp("@[A-Za-z0-9._-]+/" + retiredDomain + "\\b", "i"),
  },
  {
    label: "CURRENT_DOMAIN_OWNERSHIP_ASSERTION",
    regex: new RegExp("\\b" + retiredDomain + "\\s+owns\\b", "i"),
  },
];

function isDiagnosticVerifier(file) {
  return /^tools\/dev\/verify-[^/]+\.(?:mjs|js|ts)$/.test(file);
}

function isNonAuthoritativeHistoricalReference(file, content) {
  return (
    file.startsWith("docs/reference/") &&
    /^DOCUMENT_CLASS:\s*NONAUTHORITATIVE_[A-Z0-9_-]*REFERENCE\s*$/m.test(content)
  );
}

for (const file of tracked) {
  if (file.toLowerCase().includes(retiredDomain)) {
    failures.push("FORBIDDEN_REMOVED_DOMAIN_PATH: " + file);
  }

  const absolute = path.join(repoRoot, file);
  const buffer = fs.readFileSync(absolute);
  if (buffer.includes(0)) continue;

  const content = buffer.toString("utf8");
  if (isNonAuthoritativeHistoricalReference(file, content)) {
    if (content.toLowerCase().includes(retiredDomain)) {
      historicalReferenceMatches += 1;
    }
    continue;
  }

  if (isDiagnosticVerifier(file)) {
    if (content.toLowerCase().includes(retiredDomain)) {
      diagnosticVocabularyFiles += 1;
    }
    continue;
  }

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const { label, regex } of currentAuthorityPatterns) {
      if (!regex.test(lines[index])) continue;
      failures.push(
        label +
          ": " +
          file +
          ":" +
          (index + 1) +
          ": " +
          lines[index].trim(),
      );
    }
  }
}

if (failures.length > 0) {
  console.error("REMOVED_HUMAN_DOMAIN_RESIDUE=FAIL");
  for (const failure of [...new Set(failures)].sort()) {
    console.error("  " + failure);
  }
  process.exit(1);
}

console.log("REMOVED_HUMAN_DOMAIN_PATHS=0");
console.log("REMOVED_HUMAN_DOMAIN_CURRENT_AUTHORITY_MATCHES=0");
console.log("REMOVED_HUMAN_DOMAIN_CONTENT_MATCHES=0");
console.log("NONAUTHORITATIVE_HISTORICAL_REFERENCE_FILES=" + historicalReferenceMatches);
console.log("DIAGNOSTIC_VOCABULARY_FILES=" + diagnosticVocabularyFiles);
console.log("REMOVED_HUMAN_DOMAIN_RESIDUE=PASS");
