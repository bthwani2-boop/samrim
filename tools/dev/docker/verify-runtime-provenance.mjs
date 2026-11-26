#!/usr/bin/env node
// Read-only attestation of one observed, stable committed owner candidate.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isOwnerNonRuntimePath, sourceIdentity } from "./owner-preview-source.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const gitExe = process.platform === "win32"
  ? "C:\\Program Files\\Git\\cmd\\git.exe"
  : "/usr/bin/git";
const owners = ["dsh", "identity", "wlt"];
const project = "bthwani-refoundation";
const names = owners.map(owner => `${project}-${owner}-1`);
const sha = /^[0-9a-f]{40}$/;
const imageId = /^sha256:[0-9a-f]{64}$/;
const containerId = /^[0-9a-f]{64}$/;
const containerFormat = [
  "{{.Id}}", "{{.Name}}", "{{.Image}}",
  '{{index .Config.Labels "com.docker.compose.project"}}',
  '{{index .Config.Labels "com.docker.compose.service"}}',
  '{{index .Config.Labels "com.bthwani.environment"}}',
  '{{index .Config.Labels "com.bthwani.capability"}}',
  "{{.State.Running}}", "{{.State.Status}}",
  "{{if .State.Health}}{{.State.Health.Status}}{{else}}NOT_CONFIGURED{{end}}",
  "{{.State.StartedAt}}", "{{.RestartCount}}",
].join("|");
const imageFormat = [
  "{{.Id}}", '{{index .Config.Labels "org.opencontainers.image.revision"}}',
  '{{index .Config.Labels "com.bthwani.source-sha"}}',
  '{{index .Config.Labels "com.bthwani.preview-base"}}',
  '{{index .Config.Labels "com.bthwani.preview-digest"}}',
].join("|");

function checked(command, args) {
  const result = spawnSync(command === "git" ? gitExe : command, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 25000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} read-only attestation command failed`);
  }
  return result.stdout;
}

function gitAncestor(revision, head) {
  return spawnSync(gitExe, ["merge-base", "--is-ancestor", revision, head], {
    cwd: root, windowsHide: true, timeout: 20000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).status === 0;
}

function parseRows(raw, width, expected, keyOf, kind) {
  const rows = new Map();
  for (const line of raw.trim().split(/\r?\n/)) {
    const fields = line.split("|");
    const key = keyOf(fields);
    if (fields.length !== width || !expected.includes(key) || rows.has(key)) {
      throw new Error(`unexpected ${kind} metadata`);
    }
    rows.set(key, fields);
  }
  if (rows.size !== expected.length) throw new Error(`missing ${kind} metadata`);
  return rows;
}

function readContainers(docker) {
  const rows = parseRows(docker(["inspect", "--type", "container", "--format", containerFormat, ...names]),
    12, names, fields => fields[1]?.slice(1), "container");
  for (const [name, fields] of rows) {
    if (!containerId.test(fields[0]) || fields[1] !== `/${name}` || !imageId.test(fields[2]) ||
        !["true", "false"].includes(fields[7]) || !Number.isFinite(Date.parse(fields[10])) ||
        !/^\d+$/.test(fields[11])) throw new Error("invalid container identity or lifecycle metadata");
  }
  return rows;
}

function readImages(docker, containers) {
  const ids = [...new Set([...containers.values()].map(fields => fields[2]))];
  return parseRows(docker(["image", "inspect", "--format", imageFormat, ...ids]),
    5, ids, fields => fields[0], "image");
}

function scope(owner, startPreflight) {
  return [`services/${owner}`, ...(startPreflight ? ["infra/compose.yaml"] : [])];
}

function sourceWindow(execute, startPreflight) {
  const head = execute("git", ["rev-parse", "HEAD"]).trim();
  const branch = execute("git", ["branch", "--show-current"]).trim();
  if (!sha.test(head) || (startPreflight && (!branch || branch.startsWith("archive/")))) {
    throw new Error("source candidate not verified");
  }
  const paths = [...new Set(owners.flatMap(owner => scope(owner, startPreflight)))];
  const status = execute("git", ["status", "--porcelain=v1", "-z", "--no-renames",
    "--untracked-files=all", "--", ...paths]);
  const dirty = status.split("\0").filter(Boolean).map(record => {
    if (!/^[ MADRCU?!][ MADRCU?!] /.test(record)) throw new Error("invalid owner source status");
    const path = record.slice(3);
    if (!paths.some(p => path === p || path.startsWith(`${p}/`))) throw new Error("unexpected owner source path");
    return path;
  }).sort();
  return { head, branch, dirty };
}

function evaluate(owner, container, image, source, execute, isAncestor, startPreflight) {
  const errors = [];
  const [, , actualImage, actualProject, actualService, environment, capability, running, state, health] = container;
  if (actualProject !== project || actualService !== owner || environment !== "refoundation" ||
      (owner === "wlt" && capability !== "customer-wallet-read-only")) {
    errors.push("not the expected isolated Compose project and owner");
  }
  const active = running === "true" && state === "running" && health === "healthy";
  const stopped = startPreflight && running === "false" && state === "exited" &&
    ["healthy", "unhealthy", "starting"].includes(health);
  if (!active && !stopped) errors.push("container state or health not proven");
  if (image[0] !== actualImage) errors.push("runtime image ID absent, invalid or mismatched");
  const value = field => field === "<no value>" ? "" : field;
  let revision = "";
  try {
    const identity = sourceIdentity({
      "org.opencontainers.image.revision": value(image[1]),
      "com.bthwani.source-sha": value(image[2]),
      "com.bthwani.preview-base": value(image[3]),
      "com.bthwani.preview-digest": value(image[4]),
    }, owner);
    revision = identity.revision;
    if (identity.digest) {
      errors.push("uncommitted preview is not committed acceptance");
    } else if (!isAncestor(revision, source.head)) {
      errors.push("source is not an ancestor of HEAD");
    } else {
      const changes = execute("git", ["diff", "--name-only", "--no-renames", "-z",
        revision, source.head, "--", ...scope(owner, startPreflight)]).split("\0").filter(Boolean);
      if (changes.some(path => !isOwnerNonRuntimePath(path))) errors.push("owner source changed since image build");
    }
  } catch (error) {
    // Source-identity errors contain only the canonical owner, not raw label values.
    errors.push(error.message);
  }
  const paths = scope(owner, startPreflight);
  if (source.dirty.some(path => paths.some(p => path === p || path.startsWith(`${p}/`)))) {
    errors.push("owner worktree is not clean");
  }
  return { owner, revision, passed: errors.length === 0, errors };
}

export function verifyCandidate(argv, execute = checked, isAncestor = gitAncestor) {
  const preflight = argv.includes("--start-preflight");
  const args = argv.filter(arg => arg !== "--start-preflight");
  if (argv.length !== args.length + Number(preflight) || args.length !== 2 || args[0] !== "--context") {
    throw new Error("Usage: node tools/dev/docker/verify-runtime-provenance.mjs --context bthwani-docker [--start-preflight]");
  }
  if (args[1] !== "bthwani-docker") throw new Error("invalid Docker context");
  const context = args[1];
  if (!/^ssh:\/\/[A-Za-z0-9_.-]+@bthwani-docker$/.test(
    execute("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]).trim(),
  )) throw new Error("Wrong Docker target");
  const docker = args => execute("docker", ["--context", context, ...args]);
  const source = sourceWindow(execute, preflight);
  const first = readContainers(docker);
  const images = readImages(docker, first);
  const results = owners.map((owner, i) => {
    const container = first.get(names[i]);
    return evaluate(owner, container, images.get(container[2]), source, execute, isAncestor, preflight);
  });
  // Re-read all three owners in one native Docker call and source identity
  // after the checks. Do not emit any PASS for a superseded observation.
  const last = readContainers(docker);
  const finalSource = sourceWindow(execute, preflight);
  if (JSON.stringify(source) !== JSON.stringify(finalSource) ||
      names.some(name => JSON.stringify(first.get(name)) !== JSON.stringify(last.get(name)))) {
    throw new Error("candidate changed during runtime attestation; retry the read-only check");
  }
  return { head: source.head, preflight, results, passed: results.every(result => result.passed) };
}

export function main(argv = process.argv.slice(2), execute = checked, isAncestor = gitAncestor) {
  const result = verifyCandidate(argv, execute, isAncestor);
  const prefix = result.preflight ? "START_PREFLIGHT_" : "RUNTIME_SOURCE_";
  for (const row of result.results) {
    console.log(prefix + row.owner.toUpperCase() + "=" + (row.passed ? "PASS" : "FAIL") +
      " revision=" + (row.revision || "UNLABELED"));
    for (const reason of row.errors) console.error(`  ${row.owner}: ${reason}`);
  }
  console.log(`RUNTIME_CHECK_HEAD=${result.head}`);
  return result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`RUNTIME_CHECK_BLOCKED ${error.message}`);
    process.exitCode = 2;
  }
}
