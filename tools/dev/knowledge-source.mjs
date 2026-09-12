import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(import.meta.dirname, "../..");
export const knowledgeSourcesPath = path.join(repoRoot, "knowledge.sources.json");

const GOVERNANCE_REPOSITORY = "bthwani2-boop/governance-and-docs";
const GOVERNANCE_BRANCH = "a";
const DONOR_REPOSITORY = "bthwani2-boop/bthwani-suite-next";
const DONOR_BRANCH = "h";
const REFERENCE_CATEGORIES = ["commerce", "finance", "identity", "engineering", "experience"];
const REFERENCE_INDEXES = Object.freeze({
  commerce: "docs/reference/commerce.md",
  finance: "docs/reference/finance.md",
  identity: "docs/reference/identity.md",
  engineering: "docs/reference/engineering.md",
  experience: "docs/reference/experience.md",
  donor: "docs/reference/donor.md",
});

function fail(message) {
  throw new Error("BTHWANI_KNOWLEDGE_SOURCE: " + message);
}

function exactSha(value, label) {
  if (!/^[0-9a-f]{40}$/.test(value ?? "")) fail(label + " must be an exact 40-character lowercase SHA");
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) fail(label + " must be a non-empty string");
}

function expectedBranchUrl(repository, branch) {
  return `https://github.com/${repository}/tree/${branch}`;
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

  if (manifest?.schema !== 1) fail("unsupported knowledge.sources.json schema");

  const governance = manifest.governance ?? {};
  if (governance.repository !== GOVERNANCE_REPOSITORY) fail("unexpected governance repository: " + String(governance.repository));
  if (governance.branch !== GOVERNANCE_BRANCH) fail("unexpected governance branch: " + String(governance.branch));
  exactSha(governance.commit, "governance commit");
  if (governance.branch_url !== expectedBranchUrl(governance.repository, governance.branch)) fail("governance branch_url does not match repository/branch");
  if (governance.commit_url !== expectedCommitUrl(governance.repository, governance.commit)) fail("governance commit_url does not match repository/commit");
  if (governance.role !== "DURABLE_BTHWANI_KNOWLEDGE") fail("unexpected governance role");
  if (governance.authority !== "CHALLENGEABLE_DURABLE_BASELINE") fail("unexpected governance authority semantics");

  const donor = manifest.donor ?? {};
  if (donor.repository !== DONOR_REPOSITORY) fail("unexpected donor repository: " + String(donor.repository));
  if (donor.branch !== DONOR_BRANCH) fail("unexpected donor branch: " + String(donor.branch));
  exactSha(donor.commit, "donor commit");
  if (donor.branch_url !== expectedBranchUrl(donor.repository, donor.branch)) fail("donor branch_url does not match repository/branch");
  if (donor.commit_url !== expectedCommitUrl(donor.repository, donor.commit)) fail("donor commit_url does not match repository/commit");
  if (donor.role !== "FORENSIC_REFERENCE" || donor.authority !== "NONE") fail("unexpected donor authority semantics");

  const indexes = manifest.reference_indexes ?? {};
  for (const [key, expected] of Object.entries(REFERENCE_INDEXES)) {
    if (indexes[key] !== expected) fail(`reference_indexes.${key} must equal ${expected}`);
  }
  if (Object.keys(indexes).sort().join("|") !== Object.keys(REFERENCE_INDEXES).sort().join("|")) fail("reference_indexes contains an unexpected or missing key");

  const external = manifest.external_sources ?? {};
  const policy = external.policy ?? {};
  if (policy.authority !== "NONE") fail("external source authority must be NONE");
  if (policy.role !== "REFERENCE_FALSIFICATION_INPUT") fail("unexpected external source role");
  if (policy.freshness !== "REVALIDATE_AT_USE") fail("external sources must be REVALIDATE_AT_USE");
  if (policy.adoption !== "SEPARATE_PROOF_REQUIRED") fail("external source adoption must require separate proof");

  const seenNames = new Set();
  const seenUrls = new Set();
  for (const category of REFERENCE_CATEGORIES) {
    const entries = external[category];
    if (!Array.isArray(entries) || entries.length === 0) fail(`external_sources.${category} must be a non-empty array`);
    for (const [index, entry] of entries.entries()) {
      nonEmptyString(entry?.name, `external_sources.${category}[${index}].name`);
      if (seenNames.has(entry.name)) fail("duplicate external source name: " + entry.name);
      seenNames.add(entry.name);
      if (!Array.isArray(entry.urls) || entry.urls.length === 0) fail(`external_sources.${category}[${index}].urls must be non-empty`);
      for (const url of entry.urls) {
        if (typeof url !== "string" || !/^https:\/\//.test(url)) fail("external source URL must use https: " + String(url));
        if (seenUrls.has(url)) fail("duplicate external source URL: " + url);
        seenUrls.add(url);
      }
      if ("active_toolchain" in entry && typeof entry.active_toolchain !== "boolean") fail(`external_sources.${category}[${index}].active_toolchain must be boolean`);
    }
  }

  const allowedExternalKeys = new Set(["policy", ...REFERENCE_CATEGORIES]);
  for (const key of Object.keys(external)) if (!allowedExternalKeys.has(key)) fail("unexpected external_sources category: " + key);

  return Object.freeze(manifest);
}

export function readKnowledgePin() {
  const manifest = readKnowledgeSources();
  return Object.freeze({
    repository: manifest.governance.repository,
    branch: manifest.governance.branch,
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

function extractHttpsUrls(text) {
  return [...text.matchAll(/https:\/\/[^\s]+/g)]
    .map((match) => match[0].replace(/[),.;]+$/g, ""))
    .filter(Boolean);
}

function externalManifestUrls(manifest) {
  const urls = [];
  for (const category of REFERENCE_CATEGORIES) {
    for (const entry of manifest.external_sources[category]) urls.push(...entry.urls);
  }
  return urls.sort();
}

function assertReferenceParity(root, manifest) {
  const expected = [];
  for (const category of REFERENCE_CATEGORIES) {
    const relative = REFERENCE_INDEXES[category];
    const absolute = path.join(root, ...relative.split("/"));
    expected.push(...extractHttpsUrls(fs.readFileSync(absolute, "utf8")));
  }
  const expectedUnique = [...new Set(expected)].sort();
  const actual = externalManifestUrls(manifest);
  if (JSON.stringify(expectedUnique) !== JSON.stringify(actual)) {
    const expectedSet = new Set(expectedUnique);
    const actualSet = new Set(actual);
    const missing = expectedUnique.filter((url) => !actualSet.has(url));
    const extra = actual.filter((url) => !expectedSet.has(url));
    fail(`external source parity mismatch; missing=${missing.join(",") || "none"} extra=${extra.join(",") || "none"}`);
  }
}

function assertMaterialized(root, pin, manifest) {
  for (const required of ["governance/GOVERNANCE.md", "docs/README.md", ...Object.values(REFERENCE_INDEXES)]) {
    const absolute = path.join(root, ...required.split("/"));
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) fail("materialized source is missing " + required + " at " + root);
  }

  let head;
  try {
    head = runGit(["rev-parse", "HEAD"], root);
  } catch (error) {
    fail("materialized source is not a valid Git checkout: " + error.message);
  }
  if (head !== pin.commit) fail("materialized source HEAD mismatch: expected=" + pin.commit + " observed=" + head);
  assertReferenceParity(root, manifest);
}

export function ensureKnowledgeRoot({ materialize = true } = {}) {
  const manifest = readKnowledgeSources();
  const pin = readKnowledgePin();
  const override = process.env.BTHWANI_KNOWLEDGE_ROOT?.trim();

  if (override) {
    const root = path.resolve(override);
    assertMaterialized(root, pin, manifest);
    return root;
  }

  const cacheParent = path.join(repoRoot, ".cache", "bthwani-knowledge");
  const root = path.join(cacheParent, pin.commit);

  if (fs.existsSync(root)) {
    assertMaterialized(root, pin, manifest);
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

  assertMaterialized(root, pin, manifest);
  return root;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const root = ensureKnowledgeRoot({ materialize: true });
  const manifest = readKnowledgeSources();
  const pin = readKnowledgePin();
  console.log("KNOWLEDGE_MANIFEST=knowledge.sources.json");
  console.log("KNOWLEDGE_REPOSITORY=" + pin.repository);
  console.log("KNOWLEDGE_BRANCH=" + pin.branch);
  console.log("KNOWLEDGE_COMMIT=" + pin.commit);
  console.log("DONOR_REPOSITORY=" + manifest.donor.repository);
  console.log("DONOR_BRANCH=" + manifest.donor.branch);
  console.log("DONOR_COMMIT=" + manifest.donor.commit);
  console.log("KNOWLEDGE_ROOT=" + root);
  console.log("KNOWLEDGE_SOURCE=PASS");
}
