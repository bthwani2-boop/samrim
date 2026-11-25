#!/usr/bin/env node
// Isolated development owner reconciliation; SQL transitions use one verified owner-local transaction. No credential output or volume mutations.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { appendFileSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, readSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePinnedGo } from "../check-go.mjs";
import { acknowledgeRuntimeAttempt, acknowledgeRuntimeRecovery } from "../sync-lenovo-reconciliation.mjs";
import { buildOwnerBaselineTransition, transitionScope } from "./owner-baseline-transition.mjs";
import { captureOwner, dirtyPaths, isPreviewGoPath, materializeOwner, ownerComposeInputs, ownerReconcilePlan, ownerSourceState, previewChangeKey, sourceIdentity, verifyMaterializedOwner } from "./owner-preview-source.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const context = "bthwani-docker";
const project = "bthwani-refoundation";
const owners = {
  dsh: { tag: "REF_DSH_IMAGE_TAG", image: "bthwani-refoundation-dsh", profile: "implementation" },
  identity: { tag: "REF_IDENTITY_IMAGE_TAG", image: "bthwani-refoundation-identity-verifier", profile: "identity-verifier" },
  wlt: { tag: "REF_WLT_IMAGE_TAG", image: "bthwani-refoundation-wlt", profile: "wlt-reader" },
};
const appFiles = Object.freeze(["compose.yaml"]);
const wltFiles = appFiles;
const canonicalComposePath = resolve(root,"infra/compose.yaml");
// These names are accepted only as historical container provenance, not configuration inputs.
const legacyAppFiles = Object.freeze(["compose.yaml","compose.dsh.yaml","compose.identity.yaml","compose.merchant.yaml"]);
const legacyCaptainFile = "compose.captain.yaml";
const legacyWltFiles = Object.freeze(["compose.yaml","compose.wlt.yaml"]);
const operatorOverrides = {
  IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP: "REF_IDENTITY_OPERATOR_BOOTSTRAP",
  IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH: "REF_IDENTITY_OPERATOR_PASSKEY_AUTH",
  IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN: "REF_IDENTITY_OPERATOR_PERMISSION_ADMIN",
  IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR: "REF_IDENTITY_LOCAL_DEV_FIRST_OPERATOR",
  IDENTITY_OPERATOR_PASSKEY_ORIGINS: "REF_IDENTITY_OPERATOR_PASSKEY_ORIGINS",
  IDENTITY_OPERATOR_PASSKEY_RPID: "REF_IDENTITY_OPERATOR_PASSKEY_RPID",
};
const buildScript = "tools/dev/docker/build-owner-image.ps1";
const gitExe = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
// Keep the original identity and exact bytes, never log configuration values.
// The existing exclusive owner-operation coordination still owns the writer.
const compareNames = (a,b) => a<b?-1:a>b?1:0;
function envSnapshot(fd,file) {
  const stat=fstatSync(fd,{bigint:true});
  const identity=entry=>[entry.dev,entry.ino,entry.size,entry.mtimeNs,entry.ctimeNs].map(String);
  const matches=entry=>entry.isFile()&&!entry.isSymbolicLink()&&entry.nlink===1n&&identity(entry).every((v,i)=>v===identity(stat)[i]);
  const samePath=process.platform==="win32"?realpathSync(file).toLowerCase()===resolve(file).toLowerCase():realpathSync(file)===resolve(file);
  if(!stat.isFile()||stat.nlink!==1n||stat.size>1024n*1024n||!samePath||!matches(lstatSync(file,{bigint:true})))throw new Error("Unsafe local configuration");
  const buffer=Buffer.alloc(Number(stat.size)+1);
  let count=0;
  while(count<buffer.length){
    const n=readSync(fd,buffer,count,buffer.length-count,count);
    if(!n)break;
    count+=n;
  }
  if(BigInt(count)!==stat.size||!matches(fstatSync(fd,{bigint:true}))||!matches(lstatSync(file,{bigint:true})))throw new Error("Unsafe local configuration changed");
  const bytes=buffer.subarray(0,count);
  return {bytes,text:bytes.toString("utf8"),identity:identity(stat)};
}
function withOwnerEnv(file,writable,operation) {
  const fd=openSync(file,(writable?constants.O_RDWR|constants.O_APPEND:constants.O_RDONLY)|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {return operation(fd,envSnapshot(fd,file));} finally {closeSync(fd);}
}
export function readOwnerEnv(file) {
  return withOwnerEnv(file,false,(_fd,snapshot)=>snapshot);
}
export function appendOwnerEnv(file,expected,addition) {
  return withOwnerEnv(file,true,(fd,current)=>{
    if(!current.bytes.equals(expected.bytes)||!current.identity.every((v,i)=>v===expected.identity[i]))throw new Error("Local configuration changed; do not publish candidate credentials");
    const appended=Buffer.from(addition,"utf8");
    if(current.bytes.length+appended.length>1024*1024)throw new Error("Unsafe local configuration");
    appendFileSync(fd,appended);
    fsyncSync(fd);
    const actual=envSnapshot(fd,file);
    if(actual.identity[0]!==current.identity[0]||actual.identity[1]!==current.identity[1]||!actual.bytes.equals(Buffer.concat([current.bytes,appended])))throw new Error("Local configuration publication uncertain; inspect before retry");
  });
}
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
function privateCopyDirectory(directory, owner) {
  const prefix = "/run/bthwani-" + owner + "-copy-";
  return ["dsh", "identity"].includes(owner) && typeof directory === "string" &&
    directory.startsWith(prefix) && directory.length === prefix.length + 10 &&
    /^[A-Za-z0-9]+$/.test(directory.slice(prefix.length));
}
// Allocate an exclusive directory inside the already verified PostgreSQL
// container. mktemp -d creates it with owner-only permissions.
export function createPrivateCopyArchive(pg, owner, execute = docker) {
  if (!["dsh", "identity"].includes(owner)) throw new Error("Invalid copy archive owner");
  if (execute(["exec", pg, "stat", "-c", "%f:%u:%g", "/run"]) !== "41ed:0:0") throw new Error("Unexpected copy archive parent");
  const directory = execute(["exec", pg, "mktemp", "-d", "/run/bthwani-" + owner + "-copy-XXXXXXXXXX"]);
  if (!privateCopyDirectory(directory, owner)) throw new Error("Unexpected copy archive directory");
  return { directory, file: directory + "/archive.dump" };
}
export function removePrivateCopyArchive(pg, archive, execute = docker) {
  if (!archive || !["dsh", "identity"].some(owner => privateCopyDirectory(archive.directory, owner)) ||
      archive.file !== archive.directory + "/archive.dump") throw new Error("Unexpected copy archive directory");
  execute(["exec", pg, "rm", "-f", "--", archive.file]);
  execute(["exec", pg, "rmdir", "--", archive.directory]);
}
function composeArgs(activeFiles) {
  if (!equal(activeFiles,appFiles)) throw new Error("Only the canonical Compose source is executable");
  return ["compose","--project-directory",resolve(root,"infra"),"--env-file","infra/.env","-f",canonicalComposePath, ...Object.values(owners).flatMap(o=>["--profile",o.profile])];
}
function asEnv(values) {
  return Object.fromEntries(values.map(v => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]));
}
export function differingKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]).sort(compareNames);
}
function inspect(owner, requireHealthy = true) {
  const result = JSON.parse(docker(["inspect", project + "-" + owner + "-1"]))[0];
  if (result.Config.Labels["com.docker.compose.project"] !== project ||
      result.Config.Labels["com.docker.compose.service"] !== owner ||
      result.Config.Labels["com.bthwani.environment"] !== "refoundation") throw new Error("Unexpected container ownership: " + owner);
  const env = asEnv(result.Config.Env);
  if (env.BTHWANI_ISOLATED_TEST_MODE !== "true" || env.BTHWANI_ISOLATED_CONTAINER_MODE !== "true") throw new Error("Not an isolated owner: " + owner);
  if (owner === "wlt" && result.Config.Labels["com.bthwani.capability"] !== "customer-wallet-read-only") throw new Error("WLT read-only runtime not proven");
  if (requireHealthy && (!result.State.Running || result.State.Health?.Status !== "healthy")) throw new Error("Existing owner not healthy: " + owner);
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
// The WLT overlay is used only by the WLT Compose group. Never replace a
// mismatched owner; ordinary reconciliation may still inspect the other group.
export function wltConfigReviewRequired(expected, actual, mode) {
  if (!differingKeys(expected,actual).length) return false;
  if (["--check","--apply","--apply-preview"].includes(mode) &&
      Object.keys(expected).length === 1 && Object.keys(actual).length === 1 &&
      /^[a-f0-9]{64}$/.test(expected.wlt || "") && /^[a-f0-9]{64}$/.test(actual.wlt || "")) return true;
  assertSameHashes(expected,actual);
}
export function composeFileNames(label, repoRoot = root) {
  const prefix = repoRoot.replaceAll("/", "\\").toLowerCase() + "\\infra\\";
  // Existing containers record former file names. Exact aliases only;
  // effective configuration hashes must still match before replacement.
  const renamed = new Map([
    ["compose.apps.yaml", "compose.dsh.yaml"],
    ["compose.identity-verifier.yaml", "compose.identity.yaml"],
    ["compose.merchant-development.yaml", "compose.merchant.yaml"],
    ["compose.captain-development.yaml", "compose.captain.yaml"],
  ]);
  const allowed = new Set([...legacyAppFiles, legacyCaptainFile, ...legacyWltFiles]);
  const names = (label || "").split(",").map(p => {
    const normalized = p.replaceAll("/", "\\");
    if (!normalized.toLowerCase().startsWith(prefix)) throw new Error("Unowned Compose file");
    const name = normalized.slice(prefix.length);
    const canonical = renamed.get(name) ?? name;
    if (!allowed.has(canonical)) throw new Error("Unowned Compose file");
    return canonical;
  });
  if (new Set(names).size !== names.length) throw new Error("Duplicate Compose file");
  return names;
}
function liveFiles(v) {
  return composeFileNames(v.Config.Labels["com.docker.compose.project.config_files"]);
}
function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function configHashes(activeFiles, names, env, historical) {
  const args = composeArgs(activeFiles).map(value => historical && value === historical.file ? "-" : value);
  const lines = docker([...args, "config", "--hash", names.join(",")], env, 30000, historical ? historical.content + "\n" : undefined).split(/\r?\n/);
  const result = Object.fromEntries(lines.map(l => l.trim().split(/\s+/)));
  if (Object.keys(result).length !== names.length || names.some(o => !/^[0-9a-f]{64}$/.test(result[o] || ""))) throw new Error("Incomplete Compose hash");
  return result;
}
function currentHashes(state, names) {
  return Object.fromEntries(names.map(o => [o, state[o].Config.Labels["com.docker.compose.config-hash"]]));
}
// Accept only the explicitly admitted isolated peer-origin addition. The old
// effective Compose hash must still be reconstructed before any owner mutation.
export function isAdmittedWltOriginAddition(previous, current) {
  const normalize = value => value.replace(/\r\n/g, "\n").trimEnd();
  const before = normalize(previous), after = normalize(current);
  const line = '      WLT_TEST_DSH_ORIGIN: "http://dsh:8080"';
  const lines = after.split("\n");
  return !before.includes("WLT_TEST_DSH_ORIGIN") &&
    lines.filter(value => value === line).length === 1 &&
    after.includes('      WLT_TEST_IDENTITY_ORIGIN: "http://identity:3302"\n' + line + "\n") &&
    lines.filter(value => value !== line).join("\n") === before;
}
function historicalWltHashes(previous, env) {
  return configHashes(wltFiles,["wlt"],env,{file:canonicalComposePath,content:previous});
}

// Reconstruct only an already-admitted historical one-field transition.
// The old image revision must contain the owner definition without that key,
// and native Compose must independently match its exact running hash.
export function priorCanonicalWithoutField(current,field,oldOwnerSource) {
  if (typeof oldOwnerSource!=="string" || oldOwnerSource.includes(field)) return null;
  const lines=current.replaceAll("\r\n","\n").split("\n");
  const matches=lines.filter(line=>line.startsWith("      "+field+": "));
  if(matches.length!==1)return null;
  return lines.filter(line=>line!==matches[0]).join("\n");
}
function previousOwnerCompose(revision,owner,field,current) {
  const legacy=owner==="dsh"?["infra/compose.dsh.yaml","infra/compose.apps.yaml"]:["infra/compose.wlt.yaml"];
  const paths=[...legacy,"infra/compose.yaml"];
  const found=git(["ls-tree","--name-only",revision,"--",...paths]).split(/\r?\n/);
  const file=paths.find(p=>found.includes(p));
  if(!file)return null;
  const source=git(["show",revision+":"+file]);
  if(!source.includes("  "+owner+":"))return null;
  return priorCanonicalWithoutField(current,field,source);
}
// An explicitly requested default-off employee configuration addition has no
// permission effect on either the previous or current DSH binary. All other
// configuration drift still requires exact reconstruction and separate review.
export function admittedDshConfigTransition({mode, automatic, clean, schemaChanged, oldFlagPresent, disabledHandlerProven, previous, current, live, historical, desired, disabled}) {
  if (!["--check","--apply"].includes(mode) || automatic !== false || clean !== true ||
      schemaChanged !== false || oldFlagPresent !== false || disabledHandlerProven !== true ||
      typeof previous !== "string" || typeof current !== "string") return false;
  const before=previous.replaceAll("\r\n","\n").trimEnd();
  const after=current.replaceAll("\r\n","\n").trimEnd();
  const line=`      DSH_ENABLE_ISOLATED_EMPLOYEES: "\${REF_DSH_ENABLE_ISOLATED_EMPLOYEES:-false}"`;
  const anchor=`      DSH_ENABLE_ISOLATED_CUSTOMER_CART: "\${REF_DSH_ENABLE_ISOLATED_CUSTOMER_CART:-false}"`;
  const lines=after.split("\n");
  if(before.includes("DSH_ENABLE_ISOLATED_EMPLOYEES") || lines.filter(value=>value===line).length!==1 ||
     !after.includes(anchor+"\n"+line+"\n") || lines.filter(value=>value!==line).join("\n")!==before) return false;
  const valid=hashes=>hashes && Object.keys(hashes).length===2 &&
    ["dsh","identity"].every(owner=>Object.hasOwn(hashes,owner)&&typeof hashes[owner]==="string"&&/^[a-f0-9]{64}$/.test(hashes[owner]));
  return [live,historical,desired,disabled].every(valid) &&
    !differingKeys(live,historical).length && !differingKeys(desired,disabled).length &&
    live.identity===desired.identity && live.dsh!==desired.dsh;
}
export function isKnownImageConfigPair(image,hash,previous,candidate) {
  return (image===previous.image && hash===previous.hash) || (image===candidate.image && hash===candidate.hash);
}
function historicalDshHashes(files,names,env,previous) {
  return configHashes(files,names,env,{file:canonicalComposePath,content:previous});
}
function imageRecord(image) {
  return JSON.parse(docker(["image", "inspect", image]))[0];
}
function ownerRevision(state,owner) { return sourceIdentity(imageRecord(state[owner].Image).Config.Labels,owner); }
const guardedScope = ["services",...ownerComposeInputs,"tools/dev/docker/build-owner-image.ps1","tools/dev/docker/owner-baseline-transition.mjs","tools/dev/docker/owner-preview-source.mjs","tools/dev/docker/reconcile-owner-runtime.mjs","tests/infra/verify-isolated-postgres.ps1","tools/dev/check-go.mjs",".go-version"];
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
  const expected=["PG_FRESH_DSH_BASELINE","PG_READER_ACCESS","PG_RESTORE_READBACK","PG_DSH_DEDICATED_RUNTIME","PG_FRESH_IDENTITY_BASELINE","PG_FRESH_WLT_BASELINE","PG_BASELINE_TRANSITION_DSH","PG_BASELINE_TRANSITION_IDENTITY","PG_BASELINE_TRANSITION_WLT","PG_ISOLATION"];
  for(const name of expected) {
    const evidence=output.split(/\r?\n/).filter(line=>line.startsWith(name+"="));
    if(evidence.length!==1 || !(evidence[0]===name+"=PASS" || evidence[0].startsWith(name+"=PASS "))) throw new Error("BASELINE_PROOF_INCOMPLETE "+name);
  }
}
const baselineProofScope=["services/identity/database","services/dsh/database","services/wlt/database","services/dsh/backend/internal/dbscope","services/dsh/backend/go.mod","services/dsh/backend/go.sum","tests/infra/verify-isolated-postgres.ps1","tools/dev/check-go.mjs",".go-version","tools/dev/docker/owner-baseline-transition.mjs","infra/compose.yaml"];
// One-time additive preparation: the old owner remains the writer until a
// separately verified handoff. No retained schema, role, service or volume is
// modified. Existing target names fail closed rather than being overwritten.
export function ownerDataFingerprintSql(schema, tables, sequences, owner="dsh") {
  const identifier=/^[a-z][a-z0-9_]{0,62}$/;
  if(!["dsh","identity"].includes(owner) || !(owner==="dsh"?/^dsh_test_[a-z0-9_]{1,50}$/:/^identity_test_[a-z0-9_]{1,49}$/).test(schema) ||
     [...tables,...sequences].some(t=>!identifier.test(t)) ||
     !tables.length || new Set(tables).size!==tables.length || new Set(sequences).size!==sequences.length) throw new Error("Invalid owner snapshot scope");
  return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL intervalstyle='postgres'; SET LOCAL extra_float_digits=3;\n"+
    [...tables].sort(compareNames).map(t=>"SELECT 'table:"+t+"',count(*),encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') h FROM "+schema+"."+t+" x) q;").join("\n")+"\n"+
    [...sequences].sort(compareNames).map(t=>"SELECT 'sequence:"+t+"',last_value,is_called FROM "+schema+"."+t+";").join("\n")+"\nCOMMIT;";
}
export function legacyOwnerAccessSql(runtime="bthwani_dsh_runtime") {
  if(!["bthwani_dsh_runtime","bthwani_identity_runtime"].includes(runtime))throw new Error("Invalid dedicated owner principal");
  return "BEGIN READ ONLY; SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND (has_table_privilege('bthwani_dsh_runtime',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege('bthwani_dsh_runtime',c.oid,'INSERT,UPDATE,REFERENCES') OR ((has_table_privilege('bthwani_dsh_runtime',c.oid,'SELECT') OR has_any_column_privilege('bthwani_dsh_runtime',c.oid,'SELECT')) AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND ((e.extname='postgis' AND n.nspname='public' AND c.relname IN ('geography_columns','geometry_columns','spatial_ref_sys')) OR (e.extname='postgis_tiger_geocoder' AND n.nspname='tiger' AND c.relname IN ('geocode_settings','geocode_settings_default','loader_lookuptables','loader_platform','loader_variables','pagc_gaz','pagc_lex','pagc_rules')) OR (e.extname='postgis_topology' AND n.nspname='topology' AND c.relname IN ('layer','topology')))))); COMMIT;".replaceAll("bthwani_dsh_runtime",runtime);
}
function prepareDedicatedDsh(state, env, head, activeFiles, resume=false) {
  if(git(["status","--porcelain","--untracked-files=all"]))throw new Error("Dedicated database preparation requires a clean committed checkout");
  const live=asEnv(state.dsh.Config.Env);
  const schema=live.DSH_DB_SCHEMA;
  const oldDb="bthwani_refoundation", admin="bthwani_refoundation_admin";
  const db="bthwani_dsh_dev", owner="bthwani_dsh_owner", runtime="bthwani_dsh_runtime";
  if(live.REF_POSTGRES_DB!==oldDb || live.REF_POSTGRES_USER!==admin || !/^dsh_test_[a-z0-9_]{1,50}$/.test(schema||""))throw new Error("Expected legacy isolated DSH source not proven");
  const pg=project+"-postgres-1";
  const pgRecord=docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}',pg]);
  if(pgRecord!==project+"|refoundation|healthy")throw new Error("Unexpected PostgreSQL owner");
  const sql=(database,statement)=>docker(["exec","-i",pg,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U",admin,"-d",database,"-f","-"],{},45000,statement+"\n");
  const envPath=resolve(root,"infra/.env");
  git(["check-ignore","infra/.env"]);
  const original=readOwnerEnv(envPath);
  if(/^REF_DSH_RUNTIME_(?:DATABASE|USER|PASSWORD)=/m.test(original.text))throw new Error("Dedicated DSH credentials already exist; do not overwrite");
  const absent=sql("postgres","BEGIN READ ONLY; SELECT (SELECT count(*) FROM pg_database WHERE datname='"+db+"')+(SELECT count(*) FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"')); COMMIT;");
  if(absent!==(resume?"3":"0"))throw new Error("Dedicated DSH namespace is not in the explicitly selected preparation state");
  const list=kind=>sql(oldDb,"BEGIN READ ONLY; SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='"+kind+"' ORDER BY 1; COMMIT;").split(/\r?\n/).filter(Boolean);
  const tables=list("r"),sequences=list("S");
  if(!tables.includes("public_revision") || tables.length>100 || sequences.length>100)throw new Error("Unexpected source owner data inventory");
  const fingerprint=ownerDataFingerprintSql(schema,tables,sequences);
  const before=sql(oldDb,fingerprint);
  if(before.split(/\r?\n/).length!==tables.length+sequences.length)throw new Error("Incomplete source data fingerprint");
  const tag="sha-"+head.slice(0,9);
  run("pwsh",["-NoProfile","-File",buildScript,"-Owner","dsh","-DockerContext",context,"-Image",owners.dsh.image+":"+tag],{},180000);
  if(sourceIdentity(imageRecord(owners.dsh.image+":"+tag).Config.Labels,"dsh").revision!==head || git(["rev-parse","HEAD"])!==head || git(["status","--porcelain","--untracked-files=all"]))throw new Error("Candidate source advanced");
  const ownerSecret=randomBytes(32).toString("hex"), runtimeSecret=randomBytes(32).toString("hex");
  const candidateEnv={...env,REF_DSH_IMAGE_TAG:tag,REF_DSH_RUNTIME_DATABASE:db,REF_DSH_RUNTIME_USER:runtime,REF_DSH_RUNTIME_PASSWORD:runtimeSecret,REF_DSH_BOOTSTRAP_USER:owner,REF_DSH_BOOTSTRAP_PASSWORD:ownerSecret,REF_DSH_DISCOVERY_SCHEMA:schema};
  if(!resume){
  sql("postgres","BEGIN; CREATE ROLE "+owner+" LOGIN NOINHERIT PASSWORD '"+ownerSecret+"'; CREATE ROLE "+runtime+" LOGIN NOINHERIT PASSWORD '"+runtimeSecret+"'; COMMIT;");
  sql("postgres","CREATE DATABASE "+db+" OWNER "+owner+" TEMPLATE template0;");
  sql("postgres","REVOKE ALL ON DATABASE "+db+" FROM PUBLIC; GRANT CONNECT ON DATABASE "+db+" TO "+runtime+";");
  sql(db,"REVOKE ALL ON SCHEMA public FROM PUBLIC;");
  const proof=docker([...composeArgs(activeFiles),"--profile","bootstrap","run","--rm","--no-deps","--pull","never","dsh-bootstrap"],candidateEnv,90000);
  if(!proof.includes("DSH_FRESH_BASELINE_PASS schema="+schema))throw new Error("Canonical DSH bootstrap did not confirm");
  sql("postgres","ALTER ROLE "+owner+" NOLOGIN PASSWORD NULL;");
  }
  // The archive remains within the verified PostgreSQL container. Only new
  // fixture data is replaced; original rows are never altered.
  let archive=null;
  try {
    if(!resume){
    archive=createPrivateCopyArchive(pg,"dsh");
    docker(["exec",pg,"pg_dump","-Fc","--data-only","--no-owner","--no-acl","--schema="+schema,"-U",admin,"-d",oldDb,"-f",archive.file],{},45000);
    sql(db,"DELETE FROM "+schema+".public_revision WHERE singleton;");
    docker(["exec",pg,"pg_restore","--data-only","--no-owner","--no-acl","--exit-on-error","--single-transaction","-U",admin,"-d",db,archive.file],{},45000);
    } else {
      const candidateProof=sql(db,"BEGIN READ ONLY; SELECT (SELECT pg_get_userbyid(datdba)='"+owner+"' FROM pg_database WHERE datname=current_database()) AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"') AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AND rolcanlogin=(rolname='"+runtime+"'))=2 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"'))) AND (SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public'))=1 AND EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='"+schema+"' AND pg_get_userbyid(nspowner)='"+owner+"') AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND pg_get_userbyid(c.relowner)<>'"+owner+"'); COMMIT;");
      const candidateTables=sql(db,"BEGIN READ ONLY; SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='r' ORDER BY 1; COMMIT;").split(/\r?\n/);
      if(candidateProof!=="t" || !equal(candidateTables,[...new Set([...tables,"customer_addresses","service_city_delivery_policies"])].sort(compareNames)))throw new Error("Existing unpublished DSH candidate ownership or inventory differs; do not alter");
    }
    if(sql(oldDb,fingerprint)!==before || sql(db,fingerprint)!==before)throw new Error("Source or candidate data changed; preserve both and review");
    if(sql(db,"BEGIN READ ONLY; SELECT (SELECT count(*) FROM "+schema+".customer_addresses)+(SELECT count(*) FROM "+schema+".service_city_delivery_policies); COMMIT;")!=="0")throw new Error("Fresh policy or address facts must remain empty");
    const legacyAccess=sql(oldDb,legacyOwnerAccessSql());
    if(legacyAccess!=="0" || sql("postgres","BEGIN READ ONLY; SELECT has_database_privilege('"+runtime+"','bthwani_wlt_test','CONNECT'); COMMIT;")!=="f")throw new Error("Dedicated runtime has unexpected legacy or WLT access");

    if(resume)sql("postgres","ALTER ROLE "+runtime+" PASSWORD '"+runtimeSecret+"';");
    sql(db,"GRANT USAGE ON SCHEMA "+schema+" TO "+runtime+"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "+schema+" TO "+runtime+"; GRANT USAGE ON ALL SEQUENCES IN SCHEMA "+schema+" TO "+runtime+";");
    const verified=docker([...composeArgs(activeFiles),"run","--rm","--no-deps","--pull","never","dsh","-mode=verify-development-db"],candidateEnv,45000);
    if(!verified.includes("DSH_DEVELOPMENT_DATABASE_PASS"))throw new Error("Dedicated runtime login not verified");
    if(sql(oldDb,fingerprint)!==before || git(["rev-parse","HEAD"])!==head || git(["status","--porcelain","--untracked-files=all"]))throw new Error("Source, data or local configuration changed; do not publish candidate credentials");
    appendOwnerEnv(envPath,original,"\nREF_DSH_RUNTIME_DATABASE="+db+"\nREF_DSH_RUNTIME_USER="+runtime+"\nREF_DSH_RUNTIME_PASSWORD="+runtimeSecret+"\n");
    console.log("DSH_DEDICATED_DATABASE_PREPARED HEAD="+head+" TABLES="+tables.length+" DATA_PARITY=PASS RUNTIME_LOGIN=PASS CUTOVER=NOT_RUN");
  } finally {
    // Exact owned archive only; never remove a retained database.
    try {if(archive)removePrivateCopyArchive(pg,archive);}catch{console.error("DSH_COPY_ARCHIVE_CLEANUP_BLOCKED");}
  }
}


// Reuse the prepared owner candidate; never recreate or overwrite its data.
// A data-bearing cutover is deliberately separate from image-only rollback.
export function assertHandoffParity(source, candidate, expectedLines) {
  if (!source || !Number.isSafeInteger(expectedLines) || expectedLines < 1 ||
      source.split(/\r?\n/).length !== expectedLines || source !== candidate) {
    throw new Error("OWNER_HANDOFF_DATA_PARITY_FAILED");
  }
}
function cutoverPreparedDsh(state, env, head, files, preparedRevision) {
  const transitionScope=[...guardedScope,"tools/dev/docker/reconcile-owner-runtime.mjs","tools/dev/dev.ps1","AGENTS.md","REPOSITORY-STRUCTURE.md","governance/engineering.md"];
  const dirty=()=>dirtyPaths(root,transitionScope).length>0;
  if (!/^[0-9a-f]{40}$/.test(preparedRevision || "") || dirty()) throw new Error("Cutover requires a clean committed checkout and exact prepared source SHA");
  git(["merge-base","--is-ancestor",preparedRevision,head]);
  if (git(["diff","--name-only",preparedRevision,head,"--","services/dsh","services/identity/database/schema",".go-version"]))
    throw new Error("Prepared DSH owner inputs changed; prepare a compatible candidate first");
  const old=state.dsh, live=asEnv(old.Config.Env);
  const schema=live.DSH_DB_SCHEMA, oldDb="bthwani_refoundation", db="bthwani_dsh_dev";
  const runtime="bthwani_dsh_runtime", admin="bthwani_refoundation_admin", pg=project+"-postgres-1";
  if(live.REF_POSTGRES_DB!==oldDb || live.REF_POSTGRES_USER!==admin || !/^dsh_test_[a-z0-9_]{1,50}$/.test(schema||""))
    throw new Error("Expected legacy DSH owner is not active");
  if(docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}',pg])!==project+"|refoundation|healthy")
    throw new Error("PostgreSQL ownership not verified");
  const sql=(database,statement)=>docker(["exec","-i",pg,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U",admin,"-d",database,"-f","-"],{},45000,statement+"\n");
  const tag="sha-"+preparedRevision.slice(0,9);
  const image=imageRecord(owners.dsh.image+":"+tag);
  if(sourceIdentity(image.Config.Labels,"dsh").revision!==preparedRevision)throw new Error("Prepared image provenance mismatch");
  const candidateEnv={...env,REF_DSH_IMAGE_TAG:tag};
  for(const k of ["REF_DSH_RUNTIME_DATABASE","REF_DSH_RUNTIME_USER","REF_DSH_RUNTIME_PASSWORD"])delete candidateEnv[k];
  const config=JSON.parse(docker([...composeArgs(files),"config","--format","json"],candidateEnv));
  const target=config.services.dsh.environment;
  if(target.REF_POSTGRES_DB!==db || target.REF_POSTGRES_USER!==runtime ||
    !/^[a-f0-9]{64}$/.test(target.REF_POSTGRES_PASSWORD||"") || target.DSH_DB_SCHEMA!==schema)
    throw new Error("Prepared DSH runtime configuration not verified");
  Object.assign(candidateEnv,{REF_DSH_RUNTIME_DATABASE:db,REF_DSH_RUNTIME_USER:runtime,REF_DSH_RUNTIME_PASSWORD:target.REF_POSTGRES_PASSWORD});
  const queryList=(database,kind)=>sql(database,"BEGIN READ ONLY; SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='"+kind+"' ORDER BY 1; COMMIT;").split(/\r?\n/).filter(Boolean);
  const tables=queryList(oldDb,"r"), sequences=queryList(oldDb,"S");
  const allTables=queryList(db,"r"), allSequences=queryList(db,"S");
  if(!equal(allTables,[...new Set([...tables,"customer_addresses","service_city_delivery_policies"])].sort(compareNames)) || !equal(allSequences,sequences))
    throw new Error("Prepared DSH schema inventory changed");
  const fp=ownerDataFingerprintSql(schema,tables,sequences), full=ownerDataFingerprintSql(schema,allTables,allSequences);
  const checkParity=()=>assertHandoffParity(sql(oldDb,fp),sql(db,fp),tables.length+sequences.length);
  const verifyEmptyNewTables=()=>{if(sql(db,"BEGIN READ ONLY; SELECT (SELECT count(*) FROM "+schema+".customer_addresses)+(SELECT count(*) FROM "+schema+".service_city_delivery_policies); COMMIT;")!=="0")throw new Error("Prepared DSH candidate has independent new data");};
  const noWriters=()=>{
    if(sql("postgres","BEGIN READ ONLY; SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid() AND (datname='"+db+"' OR (datname='"+oldDb+"' AND usename='"+admin+"')); COMMIT;")!=="0")
      throw new Error("DSH writer exclusivity unproven");
  };
  checkParity(); verifyEmptyNewTables();
  if(sql(oldDb,legacyOwnerAccessSql())!=="0" || sql("postgres","BEGIN READ ONLY; SELECT has_database_privilege('"+runtime+"','bthwani_wlt_test','CONNECT'); COMMIT;")!=="f")
    throw new Error("DSH cross-owner access not excluded");
  const proof=docker([...composeArgs(files),"run","--rm","--no-deps","--pull","never","dsh","-mode=verify-development-db"],candidateEnv,45000);
  if(!proof.includes("DSH_DEVELOPMENT_DATABASE_PASS"))throw new Error("Prepared DSH runtime login proof failed");
  const beforeFull=sql(db,full);
  const oldHashes=currentHashes(state,["dsh","identity"]);
  assertSameHashes(oldHashes,configHashes(files,["dsh","identity"],env));
  const newHashes=configHashes(files,["dsh","identity"],candidateEnv);
  if(newHashes.identity!==oldHashes.identity || newHashes.dsh===oldHashes.dsh)throw new Error("Unexpected peer configuration change");
  const unchanged=()=>{
    if(git(["rev-parse","HEAD"])!==head || dirty() ||
       imageRecord(old.Config.Image).Id!==old.Image || imageRecord(owners.dsh.image+":"+tag).Id!==image.Id)
      throw new Error("Source or rollback image advanced");
  };
  unchanged();
  if(inspect("dsh").Id!==old.Id || inspect("identity").Id!==state.identity.Id || inspect("wlt").Id!==state.wlt.Id)
    throw new Error("Concurrent runtime change");
  let stopped=false, applyStarted=false;
  try {
    console.log("DSH_HANDOFF_STARTED HEAD="+head);
    docker(["stop","--time","20",old.Id],{},45000);
    stopped=true;
    if(inspect("dsh",false).State.Running)throw new Error("Old DSH writer still active");
    noWriters(); checkParity(); verifyEmptyNewTables(); unchanged();
    if(sql(db,full)!==beforeFull)throw new Error("Prepared DSH candidate changed before handoff");
    applyStarted=true;
    docker([...composeArgs(files),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60","dsh"],candidateEnv,95000);
    const now=inspect("dsh");
    const nowEnv=asEnv(now.Config.Env);
    if(now.Image!==image.Id || now.Config.Labels["com.docker.compose.config-hash"]!==newHashes.dsh ||
      nowEnv.REF_POSTGRES_DB!==db || nowEnv.REF_POSTGRES_USER!==runtime ||
      nowEnv.DSH_DB_SCHEMA!==schema || inspect("identity").Id!==state.identity.Id || inspect("wlt").Id!==state.wlt.Id)
      throw new Error("DSH handoff runtime readback mismatch");
    // Verify the actual serving container's private database principal too.
    if(!docker(["exec",now.Id,"/usr/local/bin/dsh","-mode=verify-development-db"],{},15000).includes("DSH_DEVELOPMENT_DATABASE_PASS"))
      throw new Error("Serving DSH principal readback failed");
    if(sql("postgres","BEGIN READ ONLY; SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND datname='"+oldDb+"' AND usename='"+admin+"'; COMMIT;")!=="0")
      throw new Error("Legacy DSH writer remains connected");
    console.log("DSH_HANDOFF_PASS DATA_PARITY=PASS RUNTIME_LOGIN=PASS IMAGE_SOURCE="+preparedRevision+" HEAD="+head);
  } catch(e) {
    if(e.code==="ETIMEDOUT")throw new Error("DSH_HANDOFF_BLOCKED ambiguous Docker operation; inspect durable state before retry");
    if(!stopped)throw e;
    const now=inspect("dsh",false);
    // Never roll back to stale data once a replacement may have accepted a write.
    // A pre-promotion failure is safe to recover using the same old container.
    if(!applyStarted && now.Id===old.Id && !now.State.Running){
      docker(["start",old.Id],{},45000);
      docker(["exec",old.Id,"wget","-q","-O","/dev/null","http://127.0.0.1:8080/health"],{},15000);
      if(inspect("dsh",false).Id!==old.Id || !inspect("dsh",false).State.Running)throw new Error("DSH_HANDOFF_RECOVERY_BLOCKED");
      throw new Error("DSH_HANDOFF_ABORTED old writer restored: "+e.message);
    }
    throw new Error("DSH_HANDOFF_REVIEW_REQUIRED candidate may have accepted writes; no automatic rollback: "+e.message);
  }
}


// Identity is moved without changing its existing SQL semantics. The native
// backup/restore preserves the historical audit relation and all session facts.
// Changed schemas must instead use the fresh-baseline path, never this copy.
export function identityDestinationUrl(oldUrl, password) {
  const url=new URL(oldUrl);
  if(!/^postgres(?:ql)?:$/.test(url.protocol) || url.hostname!=="postgres" ||
     !["","5432"].includes(url.port) || url.pathname!=="/bthwani_refoundation" ||
     !/^identity_runtime_docker_[a-f0-9]{12}$/.test(url.username) ||
     !url.password || url.hash || url.search!=="?sslmode=disable" ||
     !/^[a-f0-9]{64}$/.test(password))throw new Error("Unverified legacy Identity connection");
  url.username="bthwani_identity_runtime";
  url.password=password;
  url.pathname="/bthwani_identity_dev";
  return url.toString();
}
export function identityAclSql(schema, role) {
  if(!/^identity_test_docker_[a-f0-9]{12}$/.test(schema) || !/^identity_runtime_docker_[a-f0-9]{12}$/.test(role) ||
     schema.slice(-12)!==role.slice(-12))throw new Error("Unverified legacy Identity grants");
  const rows="WITH grants AS (SELECT c.relname AS relation,NULL::name AS column_name,a.privilege_type,a.is_grantable FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE n.nspname='"+schema+"' AND c.relkind='r' AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='"+role+"') UNION ALL SELECT c.relname,t.attname,a.privilege_type,a.is_grantable FROM pg_attribute t JOIN pg_class c ON c.oid=t.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(t.attacl) a WHERE n.nspname='"+schema+"' AND c.relkind='r' AND t.attnum>0 AND NOT t.attisdropped AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='"+role+"')) ";
  return "BEGIN READ ONLY; "+rows+"SELECT CASE WHEN is_grantable OR privilege_type NOT IN ('SELECT','INSERT','UPDATE') THEN 'INVALID' ELSE format('GRANT %s%s ON TABLE %I.%I TO bthwani_identity_runtime;',privilege_type,CASE WHEN column_name IS NULL THEN '' ELSE format(' (%I)',column_name) END,'"+schema+"',relation) END FROM grants ORDER BY relation,column_name NULLS FIRST,privilege_type; COMMIT;";
}
function identityEffectiveAclSql(schema, role) {
  if(!/^identity_test_docker_[a-f0-9]{12}$/.test(schema) || !/^(?:identity_runtime_docker_[a-f0-9]{12}|bthwani_identity_runtime)$/.test(role))throw new Error("Invalid Identity ACL scope");
  const roleLiteral="'"+role+"'";
  return "BEGIN READ ONLY; SELECT 'table:'||c.relname,p,has_table_privilege("+roleLiteral+",c.oid,p) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE n.nspname='"+schema+"' AND c.relkind='r' ORDER BY 1,2; SELECT 'column:'||c.relname||'.'||a.attname,p,has_column_privilege("+roleLiteral+",c.oid,a.attnum,p) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p WHERE n.nspname='"+schema+"' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY 1,2; SELECT 'function:'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',has_function_privilege("+roleLiteral+",p.oid,'EXECUTE') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='"+schema+"' ORDER BY 1; SELECT 'sequence:'||c.relname,p,has_sequence_privilege("+roleLiteral+",c.oid,p) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) p WHERE n.nspname='"+schema+"' AND c.relkind='S' ORDER BY 1,2; COMMIT;";
}
// PostgreSQL can flatten the redundant AND-group parentheses when restoring
// a CHECK expression. Ignore only that known display difference, and require
// the complete constraint catalog definition and state to match separately.
export function normalizeIdentitySchemaDump(dump) {
  const original="    CONSTRAINT operator_permission_commands_reason_check CHECK ((((char_length(reason) >= 10) AND (char_length(reason) <= 500)) AND (reason = btrim(reason)) AND (POSITION((chr(10)) IN (reason)) = 0) AND (POSITION((chr(13)) IN (reason)) = 0))),";
  const restored="    CONSTRAINT operator_permission_commands_reason_check CHECK (((char_length(reason) >= 10) AND (char_length(reason) <= 500) AND (reason = btrim(reason)) AND (POSITION((chr(10)) IN (reason)) = 0) AND (POSITION((chr(13)) IN (reason)) = 0))),";
  return dump.split(/\r?\n/).filter(line=>!/^\\(?:un)?restrict /.test(line)).map(line=>line===original?restored:line).join("\n").trim();
}
function relocateIdentity(state,env,head,files,resume=false) {
  const scope=[...guardedScope,"tools/dev/docker/reconcile-owner-runtime.mjs","tools/dev/dev.ps1","AGENTS.md","REPOSITORY-STRUCTURE.md","governance/engineering.md"];
  const clean=()=>git(["rev-parse","HEAD"])===head && !dirtyPaths(root,scope).length;
  if(!clean())throw new Error("Identity relocation requires a committed stable source");
  const old=state.identity,live=asEnv(old.Config.Env),schema=live.IDENTITY_DB_SCHEMA;
  const oldUrl=live.IDENTITY_TEST_DATABASE_URL, oldDb="bthwani_refoundation",db="bthwani_identity_dev";
  const owner="bthwani_identity_owner",runtime="bthwani_identity_runtime",admin="bthwani_refoundation_admin",pg=project+"-postgres-1";
  const oldRole=new URL(oldUrl).username;
  const password=randomBytes(32).toString("hex"),newUrl=identityDestinationUrl(oldUrl,password);
  if(!/^identity_test_docker_[a-f0-9]{12}$/.test(schema) || schema.slice(-12)!==oldRole.slice(-12))throw new Error("Legacy Identity schema not verified");
  const oldRevision=ownerRevision(state,"identity").revision;
  git(["merge-base","--is-ancestor",oldRevision,head]);
  if(git(["diff","--name-only",oldRevision,head,"--","services/identity/database/schema"]))
    throw new Error("Identity schema changed; relocation is not a fresh-baseline transition");
  if(docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}',pg])!==project+"|refoundation|healthy")throw new Error("PostgreSQL owner not verified");
  const sql=(database,statement)=>docker(["exec","-i",pg,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U",admin,"-d",database,"-f","-"],{},45000,statement+"\n");
  const envPath=resolve(root,"infra/.env");
  git(["check-ignore","infra/.env"]);
  const original=readOwnerEnv(envPath);
  if(/^REF_IDENTITY_RUNTIME_DATABASE_URL=/m.test(original.text))throw new Error("Identity candidate configuration already exists; inspect before retry");
  if(sql("postgres","BEGIN READ ONLY; SELECT (SELECT count(*) FROM pg_database WHERE datname='"+db+"')+(SELECT count(*) FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"')); COMMIT;")!==(resume?"3":"0"))
    throw new Error("Identity candidate is not in the explicitly selected preparation state");
  const roleCheck=sql(oldDb,"BEGIN READ ONLY; SELECT NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AND has_schema_privilege(rolname,'"+schema+"','USAGE') AND NOT has_schema_privilege(rolname,'"+schema+"','CREATE') FROM pg_roles r WHERE rolname='"+oldRole+"'; COMMIT;");
  if(roleCheck!=="t")throw new Error("Legacy Identity runtime principal not verified");
  const list=(database,kind)=>sql(database,"BEGIN READ ONLY; SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='"+kind+"' ORDER BY 1; COMMIT;").split(/\r?\n/).filter(Boolean);
  const tables=list(oldDb,"r"), sequences=list(oldDb,"S");
  if(!["actors","actor_roles","auth_sessions","auth_session_families","auth_refresh_tokens","operator_permissions","operator_bootstrap"].every(t=>tables.includes(t)) || tables.length>100)
    throw new Error("Legacy Identity data inventory incomplete");
  const fp=ownerDataFingerprintSql(schema,tables,sequences,"identity"), grants=sql(oldDb,identityAclSql(schema,oldRole));
  if(!grants || grants.split(/\r?\n/).some(line=>!/^GRANT (?:SELECT|INSERT|UPDATE)(?: \([a-z_][a-z0-9_]*\))? ON TABLE identity_test_docker_[a-f0-9]{12}\.[a-z_][a-z0-9_]* TO bthwani_identity_runtime;$/.test(line)))
    throw new Error("Legacy Identity grant inventory unsupported");
  const access=sql(oldDb,identityEffectiveAclSql(schema,oldRole));
  if(!access)throw new Error("Legacy Identity ACL proof incomplete");
  const tag="sha-"+head.slice(0,9);
  // The new owner image includes a mandatory live-principal check.
  run("pwsh",["-NoProfile","-File",buildScript,"-Owner","identity","-DockerContext",context,"-Image",owners.identity.image+":"+tag],{},180000);
  const image=imageRecord(owners.identity.image+":"+tag);
  if(sourceIdentity(image.Config.Labels,"identity").revision!==head || !clean())throw new Error("Identity candidate source advanced");
  const targetEnv={...env,REF_IDENTITY_IMAGE_TAG:tag,REF_IDENTITY_RUNTIME_DATABASE_URL:newUrl};
  const oldHashes=currentHashes(state,["dsh","identity"]);
  assertSameHashes(oldHashes,configHashes(files,["dsh","identity"],env));
  const targetHashes=configHashes(files,["dsh","identity"],targetEnv);
  if(targetHashes.dsh!==oldHashes.dsh || targetHashes.identity===oldHashes.identity)throw new Error("Unexpected Identity peer configuration change");
  // This is an additive, empty DB only. Preserve the legacy database and grants.
  if(!resume){
    sql("postgres","BEGIN; CREATE ROLE "+owner+" NOLOGIN NOINHERIT; CREATE ROLE "+runtime+" LOGIN NOINHERIT PASSWORD '"+password+"'; COMMIT;");
    sql("postgres","CREATE DATABASE "+db+" OWNER "+owner+" TEMPLATE template0;");
    sql("postgres","REVOKE ALL ON DATABASE "+db+" FROM PUBLIC; GRANT CONNECT ON DATABASE "+db+" TO "+runtime+";");
    sql(db,"REVOKE ALL ON SCHEMA public FROM PUBLIC;");
  } else {
    const ownership=sql(db,"BEGIN READ ONLY; SELECT (SELECT pg_get_userbyid(datdba)='"+owner+"' FROM pg_database WHERE datname=current_database()) AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"') AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AND rolcanlogin=(rolname='"+runtime+"'))=2 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"'))) AND (SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public'))=1 AND EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='"+schema+"' AND pg_get_userbyid(nspowner)='"+owner+"') AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND pg_get_userbyid(c.relowner)<>'"+owner+"') AND NOT has_schema_privilege('"+runtime+"','"+schema+"','USAGE'); COMMIT;");
    if(ownership!=="t" || !equal(list(db,"r"),tables) || !equal(list(db,"S"),sequences))
      throw new Error("Existing unpublished Identity candidate ownership differs; preserve and review");
  }
  let archive=null;
  let stopped=false,applyStarted=false;
  try {
    // Build and validate configuration before pausing the sole legacy writer.
    if(!clean() || inspect("identity").Id!==old.Id || inspect("dsh").Id!==state.dsh.Id || inspect("wlt").Id!==state.wlt.Id)
      throw new Error("Identity source or peer runtime changed");
    if(!resume)archive=createPrivateCopyArchive(pg,"identity");
    console.log("IDENTITY_HANDOFF_STARTED HEAD="+head);
    docker(["stop","--time","20",old.Id],{},45000); stopped=true;
    if(inspect("identity",false).State.Running)throw new Error("Legacy Identity writer still running");
    const noWriters=()=>{if(sql("postgres","BEGIN READ ONLY; SELECT count(*) FROM pg_stat_activity WHERE backend_type='client backend' AND pid<>pg_backend_pid() AND (datname='"+db+"' OR (datname='"+oldDb+"' AND usename IN ('"+admin+"','"+oldRole+"'))); COMMIT;")!=="0")throw new Error("Identity writer exclusivity unproven");};
    noWriters();
    const before=sql(oldDb,fp);
    const schemaDump=database=>normalizeIdentitySchemaDump(docker(["exec",pg,"pg_dump","--schema-only","--no-owner","--no-acl","--schema="+schema,"-U",admin,"-d",database],{},45000));
    const constraintSql="BEGIN READ ONLY; SELECT c.conname,c.contype,c.convalidated,c.conenforced,c.condeferrable,c.condeferred,c.connoinherit,pg_get_constraintdef(c.oid,true) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='"+schema+"' ORDER BY c.conname,c.contype,pg_get_constraintdef(c.oid,true); COMMIT;";
    const constraintProof=sql(oldDb,constraintSql);
    const originalSchema=schemaDump(oldDb);
    if(!resume){
      docker(["exec",pg,"pg_dump","-Fc","--no-owner","--no-acl","--schema="+schema,"-U",admin,"-d",oldDb,"-f",archive.file],{},45000);
      docker(["exec",pg,"pg_restore","--no-owner","--no-acl","--role="+owner,"--exit-on-error","--single-transaction","-U",admin,"-d",db,archive.file],{},60000);
    }
    if(schemaDump(db)!==originalSchema || !constraintProof || sql(db,constraintSql)!==constraintProof || !equal(list(db,"r"),tables) || !equal(list(db,"S"),sequences))throw new Error("Identity restored schema differs");
    assertHandoffParity(before,sql(db,fp),tables.length+sequences.length);
    assertHandoffParity(before,sql(oldDb,fp),tables.length+sequences.length);
    if(sql(oldDb,identityAclSql(schema,oldRole))!==grants || sql(oldDb,identityEffectiveAclSql(schema,oldRole))!==access)throw new Error("Legacy Identity grants changed");
    if(resume)sql("postgres","ALTER ROLE "+runtime+" PASSWORD '"+password+"';");
    sql(db,"BEGIN; GRANT USAGE ON SCHEMA "+schema+" TO "+runtime+";\n"+grants+"\nCOMMIT;");
    if(sql(db,identityEffectiveAclSql(schema,runtime))!==access || sql(oldDb,legacyOwnerAccessSql(runtime))!=="0" ||
       sql("postgres","BEGIN READ ONLY; SELECT NOT has_database_privilege('"+runtime+"','bthwani_dsh_dev','CONNECT') AND NOT has_database_privilege('"+runtime+"','bthwani_wlt_test','CONNECT'); COMMIT;")!=="t")
      throw new Error("Identity least-privilege parity or cross-owner isolation failed");
    if(!docker([...composeArgs(files),"run","--rm","--no-deps","--pull","never","identity","verify-development-db"],targetEnv,45000).includes("IDENTITY_DEVELOPMENT_DATABASE_PASS"))throw new Error("Identity runtime login proof failed");
    noWriters();
    assertHandoffParity(before,sql(oldDb,fp),tables.length+sequences.length);
    assertHandoffParity(before,sql(db,fp),tables.length+sequences.length);
    if(!clean() || imageRecord(owners.identity.image+":"+tag).Id!==image.Id ||
       inspect("identity",false).Id!==old.Id || inspect("dsh").Id!==state.dsh.Id || inspect("wlt").Id!==state.wlt.Id)
      throw new Error("Identity source, peers or local configuration advanced");
    appendOwnerEnv(envPath,original,"\nREF_IDENTITY_RUNTIME_DATABASE_URL="+newUrl+"\n");
    applyStarted=true;
    docker([...composeArgs(files),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60","identity"],targetEnv,95000);
    const now=inspect("identity");
    if(now.Image!==image.Id || now.Config.Labels["com.docker.compose.config-hash"]!==targetHashes.identity ||
       asEnv(now.Config.Env).IDENTITY_TEST_DATABASE_URL!==newUrl || inspect("dsh").Id!==state.dsh.Id || inspect("wlt").Id!==state.wlt.Id ||
       !docker(["exec",now.Id,"/usr/local/bin/identity","verify-development-db"],{},15000).includes("IDENTITY_DEVELOPMENT_DATABASE_PASS"))
      throw new Error("Identity serving runtime readback mismatch");
    console.log("IDENTITY_HANDOFF_PASS DATA_PARITY=PASS ACL_PARITY=PASS RUNTIME_LOGIN=PASS TABLES="+tables.length+" HEAD="+head);
  } catch(e) {
    if(e.code==="ETIMEDOUT")throw new Error("IDENTITY_HANDOFF_BLOCKED ambiguous operation; inspect before retry");
    if(stopped && !applyStarted && inspect("identity",false).Id===old.Id && !inspect("identity",false).State.Running){
      docker(["start",old.Id],{},45000);
      if(!inspect("identity",false).State.Running)throw new Error("IDENTITY_HANDOFF_RECOVERY_BLOCKED");
      throw new Error("IDENTITY_HANDOFF_ABORTED old writer restored: "+e.message);
    }
    throw new Error("IDENTITY_HANDOFF_REVIEW_REQUIRED "+e.message);
  } finally {
    try {if(archive)removePrivateCopyArchive(pg,archive);}catch{console.error("IDENTITY_COPY_ARCHIVE_CLEANUP_BLOCKED");}
  }
}

function rebaseAndApply(owner,state,env,head,files,tag,targetId,ensureSource,wltConfigTransition=null) {
  const old=state[owner], live=asEnv(old.Config.Env);
  const schema=owner==="dsh"?live.DSH_DB_SCHEMA:owner==="identity"?live.IDENTITY_DB_SCHEMA:"wlt";
  const archive="bthwani_recovery_"+owner+"_"+randomBytes(6).toString("hex");
  const scope=transitionScope(owner,schema,archive);
  const dsn=owner==="identity"?new URL(live.IDENTITY_TEST_DATABASE_URL):owner==="wlt"?new URL(live.WLT_TEST_DATABASE_URL):null;
  const actualDb=dsn?dsn.pathname.slice(1):live.REF_POSTGRES_DB;
  const actualRole=dsn?dsn.username:live.REF_POSTGRES_USER;
  if(actualDb!==scope.database||actualRole!==scope.runtime|| (dsn&&dsn.hostname!=="postgres") || (!dsn&&live.DSH_DB_HOST!=="postgres"))
    throw new Error("Dedicated owner database not verified");
  const pg=project+"-postgres-1";
  if(docker(["inspect","--format",'{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}',pg])!==project+"|refoundation|healthy")
    throw new Error("PostgreSQL owner not verified");
  const sql=(statement,timeout=30000)=>docker(["exec","-i",pg,"psql","-X","-qAt","-v","ON_ERROR_STOP=1","-U","bthwani_refoundation_admin","-d",scope.database,"-f","-"],{},timeout,statement+"\n");
  const before=sql("BEGIN READ ONLY; SELECT oid FROM pg_namespace WHERE nspname='"+schema+"' AND pg_get_userbyid(nspowner)='"+scope.owner+"'; COMMIT;");
  if(!/^[0-9]+$/.test(before))throw new Error("Owner namespace not verified");
  const transaction=buildOwnerBaselineTransition(owner,schema,archive);
  const candidateEnv={...env,[owners[owner].tag]:tag};
  const groupNames=owner==="wlt"?["wlt"]:["dsh","identity"];
  if (owner === "wlt" && wltConfigTransition) {
    assertSameHashes(currentHashes(state,groupNames),historicalWltHashes(wltConfigTransition.previous,env));
    assertSameHashes(wltConfigTransition.desired,configHashes(files,groupNames,env));
  } else {
    assertSameHashes(currentHashes(state,groupNames),configHashes(files,groupNames,env));
  }
  const hashes=configHashes(files,groupNames,candidateEnv);
  if(groupNames.some(o=>o!==owner&&hashes[o]!==currentHashes(state,[o])[o]))throw new Error("Schema transition changes peer configuration");
  ensureSource();
  if(Object.keys(owners).some(o=>inspect(o).Id!==state[o].Id)||imageRecord(owners[owner].image+":"+tag).Id!==targetId||imageRecord(old.Config.Image).Id!==old.Image)
    throw new Error("Concurrent owner or image change");
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
    docker([...composeArgs(files),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",owner],candidateEnv,95000);
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
      throw new Error("ROLLBACK_PASS "+owner+" incompatible owner baseline; original writer restored");
    }
    throw new Error("ROLLBACK_BLOCKED owner stop outcome not proven: "+owner);
  }
}

function assertNoOrphanReconciler() {
  const processes=run("pwsh",["-NoProfile","-NonInteractive","-Command",
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.ProcessId -ne "+process.pid+" -and $_.CommandLine -like '*reconcile-owner-runtime.mjs*' } | ForEach-Object { $_.ProcessId }"]);
  if(processes)throw new Error("Previous owner reconciler is still active");
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

export function assertSourceHost(machineName, reportedName, checkoutRoot) {
  if (machineName?.toUpperCase() !== "BTHWANI" ||
    (reportedName && reportedName.toUpperCase() !== "BTHWANI") ||
    checkoutRoot.toLowerCase() !== "d:\\samrim") throw new Error("Wrong source host");
}

function main() {
  const [mode,...options] = process.argv.slice(2);
  const cutover=mode==="--cutover-dsh-database";
  const recover=mode==="--recover-attempt";
  const prepare=options.length===1 && options[0]==="--prepare-baseline";
  if(recover && (options.length!==1||! /^[a-f0-9]{64}$/.test(options[0])))throw new Error("Expected exact reviewed runtime attempt key");
  if(!cutover && !recover && options.length && (!prepare || !["--apply","--apply-preview"].includes(mode))) throw new Error("Baseline preparation requires an explicit isolated apply");
  if (!["--check","--recover-attempt","--apply","--apply-captain","--apply-preview","--prepare-dsh-database","--resume-dsh-database","--cutover-dsh-database","--relocate-identity-database","--resume-identity-database"].includes(mode)) throw new Error("Usage: --check | --apply | --apply-captain | --apply-preview [--prepare-baseline]");
  const apply = mode !== "--check" && !recover;
  if ((apply||recover) && process.env.BTHWANI_UNIFIED_DEV_RECONCILE !== "1") throw new Error("Use the unified dev launcher with its lifecycle mutex");
  assertSourceHost(hostname(), process.env.COMPUTERNAME, root);
  if (!/^ssh:\/\/[^/]+@bthwani-docker$/.test(docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]))) throw new Error("Wrong Docker target");
  const head = git(["rev-parse","HEAD"]);
  const branch = git(["branch","--show-current"]);
  if (!branch || branch === "main" || branch.startsWith("archive/")) throw new Error("Not an active development branch");
  let recovery=null;
  if(recover){
    if(!process.env.LOCALAPPDATA)throw new Error("Missing runtime attempt directory");
    const directory=resolve(process.env.LOCALAPPDATA,"BThwani","Operations","SourceSync");
    const stateFile=resolve(directory,"runtime-reconcile.json"), receiptFile=resolve(directory,"runtime-reconcile.receipt.json");
    const reviewed=readFileSync(stateFile,"utf8");
    const attempt=JSON.parse(reviewed);
    if(attempt.version!==1||attempt.key!==options[0]||!["running","uncertain"].includes(attempt.status))
      throw new Error("RUNTIME_ATTEMPT_MISMATCH");
    assertNoOrphanReconciler();
    recovery={stateFile,receiptFile,reviewed,key:options[0]};
  }
  const state = Object.fromEntries(Object.keys(owners).map(o => [o, inspect(o)]));
  const activeAppFiles=appFiles;
  const captain=asEnv(state.identity.Config.Env).IDENTITY_ENABLE_ISOLATED_CAPTAIN_ADMISSION==="true";
  const allowedLegacyApp=captain?[...legacyAppFiles,legacyCaptainFile]:legacyAppFiles;
  for(const owner of ["dsh","identity"]){
    const files=liveFiles(state[owner]);
    if(!equal(files,appFiles)&&!equal(files,allowedLegacyApp))throw new Error("Unexpected historical Compose layout: "+owner);
  }
  if(!equal(liveFiles(state.wlt),appFiles)&&!equal(liveFiles(state.wlt),legacyWltFiles))throw new Error("Unexpected historical WLT Compose layout");
  // A legacy disabled layout never gets new trust mounts or routes automatically.
  // Existing exact hash checks below require a compatible explicit transition.
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
  const appNames = ["dsh","identity"];
  const groups = [{ names: appNames, files: activeAppFiles },{names:["wlt"],files:wltFiles}];
  let wltConfigDrift=false;
  let dshConfigTransition=null;
  for (const group of groups) {
    const expected=currentHashes(state,group.names);
    const actual=configHashes(group.files,group.names,env);
    if(group.names===appNames && differingKeys(expected,actual).length &&
       ["--check","--apply"].includes(mode) && !prepare &&
       !Object.hasOwn(process.env,"BTHWANI_RUNTIME_ATTEMPT_KEY") && !Object.hasOwn(process.env,"BTHWANI_RUNTIME_ATTEMPT_ID") &&
       !git(["status","--porcelain","--untracked-files=all"])) {
      const old=ownerRevision(state,"dsh"), peer=ownerRevision(state,"identity");
      git(["merge-base","--is-ancestor",old.revision,head]);
      git(["merge-base","--is-ancestor",peer.revision,head]);
      const schemaChanged=Boolean(git(["diff","--name-only",old.revision,head,"--","services/dsh/database"]) ||
                                  git(["diff","--name-only",peer.revision,head,"--","services/identity/database"]));
      const current=readFileSync(canonicalComposePath,"utf8");
      const previous=previousOwnerCompose(old.revision,"dsh","DSH_ENABLE_ISOLATED_EMPLOYEES",current);
      const disabledHandlerProven=[old.revision,head].every(revision=>/if os\.Getenv\("DSH_ENABLE_ISOLATED_EMPLOYEES"\) != "true" \{\s*return existing, nil\s*\}/.test(git(["show",revision+":services/dsh/backend/cmd/dsh/employees.go"])));
      if(previous && !old.digest && !peer.digest && admittedDshConfigTransition({
        mode,automatic:false,clean:true,schemaChanged,disabledHandlerProven,oldFlagPresent:Object.hasOwn(dshEnv,"DSH_ENABLE_ISOLATED_EMPLOYEES"),
        previous,current,live:expected,historical:historicalDshHashes(group.files,group.names,env,previous),
        desired:actual,disabled:configHashes(group.files,group.names,{...env,REF_DSH_ENABLE_ISOLATED_EMPLOYEES:"false"})
      })) {
        dshConfigTransition={previous,desired:actual};
        env.REF_DSH_ENABLE_ISOLATED_EMPLOYEES="false";
        console.log("DSH_CONFIG_TRANSITION_ELIGIBLE exact_prior_hash=yes employee_flag=false manual_only=yes");
        continue;
      }
    }
    if(wltConfigReviewRequired(expected,actual,mode)) wltConfigDrift=true;
  }
  if(mode==="--prepare-dsh-database" || mode==="--resume-dsh-database"){prepareDedicatedDsh(state,env,head,activeAppFiles,mode==="--resume-dsh-database");return;}
  if(cutover){if(options.length!==1)throw new Error("Expected prepared source SHA");cutoverPreparedDsh(state,env,head,activeAppFiles,options[0]);return;}
  if(mode==="--relocate-identity-database" || mode==="--resume-identity-database"){relocateIdentity(state,env,head,activeAppFiles,mode==="--resume-identity-database");return;}
  const revisions=Object.fromEntries(Object.keys(owners).map(o=>[o,ownerRevision(state,o)]));
  const committed={};
  for(const o of Object.keys(owners)){
    git(["merge-base","--is-ancestor",revisions[o].revision,head]);
    committed[o]=git(["diff","--name-only","--no-renames",revisions[o].revision,head,"--","services/"+o]).split(/\r?\n/).filter(Boolean);
  }
  // A committed SQL transition can include the specific WLT peer-origin
  // addition only when the exact historical configuration is reconstructable.
  // Unknown drift, dirty inputs and ordinary automatic reconciliation still hold.
  let wltConfigTransition=null;
  if (wltConfigDrift && apply && prepare && !revisions.wlt.digest &&
      !dirtyPaths(root,guardedScope).length &&
      committed.wlt.some(rel=>rel.startsWith("services/wlt/database/schema/")) &&
      !Object.hasOwn(asEnv(state.wlt.Config.Env),"WLT_TEST_DSH_ORIGIN")) {
    const desired=readFileSync(canonicalComposePath,"utf8");
    const previous=previousOwnerCompose(revisions.wlt.revision,"wlt","WLT_TEST_DSH_ORIGIN",desired);
    if (previous && isAdmittedWltOriginAddition(previous,desired) &&
        !differingKeys(currentHashes(state,["wlt"]),historicalWltHashes(previous,env)).length) {
      wltConfigTransition={previous,desired:configHashes(wltFiles,["wlt"],env)};
      wltConfigDrift=false;
      console.log("WLT_CONFIG_TRANSITION_ELIGIBLE exact_prior_hash=yes baseline_proof=required");
    }
  }
  const preview=mode==="--apply-preview" || !apply;
  const change=currentChangeKey(committed,preview,captain,wltConfigDrift);
  const ensureSource=()=>checkedHead(head,change.key,committed,preview,captain,wltConfigDrift);
  let blocked=change.plan.blocked;
  const schemaReady=[];
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
      console.error("BASELINE_PROOF_FAIL "+e.message);
      // A failed disposable rehearsal does not authorize SQL; independently
      // eligible image-only owners can still advance.
    }
  }
  if(new URL(identityEnv.IDENTITY_TEST_DATABASE_URL).pathname!=="/bthwani_identity_dev" && committed.identity.length) {
    blocked.identity="OWNER_DATABASE_HANDOFF_REQUIRED";
    if(!blocked.dsh && (change.changed.some(p=>p.startsWith("services/dsh/"))||committed.dsh.length))blocked.dsh="PEER_REVIEW_REQUIRED:identity";
    if(!blocked.wlt && (change.changed.some(p=>p.startsWith("services/wlt/"))||committed.wlt.length))blocked.wlt="PEER_REVIEW_REQUIRED:identity";
  }
  let partial=Object.keys(blocked).length>0;
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
      console.log(o+" RUNTIME=BLOCKED revision="+old.revision+" reason=PREVIEW_NOT_AUTHORIZED");
      continue;
    }
    if(dirty && (source.previewChanges.length || source.imageChanges.length || old.digest)) snapshots.set(o,captureOwner(root,o));
    const snapshot=snapshots.get(o);
    const stale=snapshot ? old.digest!==snapshot.digest || old.revision!==head : Boolean(source.imageChanges.length || old.digest || (o==="dsh"&&dshConfigTransition));
    if(stale)candidates.push(o);
    console.log(o+" RUNTIME="+(stale?"STALE":snapshot?"PREVIEW_CURRENT":"CURRENT")+" revision="+old.revision+(old.digest?" preview="+old.digest:"")+(source.clientPending && dirty?" SOURCE=CLIENT_REVIEW_PENDING":""));
  }
  const selected = selectOwners({candidates,activateCaptain:mode==="--apply-captain",currentCaptain:captain});
  if(dshConfigTransition&&!selected.includes("dsh")) throw new Error("DSH configuration transition requires an eligible DSH candidate");
  console.log("SELECTED="+(selected.join(",")||"NONE")+" HEAD="+head+" CAPTAIN_ADMISSION="+captain);
  if(recovery){
    if(partial||selected.length||change.changed.length)throw new Error("Runtime recovery requires current, clean, fully verified owners");
    ensureSource();
    verifyRecoveryOwners(state);
    ensureSource();
    acknowledgeRuntimeRecovery(recovery.stateFile,recovery.receiptFile,recovery.key,recovery.reviewed);
    console.log("RUNTIME_ATTEMPT_REARMED HEAD="+head+" key="+recovery.key.slice(0,12));
    return;
  }
  if (!apply || selected.length===0) {
    if(partial || selected.length){console.log("RECONCILE_PARTIAL HEAD="+head);process.exitCode=3;}
    else console.log("RECONCILE_PASS HEAD="+head);
    return;
  }
  ensureSource();
  if(dshConfigTransition) verifyRecoveryOwners(state);
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
    const staged=snap?materializeOwner(snap):null;
    try {
      const service=staged?.dir || resolve(root,"services",o);
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
      if(snap){
        verifyMaterializedOwner(service,snap);
        const file=resolve(service,"backend","Dockerfile");
        if(!readFileSync(file,"utf8").split(/\r?\n/).some(line=>line.startsWith("FROM golang:"+pin+"-alpine@sha256:") && /@sha256:[0-9a-f]{64} AS build$/.test(line)))throw new Error("Pinned preview Dockerfile required");
        // Preview uses the canonical owner Dockerfile but never claims a commit SHA.
        docker(["build","--pull=false","--file",file,"--build-arg","SAMRIM_SOURCE_REVISION=worktree-"+snap.digest,"--label","com.bthwani.preview-base="+head,"--label","com.bthwani.preview-digest="+snap.digest,"--tag",owners[o].image+":"+tag,service],{},180000);
        verifyMaterializedOwner(service,snap);
        if(captureOwner(root,o).digest!==snap.digest)throw new Error("Preview input changed during build: "+o);
      } else run("pwsh",["-NoProfile","-File",buildScript,"-Owner",o,"-DockerContext",context,"-Image",owners[o].image+":"+tag],{},180000);
      const image=imageRecord(owners[o].image+":"+tag);
      const source=sourceIdentity(image.Config.Labels,o);
      if(source.revision!==head || source.digest!==(snap?.digest||null))throw new Error("New image source mismatch: "+o);
      targetIds[o]=image.Id;
      nextEnv[owners[o].tag]=tag;
      console.log("OWNER_IMAGE_PASS "+o+" "+image.Id+(snap?" preview="+snap.digest:""));
    } finally { staged?.dispose(); }
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
    rebaseAndApply(o,state,env,head,o==="wlt"?wltFiles:activeAppFiles,tags[o],targetIds[o],ensureSource,o==="wlt"?wltConfigTransition:null);
  }
  for (const group of groups) {
    const names=group.names.filter(o=>selected.includes(o)&&!schemaSelected.includes(o));
    if(!names.length) continue;
    if(wltConfigTransition && names.includes("wlt")) throw new Error("WLT configuration transition requires successful baseline proof");
    const newFiles=group.files;
    ensureSource();
    for(const o of names) if(imageRecord(owners[o].image+":"+tags[o]).Id!==targetIds[o])throw new Error("Candidate image tag changed: "+o);
    const transition=group.names===appNames ? dshConfigTransition : null;
    const verifyPriorConfig=()=>{
      if(transition){
        assertSameHashes(currentHashes(state,group.names),historicalDshHashes(group.files,group.names,env,transition.previous));
        assertSameHashes(transition.desired,configHashes(group.files,group.names,env));
      }else assertSameHashes(currentHashes(state,group.names),configHashes(group.files,group.names,env));
    };
    verifyPriorConfig();
    const verifyUnselectedPeers=()=>{
      if(!transition)return;
      for(const o of group.names.filter(name=>!names.includes(name))){
        const now=inspect(o);
        if(now.Id!==state[o].Id||now.Image!==state[o].Image||now.Config.Labels["com.docker.compose.config-hash"]!==currentHashes(state,[o])[o])
          throw new Error("Concurrent unselected peer change: "+o);
      }
    };
    verifyUnselectedPeers();
    const newHashes=configHashes(newFiles,group.names,nextEnv);
    if(transition && group.names.some(o=>!names.includes(o)&&newHashes[o]!==currentHashes(state,[o])[o]))
      throw new Error("DSH configuration transition changes an unselected peer");
    try {
      console.log("OWNER_APPLY_STARTED "+names.join(","));
      docker([...composeArgs(newFiles),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",...names],nextEnv,95000);
      for (const o of names) {
        const now=inspect(o);
        const source=ownerRevision({[o]:now},o);
        if(now.Image!==targetIds[o] || now.Config.Labels["com.docker.compose.config-hash"]!==newHashes[o] || source.revision!==head || source.digest!==(snapshots.get(o)?.digest||null)) throw new Error("Owner readback mismatch: "+o);
        if(transition && o==="dsh" && asEnv(now.Config.Env).DSH_ENABLE_ISOLATED_EMPLOYEES!=="false")
          throw new Error("DSH disabled employee setting not verified");
        console.log("OWNER_RUNTIME_PASS "+o+" "+now.Id);
      }
      verifyUnselectedPeers();
      if(dshConfigTransition) verifyRecoveryOwners(Object.fromEntries(Object.keys(owners).map(o=>[o,inspect(o)])));
      console.log("OWNER_APPLY_VERIFIED "+names.join(","));
    } catch (e) {
      // Before rollback, establish the durable state and that no unknown writer
      // changed the selected service or the rollback configuration.
      for(const o of names){
        const now=inspect(o,false);
        const hash=now.Config.Labels["com.docker.compose.config-hash"];
        if(transition){
          if(!isKnownImageConfigPair(now.Image,hash,{image:state[o].Image,hash:currentHashes(state,[o])[o]},
              {image:targetIds[o],hash:newHashes[o]})) throw new Error("ROLLBACK_BLOCKED unknown owner state: "+o);
        }else if(![currentHashes(state,[o])[o],newHashes[o]].includes(hash) ||
           ![state[o].Image,targetIds[o]].includes(now.Image)) throw new Error("ROLLBACK_BLOCKED unknown owner state: "+o);
      }
      if(e.code === "ETIMEDOUT") throw new Error("ROLLBACK_BLOCKED ambiguous Docker operation; readback completed, require explicit reconciliation");
      ensureSource();
      verifyUnselectedPeers();
      verifyPriorConfig();
      for(const o of names) if(imageRecord(state[o].Config.Image).Id!==state[o].Image) throw new Error("ROLLBACK_BLOCKED previous image tag drift: "+o);
      // For this explicit configuration transition, rollback restores the old
      // binary with the already-proven default-off addition. Both binaries
      // require the value "true" to enable employees; false preserves denial.
      const rollbackHashes=transition?transition.desired:currentHashes(state,group.names);
      docker([...composeArgs(group.files),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",...names],env,95000);
      for(const o of names){
        const now=inspect(o);
        if(now.Image!==state[o].Image||now.Config.Labels["com.docker.compose.config-hash"]!==rollbackHashes[o]) throw new Error("ROLLBACK_READBACK_FAILED "+o);
      }
      verifyUnselectedPeers();
      if(dshConfigTransition) verifyRecoveryOwners(Object.fromEntries(Object.keys(owners).map(o=>[o,inspect(o)])));
      throw new Error("ROLLBACK_PASS "+names.join(",")+" after failed replacement: "+e.message);
    }
  }
  ensureSource();
  for(const [o,snap] of snapshots) if(captureOwner(root,o).digest!==snap.digest)throw new Error("RUNTIME_STALE preview input advanced: "+o);
  if(partial){console.log("RECONCILE_PARTIAL HEAD="+head);process.exitCode=3;}
  else console.log("RECONCILE_PASS HEAD="+head);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
    // The actual reconciler owns the terminal proof, not the watcher's pipe.
    // Only a complete successful automatic apply can release the matching hold.
    const key=process.env.BTHWANI_RUNTIME_ATTEMPT_KEY;
    const attempt=process.env.BTHWANI_RUNTIME_ATTEMPT_ID;
    if((key||attempt) && !process.exitCode && ["--apply","--apply-preview"].includes(process.argv[2])){
      if(!key||!attempt||!process.env.LOCALAPPDATA)throw new Error("RUNTIME_ATTEMPT_MISMATCH");
      const directory=resolve(process.env.LOCALAPPDATA,"BThwani","Operations","SourceSync");
      acknowledgeRuntimeAttempt(resolve(directory,"runtime-reconcile.json"),resolve(directory,"runtime-reconcile.receipt.json"),key,attempt);
    }
  } catch (e) { console.error("RUNTIME_RECONCILE_BLOCKED " + e.message); process.exitCode = 1; }
}
