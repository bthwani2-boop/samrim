import assert from "node:assert/strict";
import test from "node:test";
import { parseReconcileArgs } from "../../tools/dev/docker/reconcile-owner-runtime.mjs";

const revision = "a".repeat(40);

test("configuration transition requires an exact reviewed Git revision and a distinct explicit mode", () => {
  assert.equal(parseReconcileArgs(["--check-config", revision]).configuration, true);
  assert.equal(parseReconcileArgs(["--check-config", revision]).apply, false);
  assert.equal(parseReconcileArgs(["--apply-config", revision]).apply, true);
  assert.throws(() => parseReconcileArgs(["--apply-config"]));
  assert.throws(() => parseReconcileArgs(["--apply-config", "main"]));
  assert.throws(() => parseReconcileArgs(["--apply-config", revision, "--prepare-baseline"]));
});

test("configuration reconciliation admits only the resource/logging policy and historical metadata transition", async () => {
  const { verifyPolicyTransition } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const previous = { image: "owner:old", environment: { USER: "owner" }, volumes: [{ source: "data", target: "/data" }], labels: {}, networks: { isolated: null } };
  const next = { ...previous, mem_limit: 536870912, pids_limit: 256, logging: { driver: "local", options: { "max-size": "10m", "max-file": "3" } }, labels: { "com.bthwani.worktree": "samrim-refoundation-clean-20261112" } };
  assert.doesNotThrow(() => verifyPolicyTransition(previous, next));
  for (const change of [
    { image: "owner:new" },
    { environment: { USER: "different" } },
    { volumes: [{ source: "other", target: "/data" }] },
    { networks: { public: null } },
    { privileged: true },
    { mem_limit: 0 },
    { logging: { driver: "json-file" } },
  ]) assert.throws(() => verifyPolicyTransition(previous, { ...next, ...change }));
});

test("a resource-only replacement preserves persistent mounts, actual image and effective owner configuration", async () => {
  const { verifyReplacement } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const record = { Image: `sha256:${"a".repeat(64)}`, Config: { Hostname: "before", Image: "owner:old", Env: ["A=1"], Labels: { "com.bthwani.environment": "refoundation" } }, HostConfig: { Memory: 0, PidsLimit: null, MemorySwap: 0, LogConfig: { Type: "local", Config: {} }, Privileged: false }, Mounts: [{ Name: "data", Destination: "/data", Type: "volume", RW: true }], NetworkSettings: { Networks: { isolated: { NetworkID: "network" } } }, State: { Running: true, Health: { Status: "healthy" } } };
  const after = structuredClone(record);
  after.Config.Hostname = "after";
  Object.assign(after.HostConfig, { Memory: 536870912, PidsLimit: 256, MemorySwap: 1073741824, LogConfig: { Type: "local", Config: { "max-size": "10m", "max-file": "3" } } });
  const policy = { mem_limit: 536870912, pids_limit: 256, logging: { driver: "local", options: { "max-size": "10m", "max-file": "3" } } };
  assert.doesNotThrow(() => verifyReplacement(record, after, policy));
  for (const corrupt of [
    value => { value.Image = `sha256:${"b".repeat(64)}`; },
    value => { value.Mounts[0].Name = "different"; },
    value => { value.Config.Env = ["A=2"]; },
    value => { value.HostConfig.Privileged = true; },
    value => { value.NetworkSettings.Networks.isolated.NetworkID = "other"; },
    value => { value.HostConfig.PidsLimit = null; },
  ]) {
    const candidate = structuredClone(after);
    corrupt(candidate);
    assert.throws(() => verifyReplacement(record, candidate, policy));
  }
});

test("native Compose variables are recovered only from matching live service fields", async () => {
  const { runtimeEnvironment } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const services = ["postgres", "media", "mailpit", "payment-mock", "identity", "dsh", "wlt"];
  const model = { name: "bthwani-refoundation", services: Object.fromEntries(services.map(name => [name, { image: "owner:fixed", environment: {}, ports: [] }])) };
  const state = Object.fromEntries(services.map(name => [name, { Config: { Image: "owner:fixed", Env: [] }, HostConfig: { PortBindings: {} } }]));
  model.services.dsh = { image: "owner:" + "$" + "{REF_DSH_IMAGE_TAG:-dev}", environment: { DB: "$" + "{REF_DB:?required}" }, ports: ["127.0.0.1:" + "$" + "{REF_DSH_PORT:-8080}:8080"] };
  state.dsh = { Config: { Image: "owner:exact", Env: ["DB=fixture=with=equals"] }, HostConfig: { PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "8181" }] } } };
  const result = runtimeEnvironment(model, state);
  assert.equal(result.REF_DB, "fixture=with=equals");
  assert.equal(result.REF_DSH_IMAGE_TAG, "exact");
  assert.equal(result.REF_DSH_PORT, "8181");
  for (const corrupt of [
    (_m, s) => { s.dsh.Config.Env = []; },
    (_m, s) => { s.dsh.Config.Image = "other:exact"; },
    (_m, s) => { s.dsh.HostConfig.PortBindings["8080/tcp"][0].HostIp = "0.0.0.0"; },
    (m) => { m.services.dsh.environment.DB = "prefix" + "$" + "{REF_DB}"; },
    (m) => { m.services.dsh.ports = ["0.0.0.0:" + "$" + "{REF_DSH_PORT:-8080}:8080"]; },
    (m) => { m.services.wlt.environment = { OTHER: "$" + "{REF_DB}" }; },
  ]) {
    const nextModel = structuredClone(model);
    const nextState = structuredClone(state);
    corrupt(nextModel, nextState);
    assert.throws(() => runtimeEnvironment(nextModel, nextState));
  }
});
