import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from 'node:url';
import { main, verifyCandidate } from "../../tools/dev/docker/verify-runtime-provenance.mjs";

const canonicalCompose = fileURLToPath(new URL('../../infra/compose.yaml', import.meta.url));

const head = "a".repeat(40);
const successor = "b".repeat(40);
const ownerNames = ["dsh", "identity", "wlt"];
const foundations = ["postgres", "media", "mailpit", "payment-mock"];
const allServices = [...ownerNames, ...foundations];
const memory = { postgres: 2147483648, media: 1610612736, mailpit: 268435456, "payment-mock": 805306368, dsh: 536870912, identity: 536870912, wlt: 536870912 };
const pids = service => ["postgres", "media"].includes(service) ? 512 : 256;
const capability = service => ({ dsh: "customer-store-catalog", identity: "identity-synthetic-session-verifier", wlt: "customer-wallet-read-only" }[service] ?? "");
const logOptions = { "max-file": "3", "max-size": "10m" };
const policy = service => ({
  mem_limit: String(memory[service]), pids_limit: pids(service),
  logging: { driver: "local", options: logOptions }, restart: "unless-stopped",
  read_only: ownerNames.includes(service), cap_drop: ownerNames.includes(service) ? ["ALL"] : [],
  security_opt: ownerNames.includes(service) ? ["no-new-privileges:true"] : [],
  labels: { "com.bthwani.capability": capability(service), "com.bthwani.environment": "refoundation", "com.bthwani.worktree": "samrim-refoundation-clean-20261112" },
});
const hashFor = (service, historic = false) => String(foundations.indexOf(service) + (historic ? 5 : 1)).repeat(64);
const imageRef = service => service === "payment-mock" ? "bthwani/payment-mock:local" : service + "@sha256:" + hashFor(service);
const args = ["--context", "bthwani-docker"];
const name = owner => "bthwani-refoundation-" + owner + "-1";

function fixture(options = {}) {
  const calls = [];
  let sourceReads = 0, containerReads = 0;
  const imageFor = owner => "sha256:" + String(allServices.indexOf(owner) + 1).repeat(64);
  const imageForOwner = (owner, id = imageFor(owner)) => {
    const o = { id, revision: head, source: head, previewBase: "", previewDigest: "", ...options.images?.[owner] };
    const labels = ownerNames.includes(owner) ? Object.fromEntries(Object.entries({
      "org.opencontainers.image.revision": o.revision,
      "com.bthwani.source-sha": o.source,
      "com.bthwani.preview-base": o.previewBase,
      "com.bthwani.preview-digest": o.previewDigest,
    }).filter(([,value]) => value)) : {};
    return { Id: o.id, Config: { Env: [], Labels: labels, Cmd: null, Entrypoint: ["/fixture"],
      User: ownerNames.includes(owner) ? "65532:65532" : "", Healthcheck: { Test: ["CMD", "/fixture", "health"] } } };
  };
  const containerFor = (owner, pass) => {
    const o = {
      id: String(allServices.indexOf(owner) + 1).repeat(64),
      name: "/" + name(owner), image: imageFor(owner), project: "bthwani-refoundation",
      service: owner, environment: "refoundation", capability: capability(owner),
      running: "true", state: "running", health: "healthy",
      startedAt: "2026-11-26T02:00:00.123456789Z", restartCount: "0",
      configHash: foundations.includes(owner) ? hashFor(owner) : "a".repeat(64),
      worktree: "samrim-refoundation-clean-20261112", configFiles: canonicalCompose, privileged: "false",
      memory: memory[owner], pids: pids(owner), logging: { Type: "local", Config: logOptions }, restart: "unless-stopped",
      readOnly: ownerNames.includes(owner), capDrop: ownerNames.includes(owner) ? ["ALL"] : null,
      security: ownerNames.includes(owner) ? ["no-new-privileges:true"] : null, capAdd: null, user: ownerNames.includes(owner) ? "65532:65532" : "",
      ...options.containers?.[owner], ...(pass === 2 ? options.finalContainers?.[owner] : {}),
    };
    const definition = model.services[owner], image = imageForOwner(owner, o.image);
    const labels = { ...image.Config.Labels, ...definition.labels, "com.docker.compose.project": o.project,
      "com.docker.compose.service": o.service, "com.docker.compose.config-hash": o.configHash,
      "com.docker.compose.project.config_files": o.configFiles, "com.bthwani.environment": o.environment,
      "com.bthwani.capability": o.capability, "com.bthwani.worktree": o.worktree };
    if (!o.worktree) delete labels["com.bthwani.worktree"];
    const env = { ...definition.environment, ...(owner === "dsh" ? options.seedEnvironment : {}) };
    const networks = Object.fromEntries(Object.keys(definition.networks ?? {}).map(key => [
      model.networks[key].name, { NetworkID: key === "isolated" ? (owner === "dsh" ? options.seedNetwork ?? "e".repeat(64) : "e".repeat(64)) : "f".repeat(64), Aliases: [owner] },
    ]));
    const row = {
      Id: o.id, Name: o.name, Image: o.image, RestartCount: /^\d+$/.test(o.restartCount) ? Number(o.restartCount) : o.restartCount,
      State: { Running: o.running === "true" ? true : o.running === "false" ? false : o.running,
        Status: o.state, Health: { Status: o.health }, StartedAt: o.startedAt },
      Config: { ...image.Config, User: o.user, Labels: labels, Env: Object.entries(env).map(([key,value]) => key+"="+value) },
      HostConfig: { Memory: o.memory, MemorySwap: o.memory * 2, PidsLimit: o.pids, LogConfig: o.logging,
        Privileged: o.privileged === "true", ReadonlyRootfs: o.readOnly, RestartPolicy: { Name: o.restart },
        CapDrop: o.capDrop, CapAdd: o.capAdd, SecurityOpt: o.security, PortBindings: {} },
      Mounts: options.withVolume && owner === "media" ? [{Type:"volume",Driver:"local",Name:"fixture-media",Destination:"/data",Source:"/var/lib/docker/volumes/fixture-media/_data",RW:true}] : [], NetworkSettings: { Networks: networks },
      ...options.seedRecords?.[owner],
    };
    options.actualMutations?.[owner]?.(row);
    if (pass === 2) options.finalMutations?.[owner]?.(row);
    return row;
  };
  const seedEnv = {
    DSH_DB_HOST: "postgres", REF_POSTGRES_DB: "bthwani_dsh_dev",
    REF_POSTGRES_USER: "bthwani_dsh_runtime", DSH_DB_SCHEMA: "dsh_test_retained",
    REF_POSTGRES_PASSWORD: "synthetic-fixture", BTHWANI_ISOLATED_TEST_MODE: "true",
    BTHWANI_ISOLATED_CONTAINER_MODE: "true",
  };
  const model = {
    name: "bthwani-refoundation",
    volumes: options.withVolume ? { media: { name:"fixture-media" } } : {},
    networks: { isolated: { name: "bthwani-refoundation_isolated", driver:"bridge", internal:true }, loopback: { name: "bthwani-refoundation_loopback", driver:"bridge", internal:false } },
    services: Object.fromEntries(allServices.map(service => [service, {
      ...policy(service), image: imageRef(service),
      ...(options.withVolume && service === "media" ? {volumes:[{type:"volume",source:"media",target:"/data"}]} : {}),
      ...(service === "dsh" ? { environment: seedEnv, networks: { isolated: {}, loopback: {} } } :
        service === "postgres" ? { networks: { isolated: {} } } : {}),
    }])),
  };

  const execute = (command, a, input) => {
    calls.push([command, ...a]);
    if (command === "docker" && a[0] === "context") return options.context ?? "ssh://user@bthwani-docker";
    if (command === "git") {
      if (a[0] === "rev-parse") return ++sourceReads === 2 ? options.finalHead ?? head : options.head ?? head;
      if (a[0] === "branch") return sourceReads === 2 ? options.finalBranch ?? "development" : options.branch ?? "development";
      if (a[0] === "status") return sourceReads === 2 ? options.finalStatus ?? options.status ?? "" : options.status ?? "";
      if (a[0] === "diff") {
        const owner = a.find(part => part.startsWith("services/")).split("/")[1];
        return (options.changes?.[owner] ?? []).map(path => path + "\0").join("");
      }
    }
    if (command === "docker" && a[0] === "--context" && a[1] === "bthwani-docker") {
      if (a[2] === "ps") return (options.inventory ?? allServices).map(name).join("\n");
      if (a[2] === "compose") {
        if (a.includes("--hash")) return foundations.map(service => service + " " + hashFor(service, !input.includes("  com.bthwani.worktree: samrim-refoundation-clean-20261112"))).join("\n");
        if (a.includes("--format")) return JSON.stringify(model);
      }
      if (a[2] === "inspect") {
        containerReads++;
        if (options.badContainer === "malformed") return "bad";
        const list = options.badContainer === "missing" ? allServices.slice(0, -1) :
          options.badContainer === "duplicate" ? [...allServices.slice(0, -1), "dsh"] : allServices;
        return JSON.stringify(list.map(owner => containerFor(owner, containerReads)));
      }
      if (a[2] === "volume" && a[3] === "inspect") return JSON.stringify(a.slice(4).map(Name => ({Name,Driver:"local",CreatedAt: containerReads === 2 && options.changedVolume ? "2026-11-27" : "2026-11-26",Mountpoint:"/var/lib/docker/volumes/fixture-media/_data"})));
      if (a[2] === "network" && a[3] === "inspect") return JSON.stringify(a.slice(4).map(name => ({Name:name,Id:name.endsWith("_isolated")?"e".repeat(64):"f".repeat(64),Driver:"bridge",Internal:name.endsWith("_isolated")})));
      if (a[2] === "image" && a[3] === "inspect") {
        if (a[5] === "{{.Id}}") return foundations.map(imageFor).join("\n");
        if (options.badImage === "malformed") return "bad";
        const list = options.badImage === "missing" ? allServices.slice(0, -1) :
          options.badImage === "duplicate" ? [...allServices.slice(0, -1), "dsh"] : allServices;
        return JSON.stringify(list.map(owner => imageForOwner(owner, options.containers?.[owner]?.image ?? imageFor(owner))));
      }
    }
    throw new Error("unexpected verification command");
  };
  return {
    calls, execute,
    ancestor: (revision, candidate) => {
      assert.match(revision, /^[0-9a-f]{40}$/);
      assert.equal(candidate, options.head ?? head);
      return options.ancestor ?? true;
    },
  };
}

function run(options, preflight = false) {
  const f = fixture(options);
  const result = verifyCandidate(preflight ? [...args, "--start-preflight"] : args, f.execute, f.ancestor);
  return { ...f, result };
}

function rejectOwner(options, owner = "dsh", reason, preflight = false) {
  const { result } = run(options, preflight);
  assert.equal(result.passed, false);
  const row = result.results.find(r => r.owner === owner);
  assert.equal(row.passed, false);
  if (reason) assert.ok(row.errors.some(e => e.includes(reason)), row.errors.join("; "));
}

test("one committed candidate checks all three actual owner names and rechecks the same window", () => {
  const { result, calls } = run();
  assert.equal(result.head, head);
  assert.equal(result.passed, true);
  assert.deepEqual(result.results.map(r => r.owner), ownerNames);
  const snapshots = calls.filter(c => c[0] === "docker" && c[3] === "inspect");
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) {
    assert.deepEqual(snapshot.slice(-7), allServices.map(name));
    assert.ok(snapshot.includes("--type"));
    assert.ok(!snapshot.join(" ").includes(".Config.Env"));
  }
  const images = calls.filter(c => c[0] === "docker" && c[3] === "image" && !c.includes("--format"));
  assert.equal(images.length, 1);
  assert.equal(images[0].slice(5).length, 7);
  const statuses = calls.filter(c => c[0] === "git" && c[1] === "status");
  assert.equal(statuses.length, 2);
  for (const status of statuses) {
    assert.ok(status.includes("--untracked-files=all"));
    assert.ok(status.includes("-z"));
    assert.ok(status.includes("--no-renames"));
    assert.deepEqual(status.slice(status.indexOf("--")+1), ["services/dsh", ".go-version", "services/identity", "services/wlt", "infra/compose.yaml"]);
  }
  const diffs = calls.filter(c => c[0] === "git" && c[1] === "diff");
  assert.equal(diffs.length, 3);
  assert.deepEqual(diffs.map(d => d.slice(d.indexOf("--")+1)), ownerNames.map(o => ["services/" + o, ".go-version"]));
  assert.ok(diffs.every(d => d.includes("-z") && d.includes("--no-renames")));
});

test("a HEAD or branch change cannot print a successful attestation for a superseded candidate", () => {
  for (const change of [{ finalHead: successor }, { finalBranch: "different-branch" }]) {
    const f = fixture(change);
    assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
  }
});

test("owner changes appearing during attestation invalidate the candidate", () => {
  const f = fixture({ finalStatus: "?? services/dsh/backend/internal/new.go\0" });
  assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
});

test("replacement or restart of a serving container invalidates the entire snapshot", () => {
  for (const changes of [
    { id: "9".repeat(64) },
    { image: "sha256:" + "9".repeat(64) },
    { restartCount: "1" },
    { startedAt: "2026-11-26T02:05:00Z" },
    { health: "unhealthy" },
  ]) {
    const f = fixture({ finalContainers: { wlt: changes } });
    assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
  }
});

test("changed Go, SQL, contract and Docker inputs reject owner parity; committed non-runtime inputs do not", () => {
  for (const owner of ownerNames) {
    const p = "services/" + owner + "/";
    const nonRuntime = [p + "backend/cmd/" + owner + "/main_test.go", p + "README.md",
      p + "backend/README.md", p + "clients/public-client.ts"];
    for (const preflight of [false, true]) {
      assert.equal(run({ changes: { [owner]: nonRuntime } }, preflight).result.passed, true);
      for (const path of [p + "backend/cmd/" + owner + "/main.go", p + "database/schema/00.sql",
        p + "contracts/openapi/" + owner + ".openapi.yaml", p + ".dockerignore"]) {
        rejectOwner({ changes: { [owner]: [...nonRuntime, path] } }, owner, "owner source changed", preflight);
      }
    }
  }
});

test("dirty owner files including untracked files fail even if the image labels match", () => {
  for (const status of [" M services/identity/backend/main.go\0", "?? services/identity/backend/untracked.go\0"]) {
    rejectOwner({ status }, "identity", "owner worktree is not clean");
  }
  rejectOwner({ ancestor: false }, "dsh", "source is not an ancestor");
  const { calls } = run({ ancestor: false });
  assert.ok(!calls.some(c => c[0] === "git" && c[1] === "diff"));
});

test("unknown or contradictory image provenance and previews fail closed", () => {
  for (const changes of [
    { revision: "", source: "" },
    { revision: "unsafe", source: "" },
    { revision: head, source: successor },
    { revision: head, previewBase: head },
    { revision: head, previewDigest: "f".repeat(64) },
    { revision: head, previewBase: head, previewDigest: "f".repeat(64) },
    { revision: "worktree-" + "f".repeat(64), source: "", previewBase: head, previewDigest: "f".repeat(64) },
  ]) rejectOwner({ images: { dsh: changes } });
  const { calls } = run({ images: { dsh: { revision: "unsafe", source: "" } } });
  assert.ok(!calls.some(c => c[0] === "git" && c[1] === "diff" && c.includes("services/dsh")));
});

test("a healthy-looking foreign container and wrong WLT capability are rejected", () => {
  for (const changes of [{ project: "donor" }, { service: "identity" }, { environment: "production" }, { environment: "" }]) {
    rejectOwner({ containers: { dsh: changes } }, "dsh", "not the expected isolated");
  }
  rejectOwner({ containers: { wlt: { capability: "other" } } }, "wlt", "not the expected isolated");
});

test("unhealthy, stopped, contradictory, or malformed lifecycle metadata is not acceptance", () => {
  for (const changes of [{ health: "NOT_CONFIGURED" }, { health: "unhealthy" },
    { running: "false", state: "exited" }, { running: "true", state: "exited" }]) {
    rejectOwner({ containers: { dsh: changes } }, "dsh", "container state or health not proven");
  }
  for (const changes of [{ id: "" }, { image: "sha256:invalid" }, { running: "unknown" },
    { startedAt: "" }, { restartCount: "invalid" }]) {
    assert.throws(() => run({ containers: { dsh: changes } }), /invalid container identity or lifecycle metadata/);
  }
});

test("missing, duplicate, or malformed owner/image records block the whole candidate", () => {
  for (const bad of ["missing", "duplicate", "malformed"]) {
    assert.throws(() => run({ badContainer: bad }), /(?:missing|unexpected) container metadata/);
    assert.throws(() => run({ badImage: bad }), /(?:missing|unexpected) image metadata/);
  }
  assert.throws(() => run({ images: { dsh: { id: "sha256:" + "9".repeat(64) } } }), /unexpected image metadata/);
});

test("startup preflight admits only previously exited isolated owners and checks Compose source", () => {
  const exited = { running: "false", state: "exited", health: "unhealthy" };
  rejectOwner({ containers: { dsh: exited } });
  assert.equal(run({ containers: { dsh: exited } }, true).result.passed, true);
  for (const changes of [{ state: "created" }, { state: "dead" }, { health: "NOT_CONFIGURED" },
    { running: "true", state: "running" }]) {
    rejectOwner({ containers: { dsh: { ...exited, ...changes } } }, "dsh", undefined, true);
  }
  const { calls } = run({}, true);
  assert.ok(calls.filter(c => c[0] === "git" && ["status", "diff"].includes(c[1]))
    .every(c => c.includes("infra/compose.yaml")));
  rejectOwner({ status: " M infra/compose.yaml\0" }, "wlt", "owner worktree is not clean", true);
  rejectOwner({ changes: { dsh: ["infra/compose.yaml"] } }, "dsh", "owner source changed", true);
  assert.throws(() => run({ branch: "archive/legacy" }, true), /source candidate not verified/);
});

test("invalid command arguments or non-approved Docker endpoints are rejected before owner reads", () => {
  for (const bad of [["--context"], ["--once"], ["--include-wlt"], [...args, "--include-wlt"],
    [...args, "--start-preflight", "--start-preflight"]]) assert.throws(() => main(bad), /Usage/);
  for (const context of ["../unsafe", "a;whoami", "default"]) {
    assert.throws(() => main(["--context", context]), /invalid Docker context/);
  }
  for (const context of ["npipe:////./pipe/docker_engine", "ssh://user@other", "ssh://user@bthwani-docker/"]) {
    assert.throws(() => run({ context }), /Wrong Docker target/);
  }
  assert.throws(() => run({ head: "invalid" }), /source candidate not verified/);
});

test("all four foundation services must match native configuration and image identity", () => {
  assert.equal(run().result.foundationResults.length, 4);
  for (const service of foundations) {
    for (const change of [{ configHash: "f".repeat(64) }, { image: "sha256:" + "f".repeat(64) }, { privileged: "true" }, { health: "unhealthy" }]) {
      const result = run({ containers: { [service]: change } }).result;
      assert.equal(result.passed, false);
      assert.equal(result.foundationResults.find(row => row.service === service).passed, false);
    }
  }
  assert.throws(() => run({ inventory: [...allServices, "foreign"] }), /unexpected project container inventory/);
  assert.equal(run({ status: " M infra/compose.yaml\0" }).result.passed, false);
});

test("only the exact native label-only historical hashes are accepted", () => {
  for (const service of foundations) {
    const result = run({ containers: { [service]: { configHash: hashFor(service, true), worktree: "" } } }).result;
    assert.equal(result.passed, service !== "payment-mock");
  }
  assert.equal(run({ containers: { postgres: { configHash: hashFor("postgres", true) } } }).result.passed, false);
  const f = fixture({ finalContainers: { postgres: { configHash: "f".repeat(64) } } });
  assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
});

test("effective policy drift is rejected on all seven services even with matching creation hash", () => {
  for (const service of allServices) {
    for (const change of [
      { memory: 0 }, { pids: 0 }, { logging: { Type: "local", Config: {} } },
      { logging: { Type: "json-file", Config: logOptions } }, { restart: "no" },
      { readOnly: !ownerNames.includes(service) }, { capAdd: ["SYS_ADMIN"] },
    ]) {
      const result = run({ containers: { [service]: change } }).result;
      assert.equal(result.passed, false, service + JSON.stringify(change));
      const row = [...result.results, ...result.foundationResults].find(r => (r.owner ?? r.service) === service);
      assert.ok(row.errors.some(e => e.includes("effective container policy mismatch") || e.includes("COMPOSE_SECURITY_POLICY_MISMATCH")));
    }
  }
  for (const owner of ownerNames) {
    rejectOwner({ containers: { [owner]: { user: "0:0" } } }, owner, "non-root owner user");
    rejectOwner({ containers: { [owner]: { capDrop: [] } } }, owner, "COMPOSE_SECURITY_POLICY_MISMATCH");
    rejectOwner({ containers: { [owner]: { security: [] } } }, owner, "COMPOSE_SECURITY_POLICY_MISMATCH");
  }
});

test("effective policy changes during observation invalidate the candidate", () => {
  const f = fixture({ finalContainers: { postgres: { memory: 0 } } });
  assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
  assert.throws(() => run({ containers: { dsh: { logging: null } } }), /invalid effective container policy metadata/);
});

test("equivalent native log-option ordering is not a runtime state change", () => {
  const { result } = run({ finalContainers: { wlt: { logging: { Type: "local", Config: { "max-size": "10m", "max-file": "3" } } } } });
  assert.equal(result.passed, true);
});
test("native inventory is an exact unordered set, not a sorted sequence", () => {
  assert.equal(run({ inventory: [...allServices].reverse() }).result.passed, true);
  assert.throws(() => run({ inventory: [...allServices.slice(0, -1), "dsh"] }), /unexpected project container inventory/);
  assert.throws(() => run({ inventory: [...allServices, "dsh"] }), /unexpected project container inventory/);
});

test("every container requires the canonical Compose origin in both admission modes", () => {
  const foreignOrigins = [
    undefined, null, "", "<no value>", "D:/retired/infra/compose.yaml",
    "D:/foreign/infra/compose.yaml", canonicalCompose + ",overlay.yaml",
  ];
  for (const service of allServices) {
    for (const preflight of [false, true]) {
      for (const configFiles of foreignOrigins) {
        const { result } = run({ containers: { [service]: { configFiles } } }, preflight);
        const row = [...result.results, ...result.foundationResults].find(r => (r.owner ?? r.service) === service);
        assert.equal(result.passed, false, service + ":" + String(configFiles));
        assert.equal(row.passed, false);
        assert.ok(row.errors.some(error => error.includes("canonical Compose origin")), row.errors.join("; "));
      }
      assert.equal(run({ containers: { [service]: { configFiles: canonicalCompose } } }, preflight).result.passed, true);
    }
  }
});

test("historical foundation labels cannot authorize a foreign Compose origin", () => {
  for (const service of foundations.filter(name => name !== "payment-mock")) {
    const { result } = run({ containers: { [service]: {
      configHash: hashFor(service, true), worktree: "", configFiles: "D:/retired/infra/compose.yaml",
    } } });
    assert.equal(result.passed, false);
    assert.ok(result.foundationResults.find(row => row.service === service).errors.some(error => error.includes("canonical Compose origin")));
  }
});

test("a changed Compose origin on any service invalidates the observation window", () => {
  for (const service of allServices) {
    const f = fixture({ finalContainers: { [service]: { configFiles: "D:/foreign/infra/compose.yaml" } } });
    assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
  }
});

test("seed admission rejects foreign Compose origins for either required service", () => {
  for (const service of ["dsh", "postgres"]) {
    const f = fixture({ containers: { [service]: { configFiles: "D:/retired/infra/compose.yaml" } } });
    const result = verifyCandidate([...args, "--seed-dsh-preflight"], f.execute, f.ancestor);
    assert.equal(result.passed, false);
    assert.equal(result.seedTarget, undefined);
  }
});
test("explicit seed preflight selects only admitted DSH and PostgreSQL and freezes the container identity", () => {
  const seedArgs = [...args, "--seed-dsh-preflight"];
  const f = fixture({ changes: { wlt: ["services/wlt/backend/cmd/wlt/main.go"] }, containers: { identity: { health: "unhealthy" } } });
  const result = verifyCandidate(seedArgs, f.execute, f.ancestor);
  assert.equal(result.passed, true);
  assert.equal(result.seedTarget, "1".repeat(64));
  assert.equal(result.results.find(row => row.owner === "wlt").passed, false);
  assert.equal(result.results.find(row => row.owner === "identity").passed, false);
  for (const options of [
    { changes: { dsh: ["services/dsh/backend/cmd/dsh/main.go"] } },
    { containers: { dsh: { configFiles: "D:/foreign/infra/compose.yaml" } } },
    { containers: { postgres: { configHash: "f".repeat(64) } } },
    { status: " M infra/compose.yaml\0" },
  ]) {
    const denied = fixture(options);
    const checked = verifyCandidate(seedArgs, denied.execute, denied.ancestor);
    assert.equal(checked.passed, false);
    assert.equal(checked.seedTarget, undefined);
  }
  const changed = fixture({ finalContainers: { dsh: { id: "9".repeat(64) } } });
  assert.throws(() => verifyCandidate(seedArgs, changed.execute, changed.ancestor), /candidate changed during runtime attestation/);
  assert.throws(() => main([...seedArgs, "--start-preflight"]), /Usage/);
});

test("seed preflight refuses foreign live database binding and network even if image attestation passes", () => {
  for (const options of [
    { seedEnvironment: { DSH_DB_HOST: "foreign-db" } },
    { seedEnvironment: { REF_POSTGRES_DB: "bthwani_refoundation" } },
    { seedEnvironment: { DSH_DB_SCHEMA: "dsh_test_other" } },
    { seedEnvironment: { BTHWANI_ISOLATED_TEST_MODE: "false" } },
    { seedNetwork: "0".repeat(64) },
  ]) {
    const f = fixture(options);
    const checked = verifyCandidate([...args, "--seed-dsh-preflight"], f.execute, f.ancestor);
    assert.equal(checked.passed, false);
    assert.equal(checked.seedTarget, undefined);
  }
});
test("shared Go pin changes invalidate each serving owner",()=>{
  for(const owner of ownerNames)rejectOwner({changes:{[owner]:[".go-version"]}},owner,"owner source changed");
});

test("ordinary and startup admission reject every effective process drift even when hashes and provenance match", () => {
  for (const preflight of [false, true]) {
    for (const service of allServices) {
      for (const mutate of [
        row => { row.Config.Cmd = ["unexpected"]; },
        row => { row.Config.User = "unexpected"; },
        row => { row.Config.Entrypoint = ["/unexpected"]; },
        row => { row.Config.Env.push("UNDECLARED=synthetic"); },
        row => { row.Config.Healthcheck.Test = ["CMD", "true"]; },
        row => { row.HostConfig.Devices = [{ PathOnHost: "/dev/null" }]; },
      ]) {
        const { result } = run({ actualMutations: { [service]: mutate } }, preflight);
        assert.equal(result.passed, false);
        const record = [...result.results, ...result.foundationResults].find(row => (row.owner ?? row.service) === service);
        assert.equal(record.passed, false);
        assert.ok(record.errors.some(error => error.startsWith("COMPOSE_")));
      }
    }
  }
});

test("effective process drift during observation invalidates the attestation window", () => {
  const f = fixture({ finalMutations: { wlt: row => { row.Config.Cmd = ["changed"]; } } });
  assert.throws(() => main(args, f.execute, f.ancestor), /candidate changed during runtime attestation/);
});

test("canonical volume and network identities bind effective attachment admission", () => {
  assert.equal(run({withVolume:true}).result.passed,true);
  for (const mutate of [
    row => { row.Mounts[0].Source = "/foreign"; },
    row => { row.Mounts[0].RW = false; },
    row => { row.Mounts = []; },
  ]) {
    const {result}=run({withVolume:true,actualMutations:{media:mutate}});
    assert.equal(result.passed,false);
    assert.equal(result.foundationResults.find(row=>row.service==="media").passed,false);
    assert.ok(result.results.every(row=>row.passed));
  }
  rejectOwner({actualMutations:{dsh:row=>{row.NetworkSettings.Networks["bthwani-refoundation_isolated"].NetworkID="9".repeat(64);}}},"dsh","COMPOSE_NETWORK_IDENTITY_MISMATCH");
  assert.throws(()=>run({withVolume:true,changedVolume:true}),/candidate changed during runtime attestation/);
});