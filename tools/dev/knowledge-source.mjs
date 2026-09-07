import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(import.meta.dirname, "../..");
export const pinPath = path.join(repoRoot, "governance.lock.json");

function fail(message) {
  throw new Error("BTHWANI_KNOWLEDGE_SOURCE: " + message);
}

export function readKnowledgePin() {
  let pin;
  try {
    pin = JSON.parse(fs.readFileSync(pinPath, "utf8"));
  } catch (error) {
    fail("governance.lock.json is missing or invalid JSON: " + error.message);
  }

  if (pin?.schema !== 1) fail("unsupported pin schema");
  if (pin.repository !== "bthwani2-boop/governance-and-docs") {
    fail("unexpected repository: " + String(pin.repository));
  }
  if (!/^[0-9a-f]{40}$/.test(pin.commit ?? "")) {
    fail("commit must be an exact 40-character lowercase SHA");
  }

  return Object.freeze({
    repository: pin.repository,
    commit: pin.commit,
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
  for (const required of ["governance/GOVERNANCE.md", "docs/README.md"]) {
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
  if (head !== pin.commit) {
    fail("materialized source HEAD mismatch: expected=" + pin.commit + " observed=" + head);
  }
}

export function ensureKnowledgeRoot({ materialize = true } = {}) {
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

  if (!materialize) {
    fail("pinned knowledge is not materialized; run pnpm knowledge:sync");
  }

  fs.mkdirSync(cacheParent, { recursive: true });
  const temp = root + ".tmp-" + process.pid;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true });

  try {
    runGit(["init", "--quiet"], temp);
    runGit(["remote", "add", "origin", "https://github.com/" + pin.repository + ".git"], temp);
    runGit(["fetch", "--quiet", "--depth=1", "origin", pin.commit], temp);
    const fetched = runGit(["rev-parse", "FETCH_HEAD"], temp);
    if (fetched !== pin.commit) {
      fail("fetched commit mismatch: expected=" + pin.commit + " observed=" + fetched);
    }
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
  console.log("KNOWLEDGE_REPOSITORY=" + pin.repository);
  console.log("KNOWLEDGE_COMMIT=" + pin.commit);
  console.log("KNOWLEDGE_ROOT=" + root);
  console.log("KNOWLEDGE_SOURCE=PASS");
}
