#!/usr/bin/env node
// Read-only attestation of one canonical isolated Compose runtime.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { openRepositoryReader } from "../../security/verify-secrets.mjs";
import { readVerifiedFile } from "../source-snapshot.mjs";
import { readImageDefinitions, resourceIdentities, verifyLiveDefinition, verifyResourcePolicy, verifyServiceAttachments } from './compose-runtime-transition.mjs';
import { isOwnerNonRuntimePath, ownerComposeInputs, ownerSourceScope, sourceIdentity } from "./owner-preview-source.mjs";
import { assertOwnerDatabase, composeFileNames } from './reconcile-owner-runtime.mjs';

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const infra = resolve(root, "infra");
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



let repositoryReader;
function checked(command, args, input) {
  if (command === "git") {
    repositoryReader ??= openRepositoryReader(root);
    return repositoryReader(...args).toString("utf8");
  }
  const result = spawnSync(command, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 25000,
    maxBuffer: 8 * 1024 * 1024, input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) throw new Error(command + " read-only attestation command failed");
  return result.stdout;
}

function gitAncestor(revision, head) {
  try { checked("git", ["merge-base", "--is-ancestor", revision, head]); return true; }
  catch { return false; }
}

// One private native inspect window supplies every consumer, including seed
// admission. Stable execution metadata stays in memory and is never printed.
function containerSnapshot(record) {
  const { Id, Name, Image, Config, HostConfig, Mounts, NetworkSettings, State, RestartCount } = record;
  if (!digest.test(Id) || !imageId.test(Image) || !Config?.Labels ||
      !digest.test(Config.Labels["com.docker.compose.config-hash"] ?? "") ||
      !HostConfig || typeof HostConfig.Privileged !== "boolean" ||
      typeof State?.Running !== "boolean" || typeof State.Status !== "string" ||
      !Number.isFinite(Date.parse(State.StartedAt)) || !Number.isSafeInteger(RestartCount) || RestartCount < 0 ||
      !Array.isArray(Config.Env) || !Array.isArray(Mounts) || !NetworkSettings?.Networks) {
    throw new Error("invalid container identity or lifecycle metadata");
  }
  if (typeof HostConfig.LogConfig?.Type !== "string" ||
      !HostConfig.LogConfig.Config || typeof HostConfig.LogConfig.Config !== "object" ||
      Object.values(HostConfig.LogConfig.Config).some(value => typeof value !== "string")) {
    throw new Error("invalid effective container policy metadata");
  }
  return { Id, Name, Image, Config, HostConfig, Mounts,
    NetworkSettings: { Networks: NetworkSettings.Networks },
    State: { Running: State.Running, Status: State.Status, StartedAt: State.StartedAt, Health: { Status: State.Health?.Status ?? "NOT_CONFIGURED" } },
    RestartCount };
}

function readContainers(docker) {
  const inventory = docker(["ps", "-a", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.Names}}"]).trim().split(/\r?\n/);
  if (inventory.length !== names.length || !isDeepStrictEqual(new Set(inventory), new Set(names))) {
    throw new Error("unexpected project container inventory");
  }
  let records;
  try { records = JSON.parse(docker(["inspect", "--type", "container", ...names])); }
  catch { throw new Error("unexpected container metadata"); }
  if (!Array.isArray(records) || records.length !== names.length) throw new Error("missing container metadata");
  const result = new Map();
  for (const record of records) {
    const key = record.Name?.slice(1);
    if (!names.includes(key) || record.Name !== "/" + key || result.has(key)) throw new Error("unexpected container metadata");
    result.set(key, containerSnapshot(record));
  }
  return result;
}

function readImages(docker, containers) {
  const ids = [...new Set([...containers.values()].map(row => row.Image))];
  const records = readImageDefinitions(docker, ids);
  if (!isDeepStrictEqual(new Set(records.keys()), new Set(ids))) throw new Error("unexpected image metadata");
  return records;
}

function readHashes(docker, args, input) {
  const result = new Map();
  for (const line of docker([...args, "config", "--hash", foundations.join(",")], input).trim().split(/\r?\n/)) {
    const [name, hash, extra] = line.trim().split(/\s+/);
    if (!foundations.includes(name) || !digest.test(hash ?? "") || extra || result.has(name)) {
      throw new Error("invalid foundation configuration hashes");
    }
    result.set(name, hash);
  }
  if (result.size !== foundations.length) throw new Error("missing foundation configuration hashes");
  return result;
}

function readRuntimeModel(docker, composeSource) {
  const args = ["compose", "--project-directory", infra, "--env-file", resolve(infra, ".env"), "-f", "-"];
  const canonical = readHashes(docker, args, composeSource);
  const marker = /^ {2}com\.bthwani\.worktree: samrim-refoundation-clean-20261112\r?\n/gm;
  if ([...composeSource.matchAll(marker)].length !== 1) throw new Error("canonical historical-label definition not established");
  const historical = readHashes(docker, args, composeSource.replace(marker, ""));
  let model;
  try { model = JSON.parse(docker([...args, "config", "--format", "json"], composeSource)); }
  catch { throw new Error("invalid resolved Compose model"); }
  if (model.name !== project || !isDeepStrictEqual(new Set(Object.keys(model.services ?? {})), new Set(services))) throw new Error("unexpected resolved Compose project");
  const refs = foundations.map(service => model.services[service].image);
  if (refs.some((ref, i) => typeof ref !== "string" || (i < 3 ? !/@sha256:[a-f0-9]{64}$/.test(ref) : ref !== "bthwani/payment-mock:local"))) {
    throw new Error("invalid foundation image reference");
  }
  const ids = docker(["image", "inspect", "--format", "{{.Id}}", ...refs]).trim().split(/\r?\n/);
  if (ids.length !== refs.length || ids.some(id => !imageId.test(id))) throw new Error("invalid foundation image identity");
  return { canonical, historical, model, images: Object.fromEntries(foundations.map((service, i) => [service, ids[i]])) };
}

function ownerScope(owner, preflight) {
  return [...ownerSourceScope(owner), ...(preflight ? ownerComposeInputs : [])];
}

const inScope = (path, paths) => paths.some(base => path === base || path.startsWith(base + "/"));

function sourceWindow(execute, preflight) {
  const head = execute("git", ["rev-parse", "HEAD"]).trim();
  const branch = execute("git", ["branch", "--show-current"]).trim();
  if (!sha.test(head) || (preflight && (!branch || branch === "main" || branch.startsWith("archive/")))) {
    throw new Error("source candidate not verified");
  }
  const paths = [...new Set([...owners.flatMap(owner => ownerScope(owner, preflight)), ...ownerComposeInputs])];
  const dirty = new Set();
  for (const record of execute("git", ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all", "--", ...paths]).split("\0").filter(Boolean)) {
    if (!/^[ MADRCU?!][ MADRCU?!] /.test(record)) throw new Error("invalid owner source status");
    const path = record.slice(3);
    if (!inScope(path, paths)) throw new Error("unexpected owner source path");
    dirty.add(path);
  }
  return { head, branch, dirty };
}

function containerAdmission(service, actual, definition, preflight) {
  const errors = [];
  const labels = actual.Config.Labels;
  const capability = definition.labels?.["com.bthwani.capability"] ?? "";
  const serving = owners.includes(service);

  // Every service belongs to the same canonical Compose project, including
  // infrastructure and explicitly admitted historical foundation metadata.
  // Owner-specific privileges and capabilities are additional requirements,
  // not alternatives to the shared origin contract.
  if (labels["com.docker.compose.project"] !== project ||
      labels["com.docker.compose.service"] !== service ||
      labels["com.bthwani.environment"] !== "refoundation" ||
      actual.HostConfig.Privileged !== false ||
      (labels["com.bthwani.capability"] ?? "") !== capability ||
      (service === "wlt" && capability !== "customer-wallet-read-only")) {
    errors.push("not the expected isolated Compose project and owner");
  }
  try { composeFileNames(labels["com.docker.compose.project.config_files"], root); }
  catch { errors.push("canonical Compose origin not proven"); }

  if (serving && !/^[1-9]\d*(?::[1-9]\d*)?$/.test(actual.Config.User ?? "")) {
    errors.push("non-root owner user not proven");
  }
  const { Running, Status, Health } = actual.State;
  const running = Running && Status === "running" && Health.Status === "healthy";
  const previouslyExited = preflight && !Running && Status === "exited" &&
    ["healthy", "unhealthy", "starting"].includes(Health.Status);
  if (!running && !previouslyExited) errors.push("container state or health not proven");
  try { verifyResourcePolicy(definition, actual); }
  catch { errors.push("effective container policy mismatch: resource/logging"); }
  return errors;
}
function ownerSourceAdmission(owner, image, container, source, execute, isAncestor, preflight) {
  const errors = [];
  const scope = ownerScope(owner, preflight);
  let revision = "";
  if (image.Id !== container.Image) errors.push("runtime image ID absent, invalid or mismatched");
  try {
    const identity = sourceIdentity(image.Config.Labels ?? {}, owner);
    revision = identity.revision;
    if (identity.digest) errors.push("uncommitted preview is not committed acceptance");
    else if (!isAncestor(revision, source.head)) errors.push("source is not an ancestor of HEAD");
    else {
      const changes = execute("git", ["diff", "--name-only", "--no-renames", "-z", revision, source.head, "--", ...scope]).split("\0").filter(Boolean);
      if (changes.some(path => !isOwnerNonRuntimePath(path))) errors.push("owner source changed since image build");
    }
  } catch (error) { errors.push(error.message); }
  if ([...source.dirty].some(path => inScope(path, scope))) errors.push("owner worktree is not clean");
  return { revision, errors };
}

// Missing required attachments are rejected by the same effective definition.
// Inspect canonical resources that are actually attached; an absent new trust
// volume must not conceal the independent attestation results of other owners.
function readAttachedResources(docker, model, containers) {
  const volumes = new Set(), networks = new Set();
  for (const row of containers.values()) {
    for (const mount of row.Mounts) volumes.add(mount.Name);
    for (const name of Object.keys(row.NetworkSettings.Networks)) networks.add(name);
  }
  const subset = {
    volumes: Object.fromEntries(Object.entries(model.volumes ?? {}).filter(([,v]) => volumes.has(v.name))),
    networks: Object.fromEntries(Object.entries(model.networks ?? {}).filter(([,n]) => networks.has(n.name))),
  };
  return resourceIdentities(docker, subset);
}

function admitRuntime(containers, images, expected, identities, source, execute, isAncestor, preflight) {
  const results = [], foundationResults = [];
  for (const service of services) {
    const container = containers.get(nameOf(service));
    const image = images.get(container.Image);
    const definition = expected.model.services[service];
    const labels = container.Config.Labels;
    const errors = containerAdmission(service, container, definition, preflight);
    let model = expected.model, configuration;
    if (!owners.includes(service)) {
      const configHash = labels["com.docker.compose.config-hash"];
      const canonical = configHash === expected.canonical.get(service) && labels["com.bthwani.worktree"] === historicalLabel;
      const historical = service !== "payment-mock" && configHash === expected.historical.get(service) && !Object.hasOwn(labels, "com.bthwani.worktree");
      configuration = canonical ? "CANONICAL" : historical ? "HISTORICAL_LABEL_ONLY" : "MISMATCH";
      if (!canonical && !historical) errors.push("foundation native Compose configuration mismatch");
      if (historical) {
        model = structuredClone(expected.model);
        delete model.services[service].labels["com.bthwani.worktree"];
      }
      if (container.Image !== expected.images[service]) errors.push("foundation image identity mismatch");
    }
    // The owner image is admitted by immutable source identity, not a mutable
    // .env tag. Its resolved execution settings still must match.
    try { verifyLiveDefinition(model, service, container, image); verifyServiceAttachments(service, container, identities, model, [...containers.values()]); }
    catch (error) {
      errors.push(/^COMPOSE_[A-Z_]+(?: [A-Za-z0-9_-]+)*$/.test(error.message)
        ? error.message : "effective container definition unproven");
    }
    if (source.dirty.has("infra/compose.yaml")) errors.push("Compose source is not clean");
    if (owners.includes(service)) {
      const provenance = ownerSourceAdmission(service, image, container, source, execute, isAncestor, preflight);
      errors.push(...provenance.errors);
      results.push({ owner: service, revision: provenance.revision, passed: errors.length === 0, errors });
    } else {
      foundationResults.push({ service, configuration, passed: errors.length === 0, errors });
    }
  }
  return { results, foundationResults, passed: [...results, ...foundationResults].every(row => row.passed) };
}

function seedBinding(containers, model) {
  try {
    const dsh = containers.get(nameOf("dsh")), postgres = containers.get(nameOf("postgres"));
    const env = Object.fromEntries(dsh.Config.Env.map(value => {
      const separator = value.indexOf("=");
      return [value.slice(0, separator), value.slice(separator + 1)];
    }));
    if (env.BTHWANI_ISOLATED_TEST_MODE !== "true" || env.BTHWANI_ISOLATED_CONTAINER_MODE !== "true") throw new Error("not isolated");
    const scope = assertOwnerDatabase("dsh", env);
    const name = model.networks.isolated.name;
    const a = dsh.NetworkSettings.Networks[name], b = postgres.NetworkSettings.Networks[name];
    if (!a || !b || !digest.test(b.NetworkID) || a.NetworkID !== b.NetworkID || !b.Aliases?.includes("postgres")) throw new Error("database network identity");
    return { schema: scope.schema, network: b.NetworkID };
  } catch {
    return { error: "seed owner database destination or live Compose configuration not proven" };
  }
}

const readCanonicalCompose = () => readVerifiedFile(resolve(infra, 'compose.yaml'), 1024 * 1024).bytes.toString('utf8');

function runtimeTarget(argv, execute) {
  const preflight = argv.includes('--start-preflight');
  const seed = argv.includes('--seed-dsh-preflight');
  const args = argv.filter(arg => arg !== '--start-preflight' && arg !== '--seed-dsh-preflight');
  if ((preflight && seed) || argv.length !== args.length + Number(preflight) + Number(seed) || args.length !== 2 || args[0] !== '--context') {
    throw new Error('Usage: node tools/dev/docker/verify-runtime-provenance.mjs --context bthwani-docker [--start-preflight | --seed-dsh-preflight]');
  }
  const context = args[1];
  if (context !== 'bthwani-docker') throw new Error('invalid Docker context');
  const endpoint = execute('docker', ['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']).trim();
  if (!/^ssh:\/\/[A-Za-z0-9_.-]+@bthwani-docker$/.test(endpoint)) throw new Error('Wrong Docker target');
  return { preflight, seed, docker: (args, input) => execute('docker', ['--context', context, ...args], input) };
}

export function verifyCandidate(argv, execute = checked, isAncestor = gitAncestor, readCompose = readCanonicalCompose) {
  const { preflight, seed, docker } = runtimeTarget(argv, execute);
  const source = sourceWindow(execute, preflight);
  const compose = readCompose();
  const containers = readContainers(docker);
  const model = readRuntimeModel(docker, compose);
  const images = readImages(docker, containers);
  const identities = readAttachedResources(docker, model.model, containers);
  const admission = admitRuntime(containers, images, model, identities, source, execute, isAncestor, preflight);
  const seedOwnersPassed = seed && admission.results.find(row => row.owner === 'dsh').passed &&
    admission.foundationResults.find(row => row.service === 'postgres').passed;
  const binding = seedOwnersPassed ? seedBinding(containers, model.model) : undefined;
  // All decisions attach to the same immutable observation window.
  const finalModel = readRuntimeModel(docker, compose);
  const finalContainers = readContainers(docker);
  const finalIdentities = readAttachedResources(docker, finalModel.model, finalContainers);
  const finalSource = sourceWindow(execute, preflight);
  const finalBinding = seedOwnersPassed ? seedBinding(finalContainers, finalModel.model) : undefined;
  if (compose !== readCompose() || !isDeepStrictEqual(model, finalModel) ||
      !isDeepStrictEqual(source, finalSource) || !isDeepStrictEqual(containers, finalContainers) ||
      !isDeepStrictEqual(identities, finalIdentities) ||
      !isDeepStrictEqual(binding, finalBinding)) {
    throw new Error('candidate changed during runtime attestation; retry the read-only check');
  }
  if (seed) {
    // Reuse the same attested observation window and owner admission. The
    // seed has no Identity or WLT dependency, but must use the proven DSH
    // owner and its PostgreSQL foundation; an unrelated failed row does not
    // turn this explicit preparation into a global readiness gate.
    const dsh = admission.results.find(row => row.owner === 'dsh');
    const postgres = admission.foundationResults.find(row => row.service === 'postgres');
    if (binding?.error) {
      dsh.errors.push(binding.error);
      dsh.passed = false;
    }
    const passed = dsh.passed && postgres.passed && Boolean(binding?.schema);
    return { head: source.head, preflight, ...admission, seed, passed,
      seedTarget: passed ? containers.get(nameOf('dsh')).Id : undefined };
  }
  return { head: source.head, preflight, ...admission };
}

export function main(argv = process.argv.slice(2), execute = checked, isAncestor = gitAncestor) {
  const result = verifyCandidate(argv, execute, isAncestor);
  if (result.seed) {
    if (result.passed) {
      console.log(result.seedTarget);
      return 0;
    }
    for (const row of [...result.results, ...result.foundationResults].filter(row => row.owner === 'dsh' || row.service === 'postgres')) {
      for (const reason of row.errors) console.error('  ' + (row.owner ?? row.service) + ': ' + reason);
    }
    return 1;
  }
  const prefix = result.preflight ? 'START_PREFLIGHT_' : 'RUNTIME_SOURCE_';
  for (const row of result.results) {
    console.log(prefix + row.owner.toUpperCase() + '=' + (row.passed ? 'PASS' : 'FAIL') + ' revision=' + (row.revision || 'UNLABELED'));
    for (const reason of row.errors) console.error('  ' + row.owner + ': ' + reason);
  }
  for (const row of result.foundationResults) {
    console.log('FOUNDATION_CONFIG_' + row.service.toUpperCase() + '=' + (row.passed ? 'PASS' : 'FAIL') + ' configuration=' + row.configuration);
    for (const reason of row.errors) console.error('  ' + row.service + ': ' + reason);
  }
  console.log('RUNTIME_CHECK_HEAD=' + result.head);
  return result.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error('RUNTIME_CHECK_BLOCKED ' + error.message); process.exitCode = 2; }
}