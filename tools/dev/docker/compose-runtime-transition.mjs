// Native Compose owns parsing, configuration hashes and replacement. This
// guarded transition changes resource/logging policy only; it never builds,
// bootstraps, migrates, pulls, deletes volumes or creates a second serving project.

import { isIPv4 } from "node:net";
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
  admittedPolicy(next);
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
  const networks = Object.fromEntries(Object.entries(row.NetworkSettings.Networks || {}).map(([key, value]) => [key, endpointConfiguration(value,row)]));
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
  verifyResourcePolicy(desired, after);
  assertHealthy(after);
}


// Verify the resolved execution definition against the immutable image defaults.
// Compose's resolved JSON escapes literal dollars for re-consumption by Compose.
const composeText = value => String(value).replaceAll("$$", "$");
const argv = value => {
  requireProof(value == null || (Array.isArray(value) && value.every(item => typeof item === "string")), "COMPOSE_ARGUMENT_VECTOR_INVALID");
  return value ?? [];
};
const configEnv = config => environment({ Config: { Env: config.Env ?? [] } });

function duration(value) {
  requireProof(typeof value === "string", "COMPOSE_HEALTH_DURATION_INVALID");
  const parts = [...value.matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)];
  requireProof(parts.length && parts.map(part => part[0]).join("") === value, "COMPOSE_HEALTH_DURATION_INVALID");
  const unit = { ns: 1, us: 1000, "µs": 1000, ms: 1000000, s: 1000000000, m: 60000000000, h: 3600000000000 };
  const result = parts.reduce((total, part) => total + Number(part[1]) * unit[part[2]], 0);
  requireProof(Number.isSafeInteger(result) && result >= 0, "COMPOSE_HEALTH_DURATION_INVALID");
  return result;
}

const healthFields = { interval: "Interval", timeout: "Timeout", start_period: "StartPeriod", start_interval: "StartInterval", retries: "Retries" };
function healthDefinition(config) {
  const fields = ["Test", ...Object.values(healthFields)];
  requireProof(Object.keys(config ?? {}).every(key => fields.includes(key)), "COMPOSE_HEALTH_FIELD_UNKNOWN");
  const result = { Test: argv(config?.Test) };
  for (const field of Object.values(healthFields)) {
    const value = config?.[field] ?? 0;
    requireProof(Number.isSafeInteger(value) && value >= 0, "COMPOSE_HEALTH_METADATA_INVALID");
    result[field] = value;
  }
  return result;
}
function expectedHealth(definition, image) {
  const health = healthDefinition(image.Healthcheck);
  const override = definition.healthcheck ?? {};
  requireProof(Object.keys(override).every(key => ["test", "disable", ...Object.keys(healthFields)].includes(key)), "COMPOSE_HEALTH_FIELD_UNKNOWN");
  if (override.disable === true) health.Test = ["NONE"];
  else if (override.test != null) health.Test = argv(override.test).map(composeText);
  for (const [key, field] of Object.entries(healthFields)) {
    if (override[key] != null) health[field] = key === "retries" ? Number(override[key]) : duration(override[key]);
  }
  return healthDefinition(health);
}

export function readImageDefinitions(docker, references) {
  // Full image metadata stays private in process memory.
  let rows;
  try { rows = JSON.parse(docker(["image", "inspect", ...references])); }
  catch { throw new Error("unexpected image metadata"); }
  requireProof(Array.isArray(rows) && rows.length === references.length, "missing image metadata");
  const result = new Map();
  for (const row of rows) {
    requireProof(imageId.test(row?.Id) && row.Config && !result.has(row.Id), "unexpected image metadata");
    result.set(row.Id, row);
  }
  return result;
}

export function readImageDefinition(docker, reference) {
  return readImageDefinitions(docker, [reference]).values().next().value;
}

function admittedPolicy(definition) {
  const policy = desiredPolicy(definition);
  requireProof(Number.isSafeInteger(policy.memory) && policy.memory > 0 &&
    Number.isSafeInteger(policy.swap) && policy.swap >= policy.memory &&
    Number.isSafeInteger(policy.pids) && policy.pids > 0 &&
    policy.logging.Type === "local" &&
    equal(policy.logging.Config, { "max-size": "10m", "max-file": "3" }),
  "COMPOSE_POLICY_NOT_ADMITTED");
  return policy;
}

export function verifyResourcePolicy(definition, row) {
  same(effectivePolicy(row), admittedPolicy(definition), "COMPOSE_EFFECTIVE_POLICY_MISMATCH");
}

// Native Engine 29 Linux execution contract of the canonical Compose model.
// Any unreviewed field is a rejection, not a silently assumed engine default.
const maskedPaths = ["/proc/acpi","/proc/asound","/proc/interrupts","/proc/kcore","/proc/keys","/proc/latency_stats","/proc/sched_debug","/proc/scsi","/proc/timer_list","/proc/timer_stats","/sys/devices/virtual/powercap","/sys/firmware"];
const readonlyPaths = ["/proc/bus","/proc/fs","/proc/irq","/proc/sys","/proc/sysrq-trigger"];
const hostDefaults = {
  ContainerIDFile:"", AutoRemove:false, VolumeDriver:"", CgroupnsMode:"private", IpcMode:"private",
  Cgroup:"", OomScoreAdj:0, PidMode:"", PublishAllPorts:false, UTSMode:"", UsernsMode:"",
  ShmSize:67108864, Runtime:"runc", Isolation:"", CpuShares:0, NanoCpus:0, CgroupParent:"",
  BlkioWeight:0, CpuPeriod:0, CpuQuota:0, CpuRealtimePeriod:0, CpuRealtimeRuntime:0,
  CpusetCpus:"", CpusetMems:"", MemoryReservation:0, CpuCount:0, CpuPercent:0, IOMaximumIOps:0,IOMaximumBandwidth:0,
};
const emptyHostLists = ["VolumesFrom","Dns","DnsOptions","DnsSearch","ExtraHosts","GroupAdd","Links",
  "BlkioWeightDevice","BlkioDeviceReadBps","BlkioDeviceWriteBps","BlkioDeviceReadIOps","BlkioDeviceWriteIOps",
  "Devices","DeviceCgroupRules","DeviceRequests","Ulimits","Mounts"];
const hostFields = new Set([...Object.keys(hostDefaults),...emptyHostLists,
  "Binds","LogConfig","NetworkMode","PortBindings","RestartPolicy","ConsoleSize","CapAdd","CapDrop",
  "Privileged","ReadonlyRootfs","SecurityOpt","Memory","MemorySwap","MemorySwappiness","OomKillDisable",
  "PidsLimit","MaskedPaths","ReadonlyPaths","Init","Tmpfs","Sysctls","StorageOpt"]);
const configFields = new Set(["Hostname","Domainname","User","AttachStdin","AttachStdout","AttachStderr","ExposedPorts",
  "Tty","OpenStdin","StdinOnce","Env","Cmd","Healthcheck","Image","Volumes","WorkingDir","Entrypoint","Labels","StopSignal"]);
const endpointFields = new Set(["IPAMConfig","Links","Aliases","DriverOpts","GwPriority","NetworkID","EndpointID",
  "Gateway","IPAddress","MacAddress","IPPrefixLen","IPv6Gateway","GlobalIPv6Address","GlobalIPv6PrefixLen","DNSNames"]);
const plain = value => value !== null && typeof value === "object" && !Array.isArray(value);
const emptyMap = value => value == null || (plain(value) && Object.keys(value).length === 0);
const emptyList = value => value == null || (Array.isArray(value) && value.length === 0);
const knownFields = (value,fields) => plain(value) && Object.keys(value).every(key=>fields.has(key));
function expectedMounts(model,definition) {
  return orderedMounts((definition.volumes ?? []).map(volume=>{
    requireProof(knownFields(volume,new Set(["type","source","target","read_only","volume"])) &&
      volume.type==="volume" && model.volumes[volume.source]?.name &&
      (volume.read_only==null || typeof volume.read_only==="boolean") && emptyMap(volume.volume),"COMPOSE_VOLUME_NOT_ADMITTED");
    return {target:volume.target,name:model.volumes[volume.source].name,writable:!volume.read_only};
  }),volume=>volume.target);
}
function verifyMountDefinition(model,definition,row,service) {
  const expected=expectedMounts(model,definition);
  const live=orderedMounts(row.Mounts.map(mount=>{
    requireProof(knownFields(mount,new Set(["Type","Name","Source","Destination","Driver","Mode","RW","Propagation"])) &&
      mount.Type==="volume" && mount.Driver==="local" && typeof mount.Source==="string" && mount.Source.length>0 &&
      typeof mount.RW==="boolean" && mount.Mode===(mount.RW?"rw":"ro") && mount.Propagation==="","COMPOSE_VOLUME_DRIVER_MISMATCH "+service);
    return {target:mount.Destination,name:mount.Name,writable:mount.RW};
  }),volume=>volume.target);
  same(live,expected,"COMPOSE_VOLUME_MISMATCH "+service);
  same(orderedText(row.HostConfig.Binds ?? []),orderedText(expected.map(m=>[m.name,m.target,m.writable?"rw":"ro"].join(":"))),
    "COMPOSE_BIND_DEFINITION_MISMATCH "+service);
}
function expectedPortBindings(definition) {
  const result={};
  for(const port of definition.ports ?? []) {
    requireProof(knownFields(port,new Set(["mode","host_ip","target","published","protocol"])) &&
      (port.mode==null || port.mode==="ingress") && port.protocol==="tcp" && Number.isInteger(port.target) &&
      port.target>0 && port.target<=65535 && /^[1-9][0-9]{0,4}$/.test(String(port.published)) &&
      Number(port.published)<=65535 && port.host_ip==="127.0.0.1","COMPOSE_PORT_NOT_ADMITTED");
    const key=String(port.target)+"/tcp";
    result[key] ??= [];
    result[key].push({HostIp:port.host_ip,HostPort:String(port.published)});
  }
  return result;
}
function endpointConfiguration(endpoint,row) {
  return {NetworkID:endpoint.NetworkID,Aliases:orderedText(endpoint.Aliases ?? []),
    IPAMConfig:endpoint.IPAMConfig ?? null,Links:endpoint.Links ?? null,DriverOpts:endpoint.DriverOpts ?? null,
    GwPriority:endpoint.GwPriority ?? 0,DNSNames:orderedText((endpoint.DNSNames ?? []).filter(name=>name!==row.Id?.slice(0,12)))};
}
function verifyEndpoint(endpoint,row,service,internal) {
  requireProof(knownFields(endpoint,endpointFields) && emptyMap(endpoint.IPAMConfig) && emptyList(endpoint.Links) &&
    emptyMap(endpoint.DriverOpts) && endpoint.GwPriority===0,"COMPOSE_ENDPOINT_POLICY_MISMATCH "+service);
  same(orderedText(endpoint.Aliases ?? []),orderedText([nameOf(service),service]),"COMPOSE_NETWORK_ALIAS_MISMATCH "+service);
  same(orderedText(endpoint.DNSNames ?? []),orderedText([nameOf(service),service,row.Id.slice(0,12)]),"COMPOSE_NETWORK_DNS_MISMATCH "+service);
  requireProof(hash.test(endpoint.NetworkID) && endpoint.IPv6Gateway==="" && endpoint.GlobalIPv6Address==="" &&
    endpoint.GlobalIPv6PrefixLen===0,"COMPOSE_NETWORK_IDENTITY_MISMATCH "+service);
  if(row.State?.Running) {
    requireProof(hash.test(endpoint.EndpointID) && isIPv4(endpoint.IPAddress) && /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/.test(endpoint.MacAddress) &&
      Number.isInteger(endpoint.IPPrefixLen) && endpoint.IPPrefixLen>0 && endpoint.IPPrefixLen<=32 &&
      (internal?endpoint.Gateway==="":isIPv4(endpoint.Gateway)),"COMPOSE_ENDPOINT_IDENTITY_UNPROVEN "+service);
  } else requireProof(endpoint.EndpointID==="" && endpoint.IPAddress==="" && endpoint.Gateway==="" &&
    endpoint.MacAddress==="" && endpoint.IPPrefixLen===0,"COMPOSE_STOPPED_ENDPOINT_MISMATCH "+service);
}
function verifyHostDefinition(model,definition,row,service) {
  const host=row.HostConfig;
  requireProof(knownFields(host,hostFields),"COMPOSE_HOST_FIELD_NOT_ADMITTED "+service);
  for(const [field,value] of Object.entries(hostDefaults)) same(host[field],value,"COMPOSE_HOST_DEFAULT_MISMATCH "+service+" "+field);
  for(const field of emptyHostLists) requireProof(emptyList(host[field]),"COMPOSE_HOST_FIELD_NOT_ADMITTED "+service+" "+field);
  requireProof(emptyMap(host.Tmpfs) && emptyMap(host.Sysctls) && emptyMap(host.StorageOpt) && host.MemorySwappiness==null &&
    (host.OomKillDisable==null || host.OomKillDisable===false) && (host.Init==null || host.Init===false),"COMPOSE_HOST_DEFAULT_MISMATCH "+service);
  same(host.ConsoleSize,[0,0],"COMPOSE_HOST_DEFAULT_MISMATCH "+service);
  same(orderedText(host.MaskedPaths ?? []),orderedText(maskedPaths),"COMPOSE_MASKED_PATHS_MISMATCH "+service);
  same(orderedText(host.ReadonlyPaths ?? []),orderedText(readonlyPaths),"COMPOSE_READONLY_PATHS_MISMATCH "+service);
  requireProof(host.Privileged===Boolean(definition.privileged) && host.ReadonlyRootfs===Boolean(definition.read_only) &&
    equal(host.RestartPolicy,{Name:definition.restart,MaximumRetryCount:0}) &&
    equal(orderedText(host.CapDrop ?? []),orderedText(definition.cap_drop ?? [])) &&
    equal(orderedText(host.CapAdd ?? []),orderedText(definition.cap_add ?? [])) &&
    equal(orderedText(host.SecurityOpt ?? []),orderedText(definition.security_opt ?? [])),"COMPOSE_SECURITY_POLICY_MISMATCH "+service);
  const networks=Object.entries(definition.networks ?? {}).map(([key,options])=>{
    requireProof(emptyMap(options) && model.networks[key]?.name,"COMPOSE_NETWORK_DEFINITION_UNPROVEN "+service);
    return model.networks[key];
  });
  const names=networks.map(network=>network.name);
  same(orderedText(Object.keys(row.NetworkSettings.Networks)),orderedText(names),"COMPOSE_NETWORK_MISMATCH "+service);
  same(host.NetworkMode,names[0] ?? "default","COMPOSE_NETWORK_MODE_MISMATCH "+service);
  for(const network of networks) verifyEndpoint(row.NetworkSettings.Networks[network.name],row,service,Boolean(network.internal));
  same(host.PortBindings ?? {},expectedPortBindings(definition),"COMPOSE_PORT_MISMATCH "+service);
  verifyMountDefinition(model,definition,row,service);
}
export function verifyLiveDefinition(model,service,row,image) {
  const definition=model.services[service],config=row.Config;
  requireProof(image?.Id===row.Image && imageId.test(image?.Id) && image.Config && hash.test(row.Id),"COMPOSE_IMAGE_DEFINITION_UNPROVEN");
  const defaults=image.Config;
  const admitted=new Set(["restart","cap_drop","cap_add","command","entrypoint","environment","image","labels","logging","mem_limit","memswap_limit","networks","pids_limit","read_only","security_opt","volumes","build","depends_on","healthcheck","ports","user","working_dir","stop_signal","hostname","privileged"]);
  requireProof(knownFields(definition,admitted),"COMPOSE_UNSUPPORTED_DEFINITION_FIELD");
  verifyHostDefinition(model,definition,row,service);
  requireProof(knownFields(config,configFields) && config.Domainname==="" && config.AttachStdin===false &&
    config.AttachStdout===true && config.AttachStderr===true && config.Tty===false && config.OpenStdin===false &&
    config.StdinOnce===false && typeof config.Image==="string" && config.Image.length>0,"COMPOSE_PROCESS_DEFAULT_MISMATCH "+service);
  const exposed={...defaults.ExposedPorts};
  for(const port of Object.keys(expectedPortBindings(definition))) exposed[port]={};
  same(config.ExposedPorts ?? {},exposed,"COMPOSE_EXPOSED_PORTS_MISMATCH "+service);
  same(config.Volumes ?? {},defaults.Volumes ?? {},"COMPOSE_IMAGE_VOLUME_MISMATCH "+service);
  const expectedEnv=configEnv(defaults);
  for(const [key,value] of Object.entries(definition.environment ?? {})) {
    requireProof(typeof value==="string","COMPOSE_ENVIRONMENT_VALUE_UNPROVEN");
    Object.defineProperty(expectedEnv,key,{value:composeText(value),enumerable:true,configurable:true,writable:true});
  }
  same(configEnv(config),expectedEnv,"COMPOSE_ENVIRONMENT_MISMATCH "+service);
  const entrypoint=definition.entrypoint==null?argv(defaults.Entrypoint):argv(definition.entrypoint).map(composeText);
  const command=definition.command==null?(definition.entrypoint==null?argv(defaults.Cmd):[]):argv(definition.command).map(composeText);
  same(argv(config.Entrypoint),entrypoint,"COMPOSE_ENTRYPOINT_MISMATCH "+service);
  same(argv(config.Cmd),command,"COMPOSE_COMMAND_MISMATCH "+service);
  for(const [key,field] of [["user","User"],["working_dir","WorkingDir"],["stop_signal","StopSignal"]])
    same(config[field] ?? "",definition[key]==null?defaults[field] ?? "":composeText(definition[key]),"COMPOSE_PROCESS_FIELD_MISMATCH "+service+" "+field);
  same(healthDefinition(config.Healthcheck),expectedHealth(definition,defaults),"COMPOSE_HEALTHCHECK_MISMATCH "+service);
  const expectedLabels=Object.fromEntries(Object.entries({...defaults.Labels,...definition.labels}).filter(([key])=>!key.startsWith("com.docker.compose.")));
  const labels=Object.fromEntries(Object.entries(config.Labels ?? {}).filter(([key])=>!key.startsWith("com.docker.compose.")));
  same(labels,expectedLabels,"COMPOSE_LABEL_MISMATCH "+service);
  same(config.Hostname,definition.hostname ?? row.Id.slice(0,12),"COMPOSE_HOSTNAME_MISMATCH "+service);
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
  const image = readImageDefinition(docker, source.model.services[service].image);
  requireProof(image.Id === row.Image, `COMPOSE_IMAGE_REFERENCE_MISMATCH ${service}`);
  verifyLiveDefinition(source.model, service, row, image);
}

function ipv4Number(address) {
  requireProof(isIPv4(address),"COMPOSE_IPV4_IDENTITY_INVALID");
  return address.split(".").reduce((value,octet)=>value*256+Number(octet),0);
}
function poolIdentity(pool) {
  const [address,prefix,...rest]=String(pool?.Subnet).split("/");
  requireProof(knownFields(pool,new Set(["Subnet","Gateway"])) && isIPv4(address) &&
    /^[1-9][0-9]?$/.test(prefix) && Number(prefix)<=32 && rest.length===0 && isIPv4(pool.Gateway),
  "COMPOSE_NETWORK_POLICY_UNPROVEN");
  const size=2**(32-Number(prefix)), base=ipv4Number(address), gateway=ipv4Number(pool.Gateway);
  requireProof(base%size===0 && gateway>base && gateway<base+size-1,"COMPOSE_NETWORK_POOL_UNPROVEN");
  return {base,size,prefix:Number(prefix),gateway:pool.Gateway};
}
function composeResourceLabels(labels,kind,key) {
  const expected=new Set(["com.docker.compose.project","com.docker.compose."+kind,
    "com.docker.compose.config-hash","com.docker.compose.version"]);
  requireProof(knownFields(labels,expected) && labels["com.docker.compose.project"]===project &&
    labels["com.docker.compose."+kind]===key && hash.test(labels["com.docker.compose.config-hash"]) &&
    typeof labels["com.docker.compose.version"]==="string" && labels["com.docker.compose.version"].length>0,
  "COMPOSE_RESOURCE_OWNER_UNPROVEN");
}
function networkPolicy(key,definition,row) {
  requireProof(knownFields(definition,new Set(["name","driver","internal","ipam"])) && definition.driver==="bridge" &&
    emptyMap(definition.ipam) && hash.test(row.Id) && row.Driver==="bridge" && row.Internal===Boolean(definition.internal) &&
    row.Scope==="local" && row.EnableIPv4===true && row.EnableIPv6===false && row.Attachable===false &&
    row.Ingress===false && row.ConfigOnly===false && equal(row.ConfigFrom,{Network:""}) &&
    equal(row.Options,{"com.docker.network.enable_ipv4":"true","com.docker.network.enable_ipv6":"false"}) &&
    knownFields(row.IPAM,new Set(["Driver","Options","Config"])) && row.IPAM.Driver==="default" &&
    emptyMap(row.IPAM.Options) && Array.isArray(row.IPAM.Config) && row.IPAM.Config.length===1 &&
    Number.isFinite(Date.parse(row.Created)) && plain(row.Containers),"COMPOSE_NETWORK_IDENTITY_UNPROVEN");
  composeResourceLabels(row.Labels,"network",key);
  poolIdentity(row.IPAM.Config[0]);
  return {id:row.Id,created:row.Created,ipam:row.IPAM,labels:row.Labels,options:row.Options};
}
// Replacement can change endpoint identities but never persistent resources.
export function resourceIdentities(docker,model) {
  const volumes=Object.values(model.volumes ?? {}).map(volume=>volume.name);
  const networks=Object.values(model.networks ?? {}).map(network=>network.name);
  const inspect=(kind,names)=>{
    if(!names.length)return [];
    let records;
    try{records=JSON.parse(docker([kind,"inspect",...names]));}
    catch{throw new Error("COMPOSE_RESOURCE_INSPECT_UNPROVEN");}
    requireProof(Array.isArray(records)&&records.length===names.length,"COMPOSE_RESOURCE_INVENTORY_MISMATCH");
    return records;
  };
  const storage=Object.fromEntries(inspect("volume",volumes).map(volume=>{
    const entry=Object.entries(model.volumes).find(([,def])=>def.name===volume.Name);
    requireProof(entry && knownFields(entry[1],new Set(["name","external"])) &&
      volume.Driver==="local" && volume.Scope==="local" && emptyMap(volume.Options) &&
      Number.isFinite(Date.parse(volume.CreatedAt)) && typeof volume.Mountpoint==="string" &&
      volume.Mountpoint.startsWith("/") && volume.Mountpoint.length>1,"COMPOSE_VOLUME_IDENTITY_UNPROVEN");
    if(!entry[1].external) composeResourceLabels(volume.Labels,"volume",entry[0]);
    return [volume.Name,[volume.CreatedAt,volume.Driver,volume.Mountpoint,volume.Labels]];
  }));
  const networkRecords=inspect("network",networks);
  const network=Object.fromEntries(networkRecords.map(row=>{
    const entry=Object.entries(model.networks).find(([,def])=>def.name===row.Name);
    requireProof(entry,"COMPOSE_NETWORK_IDENTITY_UNPROVEN");
    return [row.Name,networkPolicy(entry[0],entry[1],row)];
  }));
  const peers=Object.fromEntries(networkRecords.map(row=>[row.Name,row.Containers]));
  requireProof(Object.keys(storage).length===volumes.length && Object.keys(network).length===networks.length,"COMPOSE_RESOURCE_IDENTITY_DUPLICATE");
  return {storage,network,peers};
}
export function verifyServiceAttachments(service,row,identities,model,rows) {
  for(const [name,endpoint] of Object.entries(row.NetworkSettings.Networks)) {
    requireProof(hash.test(endpoint.NetworkID) && endpoint.NetworkID===identities.network[name]?.id,"COMPOSE_NETWORK_IDENTITY_MISMATCH "+service);
    const key=Object.keys(model.networks).find(k=>model.networks[k].name===name);
    const members=Object.entries(model.services).filter(([,def])=>Object.hasOwn(def.networks ?? {},key))
      .map(([owner])=>rows.find(candidate=>candidate.Name==="/"+nameOf(owner)));
    requireProof(members.every(Boolean),"COMPOSE_NETWORK_MEMBER_MISSING "+service);
    const running=members.filter(candidate=>candidate.State.Running);
    requireProof(new Set(running.map(candidate=>candidate.Id)).size===running.length,"COMPOSE_NETWORK_MEMBER_DUPLICATE "+service);
    const pool=poolIdentity(identities.network[name].ipam.Config[0]);
    const expected=Object.fromEntries(running.map(candidate=>{
      const connection=candidate.NetworkSettings.Networks[name];
      requireProof(connection && isIPv4(connection.IPAddress),"COMPOSE_NETWORK_MEMBER_MISSING "+service);
      const address=ipv4Number(connection.IPAddress);
      requireProof(address>pool.base && address<pool.base+pool.size-1 && connection.IPAddress!==pool.gateway &&
        connection.IPPrefixLen===pool.prefix && connection.Gateway===(model.networks[key].internal?"":pool.gateway),
      "COMPOSE_NETWORK_MEMBER_ADDRESS_MISMATCH "+service);
      return [candidate.Id,{Name:candidate.Name.slice(1),EndpointID:connection.EndpointID,MacAddress:connection.MacAddress,
        IPv4Address:connection.IPAddress+"/"+connection.IPPrefixLen,IPv6Address:""}];
    }));
    same(identities.peers[name],expected,"COMPOSE_NETWORK_PEER_MISMATCH "+service);
  }
  for(const mount of row.Mounts)
    requireProof(mount.Source===identities.storage[mount.Name]?.[2],"COMPOSE_STORAGE_IDENTITY_MISMATCH "+service);
}
function verifyAttachments(rows,identities,model) {
  for(const service of services)verifyServiceAttachments(service,rows[service],identities,model,Object.values(rows));
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
  const attestOnly = previous === null && apply === false;
  requireProof(attestOnly || (/^[a-f0-9]{40}$/.test(previous) && previous !== head), "COMPOSE_PREVIOUS_REVISION_REQUIRED");
  const current = git(["show", `${head}:infra/compose.yaml`]);
  const variants = [];
  if (!attestOnly) {
    git(["merge-base", "--is-ancestor", previous, head]);
    const prior = git(["show", `${previous}:infra/compose.yaml`]);
    const marker = /^ {2}com\.bthwani\.worktree: samrim-refoundation-clean-20261112\r?\n/gm;
    variants.push(prior);
    if ([...prior.matchAll(marker)].length === 1) variants.push(prior.replace(marker, ""));
  }
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
  verifyAttachments(state, identities,next.model);
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
  const unchangedResources = rows => {
    const current=resourceIdentities(docker,next.model);
    same({storage:current.storage,network:current.network},{storage:identities.storage,network:identities.network},"COMPOSE_RESOURCE_IDENTITY_CHANGED");
    verifyAttachments(rows,current,next.model);
  };
  ensureSource();
  ownerReadback(state);
  const observed = healthyInventory(docker);
  verifyUnchanged(state, observed);
  unchangedResources(observed);
  ensureSource();
  if (!apply) {
    if (attestOnly) console.log(`COMPOSE_SERVING_BASELINE_PASS HEAD=${head}`);
    else console.log(`COMPOSE_CONFIGURATION_PLAN_PASS HEAD=${head} PREVIOUS=${previous} SELECTED=${[...plan.keys()].join(",") || "NONE"}`);
    return;
  }

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