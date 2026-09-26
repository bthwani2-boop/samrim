import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: false });
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const readKnowledge = (p) => fs.readFileSync(path.join(knowledgeRoot, p), "utf8");

const packageJson = JSON.parse(read("package.json"));
const developmentGuide = readKnowledge("docs/DEVELOPMENT.md");
const operationsGuide = readKnowledge("docs/OPERATIONS.md");

const nodeVersion = read(".nvmrc").trim();
const nodeVersionFile = read(".node-version").trim();
const pnpmVersion = (packageJson.packageManager ?? "").match(/^pnpm@(.+)$/)?.[1];
const goVersion = read("go.work").match(/^go\s+(\S+)\s*$/m)?.[1];

if (!nodeVersion || nodeVersion !== nodeVersionFile) failures.push("Node pin mismatch between .nvmrc and .node-version");
if (!pnpmVersion || pnpmVersion !== packageJson.engines?.pnpm) failures.push("pnpm pin mismatch between packageManager and engines.pnpm");
if (!packageJson.engines?.node?.includes(nodeVersion)) failures.push("engines.node does not admit pinned Node " + nodeVersion);
if (!goVersion) failures.push("go.work missing Go version");

function findGoMods(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === ".git" || entry.name === ".kilo" || entry.name === ".cache") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findGoMods(full));
    } else if (entry.name === "go.mod") {
      results.push(full);
    }
  }
  return results;
}

const allGoMods = findGoMods(root).map((f) => path.relative(root, f).replace(/\\/g, "/"));
for (const mod of allGoMods) {
  const version = read(mod).match(/^go\s+(\S+)\s*$/m)?.[1];
  if (version !== goVersion) failures.push(mod + " Go version differs from go.work");
}

function requireMetadata(body, key, expected, owner) {
  const match = body.match(new RegExp(`^${key}:\\s*(\\S+)\\s*$`, "m"));
  if (!match || match[1] !== expected) failures.push(`${owner} must declare ${key}: ${expected}`);
}

requireMetadata(developmentGuide, "DOCUMENT_CLASS", "NONAUTHORITATIVE_DEVELOPMENT_GUIDE", "docs/DEVELOPMENT.md");
requireMetadata(developmentGuide, "CURRENT_IMPLEMENTATION_AUTHORITY", "NONE", "docs/DEVELOPMENT.md");
requireMetadata(operationsGuide, "DOCUMENT_CLASS", "NONAUTHORITATIVE_OPERATIONS_GUIDE", "docs/OPERATIONS.md");
requireMetadata(operationsGuide, "CURRENT_IMPLEMENTATION_AUTHORITY", "NONE", "docs/OPERATIONS.md");

if (!/current repository commands, paths, versions and runtime shape are sourced from the consuming repository/i.test(developmentGuide)) {
  failures.push("development guide must route mutable command/path/version/runtime truth to the consuming repository");
}
if (!/operational actions are source-derived from the exact implementation candidate/i.test(operationsGuide)) {
  failures.push("operations guide must route operational truth to the exact implementation candidate");
}
if (!/does not freeze commands, ports, container names, credentials or provider settings/i.test(operationsGuide)) {
  failures.push("operations guide must explicitly reject frozen mutable runtime configuration");
}

const guides = [
  ["docs/DEVELOPMENT.md", developmentGuide],
  ["docs/OPERATIONS.md", operationsGuide],
];
for (const [name, body] of guides) {
  if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(body)) failures.push(name + " hard-codes a local port");
  if (/\b(?:node|pnpm|go)\s+v?\d+\.\d+(?:\.\d+)?\b/i.test(body)) failures.push(name + " freezes a mutable toolchain version");
  if (/\b(?:runtime:integration|runtime:daily):/i.test(body)) failures.push(name + " freezes a retired parallel runtime command family");
}

if (/docker compose/i.test(read("tools/dev/bootstrap.ps1"))) failures.push("bootstrap must remain independent of runtime composition");

if (failures.length) {
  console.error("DOC_CONFIG_PARITY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("DOC_CONFIG_PARITY=PASS");
console.log("DOC_MUTABLE_CONFIGURATION_AUTHORITY=CONSUMING_REPOSITORY");
console.log("NODE=" + nodeVersion);
console.log("PNPM=" + pnpmVersion);
console.log("GO=" + goVersion);
