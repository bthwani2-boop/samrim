import fs from "node:fs";
import path from "node:path";
import { ensureKnowledgeRoot } from "./knowledge-source.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const knowledgeRoot = ensureKnowledgeRoot({ materialize: true });
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const readKnowledge = (p) => fs.readFileSync(path.join(knowledgeRoot, p), "utf8");

const packageJson = JSON.parse(read("package.json"));
const workflowGuide = readKnowledge("docs/development/workflow.md");
const runtimeGuide = readKnowledge("docs/development/runtime.md");
const compose = read("infra/local/compose/compose.yaml");
const envExample = read("infra/local/compose/.env.example");

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
    if (entry.name === "node_modules" || entry.name === "vendor" || entry.name === ".git") continue;
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

if (!workflowGuide.includes("Use repository-declared versions and scripts")) {
  failures.push("developer workflow must route toolchain/version truth to executable repository declarations");
}
if (!workflowGuide.includes("CURRENT_COMMAND_TRUTH_SOURCE: package.json / pnpm-workspace.yaml / repository scripts")) {
  failures.push("developer workflow must identify repository manifests/scripts as command truth");
}
if (!runtimeGuide.includes("CURRENT_RUNTIME_TRUTH_SOURCE: live repository scripts/configuration")) {
  failures.push("runtime guide must identify live repository scripts/configuration as runtime truth");
}
if (!runtimeGuide.includes("Resolve them from the consuming repository's exact pinned `package.json`, runtime scripts and executable configuration")) {
  failures.push("runtime guide must route runtime command truth to the exact consuming repository");
}
if (/runtime:integration:|runtime:daily:/i.test(runtimeGuide + "\n" + workflowGuide)) {
  failures.push("development guides must not freeze retired parallel runtime command families");
}

for (const key of new Set([...runtimeGuide.matchAll(/\bIDENTITY_[A-Z0-9_]+\b/g)].map((m) => m[0]))) {
  if (!compose.includes(key)) failures.push("documented Identity config key missing from compose: " + key);
  if (!envExample.includes(key + "=")) failures.push("documented Identity config key missing from .env.example: " + key);
}

for (const file of (function collect(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out;
})(path.join(knowledgeRoot, "docs/development"))) {
  const body = fs.readFileSync(file, "utf8");
  if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(body)) {
    failures.push(path.relative(knowledgeRoot, file).split(path.sep).join("/") + " hard-codes a local port");
  }
}

if (/docker compose/i.test(read("tools/dev/bootstrap.ps1"))) failures.push("bootstrap must remain independent of runtime composition");

if (failures.length) {
  console.error("DOC_CONFIG_PARITY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("DOC_CONFIG_PARITY=PASS");
console.log("NODE=" + nodeVersion);
console.log("PNPM=" + pnpmVersion);
console.log("GO=" + goVersion);
