import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const records = execFileSync("git", ["ls-files", "-s", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean)
  .map((record) => {
    const match = record.match(/^(\d{6})\s+([0-9a-f]{40})\s+(\d)\t(.+)$/);
    if (!match) throw new Error("Unable to parse git ls-files record: " + record);
    return {
      mode: match[1],
      sha: match[2],
      stage: match[3],
      file: match[4].replaceAll("\\", "/"),
    };
  })
  .filter((record) => fs.existsSync(path.join(repoRoot, record.file)));

const tracked = records.map((record) => record.file);
const trackedSet = new Set(tracked);
const failures = [];
const classifications = new Map();

const attributesText = fs
  .readFileSync(path.join(repoRoot, ".gitattributes"), "utf8")
  .replace(/\r\n?/g, "\n");

if (!/^\*\s+text=auto\s+eol=lf\s*$/m.test(attributesText)) {
  failures.push("Canonical repository text EOL policy is missing: expected '* text=auto eol=lf'");
}

const eolRecords = execFileSync("git", ["ls-files", "--eol", "-z"], {
  cwd: repoRoot,
  encoding: "utf8",
})
  .split("\0")
  .filter(Boolean);

for (const record of eolRecords) {
  const separator = record.indexOf("\t");
  if (separator < 0) {
    failures.push("Unable to parse git ls-files --eol record: " + record);
    continue;
  }
  const metadata = record.slice(0, separator);
  const file = record.slice(separator + 1).replaceAll("\\", "/");
  const indexEol = metadata.match(/\bi\/(\S+)/)?.[1];
  const attributes = metadata.match(/\battr\/(.+)$/)?.[1] ?? "";
  if (!indexEol) {
    failures.push("Unable to resolve index EOL state: " + file + " (" + metadata + ")");
    continue;
  }
  const binary = indexEol === "-text" || attributes.split(/\s+/).includes("-text");
  if (!binary && !/\beol=lf\b/.test(attributes)) failures.push("Tracked text artifact lacks canonical eol=lf policy: " + file + " (" + metadata + ")");
  if (!binary && (indexEol === "crlf" || indexEol === "mixed")) failures.push("Tracked text artifact is non-canonical in Git index: " + file + " (" + metadata + ")");
}

function classify(file, category) {
  if (classifications.has(file)) {
    failures.push("Artifact classified more than once: " + file + " (" + classifications.get(file) + ", " + category + ")");
    return;
  }
  classifications.set(file, category);
}

const executablePathExtension = /\.(?:mjs|cjs|js|mts|cts|ts|tsx|jsx|ps1|psm1|bat|cmd|sh|bash|zsh|fish|py|rb|pl|go)$/i;

function shellTokens(script) {
  const tokens = [];
  let token = "";
  let quote = null;
  let escaped = false;

  const flush = () => {
    if (token) tokens.push(token);
    token = "";
  };

  for (const character of script) {
    if (escaped) {
      token += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if ([";", "|", "&", "(", ")"].includes(character)) {
      flush();
      tokens.push(character);
      continue;
    }
    token += character;
  }
  if (escaped) token += "\\";
  flush();
  return tokens;
}

function repoRelativePath(absolutePath) {
  const relative = path.relative(repoRoot, absolutePath);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(".." + path.sep)) return null;
  return relative.replaceAll(path.sep, "/");
}

function packageScriptTarget(manifest, operand) {
  const normalizedOperand = operand.replaceAll("\\", "/").replace(/^[,]+|[,]+$/g, "");
  if (!executablePathExtension.test(normalizedOperand)) return null;
  if (!normalizedOperand || normalizedOperand.startsWith("-") || normalizedOperand.includes("://") || /[*?$`]/.test(normalizedOperand)) return null;
  if (normalizedOperand.startsWith("@")) return null;

  const manifestPath = path.join(repoRoot, manifest);
  const absolutePath = path.isAbsolute(normalizedOperand)
    ? path.resolve(normalizedOperand)
    : path.resolve(path.dirname(manifestPath), normalizedOperand);
  const relative = repoRelativePath(absolutePath);
  if (!relative || relative === "node_modules" || relative.startsWith("node_modules/")) return null;

  const isExplicitPath = normalizedOperand.startsWith(".") || normalizedOperand.startsWith("/") || /^[A-Za-z]:\//.test(normalizedOperand);
  const topLevel = relative.split("/")[0];
  const isKnownRepositoryPath = manifest === "package.json"
    || isExplicitPath
    || trackedSet.has(topLevel)
    || [...trackedSet].some((file) => file.startsWith(topLevel + "/"));
  return isKnownRepositoryPath ? { absolutePath, relative } : null;
}

let packageScriptPathCount = 0;
for (const manifest of tracked.filter((file) => path.posix.basename(file) === "package.json")) {
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, manifest), "utf8"));
  } catch (error) {
    failures.push("Unable to parse package manifest: " + manifest + " (" + error.message + ")");
    continue;
  }
  if (!packageJson.scripts || typeof packageJson.scripts !== "object" || Array.isArray(packageJson.scripts)) continue;

  for (const [scriptName, script] of Object.entries(packageJson.scripts)) {
    if (typeof script !== "string") {
      failures.push("Package script must be a string: " + manifest + " scripts." + scriptName);
      continue;
    }
    for (const operand of shellTokens(script)) {
      const target = packageScriptTarget(manifest, operand);
      if (!target) continue;
      packageScriptPathCount += 1;
      const exists = fs.existsSync(target.absolutePath);
      const trackedTarget = trackedSet.has(target.relative);
      if (!exists) failures.push("Missing package script target: " + manifest + " scripts." + scriptName + " -> " + target.relative);
      else if (!fs.statSync(target.absolutePath).isFile()) failures.push("Package script target is not a file: " + manifest + " scripts." + scriptName + " -> " + target.relative);
      else if (!trackedTarget) failures.push("Package script target is not tracked: " + manifest + " scripts." + scriptName + " -> " + target.relative);
    }
  }
}

const rootAgentLawOwner = "AGENTS.md";
const rootAgentRoutingAdapters = new Set(["CLAUDE.md", "GEMINI.md"]);
const githubAgentRoutingAdapter = ".github/copilot-instructions.md";

const rootFiles = new Set([
  ".dockerignore",
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".go-version",
  "biome.json",
  ".node-version",
  ".nvmrc",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "knowledge.sources.json",
  "go.work",
  "go.work.sum",
  "knip.jsonc",
  "nx.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

const codeownersPath = path.join(repoRoot, ".github", "CODEOWNERS");
if (fs.existsSync(codeownersPath)) {
  const codeowners = fs.readFileSync(codeownersPath, "utf8");
  for (const retired of ["/governance/", "/docs/", "/tools/prompting/"]) {
    if (codeowners.includes(retired)) failures.push("CODEOWNERS retains retired repository path: " + retired);
  }
}

const projectRecords = tracked
  .filter((file) => /(^|\/)project\.json$/.test(file))
  .map((file) => {
    try {
      return { file, project: JSON.parse(fs.readFileSync(path.join(repoRoot, file), "utf8")) };
    } catch (error) {
      failures.push("Invalid project manifest: " + file + " (" + error.message + ")");
      return null;
    }
  })
  .filter(Boolean);

function projectNames(top, tag) {
  return new Set(
    projectRecords
      .filter(({ project }) => project.root?.startsWith(top + "/") && project.tags?.includes(tag))
      .map(({ project }) => project.root.slice(top.length + 1).split("/")[0]),
  );
}

const apps = projectNames("apps", "type:app");
const services = projectNames("services", "type:service");
const serviceLanes = new Set(
  tracked
    .filter((file) => file.startsWith("services/"))
    .map((file) => file.split("/")[2])
    .filter(Boolean),
);

for (const file of tracked) {
  if (!file.includes("/")) {
    if (rootFiles.has(file)) classify(file, "root-substrate");
    else if (file === rootAgentLawOwner) classify(file, "agent-law-owner");
    else if (rootAgentRoutingAdapters.has(file)) classify(file, "agent-routing-adapter");
    continue;
  }

  const segments = file.split("/");
  const top = segments[0];
  if (top === ".github") {
    classify(file, file === githubAgentRoutingAdapter ? "agent-routing-adapter" : "repository-platform");
    continue;
  }
  if (top === "apps") {
    if (file === "apps/README.md") { classify(file, "apps-orientation"); continue; }
    if (apps.has(segments[1])) classify(file, "deployable-app:" + segments[1]);
    continue;
  }
  if (top === "services") {
    if (file === "services/README.md") { classify(file, "services-orientation"); continue; }
    const service = segments[1];
    if (!services.has(service)) continue;
    if (segments.length === 3 && ["README.md", "project.json", "package.json", "tsconfig.json"].includes(segments[2])) {
      classify(file, "service-root:" + service);
      continue;
    }
    if (segments.length >= 4 && serviceLanes.has(segments[2])) classify(file, "service-lane:" + service + ":" + segments[2]);
    continue;
  }
  if (top === "packages") {
    if (file === "packages/README.md") { classify(file, "packages-orientation"); continue; }
    if (segments[1] === "design-system") classify(file, "technical-package:" + segments[1]);
    continue;
  }
  if (top === "contracts") { classify(file, "cross-service-contract-boundary"); continue; }
  if (top === "infra") { classify(file, "infrastructure"); continue; }
  if (top === "governance") { classify(file, "durable-governance"); continue; }
  if (top === "docs") { classify(file, "human-documentation"); continue; }
  if (top === "tools") {
    if (file === "tools/README.md") { classify(file, "tools-orientation"); continue; }
    if (segments[1] === "dev") { classify(file, "developer-tooling"); continue; }
    if (segments[1] === "mobile") { classify(file, "mobile-tooling"); continue; }
  }
}

for (const record of records) {
  if (record.stage !== "0") failures.push("Non-stage-0 tracked index entry: " + record.file);
  if (record.mode === "120000") failures.push("Tracked symlink requires explicit structural admission: " + record.file);
  if (record.mode === "160000") failures.push("Tracked Git submodule requires explicit structural admission: " + record.file);
}

const forbiddenSegments = new Set(["archive", "backup", "backups", "compat", "compatibility", "deprecated", "legacy", "old", "temp", "tmp", "_unused"]);
for (const file of tracked) {
  const segments = file.toLowerCase().split("/");
  if (segments.some((segment) => forbiddenSegments.has(segment))) failures.push("Forbidden historical/temporary container: " + file);
  if (/\.(?:bak|orig|rej|old|tmp)$|~$/.test(file.toLowerCase())) failures.push("Forbidden backup/conflict artifact: " + file);
  if (/(^|\/)(?:node_modules|\.next|\.expo|dist|build|coverage)(\/|$)/.test(file)) failures.push("Generated/build output is tracked: " + file);
  if (/^apps\/[^/]+\/(?:android|ios)\//.test(file)) failures.push("Generated native directory is tracked without explicit admission: " + file);
}

const filesByDirectory = new Map();
for (const file of tracked) {
  const parts = file.split("/");
  for (let depth = 1; depth < parts.length; depth++) {
    const dir = parts.slice(0, depth).join("/");
    const list = filesByDirectory.get(dir) ?? [];
    list.push(file);
    filesByDirectory.set(dir, list);
  }
}
for (const [dir, files] of filesByDirectory) {
  if (files.length === 1 && files[0] === dir + "/README.md") failures.push("Unadmitted README-only container: " + dir);
}

for (const file of tracked) {
  const absolute = path.join(repoRoot, file);
  if (!fs.existsSync(absolute)) continue;
  const stat = fs.statSync(absolute);
  if (stat.size === 0) failures.push("Zero-byte tracked artifact: " + file);
}

const unclassified = tracked.filter((file) => fs.existsSync(path.join(repoRoot, file)) && !classifications.has(file));
for (const file of unclassified) failures.push("UNCLASSIFIED_TRACKED_ARTIFACT: " + file);

const goFiles = tracked.filter((file) => file.endsWith(".go"));
if (goFiles.length > 0) {
  try {
    const unformatted = execFileSync("gofmt", ["-l", ...goFiles], { cwd: repoRoot, encoding: "utf8" }).trim();
    if (unformatted) failures.push("Go source files are not canonical formatted (gofmt -l):\n" + unformatted);
  } catch (err) {
    failures.push("Failed to run gofmt: " + err.message);
  }
}

if (failures.length) {
  console.error("STRUCTURAL_HYGIENE=FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
  process.exit(1);
}

const counts = {};
for (const category of classifications.values()) counts[category] = (counts[category] ?? 0) + 1;

console.log("TRACKED_ARTIFACTS=" + tracked.length);
console.log("UNCLASSIFIED_TRACKED_ARTIFACTS=0");
console.log("UNDISPOSITIONED_TRACKED_ARTIFACTS=0");
console.log("DEAD_TRACKED_FILES_AUDIT=NOT_PERFORMED");
console.log("DEAD_TRACKED_DIRECTORIES_AUDIT=NOT_PERFORMED");
console.log("TRACKED_SYMLINKS_OR_SUBMODULES=0");
console.log("FORBIDDEN_HISTORICAL_TEMP_PATHS=0");
console.log("README_ONLY_CONTAINERS=0");
console.log("GENERATED_BUILD_OUTPUT_TRACKED=0");
console.log("PACKAGE_SCRIPT_LOCAL_PATHS_CHECKED=" + packageScriptPathCount);
console.log("PACKAGE_SCRIPT_LOCAL_PATHS=PASS");
console.log("CANONICAL_TEXT_EOL_POLICY=PASS");
console.log("STRUCTURAL_HYGIENE=PASS");
console.log("CLASSIFICATION_COUNTS=" + JSON.stringify(counts));
