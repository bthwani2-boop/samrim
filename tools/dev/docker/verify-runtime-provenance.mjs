#!/usr/bin/env node
// Read-only attestation of one canonical isolated Compose runtime.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readVerifiedFile } from "../source-snapshot.mjs";
import { verifyLiveDefinition } from './compose-runtime-transition.mjs';
import { isOwnerNonRuntimePath, ownerComposeInputs, ownerSourceScope, sourceIdentity } from "./owner-preview-source.mjs";
import { assertOwnerDatabase, composeFileNames } from './reconcile-owner-runtime.mjs';

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

// Normal read-only provenance uses one bounded metadata projection. Seed admission privately verifies the actual configuration using the existing Compose owner.
const containerFields = {
  id: "{{.Id}}", name: "{{.Name}}", image: "{{.Image}}",
  project: '{{index .Config.Labels "com.docker.compose.project"}}',
  service: '{{index .Config.Labels "com.docker.compose.service"}}',
  environment: '{{index .Config.Labels "com.bthwani.environment"}}',
  capability: '{{index .Config.Labels "com.bthwani.capability"}}',
  running: "{{.State.Running}}", state: "{{.State.Status}}",
  health: "{{if .State.Health}}{{.State.Health.Status}}{{else}}NOT_CONFIGURED{{end}}",
  startedAt: "{{.State.StartedAt}}", restarts: "{{.RestartCount}}",
  configHash: '{{index .Config.Labels "com.docker.compose.config-hash"}}',
  worktree: '{{index .Config.Labels "com.bthwani.worktree"}}',
  configFiles: '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
  privileged: "{{.HostConfig.Privileged}}",
  memory: "{{.HostConfig.Memory}}",
  pids: "{{if .HostConfig.PidsLimit}}{{.HostConfig.PidsLimit}}{{else}}0{{end}}",
  logging: "{{json .HostConfig.LogConfig}}",
  restart: "{{.HostConfig.RestartPolicy.Name}}",
  readOnly: "{{.HostConfig.ReadonlyRootfs}}",
  capDrop: "{{json .HostConfig.CapDrop}}",
  security: "{{json .HostConfig.SecurityOpt}}",
  capAdd: "{{json .HostConfig.CapAdd}}",
  user: "{{.Config.User}}",
};
const imageFields = {
  id: "{{.Id}}", revision: '{{index .Config.Labels "org.opencontainers.image.revision"}}',
  source: '{{index .Config.Labels "com.bthwani.source-sha"}}',
  previewBase: '{{index .Config.Labels "com.bthwani.preview-base"}}',
  previewDigest: '{{index .Config.Labels "com.bthwani.preview-digest"}}',
};

function checked(command, args, input) {
  const result = spawnSync(command === "git" ? gitExe : command, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 25000,
    maxBuffer: 8 * 1024 * 1024, input,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (result.error || result.status !== 0) throw new Error(command + " read-only attestation command failed");
  return result.stdout;
}

function gitAncestor(revision, head) {
  return spawnSync(gitExe, ["merge-base", "--is-ancestor", revision, head], {
    cwd: root, windowsHide: true, timeout: 20000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  }).status === 0;
}

const projection = fields => Object.values(fields).join("|");

function rows(raw, fields, expected, keyOf, kind) {
  const keys = Object.keys(fields);
  const admitted = new Set(expected);
  const result = new Map();
  for (const line of raw.trimEnd().split(/\r?\n/)) {
    const values = line.split("|");
    if (values.length !== keys.length) throw new Error("unexpected " + kind + " metadata");
    const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    const key = keyOf(row);
    if (!admitted.has(key) || result.has(key)) throw new Error("unexpected " + kind + " metadata");
    result.set(key, row);
  }
  if (result.size !== admitted.size) throw new Error("missing " + kind + " metadata");
  return result;
}

// Capability/security lists are unordered but multiplicity is significant.
// Compare structured maps instead of locale-dependent sorting or serialized JSON.
function stringMultiset(value) {
  if (value === null || value === undefined) return new Map();
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new Error("invalid runtime policy metadata");
  const counts = new Map();
  for (const item of value) counts.set(item, (counts.get(item) ?? 0) + 1);
  return counts;
}

function stringMap(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== "object" || Array.isArray(value) || Object.values(value).some(item => typeof item !== "string")) {
    throw new Error("invalid runtime logging metadata");
  }
  return Object.fromEntries(Object.entries(value));
}

function integer(value, allowZero = false) {
  if (!/^(?:0|[1-9]\d*)$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < (allowZero ? 0 : 1)) {
    throw new Error("invalid runtime resource metadata");
  }
  return Number(value);
}

function runtimePolicy({ memory, pids, logDriver, logOptions, restart, readOnly, capDrop, security, capAdd }, allowZero = false) {
  if (typeof logDriver !== "string" || typeof restart !== "string" || typeof readOnly !== "boolean") {
    throw new Error("invalid runtime policy metadata");
  }
  return {
    memory: integer(memory, allowZero), pids: integer(pids, allowZero),
    logDriver, logOptions: stringMap(logOptions), restart, readOnly,
    capDrop: stringMultiset(capDrop), security: stringMultiset(security), capAdd: stringMultiset(capAdd),
  };
}

function containerSnapshot(row) {
  if (!digest.test(row.id) || !imageId.test(row.image) ||
      !["true", "false"].includes(row.running) || !Number.isFinite(Date.parse(row.startedAt)) ||
      !/^\d+$/.test(row.restarts) || !digest.test(row.configHash) || !["true", "false"].includes(row.privileged)) {
    throw new Error("invalid container identity or lifecycle metadata");
  }
  const { memory, pids, logging, restart, readOnly, capDrop, security, capAdd, ...identity } = row;
  try {
    const log = JSON.parse(logging);
    if (!log || !["true", "false"].includes(readOnly)) throw new Error("invalid policy");
    const policy = runtimePolicy({
      memory, pids, logDriver: log.Type, logOptions: log.Config, restart,
      readOnly: readOnly === "true", capDrop: JSON.parse(capDrop),
      security: JSON.parse(security), capAdd: JSON.parse(capAdd),
    }, true);
    return { ...identity, policy };
  } catch {
    throw new Error("invalid effective container policy metadata");
  }
}

function readContainers(docker) {
  const inventory = docker(["ps", "-a", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.Names}}"])
    .trim().split(/\r?\n/);
  if (inventory.length !== names.length || !isDeepStrictEqual(new Set(inventory), new Set(names))) {
    throw new Error("unexpected project container inventory");
  }
  const records = rows(docker(["inspect", "--type", "container", "--format", projection(containerFields), ...names]),
    containerFields, names, row => row.name.slice(1), "container");
  return new Map([...records].map(([name, row]) => {
    if (row.name !== "/" + name) throw new Error("invalid container identity or lifecycle metadata");
    return [name, containerSnapshot(row)];
  }));
}

function readOwnerImages(docker, containers) {
  const ids = [...new Set(owners.map(owner => containers.get(nameOf(owner)).image))];
  return rows(docker(["image", "inspect", "--format", projection(imageFields), ...ids]),
    imageFields, ids, row => row.id, "image");
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

function resolvedPolicy(service, definition) {
  if (!definition) throw new Error("missing canonical runtime policy: " + service);
  return {
    policy: runtimePolicy({
      memory: definition.mem_limit, pids: definition.pids_limit,
      logDriver: definition.logging?.driver, logOptions: definition.logging?.options,
      restart: definition.restart, readOnly: definition.read_only === true,
      capDrop: definition.cap_drop, security: definition.security_opt, capAdd: definition.cap_add,
    }),
    capability: definition.labels?.["com.bthwani.capability"] || "<no value>",
  };
}

function readRuntimeModel(docker, composeSource, seed = false) {
  const args = ["compose", "--project-directory", infra, "--env-file", resolve(infra, ".env"), "-f", "-"];
  const canonical = readHashes(docker, args, composeSource);
  const marker = /^  com\.bthwani\.worktree: samrim-refoundation-clean-20261112\r?\n/gm;
  if ([...composeSource.matchAll(marker)].length !== 1) throw new Error("canonical historical-label definition not established");
  const historical = readHashes(docker, args, composeSource.replace(marker, ""));
  let model;
  try { model = JSON.parse(docker([...args, "config", "--format", "json"], composeSource)); }
  catch { throw new Error("invalid resolved foundation model"); }
  if (model.name !== project) throw new Error("unexpected resolved Compose project");
  const policy = Object.fromEntries(services.map(service => [service, resolvedPolicy(service, model.services?.[service])]));
  const refs = foundations.map(service => model.services?.[service]?.image);
  if (refs.some((ref, i) => typeof ref !== "string" || (i < 3 ? !/@sha256:[a-f0-9]{64}$/.test(ref) : ref !== "bthwani/payment-mock:local"))) {
    throw new Error("invalid foundation image reference");
  }
  const ids = docker(["image", "inspect", "--format", "{{.Id}}", ...refs]).trim().split(/\r?\n/);
  if (ids.length !== refs.length || ids.some(id => !imageId.test(id))) throw new Error("invalid foundation image identity");
  return { canonical, historical, policy, images: Object.fromEntries(foundations.map((service, i) => [service, ids[i]])),
    // Only seed admission needs the resolved DSH/database configuration.
    // Keep it in process memory, never in the returned evidence or logs.
    seedModel: seed ? { services: { dsh: model.services.dsh, postgres: model.services.postgres }, networks: model.networks, volumes: model.volumes } : undefined };
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

function containerAdmission(service, actual, expected, preflight) {
  const errors = [];
  const serving = owners.includes(service);
  if (actual.project !== project || actual.service !== service || actual.environment !== 'refoundation' ||
      actual.privileged !== 'false' || actual.capability !== expected.capability ||
      (service === 'wlt' && actual.capability !== 'customer-wallet-read-only')) {
    errors.push('not the expected isolated Compose project and owner');
  }
  // Serving provenance is not just a matching project or image label: the
  // canonical Compose origin is required even for an exited startup candidate.
  if (serving) {
    try { composeFileNames(actual.configFiles, root); }
    catch { errors.push('serving owner canonical Compose origin not proven'); }
    if (!/^[1-9]\d*(?::[1-9]\d*)?$/.test(actual.user)) errors.push('non-root owner user not proven');
  }
  const running = actual.running === 'true' && actual.state === 'running' && actual.health === 'healthy';
  const previouslyExited = preflight && actual.running === 'false' && actual.state === 'exited' &&
    ['healthy', 'unhealthy', 'starting'].includes(actual.health);
  if (!running && !previouslyExited) errors.push('container state or health not proven');
  for (const [key, value] of Object.entries(expected.policy)) {
    if (!isDeepStrictEqual(actual.policy[key], value)) errors.push('effective container policy mismatch: ' + key);
  }
  return errors;
}

function ownerSourceAdmission(owner, image, container, source, execute, isAncestor, preflight) {
  const errors = [];
  const scope = ownerScope(owner, preflight);
  let revision = '';
  if (image.id !== container.image) errors.push('runtime image ID absent, invalid or mismatched');
  const label = field => field === '<no value>' ? '' : field;
  try {
    const identity = sourceIdentity({
      'org.opencontainers.image.revision': label(image.revision),
      'com.bthwani.source-sha': label(image.source),
      'com.bthwani.preview-base': label(image.previewBase),
      'com.bthwani.preview-digest': label(image.previewDigest),
    }, owner);
    revision = identity.revision;
    if (identity.digest) errors.push('uncommitted preview is not committed acceptance');
    else if (!isAncestor(revision, source.head)) errors.push('source is not an ancestor of HEAD');
    else {
      const changes = execute('git', ['diff', '--name-only', '--no-renames', '-z', revision, source.head, '--', ...scope]).split('\0').filter(Boolean);
      if (changes.some(path => !isOwnerNonRuntimePath(path))) errors.push('owner source changed since image build');
    }
  } catch (error) { errors.push(error.message); }
  if ([...source.dirty].some(path => inScope(path, scope))) errors.push('owner worktree is not clean');
  return { revision, errors };
}

function admitRuntime(containers, images, model, source, execute, isAncestor, preflight) {
  const results = [], foundationResults = [];
  for (const service of services) {
    const container = containers.get(nameOf(service));
    const errors = containerAdmission(service, container, model.policy[service], preflight);
    if (owners.includes(service)) {
      const provenance = ownerSourceAdmission(service, images.get(container.image), container, source, execute, isAncestor, preflight);
      errors.push(...provenance.errors);
      results.push({ owner: service, revision: provenance.revision, passed: errors.length === 0, errors });
      continue;
    }
    const canonical = container.configHash === model.canonical.get(service) && container.worktree === historicalLabel;
    const historical = service !== 'payment-mock' && container.configHash === model.historical.get(service) && container.worktree === '<no value>';
    const configuration = canonical ? 'CANONICAL' : historical ? 'HISTORICAL_LABEL_ONLY' : 'MISMATCH';
    if (!canonical && !historical) errors.push('foundation native Compose configuration mismatch');
    if (container.image !== model.images[service]) errors.push('foundation image identity mismatch');
    if (source.dirty.has('infra/compose.yaml')) errors.push('foundation Compose source is not clean');
    foundationResults.push({ service, configuration, passed: errors.length === 0, errors });
  }
  return { results, foundationResults, passed: [...results, ...foundationResults].every(row => row.passed) };
}

function seedBinding(docker, containers, model) {
  try {
    const targets = ['dsh', 'postgres'].map(service => containers.get(nameOf(service)));
    const records = JSON.parse(docker(['inspect', ...targets.map(row => row.id)]));
    if (!Array.isArray(records) || records.length !== targets.length) throw new Error('seed inventory');
    for (const [index, service] of ['dsh', 'postgres'].entries()) {
      const row = records[index], target = targets[index];
      if (row.Id !== target.id || row.Name !== target.name || row.Image !== target.image ||
          row.State.Running !== true || row.State.Health?.Status !== 'healthy' ||
          row.State.StartedAt !== target.startedAt || String(row.RestartCount) !== target.restarts) {
        throw new Error('seed target changed');
      }
      verifyLiveDefinition(model.seedModel, service, row);
    }
    // The canonical Compose verifier already validated unique environment
    // entries and their resolved values. Reuse the existing owner DB guard.
    const env = Object.fromEntries(records[0].Config.Env.map(value => {
      const separator = value.indexOf('=');
      return [value.slice(0, separator), value.slice(separator + 1)];
    }));
    if (env.BTHWANI_ISOLATED_TEST_MODE !== 'true' || env.BTHWANI_ISOLATED_CONTAINER_MODE !== 'true') throw new Error('not isolated');
    const scope = assertOwnerDatabase('dsh', env);
    const name = model.seedModel.networks.isolated.name;
    const [dsh, postgres] = records.map(row => row.NetworkSettings.Networks[name]);
    if (!dsh || !postgres || !digest.test(postgres.NetworkID) || dsh.NetworkID !== postgres.NetworkID ||
        !postgres.Aliases?.includes('postgres')) throw new Error('database network identity');
    return { schema: scope.schema, network: postgres.NetworkID };
  } catch {
    // Never propagate an inspection or configuration payload containing env.
    return { error: 'seed owner database destination or live Compose configuration not proven' };
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
  const model = readRuntimeModel(docker, compose, seed);
  const images = readOwnerImages(docker, containers);
  const admission = admitRuntime(containers, images, model, source, execute, isAncestor, preflight);
  const seedOwnersPassed = seed && admission.results.find(row => row.owner === 'dsh').passed &&
    admission.foundationResults.find(row => row.service === 'postgres').passed;
  const binding = seedOwnersPassed ? seedBinding(docker, containers, model) : undefined;
  // All decisions attach to the same immutable observation window.
  const finalModel = readRuntimeModel(docker, compose, seed);
  const finalContainers = readContainers(docker);
  const finalSource = sourceWindow(execute, preflight);
  const finalBinding = seedOwnersPassed ? seedBinding(docker, finalContainers, finalModel) : undefined;
  if (compose !== readCompose() || !isDeepStrictEqual(model, finalModel) ||
      !isDeepStrictEqual(source, finalSource) || !isDeepStrictEqual(containers, finalContainers) ||
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
      seedTarget: passed ? containers.get(nameOf('dsh')).id : undefined };
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
