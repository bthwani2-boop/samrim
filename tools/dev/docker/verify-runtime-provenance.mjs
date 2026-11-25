#!/usr/bin/env node
// Read-only source/image/container attestation for existing isolated Docker services.
// No container lifecycle, SQL, credentials, network changes, or secret env inspection.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isOwnerClientPath, sourceIdentity } from "./owner-preview-source.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
// Do not resolve Git from a caller-controlled PATH when verifying provenance.
const gitExecutable = process.platform === "win32"
  ? "C:\\Program Files\\Git\\cmd\\git.exe"
  : "/usr/bin/git";
const ownerServices = {
  dsh: "bthwani-refoundation-dsh-1",
  identity: "bthwani-refoundation-identity-1",
  wlt: "bthwani-refoundation-wlt-1",
};

function checked(command, args) {
  const result = spawnSync(command === "git" ? gitExecutable : command, args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    timeout: 25000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) {
    throw new Error(command + " " + args.slice(0, 3).join(" ") + " exited " + result.status);
  }
  return result.stdout.trim();
}

export function evaluateService(input, { startPreflight = false } = {}) {
  const errors = [];
  const revision = input.revisionPrimary || input.revisionFallback || "";
  try {
    const source = sourceIdentity({
      "org.opencontainers.image.revision": input.revisionPrimary,
      "com.bthwani.source-sha": input.revisionFallback,
      "com.bthwani.preview-base": input.previewBase,
      "com.bthwani.preview-digest": input.previewDigest,
    }, input.owner);
    if (source.digest) errors.push("uncommitted preview is not committed acceptance; use docker reconcile to check preview parity");
  } catch (error) {
    errors.push(error.message);
  }
  if (input.project !== "bthwani-refoundation" || input.service !== input.owner || input.environment !== "refoundation" ||
      (input.owner === "wlt" && input.capability !== "customer-wallet-read-only")) {
    errors.push("not the expected isolated Compose project and owner");
  }
  // Preflight is permission to start a previously exited container, not proof of runtime health.
  const eligibleStopped = startPreflight && !input.running && input.state === "exited" &&
    ["healthy", "unhealthy", "starting"].includes(input.health);
  if (!input.running && !eligibleStopped) errors.push("container is not running");
  if (input.health !== "healthy" && !eligibleStopped) errors.push("container health not proven");
  if (!/^sha256:[0-9a-f]{64}$/.test(input.imageId || "") || input.imageId !== input.containerImageId) errors.push("runtime image ID absent, invalid or mismatched");
  if (input.committedAncestor !== true) errors.push("source is not an ancestor of HEAD");
  if (input.ownerChanges?.some(rel => !isOwnerClientPath(rel))) errors.push("owner source changed since image build");
  if (input.localOwnerChanges?.length) errors.push("owner worktree is not clean");
  return { revision, errors, passed: errors.length === 0 };
}

function gitAncestor(revision, head) {
  const check = spawnSync(gitExecutable, ["merge-base", "--is-ancestor", revision, head], {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 20000,
  });
  return check.status === 0;
}

// Only the side-effect runner is injectable for isolated negative-path tests.
export function readService(owner, dockerContext, head, execute = checked, isAncestor = gitAncestor, { startPreflight = false } = {}) {
  const name = ownerServices[owner];
  if (!name) throw new Error("unknown owner");
  const docker = (args) => execute("docker", ["--context", dockerContext, ...args]);
  // Templates intentionally extract only non-secret metadata.
  const containerRecord = docker(["inspect", "--format",
    '{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}NOT_CONFIGURED{{end}}|{{index .Config.Labels "com.bthwani.environment"}}|{{index .Config.Labels "com.bthwani.capability"}}|{{.State.Status}}',
    name]).split("|");
  if (containerRecord.length !== 8 || !/^sha256:[0-9a-f]{64}$/.test(containerRecord[0])) throw new Error("unexpected container metadata");
  const imageRecord = docker(["image", "inspect", "--format",
    '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "com.bthwani.source-sha"}}|{{index .Config.Labels "com.bthwani.preview-base"}}|{{index .Config.Labels "com.bthwani.preview-digest"}}',
    containerRecord[0]]).split("|");
  if (imageRecord.length !== 5) throw new Error("unexpected image metadata");
  // Docker Go templates render absent label values as the literal '<no value>'.
  const label = (value) => value === "<no value>" ? "" : value;
  const primaryRevision = label(imageRecord[1]);
  const fallbackRevision = label(imageRecord[2]);
  const revision = primaryRevision || fallbackRevision;
  const paths = ["services/" + owner, ...(startPreflight ? ["infra/compose.yaml"] : [])];
  let committedAncestor = false;
  let ownerChanges = [];
  if (/^[0-9a-f]{40}$/.test(revision)) {
    committedAncestor = isAncestor(revision, head);
    if (committedAncestor) {
      ownerChanges = execute("git", ["diff", "--name-only", "--no-renames", revision, head,
        "--", ...paths]).split("\n").filter(Boolean);
    }
  }
  const localOwnerChanges = execute("git", ["status", "--porcelain",
    "--", ...paths]).split("\n").filter(Boolean);
  return evaluateService({
    owner, project: containerRecord[1], service: containerRecord[2],
    environment: containerRecord[5], capability: label(containerRecord[6]),
    running: containerRecord[3] === "true", health: containerRecord[4], state: containerRecord[7],
    containerImageId: containerRecord[0], imageId: imageRecord[0],
    revisionPrimary: primaryRevision || undefined,
    revisionFallback: fallbackRevision || undefined,
    previewBase: label(imageRecord[3]), previewDigest: label(imageRecord[4]),
    committedAncestor, ownerChanges, localOwnerChanges,
  }, { startPreflight });
}

export function main(argv = process.argv.slice(2)) {
  const withWlt = argv.includes("--include-wlt");
  const startPreflight = argv.includes("--start-preflight");
  const contextArgs = argv.filter(arg => !["--include-wlt","--start-preflight"].includes(arg));
  if (argv.filter(arg => arg === "--include-wlt").length > 1 ||
      argv.filter(arg => arg === "--start-preflight").length > 1 || (startPreflight && !withWlt) ||
      contextArgs.length > 2 || (contextArgs[0] && contextArgs[0] !== "--context") ||
      (contextArgs.length === 1 && contextArgs[0] === "--context")) {
    throw new Error("Usage: node tools/dev/docker/verify-runtime-provenance.mjs [--context CONTEXT] [--include-wlt] [--start-preflight]");
  }
  const context = contextArgs.length === 2 ? contextArgs[1] : checked("docker", ["context", "show"]);
  if (!/^[a-zA-Z0-9._-]+$/.test(context)) throw new Error("invalid Docker context");
  const head = checked("git", ["rev-parse", "HEAD"]);
  let failures = 0;
  // WLT is an opt-in Docker reader; baseline environments do not require it.
  const owners = withWlt ? Object.keys(ownerServices) : ["dsh", "identity"];
  for (const owner of owners) {
    const state = readService(owner, context, head, checked, gitAncestor, { startPreflight });
    if (!state.passed) failures++;
    console.log((startPreflight ? "START_PREFLIGHT_" : "RUNTIME_SOURCE_") + owner.toUpperCase() + "=" +
      (state.passed ? "PASS" : "FAIL") + " revision=" + (state.revision || "UNLABELED"));
    for (const reason of state.errors) console.error("  " + owner + ": " + reason);
  }
  console.log("RUNTIME_CHECK_HEAD=" + head);
  if (failures) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error("RUNTIME_CHECK_BLOCKED " + error.message);
    process.exitCode = 2;
  }
}
