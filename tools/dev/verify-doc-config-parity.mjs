import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

const packageJson = JSON.parse(read("package.json"));
const workflowGuide = read("docs/development/workflow/developer-workflow.md");
const runtimeGuide = read("docs/development/runtime/runtime-and-configuration.md");
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
for (const mod of ["services/identity/backend/go.mod", "services/dsh/backend/go.mod", "services/wlt/backend/go.mod"]) {
  const version = read(mod).match(/^go\s+(\S+)\s*$/m)?.[1];
  if (version !== goVersion) failures.push(mod + " Go version differs from go.work");
}

for (const [label, value] of [["Node", nodeVersion], ["pnpm", pnpmVersion], ["Go", goVersion]]) {
  if (value && !workflowGuide.includes(value)) failures.push("developer workflow does not reflect pinned " + label + " " + value);
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
})(path.join(root, "docs/development"))) {
  const body = fs.readFileSync(file, "utf8");
  if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(body)) {
    failures.push(path.relative(root, file).split(path.sep).join("/") + " hard-codes a local port");
  }
}

if (/docker compose/i.test(read("tools/dev/bootstrap.ps1"))) failures.push("bootstrap must remain independent of runtime composition");
if (!runtimeGuide.includes("Current integration-runtime commands are derived from")) failures.push("runtime guide must route command truth to package.json");

if (failures.length) {
  console.error("DOC_CONFIG_PARITY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}
console.log("DOC_CONFIG_PARITY=PASS");
console.log("NODE=" + nodeVersion);
console.log("PNPM=" + pnpmVersion);
console.log("GO=" + goVersion);
