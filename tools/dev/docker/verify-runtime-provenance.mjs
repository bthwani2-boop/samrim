#!/usr/bin/env node
// Read-only attestation of the complete existing isolated Compose runtime.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isOwnerNonRuntimePath, sourceIdentity } from "./owner-preview-source.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const infra = resolve(root, "infra");
const gitExe = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
const project = "bthwani-refoundation";
const owners = ["dsh", "identity", "wlt"];
const foundations = ["postgres", "media", "mailpit", "payment-mock"];
const services = [...owners, ...foundations];
const nameOf = service => project + "-" + service + "-1";
const names = services.map(nameOf);
const sha = /^[a-f0-9]{40}$/;
const digest = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const historicalLabel = "samrim-refoundation-clean-20261112";
// Use a bounded metadata projection, never Config.Env or full inspect output.
const containerFormat = [
  "{{.Id}}", "{{.Name}}", "{{.Image}}",
  '{{index .Config.Labels "com.docker.compose.project"}}',
  '{{index .Config.Labels "com.docker.compose.service"}}',
  '{{index .Config.Labels "com.bthwani.environment"}}',
  '{{index .Config.Labels "com.bthwani.capability"}}',
  "{{.State.Running}}", "{{.State.Status}}",
  "{{if .State.Health}}{{.State.Health.Status}}{{else}}NOT_CONFIGURED{{end}}",
  "{{.State.StartedAt}}", "{{.RestartCount}}",
  '{{index .Config.Labels "com.docker.compose.config-hash"}}',
  '{{index .Config.Labels "com.bthwani.worktree"}}',
  '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
  "{{.HostConfig.Privileged}}",
  "{{.HostConfig.Memory}}",
  "{{if .HostConfig.PidsLimit}}{{.HostConfig.PidsLimit}}{{else}}0{{end}}",
  "{{json .HostConfig.LogConfig}}",
  "{{.HostConfig.RestartPolicy.Name}}",
  "{{.HostConfig.ReadonlyRootfs}}",
  "{{json .HostConfig.CapDrop}}",
  "{{json .HostConfig.SecurityOpt}}",
  "{{json .HostConfig.CapAdd}}",
  "{{.Config.User}}",
].join("|");

const imageFormat = [
  "{{.Id}}", '{{index .Config.Labels "org.opencontainers.image.revision"}}',
  '{{index .Config.Labels "com.bthwani.source-sha"}}',
  '{{index .Config.Labels "com.bthwani.preview-base"}}',
  '{{index .Config.Labels "com.bthwani.preview-digest"}}',
].join("|");

function checked(command, args, input) {
  const result = spawnSync(command === "git" ? gitExe : command, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 25000,
    maxBuffer: 8 * 1024 * 1024, input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  // Never print native stderr or a resolved model: it may contain credentials.
  if (result.error || result.status !== 0) throw new Error(command + " read-only attestation command failed");
  return result.stdout;
}

function gitAncestor(revision, head) {
  return spawnSync(gitExe, ["merge-base", "--is-ancestor", revision, head], {
    cwd: root, windowsHide: true, timeout: 20000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).status === 0;
}

function rows(raw, width, expected, keyOf, kind) {
  const result = new Map();
  for (const line of raw.trim().split(/\r?\n/)) {
    const fields = line.split("|"), key = keyOf(fields);
    if (fields.length !== width || !expected.includes(key) || result.has(key)) throw new Error("unexpected " + kind + " metadata");
    result.set(key, fields);
  }
  if (result.size !== expected.length) throw new Error("missing " + kind + " metadata");
  return result;
}

function stringList(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("invalid runtime policy metadata");
  return [...value].sort();
}

function stringMap(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value) || Object.values(value).some(v => typeof v !== "string")) throw new Error("invalid runtime logging metadata");
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function integer(value, allowZero = false) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < (allowZero ? 0 : 1)) throw new Error("invalid runtime resource metadata");
  return Number(value);
}

function observedPolicy(f) {
  try {
    const log = JSON.parse(f[18]);
    if (!log || typeof log.Type !== "string" || !["true", "false"].includes(f[20])) throw new Error();
    return {
      memory: integer(f[16], true), pids: integer(f[17], true),
      logDriver: log.Type, logOptions: stringMap(log.Config), restart: f[19],
      readOnly: f[20] === "true", capDrop: stringList(JSON.parse(f[21])),
      security: stringList(JSON.parse(f[22])), capAdd: stringList(JSON.parse(f[23])),
      user: f[24],
    };
  } catch { throw new Error("invalid effective container policy metadata"); }
}

function readContainers(docker) {
  const inventory = docker(["ps", "-a", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.Names}}"]).trim().split(/\r?\n/).sort();
  if (JSON.stringify(inventory) !== JSON.stringify([...names].sort())) throw new Error("unexpected project container inventory");
  const result = rows(docker(["inspect", "--type", "container", "--format", containerFormat, ...names]), 25, names, f => f[1]?.slice(1), "container");
  for (const [name, f] of result) {
    if (!digest.test(f[0]) || f[1] !== "/" + name || !imageId.test(f[2]) ||
        !["true", "false"].includes(f[7]) || !Number.isFinite(Date.parse(f[10])) || !/^\d+$/.test(f[11]) ||
        !digest.test(f[12]) || !["true", "false"].includes(f[15])) throw new Error("invalid container identity or lifecycle metadata");
    observedPolicy(f);
  }
  return result;
}

function readOwnerImages(docker, containers) {
  const ids = [...new Set(owners.map(owner => containers.get(nameOf(owner))[2]))];
  return rows(docker(["image", "inspect", "--format", imageFormat, ...ids]), 5, ids, f => f[0], "image");
}

function readHashes(docker, args, input) {
  const result = {};
  for (const line of docker([...args, "config", "--hash", foundations.join(",")], input).trim().split(/\r?\n/)) {
    const [name, hash, extra] = line.trim().split(/\s+/);
    if (!foundations.includes(name) || !digest.test(hash || "") || extra || Object.hasOwn(result, name)) throw new Error("invalid foundation configuration hashes");
    result[name] = hash;
  }
  if (Object.keys(result).length !== foundations.length) throw new Error("missing foundation configuration hashes");
  return Object.fromEntries(foundations.map(name => [name, result[name]]));
}

function resolvedPolicy(service, definition) {
  if (!definition || typeof definition.logging?.driver !== "string" || typeof definition.restart !== "string") throw new Error("missing canonical runtime policy: " + service);
  return {
    memory: integer(definition.mem_limit), pids: integer(definition.pids_limit),
    logDriver: definition.logging.driver, logOptions: stringMap(definition.logging.options),
    restart: definition.restart, readOnly: definition.read_only === true,
    capDrop: stringList(definition.cap_drop), security: stringList(definition.security_opt),
    capAdd: stringList(definition.cap_add),
    capability: definition.labels?.["com.bthwani.capability"] || "<no value>",
  };
}

function readRuntimeModel(docker, composeSource) {
  const args = ["compose", "--project-directory", infra, "--env-file", resolve(infra, ".env"), "-f", "-"];
  const canonical = readHashes(docker, args, composeSource);
  // Reconstruct only the explicitly admitted label-only historical model.
  // Resource policy changes must never be treated as historical label drift.
  const marker = /^  com\.bthwani\.worktree: samrim-refoundation-clean-20261112\r?\n/gm;
  if ([...composeSource.matchAll(marker)].length !== 1) throw new Error("canonical historical-label definition not established");
  const historical = readHashes(docker, args, composeSource.replace(marker, ""));
  let model;
  try { model = JSON.parse(docker([...args, "config", "--format", "json"], composeSource)); }
  catch { throw new Error("invalid resolved foundation model"); }
  if (model.name !== project) throw new Error("unexpected resolved Compose project");
  const policy = Object.fromEntries(services.map(service => [service, resolvedPolicy(service, model.services?.[service])]));
  const refs = foundations.map(service => model.services?.[service]?.image);
  if (refs.some((ref, i) => typeof ref !== "string" || (i < 3 ? !/@sha256:[a-f0-9]{64}$/.test(ref) : ref !== "bthwani/payment-mock:local"))) throw new Error("invalid foundation image reference");
  const ids = docker(["image", "inspect", "--format", "{{.Id}}", ...refs]).trim().split(/\r?\n/);
  if (ids.length !== refs.length || ids.some(id => !imageId.test(id))) throw new Error("invalid foundation image identity");
  return { canonical, historical, policy, images: Object.fromEntries(foundations.map((service, i) => [service, ids[i]])) };
}

function ownerScope(owner, preflight) {
  return ["services/" + owner, ...(preflight ? ["infra/compose.yaml"] : [])];
}

function sourceWindow(execute, preflight) {
  const head = execute("git", ["rev-parse", "HEAD"]).trim();
  const branch = execute("git", ["branch", "--show-current"]).trim();
  if (!sha.test(head) || (preflight && (!branch || branch === "main" || branch.startsWith("archive/")))) throw new Error("source candidate not verified");
  const paths = [...new Set([...owners.flatMap(owner => ownerScope(owner, preflight)), "infra/compose.yaml"])];
  const dirty = execute("git", ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...paths])
    .split("\0").filter(Boolean).map(record => {
      if (!/^[ MADRCU?!][ MADRCU?!] /.test(record)) throw new Error("invalid owner source status");
      const path = record.slice(3);
      if (!paths.some(p => path === p || path.startsWith(p + "/"))) throw new Error("unexpected owner source path");
      return path;
    }).sort();
  return { head, branch, dirty };
}

function evaluateContainer(service, f, expected, preflight) {
  const errors = [];
  if (f[3] !== project || f[4] !== service || f[5] !== "refoundation" || f[15] !== "false" ||
      f[6] !== expected.capability || (service === "wlt" && f[6] !== "customer-wallet-read-only")) errors.push("not the expected isolated Compose project and owner");
  const active = f[7] === "true" && f[8] === "running" && f[9] === "healthy";
  const stopped = preflight && f[7] === "false" && f[8] === "exited" && ["healthy", "unhealthy", "starting"].includes(f[9]);
  if (!active && !stopped) errors.push("container state or health not proven");
  // Inspect effective HostConfig as well as the immutable creation hash:
  // docker update and daemon defaults can otherwise leave a matching hash.
  const actual = observedPolicy(f);
  for (const key of ["memory", "pids", "logDriver", "logOptions", "restart", "readOnly", "capDrop", "security", "capAdd"]) {
    if (JSON.stringify(actual[key]) !== JSON.stringify(expected[key])) errors.push("effective container policy mismatch: " + key);
  }
  if (owners.includes(service) && !/^[1-9]\d*(?::[1-9]\d*)?$/.test(actual.user)) errors.push("non-root owner user not proven");
  return errors;
}

function evaluateOwner(owner, f, image, model, source, execute, isAncestor, preflight) {
  const errors = evaluateContainer(owner, f, model.policy[owner], preflight);
  if (image[0] !== f[2]) errors.push("runtime image ID absent, invalid or mismatched");
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
    if (identity.digest) errors.push("uncommitted preview is not committed acceptance");
    else if (!isAncestor(revision, source.head)) errors.push("source is not an ancestor of HEAD");
    else {
      const changes = execute("git", ["diff", "--name-only", "--no-renames", "-z", revision, source.head, "--", ...ownerScope(owner, preflight)]).split("\0").filter(Boolean);
      if (changes.some(path => !isOwnerNonRuntimePath(path))) errors.push("owner source changed since image build");
    }
  } catch (error) { errors.push(error.message); }
  if (source.dirty.some(path => ownerScope(owner, preflight).some(p => path === p || path.startsWith(p + "/")))) errors.push("owner worktree is not clean");
  return { owner, revision, passed: errors.length === 0, errors };
}

function evaluateFoundation(service, f, model, source, preflight) {
  const errors = evaluateContainer(service, f, model.policy[service], preflight);
  const canonical = f[12] === model.canonical[service] && f[13] === historicalLabel;
  const historical = service !== "payment-mock" && f[12] === model.historical[service] && f[13] === "<no value>";
  if (!canonical && !historical) errors.push("foundation native Compose configuration mismatch");
  if (f[2] !== model.images[service]) errors.push("foundation image identity mismatch");
  if (source.dirty.includes("infra/compose.yaml")) errors.push("foundation Compose source is not clean");
  return { service, configuration: canonical ? "CANONICAL" : historical ? "HISTORICAL_LABEL_ONLY" : "MISMATCH", passed: errors.length === 0, errors };
}

export function verifyCandidate(argv, execute = checked, isAncestor = gitAncestor, readCompose = () => readFileSync(resolve(infra, "compose.yaml"), "utf8")) {
  const preflight = argv.includes("--start-preflight"), args = argv.filter(arg => arg !== "--start-preflight");
  if (argv.length !== args.length + Number(preflight) || args.length !== 2 || args[0] !== "--context") throw new Error("Usage: node tools/dev/docker/verify-runtime-provenance.mjs --context bthwani-docker [--start-preflight]");
  if (args[1] !== "bthwani-docker") throw new Error("invalid Docker context");
  const context = args[1];
  if (!/^ssh:\/\/[A-Za-z0-9_.-]+@bthwani-docker$/.test(execute("docker", ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]).trim())) throw new Error("Wrong Docker target");
  const docker = (args, input) => execute("docker", ["--context", context, ...args], input);
  const source = sourceWindow(execute, preflight);
  const compose = readCompose();
  const first = readContainers(docker);
  const model = readRuntimeModel(docker, compose);
  const images = readOwnerImages(docker, first);
  const results = owners.map(owner => {
    const container = first.get(nameOf(owner));
    return evaluateOwner(owner, container, images.get(container[2]), model, source, execute, isAncestor, preflight);
  });
  const foundationResults = foundations.map(service => evaluateFoundation(service, first.get(nameOf(service)), model, source, preflight));
  const lastModel = readRuntimeModel(docker, compose);
  const last = readContainers(docker), finalSource = sourceWindow(execute, preflight);
  if (compose !== readCompose() || JSON.stringify(model) !== JSON.stringify(lastModel) ||
      JSON.stringify(source) !== JSON.stringify(finalSource) ||
      names.some(name => JSON.stringify(first.get(name)) !== JSON.stringify(last.get(name)))) {
    throw new Error("candidate changed during runtime attestation; retry the read-only check");
  }
  return { head: source.head, preflight, results, foundationResults, passed: [...results, ...foundationResults].every(row => row.passed) };
}

export function main(argv = process.argv.slice(2), execute = checked, isAncestor = gitAncestor) {
  const result = verifyCandidate(argv, execute, isAncestor);
  const prefix = result.preflight ? "START_PREFLIGHT_" : "RUNTIME_SOURCE_";
  for (const row of result.results) {
    console.log(prefix + row.owner.toUpperCase() + "=" + (row.passed ? "PASS" : "FAIL") + " revision=" + (row.revision || "UNLABELED"));
    for (const reason of row.errors) console.error("  " + row.owner + ": " + reason);
  }
  for (const row of result.foundationResults) {
    console.log("FOUNDATION_CONFIG_" + row.service.toUpperCase() + "=" + (row.passed ? "PASS" : "FAIL") + " configuration=" + row.configuration);
    for (const reason of row.errors) console.error("  " + row.service + ": " + reason);
  }
  console.log("RUNTIME_CHECK_HEAD=" + result.head);
  return result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error("RUNTIME_CHECK_BLOCKED " + error.message); process.exitCode = 2; }
}
