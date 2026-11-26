import assert from "node:assert/strict";
import test from "node:test";
import { evaluateService, main, readService } from "../../tools/dev/docker/verify-runtime-provenance.mjs";

const sha = "a".repeat(40);
const good = {
  owner: "dsh", service: "dsh", project: "bthwani-refoundation", environment: "refoundation",
  running: true, health: "healthy",
  imageId: "sha256:"+"1".repeat(64), containerImageId: "sha256:"+"1".repeat(64),
  revisionPrimary: sha, revisionFallback: sha,
  committedAncestor: true, ownerChanges: [], localOwnerChanges: [],
};

test("accept source parity only when the running isolated owner has health, matching image, and clean unchanged source", () => {
  assert.deepEqual(evaluateService(good), { revision: sha, errors: [], passed: true });
});

test("reject a committed but stale Go or contract image", () => {
  const result = evaluateService({ ...good, ownerChanges: ["services/dsh/backend/cmd/dsh/main.go"] });
  assert.equal(result.passed, false);
  assert.ok(result.errors.includes("owner source changed since image build"));
});

test("reject missing and contradictory source revision labels", () => {
  assert.equal(evaluateService({ ...good, revisionPrimary: "", revisionFallback: "" }).passed, false);
  assert.ok(evaluateService({ ...good, revisionFallback: "b".repeat(40) })
    .errors.some(e=>e.includes("conflicting image source labels")));
});

test("reject a healthy-looking container from another environment or service", () => {
  assert.equal(evaluateService({ ...good, project: "donor" }).passed, false);
  assert.equal(evaluateService({ ...good, service: "identity" }).passed, false);
});

test("reject unproven health, stopped service, and wrong runtime image", () => {
  for (const change of [
    { health: "NOT_CONFIGURED" },
    { running: false },
    { imageId: "sha256:other" },
  ]) assert.equal(evaluateService({ ...good, ...change }).passed, false);
});

test("reject revision outside history and owner-local uncommitted edits", () => {
  assert.equal(evaluateService({ ...good, committedAncestor: false }).passed, false);
  assert.equal(evaluateService({ ...good, localOwnerChanges: ["?? services/dsh/new.go"] }).passed, false);
});

// These tests verify the command/attestation parser. They deliberately do not
// claim that a real Docker runtime or source revision has been attested.
function serviceRecords({
  owner = "dsh", project = "bthwani-refoundation", imageId = "sha256:"+"1".repeat(64),
  environment = "refoundation", capability = owner==="wlt"?"customer-wallet-read-only":"", previewBase = "", previewDigest = "",
  revision = sha, fallback = sha, running = "true", health = "healthy",
  sourceDiff = "", localStatus = "", malformed = "", state = running === "true" ? "running" : "exited",
} = {}) {
  const calls = [];
  const execute = (command, args) => {
    calls.push({ command, args });
    if (command === "docker" && args[2] === "inspect") {
      if (malformed === "container") return "not-a-container-record";
      return [imageId, project, owner, running, health, environment, capability || "<no value>", state].join("|");
    }
    if (command === "docker" && args[2] === "image" && args[3] === "inspect") {
      if (malformed === "image") return "not-an-image-record";
      return [imageId, revision || "<no value>", fallback || "<no value>", previewBase || "<no value>", previewDigest || "<no value>"].join("|");
    }
    if (command === "git" && args[0] === "diff") return sourceDiff;
    if (command === "git" && args[0] === "status") return localStatus;
    throw new Error("unexpected verification command");
  };
  return { execute, calls };
}

test("runtime attestation checks actual owner metadata, SHA ancestry and scoped Git queries", () => {
  const fixture = serviceRecords();
  const verified = readService("dsh", "isolated", sha, fixture.execute, () => true);
  assert.deepEqual(verified, { revision: sha, errors: [], passed: true });
  assert.equal(fixture.calls.length, 4);
  assert.deepEqual(fixture.calls.filter((c) => c.command === "git").map((c) => c.args), [
    ["diff", "--name-only", "--no-renames", sha, sha, "--", "services/dsh"],
    ["status", "--porcelain", "--", "services/dsh"],
  ]);
  assert.ok(fixture.calls.filter((c) => c.command === "docker")
    .every((c) => c.args[0] === "--context" && c.args[1] === "isolated"));
});

test("runtime attestation rejects a changed owner, a dirty checkout and non-ancestor images", () => {
  const changed = serviceRecords({ sourceDiff: "services/dsh/backend/cmd/dsh/main.go" });
  assert.ok(readService("dsh", "isolated", sha, changed.execute, () => true)
    .errors.includes("owner source changed since image build"));
  const dirty = serviceRecords({ owner: "identity", localStatus: " M services/identity/backend/main.go" });
  assert.ok(readService("identity", "isolated", sha, dirty.execute, () => true)
    .errors.includes("owner worktree is not clean"));
  const ancestorRejected = serviceRecords();
  assert.ok(readService("dsh", "isolated", sha, ancestorRejected.execute, () => false)
    .errors.includes("source is not an ancestor of HEAD"));
  assert.equal(ancestorRejected.calls.some((c) => c.command === "git" && c.args[0] === "diff"), false);
});

test("mandatory WLT attestation verifies the real owner container and WLT-only source changes", () => {
  const fixture = serviceRecords({ owner: "wlt" });
  const verified = readService("wlt", "isolated", sha, fixture.execute, () => true);
  assert.deepEqual(verified, { revision: sha, errors: [], passed: true });
  assert.equal(fixture.calls.find(c => c.command === "docker" && c.args[2] === "inspect")
    ?.args.at(-1), "bthwani-refoundation-wlt-1");
  assert.deepEqual(fixture.calls.filter(c => c.command === "git").map(c => c.args), [
    ["diff", "--name-only", "--no-renames", sha, sha, "--", "services/wlt"],
    ["status", "--porcelain", "--", "services/wlt"],
  ]);

  const stale = serviceRecords({ owner: "wlt", sourceDiff: "services/wlt/backend/cmd/wlt/main.go" });
  assert.ok(readService("wlt", "isolated", sha, stale.execute, () => true)
    .errors.includes("owner source changed since image build"));
  const wrongService = serviceRecords({ owner: "identity" });
  assert.equal(readService("wlt", "isolated", sha, wrongService.execute, () => true).passed, false);
  assert.throws(() => readService("unsupported", "isolated", sha, fixture.execute), /unknown owner/);
  assert.throws(() => readService("wlt", "isolated", sha, (command, args) => {
    if (command === "docker" && args[2] === "inspect") throw new Error("missing WLT container");
    return fixture.execute(command, args);
  }, () => true), /missing WLT container/);
});

test("all serving owners are mandatory and the retired opt-in is rejected", () => {
  assert.throws(() => main(["--include-wlt"]), /Usage/);
  assert.throws(() => main(["--context", "bthwani-docker", "--include-wlt"]), /Usage/);
  const seen = [];
  const fixture = serviceRecords();
  const execute = (command, args) => {
    if (command === "docker" && args[0] === "context") return "ssh://user@bthwani-docker";
    if (command === "git" && args[0] === "rev-parse") return sha;
    if (command === "docker" && args[2] === "inspect") {
      const owner = args.at(-1).match(/-(dsh|identity|wlt)-1$/)[1];
      seen.push(owner);
      return serviceRecords({owner}).execute(command,args);
    }
    return fixture.execute(command,args);
  };
  main(["--context","bthwani-docker"], execute, () => true);
  assert.deepEqual(seen,["dsh","identity","wlt"]);
});
test("runtime attestation fails closed for missing, conflicting and invalid image revisions", () => {
  for (const revisions of [
    { revision: "", fallback: "" },
    { revision: "unsafe", fallback: "" },
    { revision: sha, fallback: "b".repeat(40) },
  ]) {
    const fixture = serviceRecords(revisions);
    const result = readService("dsh", "isolated", sha, fixture.execute, () => true);
    assert.equal(result.passed, false);
    if (revisions.revision === "unsafe") {
      assert.equal(fixture.calls.some((c) => c.command === "git" && c.args[0] === "diff"), false);
    }
  }
});

test("malformed container and image metadata cannot be treated as a passing runtime", () => {
  for (const malformed of ["container", "image"]) {
    const fixture = serviceRecords({ malformed });
    assert.throws(() => readService("dsh", "isolated", sha, fixture.execute, () => true),
      /unexpected (?:container|image) metadata/);
  }
});

test("runtime command-line refuses unsafe or incomplete Docker context names before execution", () => {
  assert.throws(() => main(["--context"]), /Usage/);
  assert.throws(() => main(["--once"]), /Usage/);
  assert.throws(() => main(["--context", "../unsafe"]), /invalid Docker context/);
  assert.throws(() => main(["--context", "a;whoami"]), /invalid Docker context/);
});

test("a preview never satisfies committed runtime acceptance",()=>{
  const result=evaluateService({...good,revisionPrimary:"worktree-"+"a".repeat(64),revisionFallback:undefined,previewBase:sha,previewDigest:"a".repeat(64)});
  assert.equal(result.passed,false);
  assert.ok(result.errors.some(e=>e.includes("uncommitted preview")));
});

test("committed attestation rejects absent image IDs, unknown ancestry, and preview metadata on a committed SHA", () => {
  for (const changes of [
    { imageId: "", containerImageId: "" },
    { imageId: undefined, containerImageId: undefined },
    { committedAncestor: undefined },
    { environment: undefined },
    { environment: "production" },
    { owner: "wlt", service: "wlt", capability: "other" },
    { imageId: "sha256:invalid", containerImageId: "sha256:invalid" },
    { previewBase: sha, previewDigest: "b".repeat(64) },
    { previewBase: sha },
    { previewDigest: "b".repeat(64) },
  ]) assert.equal(evaluateService({ ...good, ...changes }).passed, false, JSON.stringify(changes));
});

test("startup preflight admits only previously exited verified owners, not unproven running health", () => {
  const stopped={...good,running:false,health:"unhealthy",state:"exited"};
  assert.equal(evaluateService(stopped).passed,false);
  assert.equal(evaluateService(stopped,{startPreflight:true}).passed,true);
  for(const change of [{state:"created"},{state:"dead"},{health:"NOT_CONFIGURED"},{ownerChanges:["infra/compose.yaml"]},{committedAncestor:false},{project:"foreign"},{running:true,state:"running"}]){
    assert.equal(evaluateService({...stopped,...change},{startPreflight:true}).passed,false);
  }
});

test("startup preflight checks shared Compose source without weakening runtime verification", () => {
  const fixture=serviceRecords({running:"false",health:"unhealthy"});
  assert.equal(readService("dsh","isolated",sha,fixture.execute,()=>true,{startPreflight:true}).passed,true);
  assert.ok(fixture.calls.filter(c=>c.command==="git").every(c=>c.args.includes("infra/compose.yaml")));
  const dirty=serviceRecords({running:"false",health:"unhealthy",localStatus:" M infra/compose.yaml"});
  assert.equal(readService("dsh","isolated",sha,dirty.execute,()=>true,{startPreflight:true}).passed,false);
  assert.throws(()=>main(["--start-preflight"]),/Usage/);
});

test("committed test and README changes preserve serving provenance without relaxing runtime guards",()=>{
  for(const owner of ["identity","dsh","wlt"]){
    const prefix="services/"+owner+"/";
    const nonRuntime=[prefix+"backend/cmd/"+owner+"/main_test.go",prefix+"README.md",prefix+"backend/README.md"];
    for(const startPreflight of [false,true]){
      const fixture=serviceRecords({owner,sourceDiff:nonRuntime.join("\n")});
      assert.equal(readService(owner,"isolated",sha,fixture.execute,()=>true,{startPreflight}).passed,true);
      for(const runtime of [prefix+"backend/cmd/"+owner+"/main.go",prefix+"database/schema/00.sql",prefix+"contracts/openapi/"+owner+".openapi.yaml","infra/compose.yaml"]){
        const mixed=serviceRecords({owner,sourceDiff:[...nonRuntime,runtime].join("\n")});
        assert.equal(readService(owner,"isolated",sha,mixed.execute,()=>true,{startPreflight}).passed,false);
      }
    }
  }
});

test("committed client-only changes preserve runtime provenance, but mixed runtime changes do not",()=>{
  for(const startPreflight of [false,true]){
    const client="services/dsh/clients/dsh-public-client.test.mjs";
    const fixture=serviceRecords({sourceDiff:client});
    assert.equal(readService("dsh","isolated",sha,fixture.execute,()=>true,{startPreflight}).passed,true);
    for(const path of ["services/dsh/backend/cmd/dsh/main.go","services/dsh/contracts/openapi/dsh.openapi.yaml","services/dsh/database/schema/00.sql","services/dsh/.dockerignore"]){
      const mixed=serviceRecords({sourceDiff:client+"\n"+path});
      assert.equal(readService("dsh","isolated",sha,mixed.execute,()=>true,{startPreflight}).passed,false);
    }
  }
});
