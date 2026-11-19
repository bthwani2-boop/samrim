#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
/**
 * Prepare a reviewable partner -> merchant source rename.
 *
 * This is intentionally NOT a repository-wide string replacer.
 * Planning is read-only unless --out is supplied; applying requires
 * an explicitly reviewed manifest with approved: true for each line.
 * Governance, AGENTS.md, migrations and external compatibility IDs
 * are never edited by this tool.
 */
import {
  existsSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

const VERSION = 1;
const args = process.argv.slice(2);
const command = args[0] ?? "plan";

function die(message) {
  console.error("BLOCKED: " + message);
  process.exit(1);
}

function option(name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}

function git(root, ...arguments_) {
  return execFileSync("git", arguments_, {
    cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
  }).trimEnd();
}

function hash(data) {
  return createHash("sha256").update(data).digest("hex");
}

function repoRoot() {
  const provided = option("--root") ?? process.cwd();
  const root = resolve(provided);
  if (!existsSync(join(root, "AGENTS.md"))) die("AGENTS.md missing in target checkout");
  try {
    return resolve(git(root, "rev-parse", "--show-toplevel"));
  } catch {
    die("Not a Git checkout");
  }
}

function guardedFile(path) {
  return /(^|\/)AGENTS\.md$/i.test(path)
    || /^(?:governance|docs|specs|\.agents|\.github)\//i.test(path)
    || /^(?:REPOSITORY-STRUCTURE\.md|README(?:\..*)?)$/i.test(path);
}

function classify(path, dirty) {
  if (guardedFile(path)) return "PROTECTED_POLICY_OR_HISTORY";
  if (/^(?:tools|infra)\//i.test(path)) return "TOOLING_OR_INFRA_MANUAL";
  if (/(^|\/)(?:database|migrations|contracts|generated|node_modules|dist|build|\.expo)(\/|$)/i.test(path)
    || /\.(?:sql|lock|snap)$/i.test(path)) return "SQL_CONTRACT_OR_GENERATED_MANUAL";
  if (!/^(apps|services|packages)\//.test(path)) return "OUT_OF_SCOPE";
  if (!/\.(?:js|jsx|mjs|cjs|ts|tsx|go|json|yaml|yml)$/.test(path)) return "UNSUPPORTED_FILE_TYPE";
  if (/(^|\/)(?:app\.json|package\.json|app\.config\.[^/]+)$/.test(path)) return "EXTERNAL_IDENTITY_MANUAL";
  if (dirty.has(path)) return "DIRTY_FILE_SKIP";
  return "REVIEWABLE";
}

function propose(source) {
  // Respect common camelCase, PascalCase, lowercase, UPPERCASE.
  // Avoid English words such as partnership/partnered.
  return source.replace(
    /(?<![A-Za-z])(?:partners|partner|Partners|Partner|PARTNERS|PARTNER)(?![a-z])|(?<=[a-z])(?:Partners|Partner|PARTNERS|PARTNER)(?![a-z])/g,
    (match) => {
      const plural = /s$/i.test(match);
      const base = plural ? "merchants" : "merchant";
      if (match === match.toUpperCase()) return base.toUpperCase();
      if (match[0] === match[0].toUpperCase()) {
        return base[0].toUpperCase() + base.slice(1);
      }
      return base;
    },
  );
}

function isCompatibility(line) {
  return /app-partner|partner-store-commissions|(?:package|bundle|scheme|slug|applicationId).{0,50}partner/i.test(line);
}

function guardHashes(root) {
  const required = [
    ["AGENTS.md", "Mandatory Customer/Merchant terminology and authorization guard"],
    ["governance/platform.md", "CUSTOMER_MERCHANT_CANONICAL_TERMS"],
  ];
  return Object.fromEntries(required.map(([path, marker]) => {
    const file = join(root, path);
    if (!existsSync(file)) die("Required guard missing: " + path);
    const bytes = readFileSync(file);
    if (!bytes.toString("utf8").includes(marker)) {
      die("Required guard marker missing: " + path);
    }
    return [path, hash(bytes)];
  }));
}

function trackedFiles(root) {
  return git(root, "ls-files", "--cached", "--full-name")
    .split(/\r?\n/).filter(Boolean);
}

function dirtyFiles(root) {
  const names = [
    git(root, "diff", "--name-only"),
    git(root, "diff", "--cached", "--name-only"),
  ].join("\n");
  return new Set(names.split(/\r?\n/).filter(Boolean).map((x) => x.replaceAll("\\", "/")));
}

function safePath(root, path) {
  if (typeof path !== "string" || !path || isAbsolute(path)
      || path.includes("\\") || path.split("/").includes("..") || path.startsWith("/")) {
    die("Invalid manifest path");
  }
  const absolute = resolve(root, path);
  if (!absolute.startsWith(root + sep)) die("Path escapes repository: " + path);
  if (!existsSync(absolute) || !lstatSync(absolute).isFile()) {
    die("Missing or non-file: " + path);
  }
  let cursor = absolute;
  while (cursor !== root) {
    if (lstatSync(cursor).isSymbolicLink()) die("Symlink refused: " + path);
    cursor = dirname(cursor);
  }
  return absolute;
}

function linesOf(value) {
  return value.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

function plan(root, head) {
  const protectedHashes = guardHashes(root);
  const dirty = dirtyFiles(root);
  const entries = [];
  const skipped = [];
  let scanned = 0;
  for (const path of trackedFiles(root)) {
    if (!/partner/i.test(path) && !/\.(?:js|jsx|mjs|cjs|ts|tsx|go|json|yaml|yml|md|ps1|sql|csv)$/.test(path)) continue;
    const file = safePath(root, path);
    const bytes = readFileSync(file);
    if (bytes.includes(0)) continue;
    const original = bytes.toString("utf8");
    if (!/partner/i.test(original) && !/partner/i.test(path)) continue;
    scanned++;
    const classification = classify(path, dirty);
    if (classification !== "REVIEWABLE") {
      skipped.push({ path, reason: classification });
      continue;
    }
    const sourceLines = linesOf(original);
    const fileHash = hash(bytes);
    for (let i = 0; i < sourceLines.length; i++) {
      const before = sourceLines[i];
      if (!/partner/i.test(before)) continue;
      if (isCompatibility(before)) {
        skipped.push({ path, line: i + 1, reason: "EXTERNAL_COMPATIBILITY_ID_MANUAL" });
        continue;
      }
      const after = propose(before);
      if (before !== after) {
        entries.push({
          path, line: i + 1, fileSha256: fileHash,
          before, after, approved: false,
        });
      }
    }
  }
  return {
    schemaVersion: VERSION, repository: root, head, protectedHashes,
    explanation: "Review each line. Set approved=true only for Merchant domain semantics. SQL/contracts/routes/external IDs and dirty files need separate owner-backed change.",
    summary: { filesWithPartnerOrPathName: scanned, proposedLines: entries.length, deferredItems: skipped.length },
    entries, skipped,
  };
}

function apply(root, head, manifestPath) {
  if (!manifestPath) die("apply requires --manifest <reviewed-plan.json>");
  const manifest = JSON.parse(readFileSync(resolve(manifestPath), "utf8"));
  if (manifest.schemaVersion !== VERSION || manifest.repository !== root || manifest.head !== head) {
    die("Manifest repository/HEAD mismatch; regenerate plan");
  }
  const currentGuards = guardHashes(root);
  if (JSON.stringify(currentGuards) !== JSON.stringify(manifest.protectedHashes)) {
    die("Policy guard changed since planning; regenerate plan");
  }
  const dirty = dirtyFiles(root);
  const tracked = new Set(trackedFiles(root));
  const approved = manifest.entries.filter((x) => x.approved === true);
  if (!approved.length) die("No explicitly approved changes");
  const byFile = new Map();
  for (const item of approved) {
    if (!tracked.has(item.path) || classify(item.path, dirty) !== "REVIEWABLE") {
      die("Untracked, dirty, or forbidden file: " + item.path);
    }
    if (propose(item.before) !== item.after || isCompatibility(item.before)) {
      die("Unsafe or manually altered replacement: " + item.path);
    }
    if (!byFile.has(item.path)) byFile.set(item.path, []);
    byFile.get(item.path).push(item);
  }
  const updates = [];
  for (const [path, changes] of byFile) {
    const absolute = safePath(root, path);
    const bytes = readFileSync(absolute);
    const sourceLines = linesOf(bytes.toString("utf8"));
    const used = new Set();
    for (const item of changes) {
      const i = item.line - 1;
      if (!Number.isSafeInteger(i) || i < 0 || i >= sourceLines.length
          || sourceLines[i] !== item.before || hash(bytes) !== item.fileSha256
          || used.has(i)) {
        die("Stale, duplicate, or mismatched source: " + path + ":" + item.line);
      }
      used.add(i);
      sourceLines[i] = item.after;
    }
    const result = Buffer.from(sourceLines.join(""), "utf8");
    if (!result.equals(bytes)) updates.push({ path, absolute, result });
  }
  // All changes must validate before any write.
  for (const { absolute, result } of updates) {
    const temporary = absolute + ".merchant-rename-" + randomUUID() + ".tmp";
    try {
      writeFileSync(temporary, result, { flag: "wx" });
      renameSync(temporary, absolute);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  const guardsAfter = guardHashes(root);
  if (JSON.stringify(guardsAfter) !== JSON.stringify(currentGuards)) {
    die("Unexpected policy guard mutation detected");
  }
  console.log("APPLIED: " + updates.length + " reviewed files. Validate diff, imports, tests and contracts before commit.");
}

try {
  const root = repoRoot();
  const head = git(root, "rev-parse", "HEAD");
  const branch = git(root, "branch", "--show-current");
  if (!branch || /^archive\//.test(branch)) die("Protected/archived or detached branch");
  if (command === "plan") {
    const manifest = plan(root, head);
    if (option("--out")) {
      const output = resolve(option("--out"));
      if (output.startsWith(root + sep)) die("Save the review manifest OUTSIDE the repository");
      writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
      console.log("PLAN_FILE=" + output);
    }
    console.log(JSON.stringify({
      action: "PLAN_ONLY", branch, head, ...manifest.summary,
      rulesUntouched: Object.keys(manifest.protectedHashes),
      reviewRequired: true,
    }, null, 2));
  } else if (command === "apply") {
    apply(root, head, option("--manifest"));
  } else {
    die("Usage: node tools/dev/prepare-merchant-rename.mjs plan [--out C:/outside/review.json] [--root REPO] | apply --manifest C:/outside/review.json [--root REPO]");
  }
} catch (error) {
  die(error.message);
}
