import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(import.meta.dirname, "../..");
export const knowledgeSourcesPath = path.join(repoRoot, "knowledge.sources.json");

const GOVERNANCE_REPOSITORY = "bthwani2-boop/governance-and-docs";
const ALLOWED_TOP_LEVEL_KEYS = ["governance", "schema"];
const ALLOWED_GOVERNANCE_KEYS = ["authority", "commit", "commit_url", "repository", "role"];

function fail(message) {
  throw new Error("BTHWANI_KNOWLEDGE_SOURCE: " + message);
}

function exactSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) fail(label + " must be an exact 40-character lowercase SHA");
}

function exactKeys(value, expected, label) {
  const actual = Object.keys(value ?? {}).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    fail(label + " keys must be exactly: " + wanted.join(", "));
  }
}

function expectedCommitUrl(repository, commit) {
  return `https://github.com/${repository}/commit/${commit}`;
}

export function readKnowledgeSources() {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(knowledgeSourcesPath, "utf8"));
  } catch (error) {
    fail("knowledge.sources.json is missing or invalid JSON: " + error.message);
  }

  if (manifest?.schema !== 2) fail("unsupported knowledge.sources.json schema");
  exactKeys(manifest, ALLOWED_TOP_LEVEL_KEYS, "knowledge.sources.json");

  const governance = manifest.governance ?? {};
  exactKeys(governance, ALLOWED_GOVERNANCE_KEYS, "governance binding");
  if (governance.repository !== GOVERNANCE_REPOSITORY) fail("unexpected governance repository: " + String(governance.repository));
  exactSha(governance.commit, "governance commit");
  if (governance.commit_url !== expectedCommitUrl(governance.repository, governance.commit)) fail("governance commit_url does not match repository/commit");
  if (governance.role !== "DURABLE_BTHWANI_KNOWLEDGE") fail("unexpected governance role");
  if (governance.authority !== "CHALLENGEABLE_DURABLE_BASELINE") fail("unexpected governance authority semantics");

  return Object.freeze(manifest);
}

export function readKnowledgePin() {
  const manifest = readKnowledgeSources();
  return Object.freeze({
    repository: manifest.governance.repository,
    commit: manifest.governance.commit,
  });
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function assertMaterialized(root, pin) {
  for (const required of [
    "AGENTS.md",
    "governance/GOVERNANCE.md",
    "docs/README.md",
    "tools/verify-knowledge.mjs",
  ]) {
    const absolute = path.join(root, ...required.split("/"));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      fail("materialized source is missing " + required + " at " + root);
    }
  }

  let head;
  try {
    head = runGit(["rev-parse", "HEAD"], root);
  } catch (error) {
    fail("materialized source is not a valid Git checkout: " + error.message);
  }
  if (head !== pin.commit) fail("materialized source HEAD mismatch: expected=" + pin.commit + " observed=" + head);
}

export function ensureKnowledgeRoot({ materialize = true } = {}) {
  readKnowledgeSources();
  const pin = readKnowledgePin();
  const override = process.env.BTHWANI_KNOWLEDGE_ROOT?.trim();

  if (override) {
    const root = path.resolve(override);
    assertMaterialized(root, pin);
    return root;
  }

  const cacheParent = path.join(repoRoot, ".cache", "bthwani-knowledge");
  const root = path.join(cacheParent, pin.commit);

  if (fs.existsSync(root)) {
    assertMaterialized(root, pin);
    return root;
  }

  if (!materialize) fail("pinned knowledge is not materialized; run pnpm knowledge:sync");

  fs.mkdirSync(cacheParent, { recursive: true });
  const temp = root + ".tmp-" + process.pid;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });

  try {
    runGit(["init", "--quiet"], temp);
    runGit(["remote", "add", "origin", "https://github.com/" + pin.repository + ".git"], temp);
    runGit(["fetch", "--quiet", "--depth=1", "origin", pin.commit], temp);
    const fetched = runGit(["rev-parse", "FETCH_HEAD"], temp);
    if (fetched !== pin.commit) fail("fetched commit mismatch: expected=" + pin.commit + " observed=" + fetched);
    runGit(["checkout", "--quiet", "--detach", fetched], temp);
    fs.renameSync(temp, root);
  } catch (error) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw error;
  }

  assertMaterialized(root, pin);
  return root;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = ensureKnowledgeRoot({ materialize: true });
  const pin = readKnowledgePin();
  console.log("KNOWLEDGE_MANIFEST=knowledge.sources.json");
  console.log("KNOWLEDGE_REPOSITORY=" + pin.repository);
  console.log("KNOWLEDGE_COMMIT=" + pin.commit);
  console.log("KNOWLEDGE_ROOT=" + root);
  console.log("KNOWLEDGE_SOURCE=PASS");
}
