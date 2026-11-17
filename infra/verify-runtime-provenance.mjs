#!/usr/bin/env node
// Read-only source/image/container attestation for existing isolated Docker services.
// No container lifecycle, SQL, credentials, network changes, or secret env inspection.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// Do not resolve Git from a caller-controlled PATH when verifying provenance.
const gitExecutable = process.platform === "win32"
  ? "C:\\Program Files\\Git\\cmd\\git.exe"
  : "/usr/bin/git";
const ownerServices = {
  dsh: "bthwani-refoundation-dsh-1",
  identity: "bthwani-refoundation-identity-1",
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

export function evaluateService(input) {
  const errors = [];
  const revision = input.revisionPrimary || input.revisionFallback || "";
  const shaPattern = /^[0-9a-f]{40}$/;
  if (input.revisionPrimary && input.revisionFallback &&
    input.revisionPrimary !== input.revisionFallback) {
    errors.push("conflicting image source labels");
  }
  if (!shaPattern.test(revision)) errors.push("source revision absent or invalid");
  if (input.project !== "bthwani-refoundation" || input.service !== input.owner) {
    errors.push("not the expected isolated Compose project and owner");
  }
  if (!input.running) errors.push("container is not running");
  if (input.health !== "healthy") errors.push("container health not proven");
  if (input.imageId !== input.containerImageId) errors.push("runtime image ID mismatch");
  if (input.committedAncestor === false) errors.push("source is not an ancestor of HEAD");
  if (input.ownerChanges?.length) errors.push("owner source changed since image build");
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
export function readService(owner, dockerContext, head, execute = checked, isAncestor = gitAncestor) {
  const name = ownerServices[owner];
  const docker = (args) => execute("docker", ["--context", dockerContext, ...args]);
  // Templates intentionally extract only non-secret metadata.
  const containerRecord = docker(["inspect", "--format",
    '{{.Image}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}NOT_CONFIGURED{{end}}',
    name]).split("|");
  if (containerRecord.length !== 5) throw new Error("unexpected container metadata");
  const imageRecord = docker(["image", "inspect", "--format",
    '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "com.bthwani.source-sha"}}',
    containerRecord[0]]).split("|");
  if (imageRecord.length !== 3) throw new Error("unexpected image metadata");
  // Docker Go templates render absent label values as the literal '<no value>'.
  const label = (value) => value === "<no value>" ? "" : value;
  const primaryRevision = label(imageRecord[1]);
  const fallbackRevision = label(imageRecord[2]);
  const revision = primaryRevision || fallbackRevision;
  let committedAncestor = false;
  let ownerChanges = [];
  if (/^[0-9a-f]{40}$/.test(revision)) {
    committedAncestor = isAncestor(revision, head);
    if (committedAncestor) {
      ownerChanges = execute("git", ["diff", "--name-only", revision, head,
        "--", "services/" + owner]).split("\n").filter(Boolean);
    }
  }
  const localOwnerChanges = execute("git", ["status", "--porcelain",
    "--", "services/" + owner]).split("\n").filter(Boolean);
  return evaluateService({
    owner, project: containerRecord[1], service: containerRecord[2],
    running: containerRecord[3] === "true", health: containerRecord[4],
    containerImageId: containerRecord[0], imageId: imageRecord[0],
    revisionPrimary: primaryRevision || undefined,
    revisionFallback: fallbackRevision || undefined,
    committedAncestor, ownerChanges, localOwnerChanges,
  });
}

export function main(argv = process.argv.slice(2)) {
  if (argv.length > 2 || (argv[0] && argv[0] !== "--context") ||
      (argv.length === 1 && argv[0] === "--context")) {
    throw new Error("Usage: node infra/verify-runtime-provenance.mjs [--context CONTEXT]");
  }
  const context = argv.length === 2 ? argv[1] : checked("docker", ["context", "show"]);
  if (!/^[a-zA-Z0-9._-]+$/.test(context)) throw new Error("invalid Docker context");
  const head = checked("git", ["rev-parse", "HEAD"]);
  let failures = 0;
  for (const owner of Object.keys(ownerServices)) {
    const state = readService(owner, context, head);
    if (!state.passed) failures++;
    console.log("RUNTIME_SOURCE_" + owner.toUpperCase() + "=" +
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
