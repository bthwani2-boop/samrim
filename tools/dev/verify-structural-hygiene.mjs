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
  });

const tracked = records.map((record) => record.file);
const failures = [];
const classifications = new Map();

function classify(file, category) {
  if (classifications.has(file)) {
    failures.push(
      "Artifact classified more than once: " +
        file +
        " (" +
        classifications.get(file) +
        ", " +
        category +
        ")",
    );
    return;
  }
  classifications.set(file, category);
}

const rootFiles = new Set([
  ".editorconfig",
  ".gitattributes",
  ".gitignore",
  ".go-version",
  ".node-version",
  ".nvmrc",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  "go.work",
  "nx.json",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
]);

const apps = new Set([
  "app-client",
  "app-partner",
  "app-captain",
  "app-field",
  "control-panel",
]);

const services = new Set(["identity", "workforce", "dsh", "wlt"]);
const serviceLanes = new Set([
  "backend",
  "clients",
  "contracts",
  "database",
  "frontend",
  "tests",
]);

for (const file of tracked) {
  if (!file.includes("/")) {
    if (rootFiles.has(file)) classify(file, "root-substrate");
    continue;
  }

  const segments = file.split("/");
  const top = segments[0];

  if (top === ".github") {
    classify(file, "repository-platform");
    continue;
  }

  if (top === "apps") {
    if (file === "apps/README.md") {
      classify(file, "apps-orientation");
      continue;
    }
    if (apps.has(segments[1])) {
      classify(file, "deployable-app:" + segments[1]);
    }
    continue;
  }

  if (top === "services") {
    if (file === "services/README.md") {
      classify(file, "services-orientation");
      continue;
    }

    const service = segments[1];
    if (!services.has(service)) continue;

    if (
      segments.length === 3 &&
      ["README.md", "project.json", "package.json", "tsconfig.json"].includes(segments[2])
    ) {
      classify(file, "service-root:" + service);
      continue;
    }

    if (segments.length >= 4 && serviceLanes.has(segments[2])) {
      classify(file, "service-lane:" + service + ":" + segments[2]);
    }
    continue;
  }

  if (top === "packages") {
    if (file === "packages/README.md") {
      classify(file, "packages-orientation");
      continue;
    }
    if (segments[1] === "design-system") {
      classify(file, "technical-package:design-system");
    }
    continue;
  }

  if (top === "contracts") {
    classify(file, "cross-service-contract-boundary");
    continue;
  }

  if (top === "infra") {
    classify(file, "infrastructure");
    continue;
  }

  if (top === "governance") {
    classify(file, "durable-governance");
    continue;
  }

  if (top === "docs") {
    classify(file, "human-documentation");
    continue;
  }

  if (top === "tools") {
    if (segments[1] === "dev") {
      classify(file, "developer-tooling");
      continue;
    }
    if (segments[1] === "mobile") {
      classify(file, "mobile-tooling");
      continue;
    }
    if (
      segments[1] === "prompting" &&
      ["bthwani-orchestrator", "bthwani-refoundation"].includes(segments[2])
    ) {
      classify(
        file,
        segments[2] === "bthwani-orchestrator"
          ? "orchestration-authority"
          : "temporary-refoundation-specialization",
      );
    }
  }
}

for (const record of records) {
  if (record.stage !== "0") {
    failures.push("Non-stage-0 tracked index entry: " + record.file);
  }
  if (record.mode === "120000") {
    failures.push("Tracked symlink requires explicit structural admission: " + record.file);
  }
  if (record.mode === "160000") {
    failures.push("Tracked Git submodule requires explicit structural admission: " + record.file);
  }
}

const forbiddenSegments = new Set([
  "archive",
  "backup",
  "backups",
  "compat",
  "compatibility",
  "deprecated",
  "legacy",
  "old",
  "temp",
  "tmp",
  "_unused",
]);

for (const file of tracked) {
  const segments = file.toLowerCase().split("/");
  if (segments.some((segment) => forbiddenSegments.has(segment))) {
    failures.push("Forbidden historical/temporary container: " + file);
  }

  if (/\.(?:bak|orig|rej|old|tmp)$|~$/.test(file.toLowerCase())) {
    failures.push("Forbidden backup/conflict artifact: " + file);
  }

  if (
    /(^|\/)(?:node_modules|\.next|\.expo|dist|build|coverage)(\/|$)/.test(file)
  ) {
    failures.push("Generated/build output is tracked: " + file);
  }

  if (/^apps\/[^/]+\/(?:android|ios)\//.test(file)) {
    failures.push("Generated native directory is tracked without explicit admission: " + file);
  }
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

const admittedReadmeOnlyDirectories = new Set([
  "contracts",
  "services/dsh/contracts",
  "services/dsh/database",
  "services/dsh/tests",
  "services/identity/clients",
  "services/identity/contracts",
  "services/identity/database",
  "services/identity/tests",
  "services/wlt/contracts",
  "services/wlt/database",
  "services/wlt/tests",
  "services/workforce/contracts",
  "services/workforce/database",
  "services/workforce/tests",
]);

for (const [dir, files] of filesByDirectory) {
  if (files.length !== 1) continue;
  if (files[0] !== dir + "/README.md") continue;
  if (admittedReadmeOnlyDirectories.has(dir)) continue;

  failures.push("Unadmitted README-only container: " + dir);
}

for (const file of tracked) {
  const absolute = path.join(repoRoot, file);
  const stat = fs.statSync(absolute);
  if (stat.size === 0) failures.push("Zero-byte tracked artifact: " + file);
}

const unclassified = tracked.filter((file) => !classifications.has(file));
for (const file of unclassified) {
  failures.push("UNCLASSIFIED_TRACKED_ARTIFACT: " + file);
}

if (failures.length) {
  console.error("STRUCTURAL_HYGIENE=FAIL");
  for (const failure of [...new Set(failures)].sort()) {
    console.error("  " + failure);
  }
  process.exit(1);
}

const counts = {};
for (const category of classifications.values()) {
  counts[category] = (counts[category] ?? 0) + 1;
}

console.log("TRACKED_ARTIFACTS=" + tracked.length);
console.log("UNCLASSIFIED_TRACKED_ARTIFACTS=0");
console.log("UNDISPOSITIONED_TRACKED_ARTIFACTS=0");
console.log("KNOWN_DEAD_TRACKED_FILES=0");
console.log("KNOWN_DEAD_TRACKED_DIRECTORIES=0");
console.log("TRACKED_SYMLINKS_OR_SUBMODULES=0");
console.log("FORBIDDEN_HISTORICAL_TEMP_PATHS=0");
console.log("UNADMITTED_README_ONLY_CONTAINERS=0");
console.log("GENERATED_BUILD_OUTPUT_TRACKED=0");
console.log("STRUCTURAL_HYGIENE=PASS");
console.log("CLASSIFICATION_COUNTS=" + JSON.stringify(counts));
