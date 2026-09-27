import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

export const laneOrder = ["control", "identity", "wlt", "dsh"];

export const laneTargets = {
  control: ["control-panel:browser-live-proof"],
  identity: ["identity-backend:migration-proof", "identity-backend:runtime-proof"],
  wlt: ["wlt-backend:financial-invariants"],
  dsh: ["dsh-backend:baseline-proof", "dsh-backend:runtime-proof"],
};

export const laneImages = {
  control: ["identity-backend", "dsh-backend", "wlt-backend"],
  identity: ["identity-backend"],
  wlt: ["wlt-backend"],
  dsh: ["identity-backend", "dsh-backend", "wlt-backend"],
};

export const laneServices = {
  control: ["postgres", "mailpit", "identity", "dsh", "wlt"],
  identity: ["postgres", "mailpit", "identity"],
  wlt: ["postgres", "wlt"],
  dsh: ["postgres", "mailpit", "identity", "dsh", "wlt"],
};

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

export function loadProjectConfigs() {
  const configs = new Map();
  for (const file of allProjectFiles(root)) {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value?.name) configs.set(value.name, value);
  }
  return configs;
}

function implicitLane(tags) {
  const scopes = [...tags].filter((tag) => tag.startsWith("scope:"));
  if (scopes.some((tag) => tag === "scope:control-panel")) return "control";
  if (scopes.some((tag) => tag === "scope:identity" || tag.startsWith("scope:identity-"))) return "identity";
  if (scopes.some((tag) => tag === "scope:wlt" || tag.startsWith("scope:wlt-"))) return "wlt";
  if (scopes.some((tag) => tag === "scope:dsh" || tag.startsWith("scope:dsh-"))) return "dsh";
  if (scopes.some((tag) => ["scope:infra", "scope:repository-ci", "scope:runtime-proof-routing"].includes(tag))) return "full";
  return null;
}

export function resolveFromAffected(affected, configs, fullRegression = false) {
  if (fullRegression) return buildResolution(affected, laneOrder, ["explicit-full-regression"]);

  const lanes = new Set();
  const reasons = [];
  const unclassified = [];

  for (const name of affected) {
    const project = configs.get(name);
    if (!project) throw new Error(`affected Nx project is missing project.json metadata: ${name}`);

    const tags = new Set(project.tags ?? []);
    const runtimeTags = [...tags].filter((tag) => tag.startsWith("runtime:"));

    if (runtimeTags.includes("runtime:none")) continue;
    if (runtimeTags.includes("runtime:full")) return buildResolution(affected, laneOrder, [`full-escalation:${name}`]);

    const explicitLanes = runtimeTags.map((tag) => tag.slice("runtime:".length));
    for (const lane of explicitLanes) {
      if (!laneTargets[lane]) throw new Error(`unknown runtime lane '${lane}' on Nx project '${name}'`);
      lanes.add(lane);
      reasons.push(`${name}:${lane}:explicit`);
    }

    if (explicitLanes.length === 0) {
      const inferred = implicitLane(tags);
      if (inferred === "full") return buildResolution(affected, laneOrder, [`full-escalation:${name}:scope`]);
      if (inferred) {
        lanes.add(inferred);
        reasons.push(`${name}:${inferred}:scope`);
      } else if (tags.has("type:service") || tags.has("type:infra") || name === "control-panel") {
        unclassified.push(name);
      }
    }
  }

  if (unclassified.length) {
    throw new Error(`runtime-sensitive Nx projects lack runtime classification: ${unclassified.sort().join(",")}`);
  }

  return buildResolution(affected, laneOrder.filter((lane) => lanes.has(lane)), reasons);
}

function buildResolution(affected, lanes, reasons) {
  return {
    affected: [...affected].sort(),
    lanes,
    targets: unique(lanes.flatMap((lane) => laneTargets[lane])),
    images: unique(lanes.flatMap((lane) => laneImages[lane])),
    services: unique(lanes.flatMap((lane) => laneServices[lane])),
    needsBrowser: lanes.includes("control"),
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
    ["exec", "nx", "show", "projects", "--affected", `--base=${base}`, `--head=${head}`, "--sep=,"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  return output ? output.split(",").map((value) => value.trim()).filter(Boolean) : [];
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
    const resolution = resolveFromAffected(affected, loadProjectConfigs(), args.full);
    appendGithubOutput(resolution);
    console.log(`CI_RUNTIME_SCOPE=${resolution.run ? (args.full ? "FULL_REGRESSION" : "AFFECTED") : "UNAFFECTED"}`);
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
