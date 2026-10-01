import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");

export const laneOrder = ["control", "identity", "wlt", "dsh"];
const compareStrings = (left, right) => String(left).localeCompare(String(right), "en");

export const laneTargets = {
  control: ["control-panel:browser-live-proof"],
  identity: ["identity-backend:migration-proof", "identity-backend:runtime-proof"],
  wlt: ["wlt-backend:financial-invariants"],
  dsh: ["dsh-backend:baseline-proof", "dsh-backend:runtime-proof", "dsh-backend:location-proof"],
};

const laneImages = {
  control: ["identity-backend", "dsh-backend", "wlt-backend"],
  identity: ["identity-backend"],
  wlt: ["wlt-backend"],
  dsh: ["identity-backend", "dsh-backend", "wlt-backend"],
};

const laneServices = {
  control: ["postgres", "mailpit", "identity", "dsh", "wlt"],
  identity: ["postgres", "mailpit", "identity"],
  wlt: ["postgres", "wlt"],
  dsh: ["postgres", "mailpit", "identity", "dsh", "wlt"],
};

const fullRuntimeFiles = new Set([
  ".github/workflows/ci-runtime.yml",
  "tools/dev/build-ci-image.mjs",
  "tools/dev/run-ci-runtime-proof.mjs",
]);

const laneRuntimeFiles = new Map([
  ["tools/dev/verify-identity-migrations.mjs", "identity"],
  ["tools/dev/verify-identity-runtime.mjs", "identity"],
  ["tools/dev/verify-dsh-baseline.mjs", "dsh"],
  ["tools/dev/verify-dsh-runtime-core.mjs", "dsh"],
  ["tools/dev/verify-dsh-location-runtime.mjs", "dsh"],
]);

function unique(values) {
  return [...new Set(values)];
}

function allProjectFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", ".nx", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...allProjectFiles(absolute));
    else if (entry.name === "project.json") result.push(absolute);
  }
  return result;
}

function loadProjectConfigs() {
  const configs = new Map();
  for (const file of allProjectFiles(root)) {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value?.name) configs.set(value.name, value);
  }
  return configs;
}

function implicitLane(tags) {
  const scopes = [...tags].filter((tag) => tag.startsWith("scope:"));
  if (scopes.includes("scope:control-panel")) return "control";
  if (scopes.some((tag) => tag === "scope:identity" || tag.startsWith("scope:identity-"))) return "identity";
  if (scopes.some((tag) => tag === "scope:wlt" || tag.startsWith("scope:wlt-"))) return "wlt";
  if (scopes.some((tag) => tag === "scope:dsh" || tag.startsWith("scope:dsh-"))) return "dsh";
  const fullScopes = new Set(["scope:infra", "scope:runtime-proof-routing"]);
  if (scopes.some((tag) => fullScopes.has(tag))) return "full";
  return null;
}

function isRuntimeSensitive(name, tags) {
  return tags.has("type:service") || tags.has("type:infra") || tags.has("type:app") || name === "control-panel";
}

function classifyRuntimeProject(name, project) {
  const tags = new Set(project.tags ?? []);
  const runtimeTags = [...tags].filter((tag) => tag.startsWith("runtime:"));

  if (runtimeTags.includes("runtime:none")) return { mode: "none" };
  if (runtimeTags.includes("runtime:full")) return { mode: "full", reason: `full-escalation:${name}` };

  const explicitLanes = runtimeTags.map((tag) => tag.slice("runtime:".length));
  if (explicitLanes.length > 0) {
    for (const lane of explicitLanes) {
      if (!laneTargets[lane]) throw new Error(`unknown runtime lane '${lane}' on Nx project '${name}'`);
    }
    return {
      mode: "lanes",
      lanes: explicitLanes,
      reasons: explicitLanes.map((lane) => `${name}:${lane}:explicit`),
    };
  }

  const inferred = implicitLane(tags);
  if (inferred === "full") return { mode: "full", reason: `full-escalation:${name}:scope` };
  if (inferred) return { mode: "lanes", lanes: [inferred], reasons: [`${name}:${inferred}:scope`] };
  return isRuntimeSensitive(name, tags) ? { mode: "unclassified" } : { mode: "none" };
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort(compareStrings).map((key) => [key, stableJson(value[key])]));
}

function readJsonAtRef(ref, file) {
  try {
    const body = execFileSync("git", ["show", `${ref}:${file}`], { cwd: root, encoding: "utf8" });
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function repositoryRuntimeTargetChanged(base, head, changedFiles) {
  if (!changedFiles.includes(".github/project.json")) return false;
  const before = readJsonAtRef(base, ".github/project.json");
  const after = readJsonAtRef(head, ".github/project.json");
  if (!before || !after) return true;
  const beforeTarget = stableJson(before.targets?.["runtime-integration"] ?? null);
  const afterTarget = stableJson(after.targets?.["runtime-integration"] ?? null);
  return JSON.stringify(beforeTarget) !== JSON.stringify(afterTarget);
}

export function resolveChangedFileRuntime(changedFiles, repositoryCiRuntimeTargetChanged = false) {
  if (repositoryCiRuntimeTargetChanged) {
    return { mode: "full", lanes: laneOrder, reasons: ["full-escalation:repository-ci:runtime-target-changed"] };
  }

  const lanes = new Set();
  const reasons = [];
  for (const rawFile of changedFiles) {
    const file = String(rawFile).replaceAll("\\", "/");
    if (fullRuntimeFiles.has(file) || file.startsWith("tools/dev/runtime-proof/")) {
      return { mode: "full", lanes: laneOrder, reasons: [`full-escalation:file:${file}`] };
    }
    const lane = laneRuntimeFiles.get(file);
    if (lane) {
      lanes.add(lane);
      reasons.push(`file:${file}:${lane}`);
    }
  }

  return { mode: lanes.size > 0 ? "lanes" : "none", lanes: laneOrder.filter((lane) => lanes.has(lane)), reasons };
}

export function resolveFromAffected(affected, configs, fullRegression = false, changedFileRouting = { mode: "none", lanes: [], reasons: [] }) {
  if (fullRegression) return buildResolution(affected, laneOrder, ["explicit-full-regression"]);
  if (changedFileRouting.mode === "full") return buildResolution(affected, laneOrder, changedFileRouting.reasons ?? ["full-escalation:changed-file"]);

  const lanes = new Set(changedFileRouting.lanes ?? []);
  const reasons = [...(changedFileRouting.reasons ?? [])];
  const unclassified = [];

  for (const name of affected) {
    const project = configs.get(name);
    if (!project) throw new Error(`affected Nx project is missing project.json metadata: ${name}`);

    const classification = classifyRuntimeProject(name, project);
    if (classification.mode === "full") return buildResolution(affected, laneOrder, [classification.reason]);
    if (classification.mode === "unclassified") {
      unclassified.push(name);
      continue;
    }
    if (classification.mode !== "lanes") continue;

    for (const lane of classification.lanes) lanes.add(lane);
    reasons.push(...classification.reasons);
  }

  if (unclassified.length > 0) {
    throw new Error(`runtime-sensitive Nx projects lack runtime classification: ${unclassified.toSorted(compareStrings).join(",")}`);
  }

  return buildResolution(affected, laneOrder.filter((lane) => lanes.has(lane)), reasons);
}

function buildResolution(affected, lanes, reasons) {
  const targets = lanes.flatMap((lane) => {
    if (lane !== "dsh") return laneTargets[lane];
    const checkerFixtureTarget = lanes.includes("control") ? [] : ["control-panel:dsh-runtime-checker-fixture"];
    return [...checkerFixtureTarget, ...laneTargets.dsh];
  });
  return {
    affected: [...affected].toSorted(compareStrings),
    lanes,
    targets: unique(targets),
    images: unique(lanes.flatMap((lane) => laneImages[lane])),
    services: unique(lanes.flatMap((lane) => laneServices[lane])),
    needsBrowser: lanes.includes("control") || lanes.includes("dsh"),
    run: lanes.length > 0,
    reasons: unique(reasons),
  };
}

function parseArgs(argv) {
  const result = { base: process.env.NX_BASE ?? "", head: process.env.NX_HEAD ?? "", full: false };
  for (const arg of argv) {
    if (arg === "--full") result.full = true;
    else if (arg.startsWith("--base=")) result.base = arg.slice("--base=".length);
    else if (arg.startsWith("--head=")) result.head = arg.slice("--head=".length);
  }
  return result;
}

function affectedProjects(base, head) {
  if (!base || !head) throw new Error("NX_BASE/NX_HEAD (or --base/--head) are required");
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const output = execFileSync(
    executable,
    ["exec", "nx", "show", "projects", "--affected", `--base=${base}`, `--head=${head}`, "--sep=,", "--no-cloud"],
    { cwd: root, encoding: "utf8", env: { ...process.env, NX_NO_CLOUD: "true" } },
  ).trim();
  return output ? output.split(",").map((value) => value.trim()).filter(Boolean) : [];
}

function changedFiles(base, head) {
  if (!base || !head) throw new Error("NX_BASE/NX_HEAD (or --base/--head) are required");
  const output = execFileSync("git", ["diff", "--name-only", "-z", base, head, "--"], { cwd: root, encoding: "utf8" });
  return output.split("\0").map((value) => value.trim()).filter(Boolean);
}

function appendGithubOutput(resolution) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `run=${resolution.run ? "true" : "false"}`,
      `lanes=${resolution.lanes.join(",")}`,
      `targets=${resolution.targets.join(",")}`,
      `images=${resolution.images.join(",")}`,
      `services=${resolution.services.join(",")}`,
      `browser=${resolution.needsBrowser ? "true" : "false"}`,
    ].join("\n") + "\n",
  );
}

if (process.argv[1]?.endsWith("resolve.mjs")) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const affected = affectedProjects(args.base, args.head);
    const files = changedFiles(args.base, args.head);
    const fileRouting = resolveChangedFileRuntime(files, repositoryRuntimeTargetChanged(args.base, args.head, files));
    const resolution = resolveFromAffected(affected, loadProjectConfigs(), args.full, fileRouting);
    appendGithubOutput(resolution);
    let scope = "UNAFFECTED";
    if (resolution.run) scope = args.full ? "FULL_REGRESSION" : "AFFECTED";
    console.log(`CI_RUNTIME_SCOPE=${scope}`);
    console.log(`CI_RUNTIME_AFFECTED=${resolution.affected.join(",")}`);
    console.log(`CI_RUNTIME_LANES=${resolution.lanes.join(",")}`);
    console.log(`CI_RUNTIME_TARGETS=${resolution.targets.join(",")}`);
    console.log(`CI_RUNTIME_IMAGES=${resolution.images.join(",")}`);
    console.log(`CI_RUNTIME_SERVICES=${resolution.services.join(",")}`);
    console.log(`CI_RUNTIME_REASONS=${resolution.reasons.join(",")}`);
  } catch (error) {
    console.error(`CI_RUNTIME_SCOPE=FAIL ${error.message}`);
    process.exit(1);
  }
}
