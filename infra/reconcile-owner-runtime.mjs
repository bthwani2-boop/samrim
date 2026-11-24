#!/usr/bin/env node
// Isolated development owner reconciliation; no SQL, secret output or volume mutations.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, lstatSync, appendFileSync } from "node:fs";
import { captureOwner, dirtyPaths, isPreviewGoPath, materializeOwner, ownerReconcilePlan, ownerSourceState, previewChangeKey, verifyMaterializedOwner } from "./owner-preview-source.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const context = "bthwani-docker";
const project = "bthwani-refoundation";
const owners = {
  dsh: { tag: "REF_DSH_IMAGE_TAG", image: "bthwani-refoundation-dsh", profile: "implementation" },
  identity: { tag: "REF_IDENTITY_IMAGE_TAG", image: "bthwani-refoundation-identity-verifier", profile: "identity-verifier" },
  wlt: { tag: "REF_WLT_IMAGE_TAG", image: "bthwani-refoundation-wlt", profile: "wlt-reader" },
};
const appFiles = ["compose.yaml", "compose.apps.yaml", "compose.identity-verifier.yaml", "compose.merchant-development.yaml"];
const captainFile = "compose.captain-development.yaml";
const wltFiles = ["compose.yaml", "compose.wlt.yaml"];
const operatorOverrides = {
  IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP: "REF_IDENTITY_OPERATOR_BOOTSTRAP",
  IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH: "REF_IDENTITY_OPERATOR_PASSKEY_AUTH",
  IDENTITY_ENABLE_ISOLATED_OPERATOR_PERMISSION_ADMIN: "REF_IDENTITY_OPERATOR_PERMISSION_ADMIN",
  IDENTITY_ENABLE_LOCAL_DEV_FIRST_OPERATOR: "REF_IDENTITY_LOCAL_DEV_FIRST_OPERATOR",
  IDENTITY_OPERATOR_PASSKEY_ORIGINS: "REF_IDENTITY_OPERATOR_PASSKEY_ORIGINS",
  IDENTITY_OPERATOR_PASSKEY_RPID: "REF_IDENTITY_OPERATOR_PASSKEY_RPID",
};
const buildScripts = {
  dsh: "infra/build-dsh-image.ps1",
  identity: "infra/build-identity-verifier-image.ps1",
  wlt: "infra/build-wlt-image.ps1",
};
const gitExe = process.platform === "win32" ? "C:\\Program Files\\Git\\cmd\\git.exe" : "/usr/bin/git";
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
function composeArgs(activeFiles) {
  return ["compose", "--env-file", "infra/.env", "--env-file", "infra/.env.identity-verifier.local",
    ...activeFiles.flatMap(f => ["-f", "infra/" + f]),
    ...Object.entries(owners).filter(([o]) => o === "wlt" ? activeFiles.includes("compose.wlt.yaml") : activeFiles.includes("compose.apps.yaml")).flatMap(([,o]) => ["--profile", o.profile])];
}
function asEnv(values) {
  return Object.fromEntries(values.map(v => [v.slice(0, v.indexOf("=")), v.slice(v.indexOf("=") + 1)]));
}
export function differingKeys(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(k => before[k] !== after[k]).sort();
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
function liveFiles(v) {
  const prefix = root.toLowerCase() + "\\infra\\";
  return (v.Config.Labels["com.docker.compose.project.config_files"] || "").split(",").map(p => {
    const normalized = p.replaceAll("/", "\\");
    if (!normalized.toLowerCase().startsWith(prefix)) throw new Error("Unowned Compose file");
    return normalized.slice(prefix.length);
  });
}
function equal(a,b) { return JSON.stringify(a) === JSON.stringify(b); }
function configHashes(activeFiles, names, env) {
  const lines = docker([...composeArgs(activeFiles), "config", "--hash", names.join(",")], env).split(/\r?\n/);
  const result = Object.fromEntries(lines.map(l => l.trim().split(/\s+/)));
  if (Object.keys(result).length !== names.length || names.some(o => !/^[0-9a-f]{64}$/.test(result[o] || ""))) throw new Error("Incomplete Compose hash");
  return result;
}
function currentHashes(state, names) {
  return Object.fromEntries(names.map(o => [o, state[o].Config.Labels["com.docker.compose.config-hash"]]));
}
function imageRecord(image) {
  return JSON.parse(docker(["image", "inspect", image]))[0];
}
export function sourceIdentity(labels, owner) {
  const a=labels?.["org.opencontainers.image.revision"];
  const b=labels?.["com.bthwani.source-sha"];
  const base=labels?.["com.bthwani.preview-base"];
  const digest=labels?.["com.bthwani.preview-digest"];
  if(base || digest || a?.startsWith("worktree-")){
    if(b || !/^[0-9a-f]{40}$/.test(base||"") || !/^[0-9a-f]{64}$/.test(digest||"") || a!=="worktree-"+digest) throw new Error("Invalid preview provenance: "+owner);
    return {revision:base,digest};
  }
  if(!/^[0-9a-f]{40}$/.test(a||b||"") || (a&&b&&a!==b)) throw new Error("Invalid source provenance: "+owner);
  return {revision:a||b,digest:null};
}
function ownerRevision(state,owner) { return sourceIdentity(imageRecord(state[owner].Image).Config.Labels,owner); }
const guardedScope = ["services","infra/compose.yaml","infra/compose.apps.yaml","infra/compose.identity-verifier.yaml","infra/compose.merchant-development.yaml","infra/compose.captain-development.yaml","infra/compose.wlt.yaml",".go-version"];
function currentChangeKey(committed, preview, captain) {
  const changed=dirtyPaths(root,guardedScope);
  const plan=ownerReconcilePlan({changed,committed,preview,captain});
  const go=changed.filter(p=>isPreviewGoPath(p) && plan.eligible.some(o=>p.startsWith("services/"+o+"/")));
  // Blocked inputs cannot be built; only their paths/review classification
  // affect selection. Eligible Go bytes must remain exactly stable.
  const key=createHash("sha256").update(JSON.stringify([changed,plan])).update(previewChangeKey(root,go)).digest("hex");
  return {changed,plan,key};
}
function checkedHead(head, key, committed, preview, captain) {
  const currentBranch = git(["branch", "--show-current"]);
  if (!currentBranch || currentBranch === "main" || currentBranch.startsWith("archive/")) throw new Error("Not an active development branch");
  if (git(["rev-parse", "HEAD"]) !== head || currentChangeKey(committed,preview,captain).key !== key) throw new Error("Source changed during reconciliation");
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
  const expected=["PG_FRESH_DSH_BASELINE","PG_READER_ACCESS","PG_RESTORE_READBACK","PG_DSH_DEDICATED_RUNTIME","PG_FRESH_IDENTITY_BASELINE","PG_FRESH_WLT_BASELINE","PG_ISOLATION"];
  for(const name of expected) {
    const evidence=output.split(/\r?\n/).filter(line=>line.startsWith(name+"="));
    if(evidence.length!==1 || !(evidence[0]===name+"=PASS" || evidence[0].startsWith(name+"=PASS "))) throw new Error("BASELINE_PROOF_INCOMPLETE "+name);
  }
}
const baselineProofScope=["services/identity/database","services/dsh/database","services/wlt/database","infra/verify-isolated-postgres.ps1","infra/compose.yaml"];
// One-time additive preparation: the old owner remains the writer until a
// separately verified handoff. No retained schema, role, service or volume is
// modified. Existing target names fail closed rather than being overwritten.
export function ownerDataFingerprintSql(schema, tables, sequences) {
  const identifier=/^[a-z][a-z0-9_]{0,62}$/;
  if(!/^dsh_test_[a-z0-9_]{1,50}$/.test(schema) ||
     [...tables,...sequences].some(t=>!identifier.test(t)) ||
     !tables.length || new Set(tables).size!==tables.length || new Set(sequences).size!==sequences.length) throw new Error("Invalid owner snapshot scope");
  return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL intervalstyle='postgres'; SET LOCAL extra_float_digits=3;\n"+
    [...tables].sort().map(t=>"SELECT 'table:"+t+"',count(*),encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') h FROM "+schema+"."+t+" x) q;").join("\n")+"\n"+
    [...sequences].sort().map(t=>"SELECT 'sequence:"+t+"',last_value,is_called FROM "+schema+"."+t+";").join("\n")+"\nCOMMIT;";
}
export function legacyDshAccessSql() {
  return "BEGIN READ ONLY; SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('r','p','v','m','f') AND n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_%' AND (has_table_privilege('bthwani_dsh_runtime',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege('bthwani_dsh_runtime',c.oid,'INSERT,UPDATE,REFERENCES') OR ((has_table_privilege('bthwani_dsh_runtime',c.oid,'SELECT') OR has_any_column_privilege('bthwani_dsh_runtime',c.oid,'SELECT')) AND NOT EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.refclassid='pg_extension'::regclass AND d.deptype='e' AND ((e.extname='postgis' AND n.nspname='public' AND c.relname IN ('geography_columns','geometry_columns','spatial_ref_sys')) OR (e.extname='postgis_tiger_geocoder' AND n.nspname='tiger' AND c.relname IN ('geocode_settings','geocode_settings_default','loader_lookuptables','loader_platform','loader_variables','pagc_gaz','pagc_lex','pagc_rules')) OR (e.extname='postgis_topology' AND n.nspname='topology' AND c.relname IN ('layer','topology')))))); COMMIT;";
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
  const envInfo=lstatSync(envPath);
  if(!envInfo.isFile() || envInfo.isSymbolicLink())throw new Error("Unsafe local environment file");
  git(["check-ignore","infra/.env"]);
  const original=readFileSync(envPath,"utf8");
  if(/^REF_DSH_RUNTIME_(?:DATABASE|USER|PASSWORD)=/m.test(original))throw new Error("Dedicated DSH credentials already exist; do not overwrite");
  const absent=sql("postgres","BEGIN READ ONLY; SELECT (SELECT count(*) FROM pg_database WHERE datname='"+db+"')+(SELECT count(*) FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"')); COMMIT;");
  if(absent!==(resume?"3":"0"))throw new Error("Dedicated DSH namespace is not in the explicitly selected preparation state");
  const list=kind=>sql(oldDb,"BEGIN READ ONLY; SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='"+kind+"' ORDER BY 1; COMMIT;").split(/\r?\n/).filter(Boolean);
  const tables=list("r"),sequences=list("S");
  if(!tables.includes("public_revision") || tables.length>100 || sequences.length>100)throw new Error("Unexpected source owner data inventory");
  const fingerprint=ownerDataFingerprintSql(schema,tables,sequences);
  const before=sql(oldDb,fingerprint);
  if(before.split(/\r?\n/).length!==tables.length+sequences.length)throw new Error("Incomplete source data fingerprint");
  const tag="sha-"+head.slice(0,9);
  run("pwsh",["-NoProfile","-File",buildScripts.dsh,"-DockerContext",context,"-Image",owners.dsh.image+":"+tag],{},180000);
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
  const archive="/tmp/bthwani-dsh-copy-"+randomBytes(12).toString("hex")+".dump";
  try {
    if(!resume){
    docker(["exec",pg,"pg_dump","-Fc","--data-only","--no-owner","--no-acl","--schema="+schema,"-U",admin,"-d",oldDb,"-f",archive],{},45000);
    sql(db,"DELETE FROM "+schema+".public_revision WHERE singleton;");
    docker(["exec",pg,"pg_restore","--data-only","--no-owner","--no-acl","--exit-on-error","--single-transaction","-U",admin,"-d",db,archive],{},45000);
    } else {
      const candidateProof=sql(db,"BEGIN READ ONLY; SELECT (SELECT pg_get_userbyid(datdba)='"+owner+"' FROM pg_database WHERE datname=current_database()) AND NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AND (SELECT count(*) FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"') AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit) AND rolcanlogin=(rolname='"+runtime+"'))=2 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN (SELECT oid FROM pg_roles WHERE rolname IN ('"+owner+"','"+runtime+"'))) AND (SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname NOT IN ('information_schema','public'))=1 AND EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='"+schema+"' AND pg_get_userbyid(nspowner)='"+owner+"') AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND pg_get_userbyid(c.relowner)<>'"+owner+"'); COMMIT;");
      const candidateTables=sql(db,"BEGIN READ ONLY; SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='"+schema+"' AND c.relkind='r' ORDER BY 1; COMMIT;").split(/\r?\n/);
      if(candidateProof!=="t" || !equal(candidateTables,[...new Set([...tables,"customer_addresses","service_city_delivery_policies"])].sort()))throw new Error("Existing unpublished DSH candidate ownership or inventory differs; do not alter");
    }
    if(sql(oldDb,fingerprint)!==before || sql(db,fingerprint)!==before)throw new Error("Source or candidate data changed; preserve both and review");
    if(sql(db,"BEGIN READ ONLY; SELECT (SELECT count(*) FROM "+schema+".customer_addresses)+(SELECT count(*) FROM "+schema+".service_city_delivery_policies); COMMIT;")!=="0")throw new Error("Fresh policy or address facts must remain empty");
    const legacyAccess=sql(oldDb,legacyDshAccessSql());
    if(legacyAccess!=="0" || sql("postgres","BEGIN READ ONLY; SELECT has_database_privilege('"+runtime+"','bthwani_wlt_test','CONNECT'); COMMIT;")!=="f")throw new Error("Dedicated runtime has unexpected legacy or WLT access");

    if(resume)sql("postgres","ALTER ROLE "+runtime+" PASSWORD '"+runtimeSecret+"';");
    sql(db,"GRANT USAGE ON SCHEMA "+schema+" TO "+runtime+"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA "+schema+" TO "+runtime+"; GRANT USAGE ON ALL SEQUENCES IN SCHEMA "+schema+" TO "+runtime+";");
    const verified=docker([...composeArgs(activeFiles),"run","--rm","--no-deps","--pull","never","dsh","-mode=verify-development-db"],candidateEnv,45000);
    if(!verified.includes("DSH_DEVELOPMENT_DATABASE_PASS"))throw new Error("Dedicated runtime login not verified");
    if(sql(oldDb,fingerprint)!==before || git(["rev-parse","HEAD"])!==head || git(["status","--porcelain","--untracked-files=all"]) || readFileSync(envPath,"utf8")!==original)throw new Error("Source, data or local configuration changed; do not publish candidate credentials");
    appendFileSync(envPath,"\nREF_DSH_RUNTIME_DATABASE="+db+"\nREF_DSH_RUNTIME_USER="+runtime+"\nREF_DSH_RUNTIME_PASSWORD="+runtimeSecret+"\n",{encoding:"utf8"});
    console.log("DSH_DEDICATED_DATABASE_PREPARED HEAD="+head+" TABLES="+tables.length+" DATA_PARITY=PASS RUNTIME_LOGIN=PASS CUTOVER=NOT_RUN");
  } finally {
    // Exact owned archive only; never remove a retained database.
    try {if(!resume)docker(["exec",pg,"rm","-f","--",archive]);}catch{console.error("DSH_COPY_ARCHIVE_CLEANUP_BLOCKED");}
  }
}

function main() {
  const [mode,...options] = process.argv.slice(2);
  const prepare=options.length===1 && options[0]==="--prepare-baseline";
  if(options.length && (!prepare || !["--apply","--apply-preview"].includes(mode))) throw new Error("Baseline preparation requires an explicit isolated apply");
  if (!["--check","--apply","--apply-captain","--apply-preview","--prepare-dsh-database","--resume-dsh-database"].includes(mode)) throw new Error("Usage: --check | --apply | --apply-captain | --apply-preview [--prepare-baseline]");
  const apply = mode !== "--check";
  if (apply && process.env.BTHWANI_UNIFIED_DEV_RECONCILE !== "1") throw new Error("Use the unified dev launcher with its lifecycle mutex");
  if (process.env.COMPUTERNAME?.toUpperCase() !== "BTHWANI" || root.toLowerCase() !== "d:\\samrim") throw new Error("Wrong source host");
  if (!/^ssh:\/\/[^/]+@bthwani-docker$/.test(docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]))) throw new Error("Wrong Docker target");
  const head = git(["rev-parse","HEAD"]);
  const branch = git(["branch","--show-current"]);
  if (!branch || branch === "main" || branch.startsWith("archive/")) throw new Error("Not an active development branch");
  const state = Object.fromEntries(Object.keys(owners).map(o => [o, inspect(o)]));
  const activeAppFiles = liveFiles(state.dsh);
  const captain = activeAppFiles.includes(captainFile);
  if (!equal(activeAppFiles,captain ? [...appFiles,captainFile] : appFiles) || !equal(liveFiles(state.identity),activeAppFiles) || !equal(liveFiles(state.wlt),wltFiles)) throw new Error("Unexpected current Compose overlays");
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
  for (const [name, key] of Object.entries(operatorOverrides)) {
    if (!Object.hasOwn(identityEnv,name)) throw new Error("Missing current Operator setting: " + name);
    env[key] = identityEnv[name];
  }
  const appNames = ["dsh","identity"];
  const groups = [{ names: appNames, files: activeAppFiles },{names:["wlt"],files:wltFiles}];
  for (const group of groups) assertSameHashes(currentHashes(state,group.names),configHashes(group.files,group.names,env));
  if(mode==="--prepare-dsh-database" || mode==="--resume-dsh-database"){prepareDedicatedDsh(state,env,head,activeAppFiles,mode==="--resume-dsh-database");return;}
  const revisions=Object.fromEntries(Object.keys(owners).map(o=>[o,ownerRevision(state,o)]));
  const committed={};
  for(const o of Object.keys(owners)){
    git(["merge-base","--is-ancestor",revisions[o].revision,head]);
    committed[o]=git(["diff","--name-only",revisions[o].revision,head,"--","services/"+o]).split(/\r?\n/).filter(Boolean);
  }
  const preview=mode==="--apply-preview" || !apply;
  const change=currentChangeKey(committed,preview,captain);
  const ensureSource=()=>checkedHead(head,change.key,committed,preview,captain);
  const blocked=change.plan.blocked;
  let partial=Object.keys(blocked).length>0;
  if(mode==="--apply-captain" && (partial || change.changed.length)) throw new Error("Captain activation requires a fully reviewed committed source");
  const prepareFreshBaseline=()=>{
    if(!apply || !prepare) return;
    const proofOwners=baselineProofOwners({apply,prepare,blocked,dirtyInputs:dirtyPaths(root,baselineProofScope)});
    if(!proofOwners.length)return;
    ensureSource();
    console.log("BASELINE_PROOF_STARTED HEAD="+head+" OWNERS="+proofOwners.join(","));
    const proof=run("pwsh",["-NoProfile","-File","infra/verify-isolated-postgres.ps1","-DockerContext",context,"-NoPull"],{},360000);
    verifyBaselineProofOutput(proof);
    ensureSource();
    if(dirtyPaths(root,baselineProofScope).length)throw new Error("Baseline proof inputs changed during rehearsal");
    console.log("BASELINE_PROOF_PASS HEAD="+head+" OWNERS="+proofOwners.join(",")+" CUTOVER=BLOCKED");
  };
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
    const stale=snapshot ? old.digest!==snapshot.digest || old.revision!==head : Boolean(source.imageChanges.length || source.requiresCommittedRefresh || old.digest);
    if(stale)candidates.push(o);
    console.log(o+" RUNTIME="+(stale?"STALE":snapshot?"PREVIEW_CURRENT":"CURRENT")+" revision="+old.revision+(old.digest?" preview="+old.digest:"")+(source.clientPending && dirty?" SOURCE=CLIENT_REVIEW_PENDING":""));
  }
  const selected = selectOwners({candidates,activateCaptain:mode==="--apply-captain",currentCaptain:captain});
  console.log("SELECTED="+(selected.join(",")||"NONE")+" HEAD="+head+" CAPTAIN_OVERLAY="+captain);
  if (!apply || selected.length===0) {
    prepareFreshBaseline();
    if(partial || selected.length){console.log("RECONCILE_PARTIAL HEAD="+head);process.exitCode=3;}
    else console.log("RECONCILE_PASS HEAD="+head);
    return;
  }
  ensureSource();
  const tags={};
  const targetIds={};
  const nextEnv = {...env};
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
      const version=run("go",["version"],{GOTOOLCHAIN:"local"});
      if(!version.startsWith("go version go"+pin+" "))throw new Error("Pinned Go toolchain required");
      const go=spawnSync("go",["test","-json","-count=1","./..."],{cwd:resolve(service,"backend"),encoding:"utf8",windowsHide:true,timeout:120000,maxBuffer:16*1024*1024,env:{...isolatedTestEnv(process.env),GOWORK:"off"}});
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
      } else run("pwsh",["-NoProfile","-File",buildScripts[o],"-DockerContext",context,"-Image",owners[o].image+":"+tag],{},180000);
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
  if (activate) validateVolumeFiles(tags.dsh);
  // Re-read every owner before mutation. Do not overwrite another writer.
  for (const o of Object.keys(owners)) {
    const now=inspect(o);
    if(now.Id!==state[o].Id || now.Image!==state[o].Image || now.Config.Labels["com.docker.compose.config-hash"]!==state[o].Config.Labels["com.docker.compose.config-hash"]) throw new Error("Concurrent owner change: "+o);
  }
  for (const group of groups) {
    const names=group.names.filter(o=>selected.includes(o));
    if(!names.length) continue;
    const newFiles=activate && group.names.includes("dsh") ? [...group.files,captainFile]:group.files;
    ensureSource();
    for(const o of names) if(imageRecord(owners[o].image+":"+tags[o]).Id!==targetIds[o])throw new Error("Candidate image tag changed: "+o);
    assertSameHashes(currentHashes(state,group.names),configHashes(group.files,group.names,env));
    const newHashes=configHashes(newFiles,group.names,nextEnv);
    try {
      console.log("OWNER_APPLY_STARTED "+names.join(","));
      docker([...composeArgs(newFiles),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",...names],nextEnv,95000);
      for (const o of names) {
        const now=inspect(o);
        const source=ownerRevision({[o]:now},o);
        if(now.Image!==targetIds[o] || now.Config.Labels["com.docker.compose.config-hash"]!==newHashes[o] || source.revision!==head || source.digest!==(snapshots.get(o)?.digest||null)) throw new Error("Owner readback mismatch: "+o);
        console.log("OWNER_RUNTIME_PASS "+o+" "+now.Id);
      }
      console.log("OWNER_APPLY_VERIFIED "+names.join(","));
    } catch (e) {
      // Before rollback, establish the durable state and that no unknown writer
      // changed the selected service or the rollback configuration.
      for(const o of names){
        const now=inspect(o,false);
        const hash=now.Config.Labels["com.docker.compose.config-hash"];
        if(![currentHashes(state,[o])[o],newHashes[o]].includes(hash) ||
           ![state[o].Image,targetIds[o]].includes(now.Image)) throw new Error("ROLLBACK_BLOCKED unknown owner state: "+o);
      }
      if(e.code === "ETIMEDOUT") throw new Error("ROLLBACK_BLOCKED ambiguous Docker operation; readback completed, require explicit reconciliation");
      assertSameHashes(currentHashes(state,group.names),configHashes(group.files,group.names,env));
      for(const o of names) if(imageRecord(state[o].Config.Image).Id!==state[o].Image) throw new Error("ROLLBACK_BLOCKED previous image tag drift: "+o);
      docker([...composeArgs(group.files),"up","-d","--no-deps","--no-build","--pull","never","--wait","--wait-timeout","60",...names],env,95000);
      for(const o of names) if(inspect(o).Image!==state[o].Image) throw new Error("ROLLBACK_READBACK_FAILED "+o);
      throw new Error("ROLLBACK_PASS "+names.join(",")+" after failed replacement: "+e.message);
    }
  }
  ensureSource();
  for(const [o,snap] of snapshots) if(captureOwner(root,o).digest!==snap.digest)throw new Error("RUNTIME_STALE preview input advanced: "+o);
  prepareFreshBaseline();
  if(partial){console.log("RECONCILE_PARTIAL HEAD="+head);process.exitCode=3;}
  else console.log("RECONCILE_PASS HEAD="+head);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("RUNTIME_RECONCILE_BLOCKED " + e.message); process.exitCode = 1; }
}
