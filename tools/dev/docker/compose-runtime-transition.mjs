// Native Compose owns parsing, configuration hashes and replacement. This
// guarded transition changes resource/logging policy only; it never builds,
// bootstraps, migrates, pulls, deletes volumes or creates a second serving project.
import { resolve } from "node:path";
import { isDeepStrictEqual as equal } from "node:util";

const project = "bthwani-refoundation";
const owners = ["identity", "dsh", "wlt"];
const services = ["postgres", "media", "mailpit", "payment-mock", ...owners];
const legacyLabel = "com.bthwani.worktree";
const legacyValue = "samrim-refoundation-clean-20261112";
const hash = /^[a-f0-9]{64}$/;
const imageId = /^sha256:[a-f0-9]{64}$/;
const nameOf = name => `${project}-${name}-1`;
const configHash = row => row.Config.Labels["com.docker.compose.config-hash"];

const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function orderedText(values) {
  requireProof(values.every(value => typeof value === "string"), "COMPOSE_TEXT_IDENTITY_INVALID");
  return [...values].sort(compareText);
}
// A mount destination is an exact path identity, not a locale-collated
// name. Both the live inventory and Compose model share this rule.
function orderedMounts(values, target) {
  const keys = values.map(target);
  requireProof(keys.every(key => typeof key === "string" && key.length > 0) &&
    new Set(keys).size === keys.length, "COMPOSE_MOUNT_TARGET_INVALID");
  return [...values].sort((a, b) => compareText(target(a), target(b)));
}
const same = (a, b, reason) => requireProof(equal(a, b), reason);

function requireProof(condition, reason) {
  if (!condition) throw new Error(reason);
}

function desiredPolicy(model) {
  const memory = Number(model.mem_limit || 0);
  return {
    memory,
    swap: Number(model.memswap_limit ?? memory * 2),
    pids: Number(model.pids_limit || 0),
    logging: { Type: model.logging?.driver, Config: model.logging?.options || {} },
  };
}

function effectivePolicy(row) {
  const host = row.HostConfig;
  return {
    memory: host.Memory || 0, swap: host.MemorySwap || 0, pids: host.PidsLimit || 0,
    logging: { Type: host.LogConfig.Type, Config: host.LogConfig.Config || {} },
  };
}

function nonPolicy(model) {
  const { mem_limit, pids_limit, logging, ...rest } = structuredClone(model);
  if (rest.labels) delete rest.labels[legacyLabel];
  return rest;
}

export function verifyPolicyTransition(previous, next) {
  requireProof(previous && next, "COMPOSE_POLICY_MODEL_MISSING");
  same(nonPolicy(previous), nonPolicy(next), "COMPOSE_NON_POLICY_CHANGE");
  const policy = desiredPolicy(next);
  requireProof(Number.isSafeInteger(policy.memory) && policy.memory > 0 &&
    Number.isSafeInteger(policy.swap) && policy.swap >= policy.memory &&
    Number.isSafeInteger(policy.pids) && policy.pids > 0 &&
    policy.logging.Type === "local" &&
    equal(policy.logging.Config, { "max-size": "10m", "max-file": "3" }),
  "COMPOSE_POLICY_NOT_ADMITTED");
  requireProof(!next.labels?.[legacyLabel] || next.labels[legacyLabel] === legacyValue,
    "COMPOSE_LABEL_NOT_ADMITTED");
}


function environment(row) {
  const entries = row.Config.Env.map(value => {
    const i = value.indexOf("=");
    requireProof(i > 0, "COMPOSE_ENVIRONMENT_MALFORMED");
    return [value.slice(0, i), value.slice(i + 1)];
  });
  requireProof(new Set(entries.map(([key]) => key)).size === entries.length, "COMPOSE_ENVIRONMENT_DUPLICATE");
  return Object.fromEntries(entries);
}

// Native Compose resolves expressions. Recover the serving settings from live
// fields, with an exact resolved native hash and image ID as independent proof.
export function runtimeEnvironment(model, state) {
  const env = { COMPOSE_PROJECT_NAME: project, COMPOSE_PROFILES: "", COMPOSE_REMOVE_ORPHANS: "false",
    BTHWANI_BUILD_CONTEXT: "", BTHWANI_BUILD_REVISION: "", BTHWANI_BUILD_SHA: "",
    BTHWANI_BUILD_PREVIEW_BASE: "", BTHWANI_BUILD_PREVIEW_DIGEST: "" };
  const assign = (key, value) => {
    requireProof(typeof value === "string" && (!Object.hasOwn(env, key) || env[key] === value), "COMPOSE_INTERPOLATION_UNPROVEN");
    env[key] = value;
  };
  requireProof(model.name === project, "COMPOSE_PROJECT_MODEL_MISMATCH");
  for (const service of services) {
    const source = model.services?.[service], row = state[service];
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

function resolved(docker, args, env, input) {
  const model = JSON.parse(docker([...args, "config", "--format", "json"], env, 30000, input));
  const lines = docker([...args, "config", "--hash", services.join(",")], env, 30000, input).split(/\r?\n/);
  const pairs = lines.map(line => line.trim().split(/\s+/));
  requireProof(model.name === project && pairs.length === services.length &&
    pairs.every(([name, digest, extra]) => services.includes(name) && hash.test(digest) && extra === undefined),
  "COMPOSE_RESOLVED_MODEL_INVALID");
  const hashes = Object.fromEntries(pairs);
  requireProof(Object.keys(hashes).length === services.length, "COMPOSE_RESOLVED_MODEL_DUPLICATE");
  return { model, hashes, input };
}


// Normalize only equivalent engine defaults and generated identities.
// Explicit hostnames, ordered DNS settings and all other host fields remain
// protected. Environment identity is validated once by the same owner used
// for native interpolation and direct live-model attestation.
function protectedConfiguration(row) {
  const config = structuredClone(row.Config);
  if (row.Id && config.Hostname === row.Id.slice(0, 12)) delete config.Hostname;
  delete config.Image;
  config.Env = environment(row);
  config.Labels = Object.fromEntries(Object.entries(config.Labels || {}).filter(([key]) =>
    !key.startsWith("com.docker.compose.") && key !== legacyLabel));
  const host = structuredClone(row.HostConfig);
  for (const key of ["Memory", "MemorySwap", "PidsLimit", "LogConfig"]) delete host[key];
  for (const key of ["Dns", "DnsOptions", "DnsSearch"]) host[key] = host[key] ?? [];
  host.OomKillDisable = host.OomKillDisable ?? false;
  for (const key of ["Binds", "CapAdd", "CapDrop", "SecurityOpt", "MaskedPaths", "ReadonlyPaths"]) {
    if (Array.isArray(host[key])) host[key] = orderedText(host[key]);
  }
  const mounts = orderedMounts(row.Mounts || [], mount => mount.Destination);
  const networks = Object.fromEntries(Object.entries(row.NetworkSettings.Networks || {}).map(([key, value]) => [key, value.NetworkID]));
  return { config, host, mounts, networks };
}

function assertProtected(before, after) {
  requireProof(before.Image === after.Image && imageId.test(after.Image), "COMPOSE_IMAGE_CHANGED");
  const a = protectedConfiguration(before), b = protectedConfiguration(after);
  // Only print top-level field names, never inspect values or environment data.
  for (const key of Object.keys(a)) {
    if (equal(a[key], b[key])) continue;
    const fields = ["config", "host"].includes(key)
      ? [...new Set([...Object.keys(a[key]), ...Object.keys(b[key])])].filter(field => !equal(a[key][field], b[key][field]))
      : [];
    throw new Error(`COMPOSE_PROTECTED_CONFIGURATION_CHANGED ${key}${fields.length ? `.${fields.join(",")}` : ""}`);
  }
}

function assertHealthy(row) {
  requireProof(row.State.Running && row.State.Health?.Status === "healthy", "COMPOSE_HEALTH_NOT_PROVEN");
}

export function verifyReplacement(before, after, desired) {
  assertProtected(before, after);
  same(effectivePolicy(after), desiredPolicy(desired), "COMPOSE_EFFECTIVE_POLICY_MISMATCH");
  assertHealthy(after);
}


// Independently establish actual model fields even when an interrupted
// operation already converged. Do not rely on the native hash alone.
export function verifyLiveDefinition(model, service, row) {
  const definition = model.services[service], host = row.HostConfig;
  const expectedMounts = (definition.volumes || []).map(volume => {
    requireProof(volume.type === "volume" && model.volumes[volume.source]?.name, "COMPOSE_VOLUME_NOT_ADMITTED");
    return [volume.target, model.volumes[volume.source].name, !volume.read_only];
  });
  const mounts = (row.Mounts || []).map(mount => {
    requireProof(mount.Type === "volume" && mount.Driver === "local", "COMPOSE_VOLUME_DRIVER_MISMATCH");
    return [mount.Destination, mount.Name, mount.RW];
  });
  const target = entry => entry[0];
  same(orderedMounts(mounts, target), orderedMounts(expectedMounts, target), `COMPOSE_VOLUME_MISMATCH ${service}`);
  const networkNames = Object.keys(definition.networks || {}).map(key => model.networks[key]?.name);
  same(orderedText(Object.keys(row.NetworkSettings.Networks || {})), orderedText(networkNames), `COMPOSE_NETWORK_MISMATCH ${service}`);
  const ports = Object.entries(host.PortBindings || {}).flatMap(([port, bindings]) => bindings.map(binding => [port, binding.HostIp, binding.HostPort].join("|")));
  const expectedPorts = (definition.ports || []).map(port => [`${port.target}/${port.protocol}`, port.host_ip, port.published].join("|"));
  same(orderedText(ports), orderedText(expectedPorts), `COMPOSE_PORT_MISMATCH ${service}`);
  requireProof(host.Privileged === Boolean(definition.privileged) &&
    host.ReadonlyRootfs === Boolean(definition.read_only) &&
    host.RestartPolicy.Name === definition.restart &&
    equal(orderedText(host.CapDrop || []), orderedText(definition.cap_drop || [])) &&
    equal(orderedText(host.CapAdd || []), orderedText(definition.cap_add || [])) &&
    equal(orderedText(host.SecurityOpt || []), orderedText(definition.security_opt || [])),
  `COMPOSE_SECURITY_POLICY_MISMATCH ${service}`);
  const actual = environment(row);
  for (const [key, value] of Object.entries(definition.environment || {}))
    requireProof(actual[key] === String(value), `COMPOSE_ENVIRONMENT_MISMATCH ${service}`);
  for (const [key, value] of Object.entries(definition.labels || {}))
    requireProof(row.Config.Labels[key] === value, `COMPOSE_LABEL_MISMATCH ${service}`);
  requireProof(row.Config.Labels[legacyLabel] === definition.labels?.[legacyLabel], `COMPOSE_HISTORICAL_LABEL_MISMATCH ${service}`);
  if (definition.hostname) requireProof(row.Config.Hostname === definition.hostname, `COMPOSE_HOSTNAME_MISMATCH ${service}`);
}

function inventory(docker) {
  const names = docker(["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Names}}"]).split(/\r?\n/);
  same(orderedText(names), orderedText(services.map(nameOf)), "COMPOSE_INVENTORY_MISMATCH");
  const rows = JSON.parse(docker(["inspect", ...services.map(nameOf)]));
  const records = Object.fromEntries(rows.map(row => [row.Config.Labels?.["com.docker.compose.service"], row]));
  requireProof(rows.length === services.length && Object.keys(records).length === services.length, "COMPOSE_INVENTORY_MISMATCH");
  for (const service of services) {
    const row = records[service], labels = row?.Config.Labels;
    requireProof(row?.Name === `/${nameOf(service)}` && labels?.["com.docker.compose.project"] === project &&
      labels["com.bthwani.environment"] === "refoundation" && hash.test(configHash(row)) &&
      hash.test(row.Id) && imageId.test(row.Image) && !row.HostConfig.Privileged &&
      (row.Mounts || []).every(mount => mount.Type === "volume" && (mount.Name.startsWith(`${project}-`) || mount.Name.startsWith(`${project}_`))),
    `COMPOSE_EXISTING_OWNER_NOT_PROVEN ${service}`);
  }
  return records;
}

function healthyInventory(docker) {
  const rows = inventory(docker);
  for (const service of services) assertHealthy(rows[service]);
  return rows;
}


function verifyIdentity(docker, source, service, row) {
  requireProof(configHash(row) === source.hashes[service], `COMPOSE_CONFIG_HASH_MISMATCH ${service}`);
  requireProof(docker(["image", "inspect", "--format", "{{.Id}}", source.model.services[service].image]) === row.Image,
    `COMPOSE_IMAGE_REFERENCE_MISMATCH ${service}`);
  verifyLiveDefinition(source.model, service, row);
}

// Named persistent volumes and networks must already exist. Compare their
// identities before/after; Compose is never permitted to substitute storage.
function resourceIdentities(docker, model) {
  const volumes = Object.values(model.volumes).map(volume => volume.name);
  const networks = Object.values(model.networks).map(network => network.name);
  const volumeRecords = JSON.parse(docker(["volume", "inspect", ...volumes]));
  const networkRecords = JSON.parse(docker(["network", "inspect", ...networks]));
  requireProof(volumeRecords.length === volumes.length && networkRecords.length === networks.length, "COMPOSE_RESOURCE_INVENTORY_MISMATCH");
  const storage = Object.fromEntries(volumeRecords.map(volume => {
    requireProof(volumes.includes(volume.Name) && volume.Driver === "local" && volume.CreatedAt && volume.Mountpoint, "COMPOSE_VOLUME_IDENTITY_UNPROVEN");
    return [volume.Name, [volume.CreatedAt, volume.Driver, volume.Mountpoint]];
  }));
  const network = Object.fromEntries(networkRecords.map(row => {
    const def = Object.values(model.networks).find(value => value.name === row.Name);
    requireProof(def && hash.test(row.Id) && row.Driver === def.driver && row.Internal === Boolean(def.internal), "COMPOSE_NETWORK_IDENTITY_UNPROVEN");
    return [row.Name, row.Id];
  }));
  requireProof(Object.keys(storage).length === volumes.length && Object.keys(network).length === networks.length, "COMPOSE_RESOURCE_IDENTITY_DUPLICATE");
  return { storage, network };
}

function verifyAttachments(rows, identities) {
  for (const service of services) {
    for (const [name, network] of Object.entries(rows[service].NetworkSettings.Networks || {}))
      requireProof(network.NetworkID === identities.network[name], `COMPOSE_NETWORK_IDENTITY_MISMATCH ${service}`);
    for (const mount of rows[service].Mounts || [])
      requireProof(mount.Source === identities.storage[mount.Name]?.[2], `COMPOSE_STORAGE_IDENTITY_MISMATCH ${service}`);
  }
}

function verifyUnchanged(before, after, except) {
  for (const service of services.filter(name => name !== except)) {
    const a = before[service], b = after[service];
    requireProof(a.Id === b.Id && a.State.StartedAt === b.State.StartedAt && configHash(a) === configHash(b),
      `COMPOSE_CONCURRENT_CHANGE ${service}`);
    assertProtected(a, b);
    same(effectivePolicy(a), effectivePolicy(b), `COMPOSE_CONCURRENT_POLICY_CHANGE ${service}`);
  }
}


export function reconcileComposeConfiguration({ docker, git, root, head, previous, apply, verifyOwners, ensureSource }) {
  requireProof(/^[a-f0-9]{40}$/.test(previous) && previous !== head, "COMPOSE_PREVIOUS_REVISION_REQUIRED");
  git(["merge-base", "--is-ancestor", previous, head]);
  const current = git(["show", `${head}:infra/compose.yaml`]);
  const prior = git(["show", `${previous}:infra/compose.yaml`]);
  const marker = /^ {2}com\.bthwani\.worktree: samrim-refoundation-clean-20261112\r?\n/gm;
  const variants = [prior];
  if ([...prior.matchAll(marker)].length === 1) variants.push(prior.replace(marker, ""));
  const base = ["compose", "--project-directory", resolve(root, "infra"), "--env-file", resolve(root, "infra/.env"), "-f"];
  const canonicalArgs = [...base, resolve(root, "infra/compose.yaml")], priorArgs = [...base, "-"];
  const canonicalPath = resolve(root, "infra/compose.yaml").replaceAll("/", "\\").toLowerCase();
  const assertCanonical = row => requireProof(row.Config.Labels["com.docker.compose.project.config_files"]?.replaceAll("/", "\\").toLowerCase() === canonicalPath, "COMPOSE_CANONICAL_PATH_MISMATCH");
  const ownerReadback = rows => verifyOwners(Object.fromEntries(owners.map(owner => [owner, rows[owner]])));
  const verifyCurrent = (source, service, row, before = row) => {
    verifyIdentity(docker, source, service, row);
    assertCanonical(row);
    verifyReplacement(before, row, source.model.services[service]);
  };
  ensureSource();
  let state = healthyInventory(docker);
  const raw = JSON.parse(docker([...priorArgs, "config", "--no-interpolate", "--format", "json"], {}, 30000, current));
  const env = runtimeEnvironment(raw, state);
  const next = resolved(docker, canonicalArgs, env);
  const predecessors = variants.map(source => resolved(docker, priorArgs, env, source));
  const identities = resourceIdentities(docker, next.model);
  verifyAttachments(state, identities);
  const plan = new Map();
  for (const service of services) {
    const row = state[service], current = configHash(row) === next.hashes[service];
    const source = current ? next : predecessors.find(candidate => configHash(row) === candidate.hashes[service]);
    requireProof(source, `COMPOSE_PREVIOUS_HASH_MISMATCH ${service}`);
    same(source.model.volumes, next.model.volumes, "COMPOSE_STORAGE_CHANGE");
    same(source.model.networks, next.model.networks, "COMPOSE_NETWORK_CHANGE");
    verifyPolicyTransition(source.model.services[service], next.model.services[service]);
    if (current) verifyCurrent(next, service, row);
    else {
      verifyIdentity(docker, source, service, row);
      plan.set(service, source);
    }
    console.log(`COMPOSE_POLICY_${service.toUpperCase()}=${current ? "CURRENT" : "TRANSITION_READY"}`);
  }
  ensureSource();
  ownerReadback(state);
  verifyUnchanged(state, healthyInventory(docker));
  if (!apply) {
    console.log(`COMPOSE_CONFIGURATION_PLAN_PASS HEAD=${head} PREVIOUS=${previous} SELECTED=${[...plan.keys()].join(",") || "NONE"}`);
    return;
  }

  const unchangedResources = rows => {
    same(resourceIdentities(docker, next.model), identities, "COMPOSE_RESOURCE_IDENTITY_CHANGED");
    verifyAttachments(rows, identities);
  };
  const replace = (args, service, input) => docker([...args, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "90", service], env, 120000, input);
  for (const [service, old] of plan) {
    ensureSource();
    const before = healthyInventory(docker);
    verifyUnchanged(state, before);
    unchangedResources(before);
    same(resolved(docker, canonicalArgs, env), next, "COMPOSE_CANDIDATE_CHANGED");
    const oldRow = before[service];
    console.log(`COMPOSE_POLICY_APPLY_STARTED ${service}`);
    try {
      replace(canonicalArgs, service);
      const after = healthyInventory(docker);
      verifyUnchanged(before, after, service);
      unchangedResources(after);
      const row = after[service];
      verifyCurrent(next, service, row, oldRow);
      if (owners.includes(service) || service === "postgres") ownerReadback(after);
      state = after;
      console.log(`COMPOSE_POLICY_APPLY_VERIFIED ${service}`);
    } catch (error) {
      // Unknown operation effects are never replayed. Rollback is allowed only
      // after the exact candidate and intact protected configuration are proven.
      console.error(`COMPOSE_TRANSITION_REJECTED ${service} ${error.message}`);
      if (error.code === "ETIMEDOUT") throw new Error(`COMPOSE_ROLLBACK_BLOCKED ${service} operation outcome unknown`);
      const observed = inventory(docker), row = observed[service];
      verifyUnchanged(before, observed, service);
      unchangedResources(observed);
      assertProtected(oldRow, row);
      if (row.Id === oldRow.Id && configHash(row) === configHash(oldRow)) {
        same(effectivePolicy(row), effectivePolicy(oldRow), "COMPOSE_ROLLBACK_BLOCKED");
        assertHealthy(row);
        throw new Error(`COMPOSE_TRANSITION_UNCHANGED ${service}`);
      }
      requireProof(configHash(row) === next.hashes[service], `COMPOSE_ROLLBACK_BLOCKED ${service}`);
      replace(priorArgs, service, old.input);
      const restored = healthyInventory(docker);
      verifyUnchanged(before, restored, service);
      unchangedResources(restored);
      verifyIdentity(docker, old, service, restored[service]);
      assertProtected(oldRow, restored[service]);
      same(effectivePolicy(restored[service]), effectivePolicy(oldRow), "COMPOSE_ROLLBACK_READBACK_FAILED");
      ownerReadback(restored);
      throw new Error(`COMPOSE_ROLLBACK_PASS ${service} explicit review required before retry`);
    }
  }
  ensureSource();
  const final = healthyInventory(docker);
  verifyUnchanged(state, final);
  unchangedResources(final);
  for (const service of services) verifyCurrent(next, service, final[service]);
  ownerReadback(final);
  console.log(`COMPOSE_CONFIGURATION_TRANSITION_PASS HEAD=${head}`);
}
