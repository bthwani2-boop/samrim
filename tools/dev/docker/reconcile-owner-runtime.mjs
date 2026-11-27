#!/usr/bin/env node
// Isolated development owner reconciliation; SQL transitions use one verified owner-local transaction. No credential output or volume mutations.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePinnedGo } from "../check-go.mjs";
import { acknowledgeRuntimeAttempt, acknowledgeRuntimeRecovery, recordRuntimePhase, runtimeAttemptPhase, runtimeFailureStatus, runtimeReceiptStatus, runtimeTerminalStatus, VerifiedRuntimeRollback } from "../sync-lenovo-reconciliation.mjs";
import { reconcileComposeConfiguration } from "./compose-runtime-transition.mjs";
import { buildOwnerBaselineTransition, ownerDatabaseScope, transitionScope, wltCommandRoleInactiveSQL } from "./owner-baseline-transition.mjs";
import { captureCommittedOwner, captureOwner, dirtyPaths, isPreviewGoPath, materializeOwner, ownerComposeInputs, ownerReconcilePlan, ownerSourceState, previewChangeKey, sourceIdentity, verifyMaterializedOwner } from "./owner-preview-source.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const context = "bthwani-docker";
const project = "bthwani-refoundation";
const owners = {
  dsh: { tag: "REF_DSH_IMAGE_TAG", image: "bthwani-refoundation-dsh" },
  identity: { tag: "REF_IDENTITY_IMAGE_TAG", image: "bthwani-refoundation-identity-verifier" },
  wlt: { tag: "REF_WLT_IMAGE_TAG", image: "bthwani-refoundation-wlt" },
};

const canonicalComposePath = resolve(root,"infra/compose.yaml");

const operatorOverrides = {
  IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP: "REF_IDENTITY_OPERATOR_BOOTSTRAP",
  IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH: "REF_IDENTITY_OPERATOR_PASSKEY_AUTH",
  IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN: "REF_IDENTITY_OPERATOR_PERMISSION_ADMIN",
  IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR: "REF_IDENTITY_LOCAL_DEV_FIRST_OPERATOR",
  IDENTITY_OPERATOR_PASSKEY_ORIGINS: "REF_IDENTITY_OPERATOR_PASSKEY_ORIGINS",
  IDENTITY_OPERATOR_PASSKEY_RPID: "REF_IDENTITY_OPERATOR_PASSKEY_RPID",
};
const gitExe = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
const compareNames = (a,b) => a<b?-1:a>b?1:0;
function run(executable, args, env = {}, timeout = 30000, input) {
  const out = spawnSync(executable, args, { cwd: root, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024, input, env: { ...process.env, ...env } });
  // Docker/config output may contain secret values. Never print raw stdout/stderr on failure.
  if (out.error || out.status !== 0) {
    const error = new Error(executable + " " + args.slice(0, 3).join(" ") + " failed (" + (out.error?.code || out.status) + ")");
    error.code = out.error?.code;
    throw error;
  }
  return out.stdout.trim();
}
const git = args => run(gitExe, args);
const docker = (args, env, timeout, input) => run("docker", ["--context", context, ...args], env, timeout, input);
export function composeArgs() {
  return ["compose","--project-directory",resolve(root,"infra"),"--env-file","infra/.env","-f",canonicalComposePath];
}
function asEnv(values) {
  return Object.fromEntries(values.map(v => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]));
}
export function differingKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]).sort(compareNames);
}
export function assertOwnerDatabase(owner,env) {
  const schema=owner==="dsh"?env.DSH_DB_SCHEMA:owner==="identity"?env.IDENTITY_DB_SCHEMA:"wlt";
  const scope=ownerDatabaseScope(owner,schema);
  let valid=false;
  if(owner==="dsh") {
    valid=env.DSH_DB_HOST==="postgres"&&env.REF_POSTGRES_DB===scope.database&&env.REF_POSTGRES_USER===scope.runtime&&Boolean(env.REF_POSTGRES_PASSWORD);
  } else {
    try {
      const dsn=new URL(owner==="identity"?env.IDENTITY_TEST_DATABASE_URL:env.WLT_TEST_DATABASE_URL);
      valid=["postgres:","postgresql:"].includes(dsn.protocol)&&dsn.hostname==="postgres"&&dsn.port==="5432"&&dsn.pathname==="/"+scope.database&&dsn.username===scope.runtime&&Boolean(dsn.password)&&!dsn.hash;
    } catch {}
  }
  if(!valid)throw new Error("Dedicated owner database not verified: "+owner);
  return scope;
}
function inspect(owner,requireHealthy=true) {
  const result=JSON.parse(docker(["inspect",project+"-"+owner+"-1"]))[0];
  const labels=result.Config.Labels;
  if(labels["com.docker.compose.project"]!==project||labels["com.docker.compose.service"]!==owner||labels["com.bthwani.environment"]!=="refoundation")throw new Error("Unexpected container ownership: "+owner);
  const env=asEnv(result.Config.Env);
  if(env.BTHWANI_ISOLATED_TEST_MODE!=="true"||env.BTHWANI_ISOLATED_CONTAINER_MODE!=="true")throw new Error("Not an isolated owner: "+owner);
  assertOwnerDatabase(owner,env);
  if(owner==="wlt"&&labels["com.bthwani.capability"]!=="customer-wallet-read-only")throw new Error("WLT read-only runtime not proven");
  if(requireHealthy&&(!result.State.Running||result.State.Health?.Status!=="healthy"))throw new Error("Existing owner not healthy: "+owner);
  return result;
}
export function selectOwners({ candidates, activateCaptain, currentCaptain }) {
  const selected = new Set(candidates);
  if (activateCaptain && !currentCaptain) { selected.add("dsh"); selected.add("identity"); }
  return Object.keys(owners).filter(o => selected.has(o));
}
export function assertSameHashes(expected, actual) {
  if (differingKeys(expected, actual).length) throw new Error("Existing Compose configuration cannot be reconstructed exactly; refusing replacement");
}
// WLT has its own configuration-verification group. Never replace a
// mismatched owner; ordinary reconciliation may still inspect the other group.
export function wltConfigReviewRequired(expected, actual, mode) {
  if (!differingKeys(expected,actual).length) return false;
  if (["--check","--apply","--apply-preview"].includes(mode) &&
      Object.keys(expected).length === 1 && Object.keys(actual).length === 1 &&
      /^[a-f0-9]{64}$/.test(expected.wlt || "") && /^[a-f0-9]{64}$/.test(actual.wlt || "")) return true;
  assertSameHashes(expected,actual);
}
export function composeFileNames(label, repoRoot = root) {
  const expected = repoRoot.replaceAll("/", "\\").toLowerCase() + "\\infra\\compose.yaml";
  if (typeof label !== "string" || label.replaceAll("/", "\\").toLowerCase() !== expected)
    throw new Error("Unowned Compose file: serving owner must use the canonical Compose input");
  return ["compose.yaml"];
}
function configHashes(names, env) {
  const lines = docker([...composeArgs(),"config","--hash",names.join(",")],env).split(/\r?\n/);
  const result = Object.fromEntries(lines.map(l=>l.trim().split(/\s+/)));
  if(Object.keys(result).length!==names.length || names.some(o=>!/^[a-f0-9]{64}$/.test(result[o]||""))) throw new Error("Incomplete Compose hash");
  return result;
}
function currentHashes(state, names) {
  return Object.fromEntries(names.map(o => [o, state[o].Config.Labels["com.docker.compose.config-hash"]]));
}
export function isKnownImageConfigPair(image,hash,previous,candidate) {
  return (image===previous.image&&hash===previous.hash)||(image===candidate.image&&hash===candidate.hash);
}
function imageRecord(image) {
  return JSON.parse(docker(["image", "inspect", image]))[0];
}
// Compose owns the only image build definition; the caller owns source admission.
export function ownerBuildPlan(owner, head, tag, service, digest = null) {
  if (!Object.hasOwn(owners, owner) || !/^[0-9a-f]{40}$/.test(head) ||
      !/^[a-z0-9._-]+$/.test(tag) || (digest !== null && !/^[0-9a-f]{64}$/.test(digest)))
    throw new Error("Invalid owner build identity");
  return {
    args: [...composeArgs(), "build", owner],
    env: {
      [owners[owner].tag]: tag,
      BTHWANI_BUILD_CONTEXT: service,
      BTHWANI_BUILD_REVISION: digest ? "worktree-" + digest : head,
      BTHWANI_BUILD_SHA: digest ? "" : head,
      BTHWANI_BUILD_PREVIEW_BASE: digest ? head : "",
      BTHWANI_BUILD_PREVIEW_DIGEST: digest || "",
    },
    image: owners[owner].image + ":" + tag,
  };
}
function buildOwnerImage(owner, head, tag, service, snapshot) {
  const pin = readFileSync(resolve(root,".go-version"),"utf8").trim();
  const file = resolve(service,"backend","Dockerfile");
  if (!readFileSync(file,"utf8").split(/\r?\n/).some(line =>
    line.startsWith("FROM golang:"+pin+"-alpine@sha256:") && /@sha256:[0-9a-f]{64} AS build$/.test(line)))
    throw new Error("Pinned owner Dockerfile required");
  const preview=snapshot.revision===null;
  if(snapshot.owner!==owner||(!preview&&snapshot.revision!==head))throw new Error("Snapshot source identity mismatch");
  const assertSource = () => {
    if (git(["rev-parse","HEAD"]) !== head) throw new Error("Source changed during image build");
    verifyMaterializedOwner(service,snapshot);
    if(preview){
      if(captureOwner(root,owner).digest!==snapshot.digest)throw new Error("Preview input changed during build: "+owner);
    }else if(dirtyPaths(root, ["services/"+owner, ".go-version", ...ownerComposeInputs,
      "tools/dev/docker/reconcile-owner-runtime.mjs","tools/dev/docker/owner-preview-source.mjs"]).length){
      throw new Error("Owner or shared build input is not committed");
    }
  };
  const digest=preview?snapshot.digest:null;
  const plan = ownerBuildPlan(owner,head,tag,service,digest);
  assertSource();
  docker(plan.args,plan.env,180000);
  assertSource();
  const image = imageRecord(plan.image);
  const source = sourceIdentity(image.Config.Labels,owner);
  if (source.revision !== head || source.digest !== digest ||
      !/^sha256:[0-9a-f]{64}$/.test(image.Id) ||
      (!preview && image.Config.Labels["com.bthwani.source-sha"] !== head) ||
      image.Config.Labels["org.opencontainers.image.revision"] !== plan.env.BTHWANI_BUILD_REVISION)
    throw new Error("New image source mismatch: "+owner);
  return image;
}
function ownerRevision(state,owner) { return sourceIdentity(imageRecord(state[owner].Image).Config.Labels,owner); }
const guardedScope = ["services",...ownerComposeInputs,"tools/dev/dev.ps1","tools/dev/dev-resource-admission.ps1","tools/dev/docker/owner-baseline-transition.mjs","tools/dev/docker/owner-preview-source.mjs","tools/dev/docker/compose-runtime-transition.mjs","tools/dev/docker/reconcile-owner-runtime.mjs","tests/infra/verify-isolated-postgres.ps1","tools/dev/provision-wlt-test-db.ps1","tools/dev/check-go.mjs",".go-version"];
function currentChangeKey(committed, preview, captain, wltConfigDrift=false) {
  const changed=dirtyPaths(root,guardedScope);
  const plan=ownerReconcilePlan({changed,committed,preview,captain,wltConfigDrift});
  const go=changed.filter(p=>isPreviewGoPath(p) && plan.eligible.some(o=>p.startsWith("services/"+o+"/")));
  // Blocked inputs cannot be built; only their paths/review classification
  // affect selection. Eligible Go bytes must remain exactly stable.
  const key=createHash("sha256").update(JSON.stringify([changed,plan])).update(previewChangeKey(root,go)).digest("hex");
  return {changed,plan,key};
}
function checkedHead(head, key, committed, preview, captain, wltConfigDrift=false) {
  const currentBranch = git(["branch", "--show-current"]);
  if (!currentBranch || currentBranch === "main" || currentBranch.startsWith("archive/")) throw new Error("Not an active development branch");
  if (git(["rev-parse", "HEAD"]) !== head || currentChangeKey(committed,preview,captain,wltConfigDrift).key !== key) throw new Error("Source changed during reconciliation");
}
function validateVolumeFiles(headTag) {
  for (const [volume, paths] of [["bthwani-refoundation-captain-dsh-ca", ["/proof/ca.pem"]], ["bthwani-refoundation-captain-dsh-tls", ["/proof/server.pem","/proof/server-key.pem"]]]) {
    docker(["volume", "inspect", "--format", "{{.Name}}", volume]);
    // Only test readability using the same non-root UID; never print key bytes or write the volume.
    docker(["run","--rm","--pull","never","--network","none","--read-only","--cap-drop","ALL","--security-opt","no-new-privileges:true","--user","65532:65532","--mount","type=volume,src="+volume+",dst=/proof,readonly","--entrypoint","/bin/sh","bthwani-refoundation-dsh:"+headTag,"-c",paths.map(p=>"test -s "+p+" && test -r "+p).join(" && ")]);
  }
}
export function isolatedTestEnv(env) {
  return {...Object.fromEntries(Object.entries(env).filter(([k]) => !/^(BTHWANI_|DSH_|IDENTITY_|WLT_|REF_|PG[A-Z]|DATABASE_URL$)/i.test(k))), GOTOOLCHAIN:"local"};
}
// This is a preparation proof only, not permission to switch a retained
// namespace. Reuse the existing network-disabled PostgreSQL rehearsal.
export function baselineProofOwners({apply,prepare,blocked,dirtyInputs}) {
  if(!apply || !prepare || dirtyInputs.length) return [];
  return Object.keys(owners).filter(o=>blocked[o]==="SCHEMA_REVIEW_REQUIRED");
}
export function verifyBaselineProofOutput(output) {
  const expected=["PG_FRESH_DSH_BASELINE","PG_READER_ACCESS","PG_RESTORE_READBACK","PG_DSH_DEDICATED_RUNTIME","PG_FRESH_IDENTITY_BASELINE","PG_FRESH_WLT_BASELINE","PG_WLT_AGREEMENT_COMMAND","PG_BASELINE_TRANSITION_DSH","PG_BASELINE_TRANSITION_IDENTITY","PG_BASELINE_TRANSITION_WLT","PG_ISOLATION"];
  for(const name of expected) {
    const evidence=output.split(/\r?\n/).filter(line=>line.startsWith(name+"="));
    if(evidence.length!==1 || !(evidence[0]===name+"=PASS" || evidence[0].startsWith(name+"=PASS "))) throw new Error("BASELINE_PROOF_INCOMPLETE "+name);
  }
}
const baselineProofScope=["services/identity/database","services/dsh/database","services/wlt/database","services/dsh/backend/internal/dbscope","services/dsh/backend/go.mod","services/dsh/backend/go.sum","tests/infra/verify-isolated-postgres.ps1","tools/dev/provision-wlt-test-db.ps1","tools/dev/check-go.mjs",".go-version","tools/dev/docker/owner-baseline-transition.mjs","infra/compose.yaml"];
function rebaseAndApply(owner,state,env,head,tag,targetId,ensureSource) {
  const old=state[owner], live=asEnv(old.Config.Env);
  const schema=assertOwnerDatabase(owner,live).schema;
  const archive="bthwani_recovery_"+owner+"_"+randomBytes(6).toString("hex");
  const scope=transitionScope(owner,schema,archive);
  const pg=project+"-postgres-1";
  if(docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}',pg])!==project+"|refoundation|healthy")
    throw new Error("PostgreSQL owner not verified");
  const sql=(statement,timeout=30000)=>docker(["exec","-i",pg,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","bthwani_refoundation_admin","-d",scope.database,"-f","-"],{},timeout,statement+"\n");
  const before=sql("BEGIN READ ONLY; SELECT oid FROM pg_namespace WHERE nspname='"+schema+"' AND pg_get_userbyid(nspowner)='"+scope.owner+"'; COMMIT;");
  if(!/^[0-9]+$/.test(before))throw new Error("Owner namespace not verified");
  if(owner==="wlt" && sql("BEGIN READ ONLY; SELECT "+wltCommandRoleInactiveSQL+"; COMMIT;")!=="t")
    throw new Error("WLT_COMMAND_ROLE_HANDOFF_REQUIRED");
  const transaction=buildOwnerBaselineTransition(owner,schema,archive);
  const candidateEnv={...env,[owners[owner].tag]:tag};
  const groupNames=owner==="wlt"?["wlt"]:["dsh","identity"];
  assertSameHashes(currentHashes(state,groupNames),configHashes(groupNames,env));
  const hashes=configHashes(groupNames,candidateEnv);
  if(groupNames.some(o=>o!==owner&&hashes[o]!==currentHashes(state,[o])[o]))throw new Error("Schema transition changes peer configuration");
  ensureSource();
  if(Object.keys(owners).some(o=>inspect(o).Id!==state[o].Id)||imageRecord(owners[owner].image+":"+tag).Id!==targetId||imageRecord(old.Config.Image).Id!==old.Image)
    throw new Error("Concurrent owner or image change");
  markAutomaticPhase("mutating");
  let stopped=false,committed=false,applyStarted=false;
  try {
    console.log("OWNER_APPLY_STARTED "+owner);
    docker(["stop","--time","20",old.Id],{},45000); stopped=true;
    if(inspect(owner,false).State.Running)throw new Error("Legacy writer still active");
    ensureSource();
    if(sql(transaction,120000)!=="OWNER_BASELINE_TRANSITION_PASS")throw new Error("Owner baseline transaction result not proven");
    committed=true;
    const readback=sql("BEGIN READ ONLY; SELECT (SELECT oid FROM pg_namespace WHERE nspname='"+archive+"')::text||'|'||(SELECT oid FROM pg_namespace WHERE nspname='"+schema+"')::text||'|'||has_schema_privilege('"+scope.runtime+"','"+archive+"','USAGE')::text; COMMIT;");
    if(!new RegExp("^"+before+"\\|[0-9]+\\|false$").test(readback)||readback.split("|")[1]===before)
      throw new Error("Committed owner namespace readback mismatch");
    console.log("OWNER_SCHEMA_PASS "+owner+" HEAD="+head+" RECOVERY="+archive);
    // Once SQL commits, the old image must not serve the new schema. Promote
    // the tested immutable candidate even if a later HEAD arrives; the final
    // source check will schedule its successor. Never roll back image-only.
    if(imageRecord(owners[owner].image+":"+tag).Id!==targetId)throw new Error("Candidate image tag changed");
    applyStarted=true;
    docker([...composeArgs(),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",owner],candidateEnv,95000);
    const now=inspect(owner);
    if(now.Image!==targetId||ownerRevision({[owner]:now},owner).revision!==head||now.Config.Labels["com.docker.compose.config-hash"]!==hashes[owner]||Object.keys(owners).some(o=>o!==owner&&inspect(o).Id!==state[o].Id))
      throw new Error("Owner schema/image readback mismatch");
    if(owner!=="wlt"){
      const args=owner==="dsh"?["/usr/local/bin/dsh","-mode=verify-development-db"]:["/usr/local/bin/identity","verify-development-db"];
      if(!docker(["exec",now.Id,...args],{},15000).includes(owner.toUpperCase()+"_DEVELOPMENT_DATABASE_PASS"))throw new Error("Serving owner principal not verified");
    }
    state[owner]=now; env[owners[owner].tag]=tag;
    console.log("OWNER_RUNTIME_PASS "+owner+" "+now.Id);
    console.log("OWNER_APPLY_VERIFIED "+owner);
  } catch(e) {
    if(e.code==="ETIMEDOUT"||committed||applyStarted)throw new Error("ROLLBACK_BLOCKED owner schema or runtime transition requires durable readback: "+owner);
    if(stopped){
      // The SQL transaction must be proven rolled back by the original OID,
      // not merely a failed psql status, before restoring the old writer.
      const proof=sql("BEGIN READ ONLY; SELECT coalesce((SELECT oid::text FROM pg_namespace WHERE nspname='"+schema+"'),'missing')||'|'||coalesce((SELECT oid::text FROM pg_namespace WHERE nspname='"+archive+"'),'missing'); COMMIT;");
      if(proof!==before+"|missing"||inspect(owner,false).Id!==old.Id||inspect(owner,false).State.Running)throw new Error("ROLLBACK_BLOCKED owner database state uncertain: "+owner);
      docker(["start",old.Id],{},45000);
      if(!inspect(owner,false).State.Running || inspect(owner,false).Id!==old.Id)throw new Error("ROLLBACK_READBACK_FAILED "+owner);
      throw new VerifiedRuntimeRollback("ROLLBACK_PASS "+owner+" incompatible owner baseline; original writer restored");
    }
    throw new Error("ROLLBACK_BLOCKED owner stop outcome not proven: "+owner);
  }
  markAutomaticPhase("ready");
}

// The process identity is the executed Node entry point, not a filename
// mentioned by Graphify, tests or another script in its arguments.
// Unreadable or option-prefixed ambiguous invocations fail closed.
export function conflictingReconcilerProcesses(records, ownPid) {
  if(!Array.isArray(records))throw new Error("RUNTIME_PROCESS_INVENTORY_INVALID");
  return records.filter(row=>{
    if(!Number.isSafeInteger(row.ProcessId)||row.ProcessId<=0)throw new Error("RUNTIME_PROCESS_INVENTORY_INVALID");
    if(row.ProcessId===ownPid)return false;
    if(typeof row.CommandLine!=="string"||!row.CommandLine.trim())return true;
    const command=row.CommandLine;
    const entry=/^\s*(?:"[^"]+"|[^\s"]+)\s+(?:"([^"]+)"|([^\s"]+))(?=\s|$)/.exec(command);
    const script=entry?.[1]??entry?.[2];
    if(script&&/(?:^|[\\/])reconcile-owner-runtime\.mjs$/i.test(script))return true;
    if(script&&!script.startsWith("-")&&/\.(?:mjs|cjs|js|ts)$/i.test(script))return false;
    return /reconcile-owner-runtime\.mjs/i.test(command);
  }).map(row=>row.ProcessId);
}

function assertNoOrphanReconciler() {
  const inventory=run("pwsh",["-NoProfile","-NonInteractive","-Command",
    "$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Select-Object ProcessId,CommandLine); ConvertTo-Json -InputObject $rows -Compress"]);
  if(conflictingReconcilerProcesses(JSON.parse(inventory),process.pid).length)
    throw new Error("Previous owner reconciler is still active or process identity is unproven");
}

function verifyRecoveryOwners(state) {
  assertNoOrphanReconciler();
  for(const owner of ["dsh","identity"]){
    const args=owner==="dsh"?["/usr/local/bin/dsh","-mode=verify-development-db"]:["/usr/local/bin/identity","verify-development-db"];
    if(!docker(["exec",state[owner].Id,...args],{},15000).includes(owner.toUpperCase()+"_DEVELOPMENT_DATABASE_PASS"))
      throw new Error("Serving owner principal not verified: "+owner);
    console.log("RECOVERY_OWNER_READBACK_PASS "+owner);
  }
  const wlt=new URL(asEnv(state.wlt.Config.Env).WLT_TEST_DATABASE_URL);
  if(wlt.hostname!=="postgres"||wlt.pathname!=="/bthwani_wlt_test"||wlt.username!=="bthwani_wlt_reader")
    throw new Error("WLT recovery database scope mismatch");
  const pg=project+"-postgres-1";
  if(docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}',pg])!==project+"|refoundation|healthy")
    throw new Error("PostgreSQL owner not verified");
  // Read only. Re-attest the serving reader and required relations without
  // exporting credentials or touching balances, journals or protected rows.
  const sql="BEGIN READ ONLY; SET LOCAL ROLE bthwani_wlt_reader; SELECT current_database()='bthwani_wlt_test' AND current_user='bthwani_wlt_reader' AND has_schema_privilege('wlt','USAGE') AND NOT has_schema_privilege('wlt','CREATE') AND to_regclass('wlt.customer_funding_journal') IS NOT NULL AND to_regclass('wlt.customer_funding_entries') IS NOT NULL AND has_table_privilege('wlt.customer_wallet_balances','SELECT') AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wlt' AND c.relkind IN ('r','p','v','m') AND (has_table_privilege(c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') OR has_any_column_privilege(c.oid,'INSERT,UPDATE,REFERENCES'))); COMMIT;";
  if(docker(["exec","-i",pg,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","bthwani_refoundation_admin","-d","bthwani_wlt_test","-f","-"],{},30000,sql+"\n")!=="t")
    throw new Error("WLT serving reader not verified");
  console.log("RECOVERY_OWNER_READBACK_PASS wlt");
  for(const owner of Object.keys(owners)){
    const now=inspect(owner), before=state[owner];
    if(now.Id!==before.Id||now.Image!==before.Image||now.State.StartedAt!==before.State.StartedAt||
       now.Config.Labels["com.docker.compose.config-hash"]!==before.Config.Labels["com.docker.compose.config-hash"])
      throw new Error("Concurrent owner change: "+owner);
  }
  assertNoOrphanReconciler();
}

// Recovery attests the already serving state, not the desired image plan.
// The existing native Compose engine and owner database readers are the
// proof owners. No application, schema, image, credential or volume write.
function verifyReviewedServingBaseline(head,branch) {
  const scope=[...ownerComposeInputs,"tools/dev/docker/compose-runtime-transition.mjs","tools/dev/docker/reconcile-owner-runtime.mjs","tools/dev/docker/owner-baseline-transition.mjs","tools/dev/docker/owner-preview-source.mjs","tools/dev/sync-lenovo-reconciliation.mjs","tools/dev/dev.ps1","tools/dev/dev-resource-admission.ps1"];
  const ensureSource=()=>{
    if(git(["rev-parse","HEAD"])!==head||git(["branch","--show-current"])!==branch||dirtyPaths(root,scope).length)
      throw new Error("Recovery attestation source changed or is uncommitted");
  };
  const verifyOwners=state=>{
    for(const owner of Object.keys(owners)){
      const observed=inspect(owner);
      if(observed.Id!==state[owner].Id||observed.Image!==state[owner].Image)throw new Error("Concurrent owner change: "+owner);
      const revision=ownerRevision(state,owner);
      if(revision.digest)throw new Error("Recovery requires committed serving provenance: "+owner);
      git(["merge-base","--is-ancestor",revision.revision,head]);
      const database=assertOwnerDatabase(owner,asEnv(observed.Config.Env));
      const {schema,runtime}=database;
      // Verify the active namespace and all retained recovery namespaces.
      // Read-only catalog proof; no role grant, archive mutation or data export.
      const sql="BEGIN READ ONLY; SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='"+schema+"' AND pg_get_userbyid(nspowner)='"+database.owner+"') AND NOT EXISTS(SELECT 1 FROM pg_namespace n WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN('information_schema','public','"+schema+"') AND (nspname !~ '"+database.archive.source+"' OR pg_get_userbyid(nspowner)<>'"+database.owner+"' OR has_schema_privilege('"+runtime+"',n.oid,'USAGE,CREATE'))); COMMIT;";
      const result=docker(["exec","-i",project+"-postgres-1","psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","bthwani_refoundation_admin","-d",database.database,"-f","-"],{},30000,sql+"\n");
      if(result!=="t")throw new Error("Retained namespace or owner scope unproven: "+owner);
      console.log("RECOVERY_SERVING_PROVENANCE "+owner+" revision="+revision.revision);
    }
    // A stable reader is distinct from the future command role. Verify the
    // existing synthetic ledger without granting or activating that role.
    const ledger="BEGIN READ ONLY; SELECT NOT EXISTS(SELECT 1 FROM wlt.customer_funding_journal WHERE provider_id NOT IN('sandbox','sandbox-reversal')) AND NOT EXISTS(SELECT funding_id FROM wlt.customer_funding_entries GROUP BY funding_id HAVING count(*)<>2 OR sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END)<>0); COMMIT;";
    if(docker(["exec","-i",project+"-postgres-1","psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","bthwani_refoundation_admin","-d","bthwani_wlt_test","-f","-"],{},30000,ledger+"\n")!=="t")
      throw new Error("Retained WLT ledger proof failed");
    verifyRecoveryOwners(state);
  };
  reconcileComposeConfiguration({docker,git,root,head,previous:null,apply:false,verifyOwners,ensureSource});
}

// The exact reviewed state and its receipt must stay unchanged during
// readback. A settled receipt is never overwritten by another recovery.
export function recoverRuntimeAttempt({stateFile,receiptFile,key,safeOnly,assertExclusive,verifyCurrent}) {
  const reviewed=readFileSync(stateFile,"utf8");
  const attempt=JSON.parse(reviewed);
  if(attempt.version!==1||attempt.key!==key||!/^[a-f0-9]{64}$/.test(key)||!["running","uncertain"].includes(attempt.status))
    throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  const readReceipt=()=>{
    try{return readFileSync(receiptFile,"utf8");}
    catch(error){if(error.code==="ENOENT")return null;throw error;}
  };
  assertExclusive();
  if(runtimeReceiptStatus(stateFile,receiptFile)!==null)throw new Error("RUNTIME_ATTEMPT_ALREADY_SETTLED");
  const receipt=readReceipt();
  const ready=runtimeAttemptPhase(stateFile,receiptFile,key,attempt.attempt)==="ready";
  if(safeOnly&&!ready)throw new Error("RUNTIME_SAFE_BOUNDARY_NOT_PROVEN");
  if(!ready)verifyCurrent();
  assertExclusive();
  if(readReceipt()!==receipt)throw new Error("RUNTIME_RECEIPT_CHANGED");
  acknowledgeRuntimeRecovery(stateFile,receiptFile,key,reviewed,ready);
  console.log((ready?"RUNTIME_SAFE_BOUNDARY_REARMED":"RUNTIME_REVIEWED_BASELINE_REARMED")+" key="+key.slice(0,12));
}

export function assertSourceHost(machineName, reportedName, checkoutRoot) {
  if (machineName?.toUpperCase() !== "BTHWANI" ||
    (reportedName && reportedName.toUpperCase() !== "BTHWANI") ||
    checkoutRoot.toLowerCase() !== "d:\\samrim") throw new Error("Wrong source host");
}

export function parseReconcileArgs(argv) {
  const [mode, ...options] = argv;
  const build = mode === "--build-only";
  const recover = ["--recover-attempt","--recover-safe"].includes(mode);
  const configuration = ["--check-config", "--apply-config"].includes(mode);
  const prepare = options.length === 1 && options[0] === "--prepare-baseline";
  if (!["--check", "--apply", "--apply-preview", "--apply-captain", "--recover-attempt", "--recover-safe", "--build-only", "--check-config", "--apply-config"].includes(mode))
    throw new Error("Usage: --check | --apply [--prepare-baseline] | --apply-preview [--prepare-baseline] | --apply-captain | --recover-attempt KEY | --recover-safe KEY | --build-only OWNER | --check-config REVISION | --apply-config REVISION");
  if (build) {
    if (options.length !== 1 || !Object.hasOwn(owners, options[0])) throw new Error("Expected one owner for --build-only");
  } else if (recover) {
    if (options.length !== 1 || !/^[a-f0-9]{64}$/.test(options[0])) throw new Error("Expected exact reviewed runtime attempt key");
  } else if (configuration) {
    if (options.length !== 1 || !/^[a-f0-9]{40}$/.test(options[0])) throw new Error("Expected exact reviewed Compose source revision");
  } else if (options.length && (!prepare || !["--apply", "--apply-preview"].includes(mode))) {
    throw new Error("Baseline preparation requires an explicit isolated apply");
  }
  return { mode, options, build, recover, configuration, prepare, apply: ["--apply", "--apply-preview", "--apply-captain", "--apply-config"].includes(mode) };
}
let activeAttempt=null;
function attemptFiles() {
  if(!process.env.LOCALAPPDATA)throw new Error("Missing runtime attempt directory");
  const directory=resolve(process.env.LOCALAPPDATA,"BThwani","Operations","SourceSync");
  return {stateFile:resolve(directory,"runtime-reconcile.json"),receiptFile:resolve(directory,"runtime-reconcile.receipt.json")};
}
function openAutomaticAttempt(mode) {
  if(!["--apply","--apply-preview"].includes(mode))return null;
  const key=process.env.BTHWANI_RUNTIME_ATTEMPT_KEY,attempt=process.env.BTHWANI_RUNTIME_ATTEMPT_ID;
  if(!key&&!attempt)return null;
  const files=attemptFiles();
  if(!key||!attempt||runtimeAttemptPhase(files.stateFile,files.receiptFile,key,attempt)!=="ready")
    throw new Error("RUNTIME_SAFE_BOUNDARY_NOT_PROVEN");
  return {...files,key,attempt};
}
function markAutomaticPhase(phase) {
  if(activeAttempt){
    const {stateFile,receiptFile,key,attempt}=activeAttempt;
    recordRuntimePhase(stateFile,receiptFile,key,attempt,phase);
  }
}
function settleAutomaticAttempt(status) {
  if(activeAttempt) {
    const {stateFile,receiptFile,key,attempt}=activeAttempt;
    acknowledgeRuntimeAttempt(stateFile,receiptFile,key,attempt,status);
  }
}
function assertUnusedBuildTag(reference) {
  if(docker(["ps","-a","--format","{{.Image}}"]).split(/\r?\n/).includes(reference))
    throw new Error("Build-only tag is in use by a container");
}
function main() {
  const {mode,options,build,recover,configuration,prepare,apply}=parseReconcileArgs(process.argv.slice(2));
  if((build||apply||recover)&&process.env.BTHWANI_UNIFIED_DEV_RECONCILE!=="1")throw new Error("Use the unified dev launcher with its Docker resource lease");
  assertSourceHost(hostname(),process.env.COMPUTERNAME,root);
  if(docker(["context","inspect",context,"--format","{{.Endpoints.docker.Host}}"])!=="ssh://bthwa@bthwani-docker")throw new Error("Wrong Docker target");
  const head=git(["rev-parse","HEAD"]),branch=git(["branch","--show-current"]);
  if(!/^[a-f0-9]{40}$/.test(head)||!branch||branch==="main"||branch.startsWith("archive/"))throw new Error("Not an active development branch");
  activeAttempt=openAutomaticAttempt(mode);
  if (configuration) {
    const scope = [...ownerComposeInputs, "tools/dev/docker", "tools/dev/dev.ps1", "tools/dev/dev-resource-admission.ps1"];
    const ensureSource = () => {
      if (git(["rev-parse", "HEAD"]) !== head || dirtyPaths(root, apply ? scope : ownerComposeInputs).length)
        throw new Error("Compose transition source changed or is not committed");
    };
    reconcileComposeConfiguration({ docker, git, root, head, previous: options[0], apply, verifyOwners: verifyRecoveryOwners, ensureSource });
    return;
  }
  if(build){
    const [owner]=options,tag="build-"+head;
    const reference=owners[owner].image+":"+tag;
    assertUnusedBuildTag(reference);
    const snapshot=captureCommittedOwner(root,owner,head);
    const staged=materializeOwner(snapshot);
    let image;
    try{image=buildOwnerImage(owner,head,tag,staged.dir,snapshot);}
    finally{staged.dispose();}
    console.log("OWNER_IMAGE_BUILT "+owner+" tag="+tag+" image="+image.Id);
    return;
  }
  if(recover){
    recoverRuntimeAttempt({
      ...attemptFiles(), key:options[0], safeOnly:mode==="--recover-safe",
      assertExclusive:assertNoOrphanReconciler,
      verifyCurrent:()=>verifyReviewedServingBaseline(head,branch),
    });
    return;
  }
  const state = Object.fromEntries(Object.keys(owners).map(o => [o, inspect(o)]));
  const captain=asEnv(state.identity.Config.Env).IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION==="true";
  for (const owner of Object.keys(owners))
    composeFileNames(state[owner].Config.Labels["com.docker.compose.project.config_files"]);
  const env = {};
  for (const [o, v] of Object.entries(state)) {
    const prefix = owners[o].image + ":";
    if (!v.Config.Image.startsWith(prefix)) throw new Error("Wrong image owner " + o);
    if (imageRecord(v.Config.Image).Id !== v.Image) throw new Error("Running rollback image tag drift: " + o);
    env[owners[o].tag] = v.Config.Image.slice(prefix.length);
  }
  // Preserve existing explicitly enabled Operator preview flags, including their
  // origin, without writing credentials or silently reverting active sessions.
  // Reconstruct the exact running DSH settings only for attestation and
  // rollback. Normal Compose no longer injects the cluster administrator.
  const dshEnv=asEnv(state.dsh.Config.Env);
  for(const [name,key] of Object.entries({REF_POSTGRES_USER:"REF_DSH_RUNTIME_USER",REF_POSTGRES_PASSWORD:"REF_DSH_RUNTIME_PASSWORD",REF_POSTGRES_DB:"REF_DSH_RUNTIME_DATABASE"})){
    if(!dshEnv[name]) throw new Error("Missing existing DSH database configuration: "+name);
    env[key]=dshEnv[name];
  }
  const identityEnv = asEnv(state.identity.Config.Env);
  // Preserve the actual admitted settings formerly encoded by overlays.
  // Values are read from the verified existing owner containers, never inferred from an application.
  for (const [value,key] of [
    [dshEnv.DSH_ENABLE_ISOLATED_MERCHANT_STANDING,"REF_DSH_ENABLE_ISOLATED_MERCHANT_STANDING"],
    [dshEnv.DSH_ENABLE_ISOLATED_CAPTAIN_STANDING,"REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING"],
    [identityEnv.IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION,"REF_IDENTITY_CAPTAIN_ADMISSION"],
  ]) {
    if(value!==undefined&&!["true","false"].includes(value))throw new Error("Invalid running owner admission setting: "+key);
    env[key]=value??"false";
  }
  for(const [value,key,allowed] of [
    [dshEnv.DSH_ISOLATED_CAPTAIN_TLS_CERT,"REF_DSH_PRIVATE_TLS_CERT","/run/dsh-captain-tls/server.pem"],
    [dshEnv.DSH_ISOLATED_CAPTAIN_TLS_KEY,"REF_DSH_PRIVATE_TLS_KEY","/run/dsh-captain-tls/server-key.pem"],
  ]) {
    if(value&&value!==allowed)throw new Error("Unexpected running private TLS path");
    env[key]=value??"";
  }
  if(captain&&(env.REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING!=="true"||!env.REF_DSH_PRIVATE_TLS_CERT||!env.REF_DSH_PRIVATE_TLS_KEY))throw new Error("Active peer trust is incomplete");
  env.REF_IDENTITY_RUNTIME_DATABASE_URL=identityEnv.IDENTITY_TEST_DATABASE_URL;
  for (const [name, key] of Object.entries(operatorOverrides)) {
    if (!Object.hasOwn(identityEnv,name)) throw new Error("Missing current Operator setting: " + name);
    env[key] = identityEnv[name];
  }
  const groups=[{names:["dsh","identity"]},{names:["wlt"]}];
  let wltConfigDrift=false;
  for(const group of groups)
    if(wltConfigReviewRequired(currentHashes(state,group.names),configHashes(group.names,env),mode))wltConfigDrift=true;
  const revisions=Object.fromEntries(Object.keys(owners).map(o=>[o,ownerRevision(state,o)]));
  const committed={};
  for(const o of Object.keys(owners)){
    git(["merge-base","--is-ancestor",revisions[o].revision,head]);
    committed[o]=git(["diff","--name-only","--no-renames",revisions[o].revision,head,"--","services/"+o]).split(/\r?\n/).filter(Boolean);
  }
  const preview=mode==="--apply-preview" || !apply;
  const change=currentChangeKey(committed,preview,captain,wltConfigDrift);
  const ensureSource=()=>checkedHead(head,change.key,committed,preview,captain,wltConfigDrift);
  let blocked=change.plan.blocked;
  const schemaReady=[];
  let baselineFailed=false;
  const proofOwners=baselineProofOwners({apply,prepare,blocked,dirtyInputs:dirtyPaths(root,baselineProofScope)});
  if(proofOwners.length){
    ensureSource();
    console.log("BASELINE_PROOF_STARTED HEAD="+head+" OWNERS="+proofOwners.join(","));
    try {
      const proof=run("pwsh",["-NoProfile","-File","tests/infra/verify-isolated-postgres.ps1","-DockerContext",context,"-NoPull"],{},360000);
      verifyBaselineProofOutput(proof);
      ensureSource();
      if(dirtyPaths(root,baselineProofScope).length)throw new Error("Baseline proof inputs changed during rehearsal");
      schemaReady.push(...proofOwners);
      blocked=ownerReconcilePlan({changed:change.changed,committed,preview,captain,schemaReady,wltConfigDrift}).blocked;
      console.log("BASELINE_PROOF_PASS HEAD="+head+" OWNERS="+proofOwners.join(",")+" CUTOVER=ELIGIBLE_IF_COMPATIBLE");
    } catch(e) {
      ensureSource();
      baselineFailed=true;
      console.error("BASELINE_PROOF_FAIL "+e.message);
      // A failed disposable rehearsal does not authorize SQL; independently
      // eligible image-only owners can still advance.
    }
  }
  let partial=Object.keys(blocked).length>0;
  const holds=Object.values(blocked);
  if(mode==="--apply-captain" && (partial || change.changed.length)) throw new Error("Captain activation requires a fully reviewed committed source");
  const snapshots=new Map();
  const candidates=[];
  for(const o of Object.keys(owners)){
    const old=revisions[o];
    if(blocked[o]){
      console.log(o+" RUNTIME=BLOCKED revision="+old.revision+" reason="+blocked[o]);
      continue;
    }
    const source=ownerSourceState(o,change.changed,committed[o]);
    const dirty=change.changed.some(p=>p.startsWith("services/"+o+"/"));
    if(source.clientPending && dirty) partial=true;
    if(dirty && old.digest && !preview) {
      partial=true;
      holds.push("PREVIEW_NOT_AUTHORIZED");
      console.log(o+" RUNTIME=BLOCKED revision="+old.revision+" reason=PREVIEW_NOT_AUTHORIZED");
      continue;
    }
    if(dirty && (source.previewChanges.length || source.imageChanges.length || old.digest)) snapshots.set(o,captureOwner(root,o));
    const snapshot=snapshots.get(o);
    const stale=snapshot ? old.digest!==snapshot.digest || old.revision!==head : Boolean(source.imageChanges.length || old.digest);
    if(stale)candidates.push(o);
    console.log(o+" RUNTIME="+(stale?"STALE":snapshot?"PREVIEW_CURRENT":"CURRENT")+" revision="+old.revision+(old.digest?" preview="+old.digest:"")+(source.clientPending && dirty?" SOURCE=CLIENT_REVIEW_PENDING":""));
  }
  const selected = selectOwners({candidates,activateCaptain:mode==="--apply-captain",currentCaptain:captain});
  console.log("SELECTED="+(selected.join(",")||"NONE")+" HEAD="+head+" CAPTAIN_ADMISSION="+captain);
  const complete = incomplete => {
    console.log("RECONCILE_"+(incomplete?"PARTIAL":"PASS")+" HEAD="+head);
    if(incomplete)process.exitCode=3;
    return runtimeTerminalStatus({partial:incomplete,holds,baselineFailed});
  };
  if (!apply || selected.length===0) return complete(partial || selected.length>0);
  ensureSource();
  const tags={};
  const targetIds={};
  const nextEnv = {...env};
  if(selected.some(o=>committed[o].some(rel=>rel.includes("/contracts/openapi/")||rel.includes("/database/")))){
    ensureSource();
    run("node",["tools/dev/check-openapi.mjs","identity","dsh","wlt"],{},120000);
    run("node",["tools/dev/generate-openapi-operations.mjs","--check"],{},120000);
    ensureSource();
    console.log("OWNER_CONTRACTS_PASS");
  }
  for (const o of selected) {
    // Fresh local unit tests, with the pinned toolchain. No migration or DB writes.
    ensureSource();
    const snap=snapshots.get(o);
    const tag=snap?"preview-"+head.slice(0,9)+"-"+snap.digest:"sha-"+head.slice(0,9);
    tags[o]=tag;
    const snapshot=snap||captureCommittedOwner(root,o,head);
    const staged=materializeOwner(snapshot);
    try {
      const service=staged.dir;
      const pin=readFileSync(resolve(root,".go-version"),"utf8").trim();
      const testEnv={...isolatedTestEnv(process.env),GOWORK:"off"};
      const goExecutable=resolvePinnedGo(pin,testEnv);
      const go=spawnSync(goExecutable,["test","-json","-count=1","./..."],{cwd:resolve(service,"backend"),encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:16*1024*1024,env:testEnv});
      if(go.status!==0){
        const names=[];
        for(const line of (go.stdout||"").split(/\r?\n/)){
          try{const event=JSON.parse(line);if(event.Action==="fail" && /^[A-Za-z0-9_/.+-]+$/.test(event.Package||"") && (!event.Test||/^[A-Za-z0-9_/.+-]+$/.test(event.Test)))names.push(event.Package+(event.Test?":"+event.Test:""));}catch{}
        }
        throw new Error("Owner tests failed: "+o+" "+(go.error?.code||go.status)+" "+names.slice(0,15).join(","));
      }
      console.log("OWNER_TEST_PASS "+o);
      if(activeAttempt)assertUnusedBuildTag(owners[o].image+":"+tag);
      const image=buildOwnerImage(o,head,tag,service,snapshot);
      targetIds[o]=image.Id;
      nextEnv[owners[o].tag]=tag;
      console.log("OWNER_IMAGE_PASS "+o+" "+image.Id+(snap?" preview="+snap.digest:""));
    } finally { staged.dispose(); }
  }
  ensureSource();
  for(const [o,snap] of snapshots) if(captureOwner(root,o).digest!==snap.digest)throw new Error("Preview source changed: "+o);
  const activate = mode==="--apply-captain" && !captain;
  if (activate) {
    validateVolumeFiles(tags.dsh);
    Object.assign(nextEnv,{REF_IDENTITY_CAPTAIN_ADMISSION:"true",REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING:"true",REF_DSH_PRIVATE_TLS_CERT:"/run/dsh-captain-tls/server.pem",REF_DSH_PRIVATE_TLS_KEY:"/run/dsh-captain-tls/server-key.pem"});
  }
  // Re-read every owner before mutation. Do not overwrite another writer.
  for (const o of Object.keys(owners)) {
    const now=inspect(o);
    if(now.Id!==state[o].Id || now.Image!==state[o].Image || now.Config.Labels["com.docker.compose.config-hash"]!==state[o].Config.Labels["com.docker.compose.config-hash"]) throw new Error("Concurrent owner change: "+o);
  }
  // Owner databases are independent. Rebase each selected schema owner
  // with its own transaction before ordinary image-only reconciliation.
  const schemaSelected=selected.filter(o=>schemaReady.includes(o));
  for(const o of ["identity","dsh","wlt"].filter(o=>schemaSelected.includes(o))){
    ensureSource();
    rebaseAndApply(o,state,env,head,tags[o],targetIds[o],ensureSource);
  }
  for(const group of groups){
    const names=group.names.filter(o=>selected.includes(o)&&!schemaSelected.includes(o));
    if(!names.length)continue;
    const peers=Object.keys(owners).filter(o=>!names.includes(o));
    const verifyPeers=()=>{
      for(const o of peers){
        const now=inspect(o),before=state[o];
        if(now.Id!==before.Id||now.Image!==before.Image||now.State.StartedAt!==before.State.StartedAt||now.Config.Labels["com.docker.compose.config-hash"]!==currentHashes(state,[o])[o])
          throw new Error("Concurrent unselected peer change: "+o);
      }
    };
    ensureSource();
    verifyPeers();
    const priorHashes=currentHashes(state,group.names);
    assertSameHashes(priorHashes,configHashes(group.names,env));
    const newHashes=configHashes(group.names,nextEnv);
    if(group.names.some(o=>!names.includes(o)&&newHashes[o]!==priorHashes[o]))throw new Error("Candidate changes an unselected peer");
    for(const o of names){
      if(imageRecord(owners[o].image+":"+tags[o]).Id!==targetIds[o]||imageRecord(state[o].Config.Image).Id!==state[o].Image)throw new Error("Candidate or rollback image tag changed: "+o);
    }
    markAutomaticPhase("mutating");
    const updated={};
    try{
      console.log("OWNER_APPLY_STARTED "+names.join(","));
      docker([...composeArgs(),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",...names],nextEnv,95000);
      for(const o of names){
        const now=inspect(o),source=ownerRevision({[o]:now},o);
        if(now.Image!==targetIds[o]||now.Config.Labels["com.docker.compose.config-hash"]!==newHashes[o]||source.revision!==head||source.digest!==(snapshots.get(o)?.digest||null))throw new Error("Owner readback mismatch: "+o);
        updated[o]=now;
        console.log("OWNER_RUNTIME_PASS "+o+" "+now.Id);
      }
      verifyPeers();
      console.log("OWNER_APPLY_VERIFIED "+names.join(","));
    }catch(e){
      for(const o of names){
        const now=inspect(o,false);
        if(!isKnownImageConfigPair(now.Image,now.Config.Labels["com.docker.compose.config-hash"],{image:state[o].Image,hash:priorHashes[o]},{image:targetIds[o],hash:newHashes[o]}))throw new Error("ROLLBACK_BLOCKED unknown owner state: "+o);
      }
      if(e.code==="ETIMEDOUT")throw new Error("ROLLBACK_BLOCKED ambiguous Docker operation; readback completed, require explicit reconciliation");
      ensureSource();
      verifyPeers();
      assertSameHashes(priorHashes,configHashes(group.names,env));
      for(const o of names)if(imageRecord(state[o].Config.Image).Id!==state[o].Image)throw new Error("ROLLBACK_BLOCKED previous image tag drift: "+o);
      docker([...composeArgs(),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",...names],env,95000);
      for(const o of names){
        const now=inspect(o);
        if(now.Image!==state[o].Image||now.Config.Labels["com.docker.compose.config-hash"]!==priorHashes[o])throw new Error("ROLLBACK_READBACK_FAILED "+o);
      }
      verifyPeers();
      throw new VerifiedRuntimeRollback("ROLLBACK_PASS "+names.join(",")+" after failed replacement: "+e.message);
    }
    markAutomaticPhase("ready");
    for(const o of names){state[o]=updated[o];env[owners[o].tag]=tags[o];}
    if(activate&&names.includes("dsh")&&names.includes("identity")){
      for(const key of ["REF_IDENTITY_CAPTAIN_ADMISSION","REF_DSH_ENABLE_ISOLATED_CAPTAIN_STANDING","REF_DSH_PRIVATE_TLS_CERT","REF_DSH_PRIVATE_TLS_KEY"])env[key]=nextEnv[key];
    }
  }
  ensureSource();
  for(const [o,snap] of snapshots) if(captureOwner(root,o).digest!==snap.digest)throw new Error("RUNTIME_STALE preview input advanced: "+o);
  return complete(partial);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const status=main();
    settleAutomaticAttempt(status);
  } catch (error) {
    // Reuse the single owner outcome policy; an unsuccessful ready attempt
    // requires read-only review, and uncertain mutations retain their hold.
    if(activeAttempt){
      const {stateFile,receiptFile,key,attempt}=activeAttempt;
      const phase=runtimeAttemptPhase(stateFile,receiptFile,key,attempt);
      const status=runtimeFailureStatus(phase,error);
      if(status){
        try{settleAutomaticAttempt(status);}
        catch{console.error("RUNTIME_RECEIPT_WRITE_FAILED");}
      }
    }
    console.error("RUNTIME_RECONCILE_BLOCKED "+error.message);
    process.exitCode=1;
  }
}
