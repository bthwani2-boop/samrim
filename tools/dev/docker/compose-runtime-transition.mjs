// One native Compose policy transition. Git supplies the prior model; no alternate
// serving Compose file, image build, bootstrap, SQL write, or volume removal.

import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

const project = "bthwani-refoundation";
const names = ["postgres", "media", "mailpit", "payment-mock", "identity", "dsh", "wlt"];
const owners = new Set(["identity", "dsh", "wlt"]);
const worktree = "com.bthwani.worktree";
const historicalLabel = "samrim-refoundation-clean-20261112";
const hash = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const nameOf = service => `${project}-${service}-1`;
const sorted = values => [...values].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

function requireProof(condition, reason) {
  if (!condition) throw new Error(reason);
}
function policy(model) {
  return { memory: Number(model.mem_limit || 0), pids: Number(model.pids_limit || 0),
    logging: { Type: model.logging?.driver, Config: model.logging?.options || {} } };
}
function effectivePolicy(record) {
  return { memory: record.HostConfig.Memory || 0, pids: record.HostConfig.PidsLimit || 0,
    logging: { Type: record.HostConfig.LogConfig.Type, Config: record.HostConfig.LogConfig.Config || {} } };
}
function withoutPolicy(model) {
  const { mem_limit, pids_limit, logging, ...rest } = structuredClone(model);
  if (rest.labels) delete rest.labels[worktree];
  return rest;
}
export function verifyPolicyTransition(previous, next) {
  requireProof(previous && next, "COMPOSE_POLICY_MODEL_MISSING");
  requireProof(isDeepStrictEqual(withoutPolicy(previous), withoutPolicy(next)), "COMPOSE_NON_POLICY_CHANGE");
  const desired = policy(next);
  requireProof(Number.isSafeInteger(desired.memory) && desired.memory > 0 &&
    Number.isSafeInteger(desired.pids) && desired.pids > 0 &&
    desired.logging.Type === "local" &&
    isDeepStrictEqual(desired.logging.Config, { "max-size": "10m", "max-file": "3" }),
  "COMPOSE_POLICY_NOT_ADMITTED");
  requireProof(!next.labels?.[worktree] || next.labels[worktree] === historicalLabel, "COMPOSE_LABEL_NOT_ADMITTED");
}
function protectedConfiguration(record) {
  const config = structuredClone(record.Config);
  delete config.Hostname;
  delete config.Image; // The actual immutable image ID is checked separately.
  config.Env = sorted(config.Env || []);
  config.Labels = Object.fromEntries(Object.entries(config.Labels || {}).filter(([key]) =>
    !key.startsWith("com.docker.compose.") && key !== worktree));
  const host = structuredClone(record.HostConfig);
  for (const key of ["Memory", "MemorySwap", "PidsLimit", "LogConfig"]) delete host[key];
  const mounts = sorted(record.Mounts || []);
  const networks = Object.fromEntries(Object.entries(record.NetworkSettings.Networks || {}).map(([key, value]) => [key, value.NetworkID]));
  return { config, host, mounts, networks };
}
export function verifyReplacement(before, after, desired) {
  requireProof(before.Image === after.Image && imageId.test(after.Image), "COMPOSE_IMAGE_CHANGED");
  requireProof(isDeepStrictEqual(protectedConfiguration(before), protectedConfiguration(after)), "COMPOSE_PROTECTED_CONFIGURATION_CHANGED");
  requireProof(isDeepStrictEqual(effectivePolicy(after), policy(desired)), "COMPOSE_EFFECTIVE_POLICY_MISMATCH");
  requireProof(after.State.Running && after.State.Health?.Status === "healthy", "COMPOSE_HEALTH_NOT_PROVEN");
}
function readInventory(docker) {
  const actual = docker(["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Names}}"]).split(/\r?\n/);
  requireProof(actual.length === names.length && isDeepStrictEqual(new Set(actual), new Set(names.map(nameOf))), "COMPOSE_INVENTORY_MISMATCH");
  const rows = JSON.parse(docker(["inspect", ...names.map(nameOf)]));
  const records = Object.fromEntries(rows.map(record => [record.Config.Labels?.["com.docker.compose.service"], record]));
  for (const service of names) {
    const row = records[service];
    const labels = row?.Config.Labels;
    requireProof(row?.Name === `/${nameOf(service)}` && labels?.["com.docker.compose.project"] === project &&
      labels["com.bthwani.environment"] === "refoundation" && hash.test(labels["com.docker.compose.config-hash"]) &&
      imageId.test(row.Image) && row.State.Running && !row.HostConfig.Privileged &&
      (row.Mounts || []).every(mount => mount.Type === "volume" && mount.Name.startsWith(`${project}-`) || mount.Type === "volume" && mount.Name.startsWith(`${project}_`)),
    `COMPOSE_EXISTING_OWNER_NOT_PROVEN ${service}`);
  }
  return records;
}
function environment(record) {
  return Object.fromEntries(record.Config.Env.map(value => [value.slice(0, value.indexOf("=")), value.slice(value.indexOf("=") + 1)]));
}
// Native Compose owns YAML interpretation and normalization. Only exact
// variable expressions tied to a live service field are reconstructed here;
// the resolved model, native hash and immutable image must agree independently.
export function runtimeEnvironment(model, state) {
  const env = {
    COMPOSE_PROJECT_NAME: project, COMPOSE_PROFILES: "", COMPOSE_REMOVE_ORPHANS: "false",
    BTHWANI_BUILD_CONTEXT: "", BTHWANI_BUILD_REVISION: "", BTHWANI_BUILD_SHA: "",
    BTHWANI_BUILD_PREVIEW_BASE: "", BTHWANI_BUILD_PREVIEW_DIGEST: "",
  };
  const assign = (key, value) => {
    requireProof(typeof value === "string" && (!Object.hasOwn(env, key) || env[key] === value), "COMPOSE_INTERPOLATION_UNPROVEN");
    env[key] = value;
  };
  requireProof(model.name === project, "COMPOSE_PROJECT_MODEL_MISMATCH");
  for (const service of names) {
    const source = model.services?.[service];
    const row = state[service];
    requireProof(source && row, "COMPOSE_SERVICE_MODEL_MISSING");
    const live = environment(row);
    for (const [key, value] of Object.entries(source.environment || {})) {
      if (typeof value !== "string" || !value.includes("$"+"{")) continue;
      const variable = /^\$\{([A-Z][A-Z0-9_]+)(?::[-?][^}]*)?\}$/.exec(value);
      requireProof(variable, "COMPOSE_ENVIRONMENT_EXPRESSION_UNPROVEN");
      assign(variable[1], live[key]);
    }
    if (source.image.includes("$"+"{")) {
      const tag = /^([a-z0-9/-]+):\$\{([A-Z][A-Z0-9_]+):-dev\}$/.exec(source.image);
      requireProof(tag && row.Config.Image.startsWith(`${tag[1]}:`), "COMPOSE_IMAGE_OWNER_MISMATCH");
      assign(tag[2], row.Config.Image.slice(tag[1].length + 1));
    }
    for (const port of source.ports || []) {
      if (typeof port !== "string" || !port.includes("$"+"{")) continue;
      const variable = /^127\.0\.0\.1:\$\{([A-Z][A-Z0-9_]+):-\d+\}:(\d+)$/.exec(port);
      requireProof(variable, "COMPOSE_PORT_EXPRESSION_UNPROVEN");
      const bindings = row.HostConfig.PortBindings?.[`${variable[2]}/tcp`];
      requireProof(bindings?.length === 1 && bindings[0].HostIp === "127.0.0.1", "COMPOSE_PORT_NOT_PROVEN");
      assign(variable[1], bindings[0].HostPort);
    }
  }
  return env;
}
function modelFrom(docker, args, env, input) {
  const model = JSON.parse(docker([...args, "config", "--format", "json"], env, 30000, input));
  const hashes = Object.fromEntries(docker([...args, "config", "--hash", names.join(",")], env, 30000, input).split(/\r?\n/).map(line => line.trim().split(/\s+/)));
  requireProof(model.name === project && Object.keys(hashes).length === names.length && names.every(name => hash.test(hashes[name])), "COMPOSE_RESOLVED_MODEL_INVALID");
  return { model, hashes };
}
function sameInventory(before, after, except = "") {
  for (const service of names.filter(name => name !== except)) {
    const a = before[service], b = after[service];
    requireProof(a.Id === b.Id && a.Image === b.Image && a.State.StartedAt === b.State.StartedAt &&
      a.Config.Labels["com.docker.compose.config-hash"] === b.Config.Labels["com.docker.compose.config-hash"] &&
      isDeepStrictEqual(protectedConfiguration(a), protectedConfiguration(b)) &&
      isDeepStrictEqual(effectivePolicy(a), effectivePolicy(b)), `COMPOSE_CONCURRENT_CHANGE ${service}`);
  }
}
function awaitHealthy(docker) {
  const deadline = Date.now() + 60000;
  do {
    const current = readInventory(docker);
    if (names.every(service => current[service].State.Health?.Status === "healthy")) return current;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
  } while (Date.now() < deadline);
  throw new Error("COMPOSE_PROJECT_HEALTH_NOT_PROVEN");
}
function assertModelImage(docker, model, row) {
  const id = docker(["image", "inspect", "--format", "{{.Id}}", model.image]);
  requireProof(id === row.Image, "COMPOSE_IMAGE_REFERENCE_MISMATCH");
  for (const [key, value] of Object.entries(model.environment || {}))
    requireProof(environment(row)[key] === String(value), "COMPOSE_LIVE_ENVIRONMENT_MISMATCH");
}
function configHash(row) { return row.Config.Labels["com.docker.compose.config-hash"]; }

export function reconcileComposeConfiguration({ docker, git, root, head, previous, apply, verifyOwners, ensureSource }) {
  requireProof(/^[a-f0-9]{40}$/.test(previous) && previous !== head, "COMPOSE_PREVIOUS_REVISION_REQUIRED");
  git(["merge-base", "--is-ancestor", previous, head]);
  const canonical = git(["show", `${head}:infra/compose.yaml`]);
  const prior = git(["show", `${previous}:infra/compose.yaml`]);
  const marker = /^ {2}com\.bthwani\.worktree: samrim-refoundation-clean-20261112\r?\n/gm;
  requireProof([...prior.matchAll(marker)].length === 1, "COMPOSE_PREVIOUS_METADATA_NOT_PROVEN");
  const historic = prior.replace(marker, "");
  const base = ["compose", "--project-directory", resolve(root, "infra"), "--env-file", resolve(root, "infra/.env"), "-f"];
  const currentArgs = [...base, resolve(root, "infra/compose.yaml")];
  const priorArgs = [...base, "-"];
  ensureSource();
  let state = awaitHealthy(docker);
  const rawModel = JSON.parse(docker([...priorArgs, "config", "--no-interpolate", "--format", "json"], {}, 30000, canonical));
  const env = runtimeEnvironment(rawModel, state);
  const next = modelFrom(docker, currentArgs, env);
  const candidates = [prior, historic].map(input => ({ input, ...modelFrom(docker, priorArgs, env, input) }));
  const plan = new Map();
  for (const service of names) {
    const row = state[service], desired = next.model.services[service];
    const old = candidates.find(candidate => candidate.hashes[service] === configHash(row));
    const current = configHash(row) === next.hashes[service];
    requireProof(current || old, `COMPOSE_PREVIOUS_HASH_MISMATCH ${service}`);
    const source = current ? next : old;
    requireProof(isDeepStrictEqual(source.model.volumes, next.model.volumes) &&
      isDeepStrictEqual(source.model.networks, next.model.networks), "COMPOSE_STORAGE_OR_NETWORK_CHANGE");
    verifyPolicyTransition(source.model.services[service], desired);
    assertModelImage(docker, desired, row);
    requireProof(row.Config.Labels[worktree] === source.model.services[service].labels?.[worktree], "COMPOSE_EXISTING_LABEL_MISMATCH");
    if (current) verifyReplacement(row, row, desired);
    else plan.set(service, { old, desired });
    console.log(`COMPOSE_POLICY_${service.toUpperCase()}=${current ? "CURRENT" : "TRANSITION_READY"}`);
  }
  // Existing source, live owners and their real database principals are checked
  // before changing even a resource-only policy; the lease is owned by dev.ps1.
  ensureSource();
  sameInventory(state, awaitHealthy(docker));
  verifyOwners(Object.fromEntries([...owners].map(owner => [owner, state[owner]])));
  if (!apply) {
    console.log(`COMPOSE_CONFIGURATION_PLAN_PASS HEAD=${head} PREVIOUS=${previous} SELECTED=${[...plan.keys()].join(",") || "NONE"}`);
    return;
  }
  for (const [service, { old, desired }] of plan) {
    ensureSource();
    const before = awaitHealthy(docker);
    sameInventory(state, before);
    requireProof(isDeepStrictEqual(next, modelFrom(docker, currentArgs, env)), "COMPOSE_CANDIDATE_CHANGED");
    const previousRow = before[service];
    console.log(`COMPOSE_POLICY_APPLY_STARTED ${service}`);
    try {
      docker([...currentArgs, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90", service], env, 120000);
      const after = awaitHealthy(docker);
      sameInventory(before, after, service);
      requireProof(configHash(after[service]) === next.hashes[service] &&
        after[service].Config.Labels["com.docker.compose.project.config_files"]?.replaceAll("/", "\\").toLowerCase() === resolve(root, "infra/compose.yaml").replaceAll("/", "\\").toLowerCase(),
      "COMPOSE_CANONICAL_READBACK_MISMATCH");
      verifyReplacement(previousRow, after[service], desired);
      verifyOwners(Object.fromEntries([...owners].map(owner => [owner, after[owner]])));
      state = after;
      console.log(`COMPOSE_POLICY_APPLY_VERIFIED ${service}`);
    } catch {
      // Never replay an uncertain operation. Only a known candidate or the
      // exact unchanged predecessor is eligible for recovery.
      const observed = readInventory(docker);
      sameInventory(before, observed, service);
      const row = observed[service];
      if (row.Id === previousRow.Id && configHash(row) === configHash(previousRow)) {
        requireProof(isDeepStrictEqual(protectedConfiguration(previousRow), protectedConfiguration(row)) &&
          isDeepStrictEqual(effectivePolicy(previousRow), effectivePolicy(row)), "COMPOSE_ROLLBACK_BLOCKED");
        throw new Error(`COMPOSE_TRANSITION_UNCHANGED ${service}`);
      }
      requireProof(configHash(row) === next.hashes[service] && row.Image === previousRow.Image &&
        isDeepStrictEqual(protectedConfiguration(previousRow), protectedConfiguration(row)), `COMPOSE_ROLLBACK_BLOCKED ${service}`);
      docker([...priorArgs, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90", service], env, 120000, old.input);
      const restored = awaitHealthy(docker);
      sameInventory(before, restored, service);
      requireProof(configHash(restored[service]) === old.hashes[service], "COMPOSE_ROLLBACK_READBACK_FAILED");
      const priorPolicy = effectivePolicy(previousRow);
      verifyReplacement(previousRow, restored[service], { mem_limit: priorPolicy.memory, pids_limit: priorPolicy.pids,
        logging: { driver: priorPolicy.logging.Type, options: priorPolicy.logging.Config } });
      verifyOwners(Object.fromEntries([...owners].map(owner => [owner, restored[owner]])));
      throw new Error(`COMPOSE_ROLLBACK_PASS ${service} explicit review required before retry`);
    }
  }
  ensureSource();
  const finalState = awaitHealthy(docker);
  sameInventory(state, finalState);
  for (const service of names) requireProof(configHash(finalState[service]) === next.hashes[service], "COMPOSE_FINAL_HASH_MISMATCH");
  console.log(`COMPOSE_CONFIGURATION_TRANSITION_PASS HEAD=${head}`);
}
