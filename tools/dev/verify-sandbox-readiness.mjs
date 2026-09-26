import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = String(pkg.devDependencies?.nx ?? "").replace(/^[^0-9]*/, "");
const [major = 0, minor = 0] = version.split(".").map((value) => Number.parseInt(value, 10));
const failures = [];

if (!Number.isInteger(major) || !Number.isInteger(minor) || major < 22 || (major === 22 && minor < 6)) {
  failures.push("Nx 22.6+ is required for task sandboxing; observed=" + version);
}

const exclusionPath = path.join(root, ".nx", "workflows", "sandboxing-config.yaml");
if (fs.existsSync(exclusionPath)) {
  const content = fs.readFileSync(exclusionPath, "utf8").trim();
  if (content) failures.push("sandbox exclusions exist before a claim-specific audited exception was admitted: .nx/workflows/sandboxing-config.yaml");
}

const nx = JSON.parse(fs.readFileSync(path.join(root, "nx.json"), "utf8"));
if (!nx.nxCloudId || typeof nx.nxCloudId !== "string") failures.push("Nx Cloud workspace ID is required for sandboxing");

if (failures.length) {
  console.error("NX_SANDBOX_REPO_READINESS=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("NX_SANDBOX_REPO_READINESS=PASS nx=" + version + " exclusions=0");
console.log("NX_SANDBOX_CLOUD_ENFORCEMENT=EXTERNAL_REQUIRED mode=Warning_then_Strict");
