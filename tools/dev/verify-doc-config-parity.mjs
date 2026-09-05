import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const failures = [];

function collectMarkdown(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) out.push(absolute);
  }
  return out;
}

const packageJson = JSON.parse(read("package.json"));
const gettingStarted = read("docs/development/getting-started.md");
const configGuide = read("docs/development/configuration-and-secrets.md");
const compose = read("infra/local/compose/compose.yaml");
const envExample = read("infra/local/compose/.env.example");

const nvmNode = read(".nvmrc").trim();
const nodeVersionFile = read(".node-version").trim();
const packageManager = packageJson.packageManager ?? "";
const pnpmVersion = packageManager.match(/^pnpm@(.+)$/)?.[1];
const pnpmEngine = packageJson.engines?.pnpm;
const nodeEngine = packageJson.engines?.node;

if (!nvmNode || nvmNode !== nodeVersionFile) {
  failures.push(".nvmrc and .node-version must declare the same Node version");
}
if (!pnpmVersion || pnpmVersion !== pnpmEngine) {
  failures.push("packageManager pnpm version and engines.pnpm must match");
}
if (!nodeEngine?.includes(nvmNode)) {
  failures.push("package.json engines.node does not admit the pinned Node version " + nvmNode);
}

const goWorkVersion = read("go.work").match(/^go\s+(\S+)\s*$/m)?.[1];
if (!goWorkVersion) failures.push("go.work missing canonical Go version");
for (const goModPath of [
  "services/identity/backend/go.mod",
  "services/dsh/backend/go.mod",
  "services/wlt/backend/go.mod",
]) {
  const version = read(goModPath).match(/^go\s+(\S+)\s*$/m)?.[1];
  if (!version || version !== goWorkVersion) {
    failures.push(goModPath + " Go version differs from go.work: " + String(version));
  }
}

const psScripts = [
  "tools/dev/bootstrap.ps1",
  "tools/dev/doctor.ps1",
  "tools/dev/close-foundation-runtime.ps1",
  "tools/dev/verify-foundation-local.ps1",
  "tools/dev/verify-foundation-runtime.ps1",
  "tools/dev/verify-powershell-syntax.ps1",
];
const psMinimums = new Set();
for (const scriptPath of psScripts) {
  const version = read(scriptPath).match(/^#Requires\s+-Version\s+([0-9.]+)\s*$/m)?.[1];
  if (!version) failures.push(scriptPath + " missing PowerShell #Requires -Version");
  else psMinimums.add(version);
}
if (psMinimums.size !== 1) {
  failures.push("developer PowerShell scripts disagree on minimum PowerShell version: " + [...psMinimums].join(", "));
}
const powershellMinimum = [...psMinimums][0];
const tick = String.fromCharCode(96);

for (const [label, token] of [
  ["Node", "- Node.js " + tick + nvmNode + tick],
  ["pnpm", "- pnpm " + tick + pnpmVersion + tick],
  ["Go", "- Go " + tick + goWorkVersion + tick],
  ["PowerShell", "- PowerShell " + tick + powershellMinimum + "+" + tick],
]) {
  if (!gettingStarted.includes(token)) {
    failures.push("getting-started toolchain drift for " + label + ": expected " + token);
  }
}

const documentedIdentitySecrets = [
  ...new Set([...configGuide.matchAll(/\bIDENTITY_[A-Z0-9_]+\b/g)].map((m) => m[0])),
];
if (documentedIdentitySecrets.length === 0) {
  failures.push("configuration-and-secrets guide documents no Identity development credential keys");
}
for (const key of documentedIdentitySecrets) {
  if (!compose.includes(key)) failures.push("documented Identity key missing from compose config: " + key);
  if (!envExample.includes(key + "=")) failures.push("documented Identity key missing from .env.example: " + key);
}

for (const file of collectMarkdown(path.join(root, "docs", "development"))) {
  const body = fs.readFileSync(file, "utf8");
  const rel = path.relative(root, file).split(path.sep).join("/");
  if (/(?:localhost|127\.0\.0\.1):\d{2,5}\b/i.test(body)) {
    failures.push(rel + " hard-codes a local port; current ports must come from executable config");
  }
}

const bootstrapScript = read("tools/dev/bootstrap.ps1");
if (bootstrapScript.includes("docker compose")) {
  failures.push("bootstrap must remain independent of Docker runtime composition");
}
if (!gettingStarted.includes("it does not require Docker or validate/start the runtime")) {
  failures.push("getting-started no longer states the Docker-independent bootstrap boundary");
}

if (failures.length) {
  console.error("DOC_CONFIG_PARITY=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("DOC_CONFIG_PARITY=PASS");
console.log("NODE=" + nvmNode);
console.log("PNPM=" + pnpmVersion);
console.log("GO=" + goWorkVersion);
console.log("POWERSHELL_MIN=" + powershellMinimum);
console.log("IDENTITY_CONFIG_KEYS=" + documentedIdentitySecrets.length);
