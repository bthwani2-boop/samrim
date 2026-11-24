#!/usr/bin/env node
// Isolated development owner reconciliation; SQL transitions use one verified owner-local transaction. No credential output or volume mutations.
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, lstatSync, appendFileSync } from "node:fs";
import { buildOwnerBaselineTransition, transitionScope } from "./owner-baseline-transition.mjs";
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
const guardedScope = ["services","infra/compose.yaml","infra/compose.apps.yaml","infra/compose.identity-verifier.yaml","infra/compose.merchant-development.yaml","infra/compose.captain-development.yaml","infra/compose.wlt.yaml","infra/owner-baseline-transition.mjs","infra/reconcile-owner-runtime.mjs","infra/verify-isolated-postgres.ps1",".go-version"];
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
  const expected=["PG_FRESH_DSH_BASELINE","PG_READER_ACCESS","PG_RESTORE_READBACK","PG_DSH_DEDICATED_RUNTIME","PG_FRESH_IDENTITY_BASELINE","PG_FRESH_WLT_BASELINE","PG_BASELINE_TRANSITION_DSH","PG_BASELINE_TRANSITION_IDENTITY","PG_BASELINE_TRANSITION_WLT","PG_ISOLATION"];
  for(const name of expected) {
    const evidence=output.split(/\r?\n/).filter(line=>line.startsWith(name+"="));
    if(evidence.length!==1 || !(evidence[0]===name+"=PASS" || evidence[0].startsWith(name+"=PASS "))) throw new Error("BASELINE_PROOF_INCOMPLETE "+name);
  }
}
const baselineProofScope=["services/identity/database","services/dsh/database","services/wlt/database","infra/verify-isolated-postgres.ps1","infra/owner-baseline-transition.mjs","infra/compose.yaml"];
// One-time additive preparation: the old owner remains the writer until a
// separately verified handoff. No retained schema, role, service or volume is
// modified. Existing target names fail closed rather than being overwritten.
export function ownerDataFingerprintSql(schema, tables, sequences, owner="dsh") {
  const identifier=/^[a-z][a-z0-9_]{0,62}$/;
  if(!["dsh","identity"].includes(owner) || !(owner==="dsh"?/^dsh_test_[a-z0-9_]{1,50}$/:/^identity_test_[a-z0-9_]{1,49}$/).test(schema) ||
     [...tables,...sequences].some(t=>!identifier.test(t)) ||
     !tables.length || new Set(tables).size!==tables.length || new Set(sequences).size!==sequences.length) throw new Error("Invalid owner snapshot scope");
  return "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL statement_timeout='15s'; SET LOCAL timezone='UTC'; SET LOCAL datestyle='ISO, YMD'; SET LOCAL intervalstyle='postgres'; SET LOCAL extra_float_digits=3;\n"+
    [...tables].sort().map(t=>"SELECT 'table:"+t+"',count(*),encode(sha256(convert_to(coalesce(string_agg(h,'' ORDER BY h),''),'UTF8')),'hex') FROM (SELECT encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') h FROM "+schema+"."+t+" x) q;").join("\n")+"\n"+
    [...sequences].sort().map(t=>"SELECT 'sequence:"+t+"',last_value,is_called FROM "+schema+"."+t+";").join("\n")+"\nCOMMIT;";
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
    const legacyAccess=sql(oldDb,legacyOwnerAccessSql());
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


// Reuse the prepared owner candidate; never recreate or overwrite its data.
// A data-bearing cutover is deliberately separate from image-only rollback.
export function assertHandoffParity(source, candidate, expectedLines) {
  if (!source || !Number.isSafeInteger(expectedLines) || expectedLines < 1 ||
      source.split(/\r?\n/).length !== expectedLines || source !== candidate) {
    throw new Error("OWNER_HANDOFF_DATA_PARITY_FAILED");
  }
}
function cutoverPreparedDsh(state, env, head, files, preparedRevision) {
  const transitionScope=[...guardedScope,"infra/reconcile-owner-runtime.mjs","tools/dev/dev.ps1","AGENTS.md","REPOSITORY-STRUCTURE.md","governance/engineering.md"];
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
  if(!equal(allTables,[...new Set([...tables,"customer_addresses","service_city_delivery_policies"])].sort()) || !equal(allSequences,sequences))
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
  const scope=[...guardedScope,"infra/reconcile-owner-runtime.mjs","tools/dev/dev.ps1","AGENTS.md","REPOSITORY-STRUCTURE.md","governance/engineering.md"];
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
  const info=lstatSync(envPath);
  if(!info.isFile()||info.isSymbolicLink())throw new Error("Unsafe local configuration");
  const original=readFileSync(envPath,"utf8");
  if(/^REF_IDENTITY_RUNTIME_DATABASE_URL=/m.test(original))throw new Error("Identity candidate configuration already exists; inspect before retry");
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
  run("pwsh",["-NoProfile","-File",buildScripts.identity,"-DockerContext",context,"-Image",owners.identity.image+":"+tag],{},180000);
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
  const archive="/tmp/bthwani-identity-copy-"+randomBytes(12).toString("hex")+".dump";
  let stopped=false,applyStarted=false;
  try {
    // Build and validate configuration before pausing the sole legacy writer.
    if(!clean() || inspect("identity").Id!==old.Id || inspect("dsh").Id!==state.dsh.Id || inspect("wlt").Id!==state.wlt.Id)
      throw new Error("Identity source or peer runtime changed");
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
      docker(["exec",pg,"pg_dump","-Fc","--no-owner","--no-acl","--schema="+schema,"-U",admin,"-d",oldDb,"-f",archive],{},45000);
      docker(["exec",pg,"pg_restore","--no-owner","--no-acl","--role="+owner,"--exit-on-error","--single-transaction","-U",admin,"-d",db,archive],{},60000);
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
    if(!clean() || readFileSync(envPath,"utf8")!==original || imageRecord(owners.identity.image+":"+tag).Id!==image.Id ||
       inspect("identity",false).Id!==old.Id || inspect("dsh").Id!==state.dsh.Id || inspect("wlt").Id!==state.wlt.Id)
      throw new Error("Identity source, peers or local configuration advanced");
    appendFileSync(envPath,"\nREF_IDENTITY_RUNTIME_DATABASE_URL="+newUrl+"\n",{encoding:"utf8"});
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
    try {if(!resume)docker(["exec",pg,"rm","-f","--",archive]);}catch{console.error("IDENTITY_COPY_ARCHIVE_CLEANUP_BLOCKED");}
  }
}

function rebaseAndApply(owner,state,env,head,files,tag,targetId,ensureSource) {
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
  assertSameHashes(currentHashes(state,groupNames),configHashes(files,groupNames,env));
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

function main() {
  const [mode,...options] = process.argv.slice(2);
  const cutover=mode==="--cutover-dsh-database";
  const prepare=options.length===1 && options[0]==="--prepare-baseline";
  if(!cutover && options.length && (!prepare || !["--apply","--apply-preview"].includes(mode))) throw new Error("Baseline preparation requires an explicit isolated apply");
  if (!["--check","--apply","--apply-captain","--apply-preview","--prepare-dsh-database","--resume-dsh-database","--cutover-dsh-database","--relocate-identity-database","--resume-identity-database"].includes(mode)) throw new Error("Usage: --check | --apply | --apply-captain | --apply-preview [--prepare-baseline]");
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
  env.REF_IDENTITY_RUNTIME_DATABASE_URL=identityEnv.IDENTITY_TEST_DATABASE_URL;
  for (const [name, key] of Object.entries(operatorOverrides)) {
    if (!Object.hasOwn(identityEnv,name)) throw new Error("Missing current Operator setting: " + name);
    env[key] = identityEnv[name];
  }
  const appNames = ["dsh","identity"];
  const groups = [{ names: appNames, files: activeAppFiles },{names:["wlt"],files:wltFiles}];
  for (const group of groups) assertSameHashes(currentHashes(state,group.names),configHashes(group.files,group.names,env));
  if(mode==="--prepare-dsh-database" || mode==="--resume-dsh-database"){prepareDedicatedDsh(state,env,head,activeAppFiles,mode==="--resume-dsh-database");return;}
  if(cutover){if(options.length!==1)throw new Error("Expected prepared source SHA");cutoverPreparedDsh(state,env,head,activeAppFiles,options[0]);return;}
  if(mode==="--relocate-identity-database" || mode==="--resume-identity-database"){relocateIdentity(state,env,head,activeAppFiles,mode==="--resume-identity-database");return;}
  const revisions=Object.fromEntries(Object.keys(owners).map(o=>[o,ownerRevision(state,o)]));
  const committed={};
  for(const o of Object.keys(owners)){
    git(["merge-base","--is-ancestor",revisions[o].revision,head]);
    committed[o]=git(["diff","--name-only",revisions[o].revision,head,"--","services/"+o]).split(/\r?\n/).filter(Boolean);
  }
  const preview=mode==="--apply-preview" || !apply;
  const change=currentChangeKey(committed,preview,captain);
  const ensureSource=()=>checkedHead(head,change.key,committed,preview,captain);
  let blocked=change.plan.blocked;
  const schemaReady=[];
  const proofOwners=baselineProofOwners({apply,prepare,blocked,dirtyInputs:dirtyPaths(root,baselineProofScope)});
  if(proofOwners.length){
    ensureSource();
    console.log("BASELINE_PROOF_STARTED HEAD="+head+" OWNERS="+proofOwners.join(","));
    try {
      const proof=run("pwsh",["-NoProfile","-File","infra/verify-isolated-postgres.ps1","-DockerContext",context,"-NoPull"],{},360000);
      verifyBaselineProofOutput(proof);
      ensureSource();
      if(dirtyPaths(root,baselineProofScope).length)throw new Error("Baseline proof inputs changed during rehearsal");
      schemaReady.push(...proofOwners);
      blocked=ownerReconcilePlan({changed:change.changed,committed,preview,captain,schemaReady}).blocked;
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
    const stale=snapshot ? old.digest!==snapshot.digest || old.revision!==head : Boolean(source.imageChanges.length || source.requiresCommittedRefresh || old.digest);
    if(stale)candidates.push(o);
    console.log(o+" RUNTIME="+(stale?"STALE":snapshot?"PREVIEW_CURRENT":"CURRENT")+" revision="+old.revision+(old.digest?" preview="+old.digest:"")+(source.clientPending && dirty?" SOURCE=CLIENT_REVIEW_PENDING":""));
  }
  const selected = selectOwners({candidates,activateCaptain:mode==="--apply-captain",currentCaptain:captain});
  console.log("SELECTED="+(selected.join(",")||"NONE")+" HEAD="+head+" CAPTAIN_OVERLAY="+captain);
  if (!apply || selected.length===0) {
    if(partial || selected.length){console.log("RECONCILE_PARTIAL HEAD="+head);process.exitCode=3;}
    else console.log("RECONCILE_PASS HEAD="+head);
    return;
  }
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
  // Owner databases are independent. Rebase each selected schema owner
  // with its own transaction before ordinary image-only reconciliation.
  const schemaSelected=selected.filter(o=>schemaReady.includes(o));
  for(const o of ["identity","dsh","wlt"].filter(o=>schemaSelected.includes(o))){
    ensureSource();
    rebaseAndApply(o,state,env,head,o==="wlt"?wltFiles:activeAppFiles,tags[o],targetIds[o],ensureSource);
  }
  for (const group of groups) {
    const names=group.names.filter(o=>selected.includes(o)&&!schemaSelected.includes(o));
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
  if(partial){console.log("RECONCILE_PARTIAL HEAD="+head);process.exitCode=3;}
  else console.log("RECONCILE_PASS HEAD="+head);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error("RUNTIME_RECONCILE_BLOCKED " + e.message); process.exitCode = 1; }
}
