import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { resolveTrustedExecutable } from "./runtime-proof/trusted-executables.mjs";

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|mts|cts)$/i;
const TOOL_EXT = /\.(?:mjs|cjs|js|mts|cts|ts|tsx|jsx|ps1|psm1|sh|bash)$/i;
const TEXT_EXT = /\.(?:md|txt|json|jsonc|ya?ml|toml|ini|properties|xml|csv|sql|graphql|gql|html|css|scss|less|mjs|cjs|js|mts|cts|ts|tsx|jsx|ps1|psm1|sh|bash|go|mod|sum)$/i;
const ROOT_EVIDENCE = new Set([
  ".dockerignore", ".editorconfig", ".gitattributes", ".gitignore", ".go-version",
  ".node-version", ".nvmrc", "AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md",
  "DESIGN.md", "GEMINI.md", "README.md", "REPOSITORY-STRUCTURE.md", "SECURITY.md",
  "biome.json", "go.work", "go.work.sum", "knip.jsonc", "knowledge.sources.json",
  "nx.json", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
  "sonar-project.properties", "tsconfig.base.json",
]);
const APP_METADATA = /(^|\/)(?:README\.md|package\.json|project\.json|tsconfig(?:\.[^/]+)?\.json|eas\.json|mobile\.config\.json|fingerprint\.config\.js|metro\.config\.[cm]?js|babel\.config\.[cm]?js|app\.config\.[cm]?[jt]s|expo-env\.d\.ts|\.easignore)$/i;
const DATA_ASSET = /\.(?:png|jpe?g|webp|gif|svg|ico|ttf|otf|woff2?|mp3|wav|mp4|webm|pdf)$/i;

function normalize(file) {
  return file.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function deriveTrackedDirectories(files) {
  const directories = new Set();
  for (const raw of files) {
    const parts = normalize(raw).split("/");
    for (let depth = 1; depth < parts.length; depth += 1) {
      directories.add(parts.slice(0, depth).join("/"));
    }
  }
  return [...directories].sort();
}

function readTextIfBounded(repoRoot, file) {
  const absolute = path.join(repoRoot, file);
  try {
    const stat = fs.statSync(absolute);
    if (!stat.isFile() || stat.size > 2_000_000) return "";
    if (!TEXT_EXT.test(file) && !path.basename(file).startsWith(".")) return "";
    return fs.readFileSync(absolute, "utf8");
  } catch {
    return "";
  }
}

function collectReferenceCorpus(repoRoot, tracked) {
  const corpus = new Map();
  for (const file of tracked) {
    const text = readTextIfBounded(repoRoot, file);
    if (text) corpus.set(file, text.replaceAll("\\", "/"));
  }
  return corpus;
}

function isPathReferenced(file, corpus) {
  const normalized = normalize(file);
  const basename = path.posix.basename(normalized);
  const withoutExt = normalized.replace(/\.[^.\/]+$/, "");
  for (const [owner, text] of corpus) {
    if (owner === normalized) continue;
    if (text.includes(normalized) || text.includes("./" + normalized) || text.includes(withoutExt)) return true;
    if (basename.length >= 8 && text.includes(basename)) return true;
  }
  return false;
}

function parseConcatenatedJson(text) {
  const values = [];
  let start = -1;
  let depth = 0;
  let quote = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quote = false;
      continue;
    }
    if (char === '"') {
      quote = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        values.push(JSON.parse(text.slice(start, i + 1)));
        start = -1;
      }
    }
  }
  if (depth !== 0 || quote) throw new Error("Unable to parse concatenated go list JSON");
  return values;
}

function collectGoOwnedFiles(repoRoot, tracked) {
  const owned = new Set();
  const failures = [];
  const moduleFiles = tracked.filter((file) => file.endsWith("/go.mod"));
  for (const manifest of moduleFiles) {
    const moduleDir = path.dirname(path.join(repoRoot, manifest));
    let output = "";
    try {
      output = execFileSync(resolveTrustedExecutable("go"), ["list", "-e", "-json", "./..."], {
        cwd: moduleDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      failures.push("REVIEW_REQUIRED:GO_PACKAGE_GRAPH:" + manifest + ":" + (error.message ?? String(error)));
      continue;
    }
    let packages;
    try {
      packages = parseConcatenatedJson(output);
    } catch (error) {
      failures.push("REVIEW_REQUIRED:GO_PACKAGE_GRAPH_PARSE:" + manifest + ":" + error.message);
      continue;
    }
    for (const pkg of packages) {
      if (!pkg.Dir) continue;
      for (const key of ["GoFiles", "CgoFiles", "TestGoFiles", "XTestGoFiles", "IgnoredGoFiles"]) {
        for (const filename of pkg[key] ?? []) {
          const absolute = path.join(pkg.Dir, filename);
          const relative = normalize(path.relative(repoRoot, absolute));
          if (!relative.startsWith("../") && !path.isAbsolute(relative)) owned.add(relative);
        }
      }
    }
  }
  return { owned, failures };
}

function validateSonarProvenance(tracked) {
  const files = tracked.filter((file) => file.startsWith("tools/sonar-audit/"));
  if (files.length === 0) return [];
  const groups = new Map();
  for (const file of files) {
    const name = path.posix.basename(file);
    let match = name.match(/^SONAR_AUDIT_(\d{4}-\d{2}-\d{2})\.md$/);
    let kind = "report";
    if (!match) {
      match = name.match(/^sonar-coverage-(\d{4}-\d{2}-\d{2})\.csv$/);
      kind = "coverage";
    }
    if (!match) {
      match = name.match(/^sonar-issues-(\d{4}-\d{2}-\d{2})\.csv$/);
      kind = "issues";
    }
    if (!match) return ["REVIEW_REQUIRED:SONAR_PROVENANCE:" + file];
    const set = groups.get(match[1]) ?? new Set();
    set.add(kind);
    groups.set(match[1], set);
  }
  const failures = [];
  for (const [date, kinds] of groups) {
    for (const expected of ["report", "coverage", "issues"]) {
      if (!kinds.has(expected)) failures.push("REVIEW_REQUIRED:SONAR_PROVENANCE:" + date + ":missing-" + expected);
    }
  }
  return failures;
}

function knipBindingFailures(repoRoot) {
  const failures = [];
  try {
    const project = JSON.parse(fs.readFileSync(path.join(repoRoot, "tools/dev/project.json"), "utf8"));
    const structural = project.targets?.["structural-hygiene"]?.options?.command ?? "";
    const knip = project.targets?.knip?.options?.command ?? "";
    if (!structural.includes("verify-structural-hygiene.mjs") || structural.includes("verify-structural-hygiene-legacy.mjs")) {
      failures.push("REVIEW_REQUIRED:STRUCTURAL_HYGIENE_CANONICAL_BINDING");
    }
    if (!knip.includes("pnpm exec knip")) failures.push("REVIEW_REQUIRED:KNIP_TARGET_BINDING");
  } catch (error) {
    failures.push("REVIEW_REQUIRED:WORKSPACE_TOOLING_MANIFEST:" + error.message);
  }
  try {
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci-static.yml"), "utf8");
    if (!ci.includes("structural-hygiene") || !ci.includes("knip")) {
      failures.push("REVIEW_REQUIRED:STATIC_GATE_BINDING");
    }
  } catch (error) {
    failures.push("REVIEW_REQUIRED:STATIC_GATE_READ:" + error.message);
  }
  return failures;
}

function workspaceRootsFromKnip(repoRoot) {
  try {
    const text = fs.readFileSync(path.join(repoRoot, "knip.jsonc"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const config = JSON.parse(text);
    return new Set(Object.keys(config.workspaces ?? {}));
  } catch {
    return new Set();
  }
}

function appSourceEvidence(file, knipRoots) {
  const segments = file.split("/");
  const appRoot = segments.slice(0, 2).join("/");
  if (!SOURCE_EXT.test(file)) return null;
  if (file.startsWith(appRoot + "/app/")) return "FRAMEWORK_ROUTE_ENTRY";
  if (APP_METADATA.test(file)) return "FRAMEWORK_CONFIG_ENTRY";
  if (knipRoots.has(appRoot)) return "KNIP_STATIC_GATE";
  return null;
}

function packageSourceEvidence(file, knipRoots) {
  if (!SOURCE_EXT.test(file)) return null;
  const segments = file.split("/");
  const packageRoot = segments.slice(0, 2).join("/");
  if (knipRoots.has("packages/*") || knipRoots.has(packageRoot)) return "KNIP_STATIC_GATE";
  return null;
}

function nonCodeOwnerEvidence(file) {
  if (!file.includes("/") && ROOT_EVIDENCE.has(file)) return "REPOSITORY_SUBSTRATE";
  if (file.startsWith(".github/")) return "REPOSITORY_PLATFORM";
  if (/^(?:docs|governance)\//.test(file)) return "HUMAN_GOVERNANCE";
  if (file === "apps/README.md" || file === "services/README.md" || file === "packages/README.md" || file === "tools/README.md") return "ORIENTATION_DOC";
  if (file.startsWith("contracts/")) return "CONTRACT_BOUNDARY";
  if (file.startsWith("infra/")) return "RUNTIME_INFRASTRUCTURE";
  if (/\/migrations\//.test(file)) return "MIGRATION_HISTORY";
  if (APP_METADATA.test(file)) return "PROJECT_METADATA";
  if (/^apps\/[^/]+\/assets\//.test(file) && DATA_ASSET.test(file)) return "PROJECT_ASSET";
  if (/^services\/[^/]+\/(?:README\.md|project\.json|package\.json|tsconfig\.json|go\.mod|go\.sum)$/.test(file)) return "SERVICE_SUBSTRATE";
  if (/^packages\/[^/]+\/(?:README\.md|project\.json|package\.json|tsconfig(?:\.[^/]+)?\.json)$/.test(file)) return "PACKAGE_SUBSTRATE";
  if (file.startsWith("tools/sonar-audit/")) return "SONAR_PROVENANCE";
  if (file === "tools/BTHWANI_FULL_PLATFORM_CLOSURE_MATRIX.md") return "ACTIVE_TASK_EVIDENCE";
  return null;
}

export function auditSyntheticTrackedArtifacts(files, evidenceForFile) {
  const normalized = [...new Set(files.map(normalize))].sort();
  const fileEvidence = new Map();
  const review = [];
  for (const file of normalized) {
    const evidence = evidenceForFile(file);
    if (evidence) fileEvidence.set(file, evidence);
    else review.push("REVIEW_REQUIRED:FILE:" + file);
  }
  const directories = deriveTrackedDirectories(normalized);
  const directoryEvidence = new Map();
  for (const directory of directories) {
    const descendants = normalized.filter((file) => file.startsWith(directory + "/"));
    const unresolved = descendants.filter((file) => !fileEvidence.has(file));
    if (unresolved.length) review.push("REVIEW_REQUIRED:DIRECTORY:" + directory);
    else directoryEvidence.set(directory, "DESCENDANT_EVIDENCE_COMPLETE");
  }
  return { files: normalized, directories, fileEvidence, directoryEvidence, review };
}

export function runTrackedArtifactEvidenceAudit(repoRoot) {
  const tracked = execFileSync(resolveTrustedExecutable("git"), ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean).map(normalize);
  const trackedSet = new Set(tracked);
  const corpus = collectReferenceCorpus(repoRoot, tracked);
  const knipRoots = workspaceRootsFromKnip(repoRoot);
  const { owned: goOwned, failures: goFailures } = collectGoOwnedFiles(repoRoot, tracked);
  const prerequisiteFailures = [
    ...knipBindingFailures(repoRoot),
    ...validateSonarProvenance(tracked),
    ...goFailures,
  ];

  const result = auditSyntheticTrackedArtifacts(tracked, (file) => {
    const nonCode = nonCodeOwnerEvidence(file);
    if (nonCode) return nonCode;

    if (file.startsWith("apps/")) {
      const source = appSourceEvidence(file, knipRoots);
      if (source) return source;
      if (SOURCE_EXT.test(file) && isPathReferenced(file, corpus)) return "TRACKED_REFERENCE";
      if (/\.(?:css|scss|less|json|jsonc|ya?ml)$/i.test(file) && isPathReferenced(file, corpus)) return "TRACKED_REFERENCE";
      if (/\/(?:tests?|__tests__|fixtures?)\//i.test(file) && /\.(?:json|txt|md)$/i.test(file)) return "TEST_EVIDENCE";
      return null;
    }

    if (file.startsWith("packages/")) {
      const source = packageSourceEvidence(file, knipRoots);
      if (source) return source;
      if (/^packages\/[^/]+\/src\/(?:index|main)\.(?:[cm]?[jt]sx?|mts|cts)$/i.test(file)) return "PACKAGE_ENTRYPOINT";
      if (SOURCE_EXT.test(file) && isPathReferenced(file, corpus)) return "TRACKED_REFERENCE";
      if (/\.(?:css|scss|less|json|jsonc|ya?ml)$/i.test(file) && isPathReferenced(file, corpus)) return "TRACKED_REFERENCE";
      return null;
    }

    if (file.startsWith("services/")) {
      if (file.endsWith(".go")) return goOwned.has(file) ? "GO_PACKAGE_GRAPH" : null;
      if (/\/clients\//.test(file) && SOURCE_EXT.test(file)) {
        const service = file.split("/")[1];
        const generator = `services/${service}/tools/generate-types.mjs`;
        return trackedSet.has(generator) ? "GENERATED_CLIENT_PROVENANCE" : null;
      }
      if (TOOL_EXT.test(file)) return isPathReferenced(file, corpus) ? "TRACKED_REFERENCE" : null;
      if (/\.(?:json|jsonc|ya?ml|md)$/i.test(file) && isPathReferenced(file, corpus)) return "TRACKED_REFERENCE";
      return null;
    }

    if (file.startsWith("tools/dev/")) {
      if (SOURCE_EXT.test(file)) return "KNIP_STATIC_GATE";
      if (TOOL_EXT.test(file)) return isPathReferenced(file, corpus) ? "TRACKED_REFERENCE" : null;
      if (file.endsWith("/project.json")) return "TOOLING_PROJECT_MANIFEST";
      if (/\.(?:json|jsonc|ya?ml|md)$/i.test(file) && isPathReferenced(file, corpus)) return "TRACKED_REFERENCE";
      return null;
    }

    if (file.startsWith("tools/mobile/")) {
      if (file.endsWith(".d.cts") || file.endsWith(".d.ts")) {
        const implementation = file.replace(/\.d\.(?:cts|ts)$/, (match) => match === ".d.cts" ? ".cjs" : ".js");
        return trackedSet.has(implementation) ? "DECLARATION_IMPLEMENTATION_PAIR" : null;
      }
      if (TOOL_EXT.test(file)) return isPathReferenced(file, corpus) ? "TRACKED_REFERENCE" : null;
      if (file.endsWith("/README.md") || file === "tools/mobile/README.md" || file.endsWith("/project.json")) return "MOBILE_TOOLING_SUBSTRATE";
      return null;
    }

    return null;
  });

  result.review.push(...prerequisiteFailures);
  result.review = [...new Set(result.review)].sort();
  return result;
}
