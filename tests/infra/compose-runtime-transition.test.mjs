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
  const record = { Id: "a".repeat(64), Image: `sha256:${"a".repeat(64)}`, Config: { Hostname: "a".repeat(12), Image: "owner:old", Env: ["A=1"], Labels: { "com.bthwani.environment": "refoundation" } }, HostConfig: { Memory: 0, PidsLimit: null, MemorySwap: 0, LogConfig: { Type: "local", Config: {} }, Privileged: false }, Mounts: [{ Name: "data", Destination: "/data", Type: "volume", RW: true }], NetworkSettings: { Networks: { isolated: { NetworkID: "network" } } }, State: { Running: true, Health: { Status: "healthy" } } };
  const after = structuredClone(record);
  after.Id = "b".repeat(64); after.Config.Hostname = "b".repeat(12);
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

test("Docker default representations do not obscure the protected effective configuration", async () => {
  const { verifyReplacement } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const before = {
    Id: "a".repeat(64), Image: `sha256:${"b".repeat(64)}`,
    Config: { Hostname: "a".repeat(12), Image: "owner:old", Env: ["A=1"], Labels: {} },
    HostConfig: { Memory: 0, MemorySwap: 0, PidsLimit: null, LogConfig: { Type: "local", Config: {} }, Dns: [], DnsOptions: [], DnsSearch: [], OomKillDisable: false, Privileged: false },
    Mounts: [], NetworkSettings: { Networks: { isolated: { NetworkID: "network" } } },
    State: { Running: true, Health: { Status: "healthy" } },
  };
  const after = structuredClone(before);
  after.Id = "c".repeat(64);
  after.Config.Hostname = "c".repeat(12);
  Object.assign(after.HostConfig, { Memory: 536870912, MemorySwap: 1073741824, PidsLimit: 256, Dns: null, DnsOptions: null, DnsSearch: null, OomKillDisable: null, LogConfig: { Type: "local", Config: { "max-size": "10m", "max-file": "3" } } });
  const policy = { mem_limit: 536870912, pids_limit: 256, logging: { driver: "local", options: { "max-size": "10m", "max-file": "3" } } };
  assert.doesNotThrow(() => verifyReplacement(before, after, policy));
  for (const change of [
    value => { value.HostConfig.Dns = ["192.0.2.1"]; },
    value => { value.HostConfig.DnsOptions = ["timeout:1"]; },
    value => { value.HostConfig.DnsSearch = ["fixture.invalid"]; },
    value => { value.HostConfig.OomKillDisable = true; },
    value => { value.HostConfig.MemorySwap = -1; },
    value => { value.Config.Hostname = "different-explicit-host"; },
  ]) {
    const candidate = structuredClone(after);
    change(candidate);
    assert.throws(() => verifyReplacement(before, candidate, policy));
  }
});

test("interrupted transition cannot treat a current hash as proof of actual serving attachments", async () => {
  const { verifyLiveDefinition } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const model = { services: { dsh: { volumes: [{ type: "volume", source: "data", target: "/data", read_only: true }], networks: { isolated: {} }, ports: [{ target: 8080, protocol: "tcp", host_ip: "127.0.0.1", published: "8181" }], read_only: true, restart: "unless-stopped", cap_drop: ["ALL"], security_opt: ["no-new-privileges:true"], environment: { MODE: "synthetic" }, labels: { "com.bthwani.environment": "refoundation" } } }, volumes: { data: { name: "project-data" } }, networks: { isolated: { name: "project-isolated" } } };
  const record = { Config: { Env: ["MODE=synthetic"], Labels: { "com.bthwani.environment": "refoundation" } }, HostConfig: { Privileged: false, ReadonlyRootfs: true, RestartPolicy: { Name: "unless-stopped" }, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges:true"], PortBindings: { "8080/tcp": [{ HostIp: "127.0.0.1", HostPort: "8181" }] } }, Mounts: [{ Type: "volume", Driver: "local", Name: "project-data", Destination: "/data", RW: false }], NetworkSettings: { Networks: { "project-isolated": {} } } };
  assert.doesNotThrow(() => verifyLiveDefinition(model, "dsh", record));
  for (const change of [
    value => { value.Mounts[0].Name = "other-data"; },
    value => { value.Mounts[0].RW = true; },
    value => { value.NetworkSettings.Networks.public = {}; },
    value => { value.HostConfig.PortBindings["8080/tcp"][0].HostIp = "0.0.0.0"; },
    value => { value.HostConfig.ReadonlyRootfs = false; },
    value => { value.HostConfig.CapDrop = []; },
    value => { value.HostConfig.SecurityOpt = []; },
    value => { value.Config.Env = ["MODE=other"]; },
    value => { value.Config.Labels["com.bthwani.environment"] = "other"; },
  ]) {
    const candidate = structuredClone(record);
    change(candidate);
    assert.throws(() => verifyLiveDefinition(model, "dsh", candidate));
  }
});

test("effective Compose attestation compares distinct textual paths ordinally and rejects duplicate mount destinations", async () => {
  const { verifyLiveDefinition, verifyReplacement } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const paths = ["/caf\u00e9", "/cafe\u0301"];
  const policy = { mem_limit: 1024, pids_limit: 8, logging: { driver: "local", options: { "max-size": "10m", "max-file": "3" } } };
  const model = {services:{dsh:{...policy, restart:"unless-stopped", volumes:paths.map((target,i)=>({type:"volume",source:`v${i}`,target}))}},volumes:{v0:{name:"v0"},v1:{name:"v1"}},networks:{}};
  const record = { Id:"a".repeat(64),Image:`sha256:${"b".repeat(64)}`,Config:{Hostname:"a".repeat(12),Env:[],Labels:{}}, HostConfig:{Memory:1024,MemorySwap:2048,PidsLimit:8,LogConfig:{Type:"local",Config:{"max-size":"10m","max-file":"3"}},Privileged:false,ReadonlyRootfs:false,RestartPolicy:{Name:"unless-stopped"}},Mounts:paths.map((Destination,i)=>({Type:"volume",Driver:"local",Name:`v${i}`,Destination,RW:true})),NetworkSettings:{Networks:{}},State:{Running:true,Health:{Status:"healthy"}} };
  const reordered=structuredClone(record);
  reordered.Mounts.reverse();
  assert.doesNotThrow(()=>verifyReplacement(record,reordered,policy));
  assert.doesNotThrow(()=>verifyLiveDefinition(model,"dsh",reordered));
  const duplicate=structuredClone(record), duplicateModel=structuredClone(model);
  duplicate.Mounts[1].Destination=paths[0];
  duplicateModel.services.dsh.volumes[1].target=paths[0];
  assert.throws(()=>verifyReplacement(duplicate,duplicate,policy),/COMPOSE_MOUNT_TARGET/);
  assert.throws(()=>verifyLiveDefinition(duplicateModel,"dsh",duplicate),/COMPOSE_MOUNT_TARGET/);
});

/* Exercise the transition coordinator with a deterministic transport fixture.
 * This is protocol/rollback proof, not evidence of live Docker behavior. */
async function transitionFixture({ stale = [], fault, mutate } = {}) {
  const { createHash } = await import("node:crypto");
  const { resolve } = await import("node:path");
  const { reconcileComposeConfiguration } = await import("../../tools/dev/docker/compose-runtime-transition.mjs");
  const project = "bthwani-refoundation";
  const services = ["postgres","media","mailpit","payment-mock","identity","dsh","wlt"];
  const root = resolve(".");
  const compose = resolve(root,"infra/compose.yaml");
  const digest = value => createHash("sha256").update(value).digest("hex");
  const labels = {"com.bthwani.environment":"refoundation"};
  const volume = `${project}_data`, network = `${project}_isolated`;
  const policy = {mem_limit:1024,pids_limit:8,logging:{driver:"local",options:{"max-size":"10m","max-file":"3"}}};
  const oldModel = {name:project,services:Object.fromEntries(services.map(name=>[name,{image:`fixture/${name}:fixed`,restart:"unless-stopped",environment:{A:"1"},labels,volumes:[{type:"volume",source:"data",target:"/data"}],networks:{isolated:{}}}])),volumes:{data:{name:volume}},networks:{isolated:{name:network,driver:"bridge",internal:true}}};
  const newModel = structuredClone(oldModel);
  for(const name of services) Object.assign(newModel.services[name],policy);
  const hashes = current => Object.fromEntries(services.map(name=>[name,digest(name+String(current))]));
  const newRow = (name,current,serial=0) => {
    const Id=digest(name+serial);
    return {Id,Name:`/${project}-${name}-1`,Image:`sha256:${digest(`${name}image`)}`,
      Config:{Image:oldModel.services[name].image,Hostname:Id.slice(0,12),Env:["A=1"],Labels:{...labels,"com.docker.compose.project":project,"com.docker.compose.service":name,"com.docker.compose.config-hash":hashes(current)[name],"com.docker.compose.project.config_files":current?compose:"historical"}},
      HostConfig:{Privileged:false,ReadonlyRootfs:false,RestartPolicy:{Name:"unless-stopped"},Memory:current?1024:0,MemorySwap:current?2048:0,PidsLimit:current?8:null,LogConfig:{Type:"local",Config:current?policy.logging.options:{}}},
      Mounts:[{Type:"volume",Driver:"local",Name:volume,Source:"/fixture/data",Destination:"/data",RW:true}],
      NetworkSettings:{Networks:{[network]:{NetworkID:digest(network)}}},
      State:{Running:true,Health:{Status:"healthy"},StartedAt:String(serial)}};
  };
  const rows = Object.fromEntries(services.map(name=>[name,newRow(name,!stale.includes(name))]));
  const operations=[],readbacks=[];
  let serial=0;
  const docker=(args,_env,_timeout,input)=>{
    if(args[0]==="ps") return services.map(name=>rows[name].Name.slice(1)).reverse().join("\n");
    if(args[0]==="inspect") return JSON.stringify(Object.values(rows));
    if(args[0]==="image"&&args[1]==="inspect") return rows[services.find(name=>rows[name].Config.Image===args.at(-1))].Image;
    if(args[0]==="volume"&&args[1]==="inspect") return JSON.stringify([{Name:volume,Driver:"local",CreatedAt:"fixture",Mountpoint:"/fixture/data"}]);
    if(args[0]==="network"&&args[1]==="inspect") return JSON.stringify([{Name:network,Id:digest(network),Driver:"bridge",Internal:true}]);
    if(args[0]==="compose"){
      const current=input!=="old";
      if(args.includes("config")){
        if(args.includes("--hash"))return Object.entries(hashes(current)).map(pair=>pair.join(" ")).join("\n");
        return JSON.stringify(current?newModel:oldModel);
      }
      if(args.includes("up")){
        const name=args.at(-1);
        operations.push([name,current]);
        assert.ok(args.includes("--no-deps")&&args.includes("--no-build")&&args.includes("--wait"));
        if(current&&fault==="before-write")throw new Error("candidate rejected before replacement");
        rows[name]=newRow(name,current,++serial);
        if(current&&fault==="health") rows[name].State.Health.Status="unhealthy";
        if(current&&fault==="timeout") throw Object.assign(new Error("unknown operation"),{code:"ETIMEDOUT"});
        if(current&&fault==="foreign-volume") rows[name].Mounts[0].Source="/foreign";
        return "";
      }
    }
    throw new Error(`unexpected fixture command: ${args[0]}`);
  };
  const run=apply=>reconcileComposeConfiguration({docker,git:args=>args[0]==="show"?(args[1].startsWith("a")?"old":"new"):"",root,head:"b".repeat(40),previous:"a".repeat(40),apply,ensureSource(){},verifyOwners(snapshot){readbacks.push(Object.keys(snapshot));if(mutate&&readbacks.length===1)mutate(rows);}});
  return {run,rows,operations,readbacks,hashes};
}

test("native reconciliation plan and apply select only stale policy owners and verify final owner readback",async()=>{
  const fixture=await transitionFixture({stale:["media","wlt"]});
  fixture.run(false);
  assert.deepEqual(fixture.operations,[]);
  fixture.run(true);
  assert.deepEqual(fixture.operations,[["media",true],["wlt",true]]);
  for(const [name,row] of Object.entries(fixture.rows))assert.equal(row.Config.Labels["com.docker.compose.config-hash"],fixture.hashes(true)[name]);
  fixture.run(true);
  assert.equal(fixture.operations.length,2);
  assert.ok(fixture.readbacks.every(names=>names.join(",")==="identity,dsh,wlt"));
});

test("known unhealthy candidate rolls back exactly one owner; unknown outcomes never replay",async()=>{
  const unchanged=await transitionFixture({stale:["wlt"],fault:"before-write"});
  assert.throws(()=>unchanged.run(true),/COMPOSE_TRANSITION_UNCHANGED wlt/);
  assert.deepEqual(unchanged.operations,[["wlt",true]]);
  assert.equal(unchanged.rows.wlt.Config.Labels["com.docker.compose.config-hash"],unchanged.hashes(false).wlt);
  const unhealthy=await transitionFixture({stale:["wlt"],fault:"health"});
  assert.throws(()=>unhealthy.run(true),/COMPOSE_ROLLBACK_PASS wlt/);
  assert.deepEqual(unhealthy.operations,[["wlt",true],["wlt",false]]);
  assert.equal(unhealthy.rows.wlt.Config.Labels["com.docker.compose.config-hash"],unhealthy.hashes(false).wlt);
  for(const fault of ["timeout","foreign-volume"]){
    const fixture=await transitionFixture({stale:["media"],fault});
    assert.throws(()=>fixture.run(true),/COMPOSE_ROLLBACK_BLOCKED|COMPOSE_STORAGE_IDENTITY_MISMATCH/);
    assert.deepEqual(fixture.operations,[["media",true]]);
  }
});

test("unproven inventory and concurrent owner changes are rejected before mutation",async()=>{
  for(const corrupt of [
    rows=>{rows.media.Config.Labels["com.docker.compose.config-hash"]="c".repeat(64);},
    rows=>{rows.media.Mounts[0].Source="/foreign";},
    rows=>{rows.media.State.Health.Status="unhealthy";},
    rows=>{rows.media.HostConfig.Memory=0;},
    rows=>{rows.media.Config.Labels["com.docker.compose.project.config_files"]="historical";},
  ]){
    const fixture=await transitionFixture();
    corrupt(fixture.rows);
    assert.throws(()=>fixture.run(true));
    assert.deepEqual(fixture.operations,[]);
  }
  const fixture=await transitionFixture({stale:["wlt"],mutate:rows=>{rows.identity.State.StartedAt="concurrent";}});
  assert.throws(()=>fixture.run(true),/COMPOSE_CONCURRENT_CHANGE identity/);
  assert.deepEqual(fixture.operations,[]);
});
