import assert from "node:assert/strict";
import test from "node:test";
import { sourceIdentity } from "../../tools/dev/docker/owner-preview-source.mjs";
import { assertSameHashes, differingKeys, selectOwners } from "../../tools/dev/docker/reconcile-owner-runtime.mjs";

test("runtime reconciliation never rebuilds unaffected owners", () => {
  assert.deepEqual(selectOwners({ candidates: [], activateCaptain: false, currentCaptain: true }), []);
  assert.deepEqual(selectOwners({ candidates: ["dsh"], activateCaptain: false, currentCaptain: true }), ["dsh"]);
  assert.deepEqual(selectOwners({ candidates: ["identity"], activateCaptain: false, currentCaptain: false }), ["identity"]);
  assert.deepEqual(selectOwners({ candidates: ["wlt"], activateCaptain: false, currentCaptain: true }), ["wlt"]);
});
test("explicit Captain activation replaces both contract peers and never implicitly activates", () => {
  assert.deepEqual(selectOwners({ candidates: [], activateCaptain: true, currentCaptain: false }), ["dsh","identity"]);
  assert.deepEqual(selectOwners({ candidates: ["wlt"], activateCaptain: true, currentCaptain: false }), ["dsh","identity","wlt"]);
  assert.deepEqual(selectOwners({ candidates: [], activateCaptain: true, currentCaptain: true }), []);
});
test("configuration comparison refuses drift without leaking values or retrying an unchanged apply", async () => {
  const {runtimeFailureStatus,runtimePollAction}=await import("../../tools/dev/sync-lenovo-reconciliation.mjs");
  assert.deepEqual(differingKeys({ A: "secret-old", B: "unchanged" }, { A: "secret-new", B: "unchanged", C: "extra" }), ["A","C"]);
  assert.doesNotThrow(() => assertSameHashes({ identity: "same", dsh: "unchanged" }, { dsh: "unchanged", identity: "same" }));
  assert.throws(() => assertSameHashes({ identity: "secret-old" }, { identity: "secret-new" }), e => {
    assert.ok(!e.message.includes("secret-") && /refusing replacement/.test(e.message));
    const status=runtimeFailureStatus("ready",e);
    assert.equal(status,"review");
    const state={enabled:true,dirty:false,active:false,key:"same",last:{key:"same",status},now:120000,nextAudit:60000};
    assert.equal(runtimePollAction(state),"audit");
    assert.equal(runtimeFailureStatus("mutating",e),null);
    return true;
  });
});

test("reconciler consumes the single native Go test environment and guards its source", async () => {
  const { readFileSync } = await import("node:fs");
  const runner = readFileSync(new URL("../../tools/dev/docker/reconcile-owner-runtime.mjs", import.meta.url), "utf8");
  const watcher = readFileSync(new URL("../../tools/dev/sync-lenovo-source.mjs", import.meta.url), "utf8");
  assert.match(runner, /import \{ admitNativeGoTests, prepareSourceGo \} from "\.\.\/check-go\.mjs"/);
  assert.match(runner, /const \{executable:goExecutable,env:testEnv\}=prepareSourceGo\(pin,root\)/);
  assert.doesNotMatch(runner, /isolatedTestEnv|GOFLAGS|GOENV|GOWORK/);
  assert.match(runner, /const outcome=admitNativeGoTests\(go.stdout\|\|""\)/);
  assert.doesNotMatch(runner, /readFileSync\(resolve\(root,"\.go-version"\)/);
  assert.match(runner, /spawnSync\(goExecutable,\["test"/);
  assert.match(runner.match(/const guardedScope = \[[^\n]+/)[0], /tools\/dev\/check-go\.mjs/);
  assert.match(watcher.match(/const runtimeScope = \[[\s\S]*?\];/)[0], /tools\/dev\/check-go\.mjs/);
  assert.match(runner.match(/const baselineProofScope=\[[^\n]+/)[0], /tools\/dev\/check-go\.mjs/);
  const sqlProof = readFileSync(new URL("./verify-isolated-postgres.ps1", import.meta.url), "utf8");
  assert.match(sqlProof, /resolvePinnedGo\(readFileSync\("\.go-version","utf8"\)\.trim\(\)\)/);
  assert.match(sqlProof, /& \$goExecutable test -c/);
});

test("preview provenance is distinct from an accepted Git source SHA",()=>{
  const base="a".repeat(40), digest="b".repeat(64);
  const labels={"org.opencontainers.image.revision":"worktree-"+digest,"com.bthwani.preview-base":base,"com.bthwani.preview-digest":digest};
  assert.deepEqual(sourceIdentity(labels,"dsh"),{revision:base,digest});
  assert.throws(()=>sourceIdentity({...labels,"com.bthwani.source-sha":base},"dsh"),/Invalid preview/);
  assert.throws(()=>sourceIdentity({...labels,"com.bthwani.preview-digest":"c".repeat(64)},"dsh"),/Invalid preview/);
  assert.deepEqual(sourceIdentity({"org.opencontainers.image.revision":base,"com.bthwani.source-sha":base},"dsh"),{revision:base,digest:null});
});

test("an unrelated WLT contract change does not block DSH or Identity", async () => {
  const { ownerReconcilePlan } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  const plan = ownerReconcilePlan({
    changed: ["services/wlt/contracts/openapi/wlt.openapi.yaml", "services/dsh/backend/cmd/dsh/main.go"],
    committed: {}, preview: true, captain: true,
  });
  assert.deepEqual(plan.eligible, ["dsh", "identity"]);
  assert.equal(plan.blocked.wlt, "UNCOMMITTED_NON_GO");
});

test("WLT consumes DSH standing even without Captain admission and cannot advance across unreviewed DSH runtime changes", async () => {
  const { ownerReconcilePlan } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  for (const captain of [false, true]) {
    const plan = ownerReconcilePlan({
      changed: [], committed: { dsh: ["services/dsh/database/schema/45_customer_addresses.sql"] },
      preview: true, captain,
    });
    assert.deepEqual(plan.eligible, captain ? [] : ["identity"]);
    assert.equal(plan.blocked.dsh, "SCHEMA_REVIEW_REQUIRED");
    assert.equal(plan.blocked.wlt, "PEER_REVIEW_REQUIRED:dsh");
    assert.equal(plan.blocked.identity, captain ? "PEER_REVIEW_REQUIRED:dsh" : undefined);
  }
  const client = ownerReconcilePlan({changed:["services/dsh/clients/index.ts"],committed:{},preview:true,captain:false});
  assert.deepEqual(client.eligible, ["dsh","identity","wlt"]);
  const config = ownerReconcilePlan({changed:[],committed:{dsh:["services/dsh/database/schema/45_customer_addresses.sql"]},preview:true,captain:false,wltConfigDrift:true});
  assert.equal(config.blocked.wlt,"CONFIG_REVIEW_REQUIRED");
});

test("Identity runtime changes requiring review hold dependent owners, but client-only dirt does not", async () => {
  const { ownerReconcilePlan } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  const base = { committed: {}, preview: true, captain: true };
  const schema = ownerReconcilePlan({...base, changed:["services/identity/database/schema/20_sessions.sql"]});
  assert.deepEqual(schema.eligible, []);
  const client = ownerReconcilePlan({...base, changed:["services/identity/clients/session.ts"]});
  assert.deepEqual(client.eligible, ["dsh","identity","wlt"]);
  assert.equal(client.blocked.identity, undefined);
  const shared = ownerReconcilePlan({...base, changed:["infra/compose.yaml"]});
  assert.deepEqual(shared.eligible, []);
  assert.equal(shared.blocked.dsh, "SHARED_INPUT_REVIEW_REQUIRED");
});

test("shared Compose changes hold all owners; observed WLT-only drift stays owner-scoped", async () => {
  const { ownerReconcilePlan, isSharedRuntimeInput } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  const base={committed:{},preview:true,captain:true};
  assert.equal(isSharedRuntimeInput("infra/compose.yaml"),true);
  assert.deepEqual(ownerReconcilePlan({...base,changed:["infra/compose.yaml"]}).eligible,[]);
  assert.deepEqual(ownerReconcilePlan({...base,changed:[],wltConfigDrift:true}),{
    eligible:["dsh","identity"],blocked:{wlt:"CONFIG_REVIEW_REQUIRED"}
  });
});

test("ordinary reconciliation isolates verified WLT config drift, but special transitions and shared drift fail closed", async () => {
  const { wltConfigReviewRequired } = await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const a="a".repeat(64), b="b".repeat(64);
  for(const mode of ["--check","--apply","--apply-preview"]){
    assert.equal(wltConfigReviewRequired({wlt:a},{wlt:a},mode),false);
    assert.equal(wltConfigReviewRequired({wlt:a},{wlt:b},mode),true);
    assert.throws(()=>wltConfigReviewRequired({wlt:undefined},{wlt:b},mode),/refusing replacement/);
    assert.throws(()=>wltConfigReviewRequired({dsh:a,identity:a},{dsh:b,identity:a},mode),/refusing replacement/);
  }
  for(const mode of ["--apply-captain","--recover-attempt","--prepare-dsh-database","--relocate-identity-database"]){
    assert.throws(()=>wltConfigReviewRequired({wlt:a},{wlt:b},mode),/refusing replacement/);
  }
});

test("committed-only mode cannot promote a dirty Go owner", async () => {
  const { ownerReconcilePlan } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  const plan = ownerReconcilePlan({changed:["services/wlt/backend/cmd/wlt/main.go"], committed:{}, preview:false,captain:true});
  assert.deepEqual(plan.eligible, ["dsh","identity"]);
  assert.equal(plan.blocked.wlt, "PREVIEW_NOT_AUTHORIZED");
});

test("client-only edits cannot make the Go image stale or admit changed contracts", async () => {
  const { ownerReconcilePlan, ownerSourceState } = await import("../../tools/dev/docker/owner-preview-source.mjs");
  const changed=["services/identity/clients/persistent-sessions.ts"];
  const committed={identity:["services/identity/clients/index.ts"]};
  const plan=ownerReconcilePlan({changed,committed,preview:true,captain:true});
  assert.equal(plan.blocked.identity,undefined);
  assert.deepEqual(ownerSourceState("identity",changed,committed.identity),{
    imageChanges:[], previewChanges:[], clientPending:true
  });
  const contract="services/identity/contracts/openapi/identity.openapi.yaml";
  assert.equal(ownerReconcilePlan({changed:[...changed,contract],committed,preview:true,captain:true}).blocked.identity,"UNCOMMITTED_NON_GO");
  const go="services/identity/backend/cmd/identity/main.go";
  assert.equal(ownerReconcilePlan({changed,committed:{identity:[go]},preview:false,captain:true}).blocked.identity,"PREVIEW_NOT_AUTHORIZED");
});

test("owner Go test and README changes do not select a serving image rebuild", async()=>{
  const {ownerSourceState,ownerReconcilePlan}=await import("../../tools/dev/docker/owner-preview-source.mjs");
  const {readFileSync}=await import("node:fs");
  for(const owner of ["identity","dsh","wlt"]){
    const prefix=`services/${owner}/`;
    // Keep the runtime classifier tied to the actual build boundary. A new
    // context input or test re-inclusion requires reviewing this exclusion.
    const ignore=readFileSync(new URL(`../../${prefix}.dockerignore`,import.meta.url),"utf8");
    assert.equal(ignore.split(/\r?\n/).map(line=>line.trim()).filter(line=>line && !line.startsWith("#")).at(-1),"**/*_test.go");
    const dockerfile=readFileSync(new URL(`../../${prefix}backend/Dockerfile`,import.meta.url),"utf8");
    assert.deepEqual(dockerfile.split(/\r?\n/).filter(line=>/^COPY\s/.test(line) && !/^COPY --from=build\s/.test(line)),[
      "COPY backend/go.mod backend/go.sum ./",
      "COPY backend/cmd/ ./cmd/",
      "COPY backend/internal/ ./internal/",
      ...(owner==="dsh"?["COPY database/schema/ /app/database/schema/"]:[]),
    ]);
    const nonRuntime=[prefix+"backend/internal/example/example_test.go",prefix+"README.md",prefix+"backend/README.md"];
    const saved=ownerSourceState(owner,[],nonRuntime);
    assert.deepEqual(saved.imageChanges,[]);
    const local=ownerSourceState(owner,nonRuntime,[]);
    assert.deepEqual(local.previewChanges,[]);
    assert.deepEqual(ownerReconcilePlan({changed:nonRuntime,committed:{},preview:false,captain:true}).blocked,{});
    for(const runtime of [prefix+"backend/internal/example/example.go",prefix+"backend/go.mod",prefix+"backend/Dockerfile",prefix+".dockerignore",prefix+"database/schema/00.sql",prefix+"contracts/openapi/"+owner+".openapi.yaml"]){
      assert.deepEqual(ownerSourceState(owner,[],[...nonRuntime,runtime]).imageChanges,[runtime]);
      assert.deepEqual(ownerSourceState(owner,[...nonRuntime,runtime],[]).previewChanges,[runtime]);
    }
  }
});

test("committed client-only changes never require a Go image refresh",async()=>{
  const {ownerSourceState}=await import("../../tools/dev/docker/owner-preview-source.mjs");
  const clients=["services/identity/clients/persistent-sessions.ts"];
  assert.deepEqual(ownerSourceState("identity",[],clients).imageChanges,[]);
  assert.deepEqual(ownerSourceState("identity",clients,clients).imageChanges,[]);
  assert.deepEqual(ownerSourceState("identity",clients,[]).imageChanges,[]);
});

test("fresh baseline preparation is confined to explicit isolated apply with committed schema drift", async () => {
  const { baselineProofOwners, verifyBaselineProofOutput }=await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const base={apply:true,prepare:true,blocked:{dsh:"SCHEMA_REVIEW_REQUIRED",identity:"PEER_REVIEW_REQUIRED:dsh"},dirtyInputs:[]};
  assert.deepEqual(baselineProofOwners(base),["dsh"]);
  for(const patch of [{apply:false},{prepare:false},{dirtyInputs:["services/dsh/database/schema/00_marketplace.sql"]},{blocked:{identity:"UNCOMMITTED_NON_GO"}}]) {
    assert.deepEqual(baselineProofOwners({...base,...patch}),[]);
  }
  const proof=["PG_FRESH_DSH_BASELINE=PASS count=8","PG_READER_ACCESS=PASS","PG_RESTORE_READBACK=PASS","PG_DSH_DEDICATED_RUNTIME=PASS","PG_FRESH_IDENTITY_BASELINE=PASS","PG_FRESH_WLT_BASELINE=PASS","PG_WLT_AGREEMENT_COMMAND=PASS","PG_BASELINE_TRANSITION_DSH=PASS","PG_BASELINE_TRANSITION_IDENTITY=PASS","PG_BASELINE_TRANSITION_WLT=PASS","PG_ISOLATION=PASS"].join("\n");
  assert.doesNotThrow(()=>verifyBaselineProofOutput(proof));
  assert.throws(()=>verifyBaselineProofOutput(proof+"\nPG_ISOLATION=FAIL"),/BASELINE_PROOF_INCOMPLETE/);
  assert.throws(()=>verifyBaselineProofOutput(proof.replace("PG_RESTORE_READBACK=PASS","PG_RESTORE_READBACK=FAIL")),/BASELINE_PROOF_INCOMPLETE/);
});

test("canonical database scope rejects shared, foreign or privileged principals",async()=>{
  const {assertOwnerDatabase,parseReconcileArgs}=await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const dsh={DSH_DB_SCHEMA:"dsh_test_fixture",DSH_DB_HOST:"postgres",REF_POSTGRES_DB:"bthwani_dsh_dev",REF_POSTGRES_USER:"bthwani_dsh_runtime",REF_POSTGRES_PASSWORD:"fixture"};
  assert.equal(assertOwnerDatabase("dsh",dsh).database,"bthwani_dsh_dev");
  for(const change of [{REF_POSTGRES_DB:"postgres"},{DSH_DB_HOST:"foreign"},{REF_POSTGRES_USER:"postgres"},{REF_POSTGRES_PASSWORD:""}])
    assert.throws(()=>assertOwnerDatabase("dsh",{...dsh,...change}),/Dedicated owner database not verified/);
  for(const [owner,key,db,role] of [["identity","IDENTITY_TEST_DATABASE_URL","bthwani_identity_dev","bthwani_identity_runtime"],["wlt","WLT_TEST_DATABASE_URL","bthwani_wlt_test","bthwani_wlt_reader"]]){
    const env={IDENTITY_DB_SCHEMA:"identity_test_fixture",[key]:"postgres://"+role+":fixture@postgres:5432/"+db+"?sslmode=disable"};
    assert.equal(assertOwnerDatabase(owner,env).database,db);
    for(const url of [env[key].replace("@postgres:","@foreign:"),env[key].replace(":5432/",":5433/"),env[key].replace(role,"postgres"),env[key].replace(db,"postgres"),"malformed"])
      assert.throws(()=>assertOwnerDatabase(owner,{...env,[key]:url}),/Dedicated owner database not verified/);
  }
  for(const mode of ["--prepare-dsh-database","--resume-dsh-database","--cutover-dsh-database","--relocate-identity-database","--resume-identity-database"])
    assert.throws(()=>parseReconcileArgs([mode]),/Usage/);
  assert.equal(parseReconcileArgs(["--apply-preview","--prepare-baseline"]).prepare,true);
  assert.equal(parseReconcileArgs(["--recover-attempt","a".repeat(64)]).recover,true);
  const automaticRecovery=parseReconcileArgs(["--recover-safe","a".repeat(64)]);
  assert.equal(automaticRecovery.recover,true);
  assert.equal(automaticRecovery.apply,false);
  assert.throws(()=>parseReconcileArgs(["--recover-safe","wrong"]),/exact reviewed runtime attempt key/);
  assert.equal(parseReconcileArgs(["--build-only","dsh"]).build,true);
  assert.throws(()=>parseReconcileArgs(["--check","--prepare-baseline"]),/explicit isolated apply/);
});
test("only a current successful committed baseline proof admits canonical schema changes", async()=>{
  const {ownerReconcilePlan}=await import("../../tools/dev/docker/owner-preview-source.mjs");
  const base={changed:[],committed:{dsh:["services/dsh/database/schema/45_customer_addresses.sql"]},preview:true,captain:true};
  assert.equal(ownerReconcilePlan(base).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
  assert.deepEqual(ownerReconcilePlan({...base,schemaReady:["dsh"]}).eligible,["dsh","identity","wlt"]);
  assert.equal(ownerReconcilePlan({...base,schemaReady:["dsh"],changed:["services/dsh/backend/cmd/dsh/main.go"]}).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
  assert.equal(ownerReconcilePlan({...base,schemaReady:["dsh"],committed:{dsh:["services/dsh/database/migrations/001_bad.sql"]}}).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
  assert.equal(ownerReconcilePlan({...base,schemaReady:["wlt"]}).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
});
test("baseline transition is owner-local, transactional and never disables triggers",async()=>{
  const {buildOwnerBaselineTransition,transitionScope}=await import("../../tools/dev/docker/owner-baseline-transition.mjs");
  assert.throws(()=>transitionScope("dsh","identity_test_actor","bthwani_recovery_dsh_abcdef123456"),/Invalid/);
  assert.throws(()=>transitionScope("wlt","wlt","public"),/Invalid/);
  const sql=buildOwnerBaselineTransition("dsh","dsh_test_agent01","bthwani_recovery_dsh_abcdef123456");
  assert.match(sql,/^BEGIN;/);
  assert.match(sql,/ALTER SCHEMA dsh_test_agent01 RENAME TO bthwani_recovery_dsh_abcdef123456/);
  assert.match(sql,/EXCEPT ALL/);
  assert.match(sql,/OVERRIDING SYSTEM VALUE/);
  assert.match(sql,/REVOKE ALL ON SCHEMA bthwani_recovery_dsh_abcdef123456/);
  assert.doesNotMatch(sql,/DISABLE TRIGGER|session_replication_role|DROP SCHEMA/);
  assert.match(sql,/COMMIT;\nSELECT 'OWNER_BASELINE_TRANSITION_PASS';$/);
  assert.throws(()=>buildOwnerBaselineTransition("dsh","dsh_test_agent01","bthwani_recovery_dsh_abcdef123456",["SELECT '__SCHEMA__'; $bthwani_baseline$"]),/Reserved/);
});

test("WLT transition atomically provisions only the dormant command principal and exact command ACL",async()=>{
  const {buildOwnerBaselineTransition,wltCommandRoleInactiveSQL}=await import("../../tools/dev/docker/owner-baseline-transition.mjs");
  assert.match(wltCommandRoleInactiveSQL,/NOT EXISTS/);
  assert.match(wltCommandRoleInactiveSQL,/rolcanlogin/);
  assert.match(wltCommandRoleInactiveSQL,/pg_auth_members/);
  const sql=buildOwnerBaselineTransition("wlt","wlt","bthwani_recovery_wlt_abcdef123456");
  const create=sql.indexOf("CREATE ROLE bthwani_wlt_command NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS");
  const owner=sql.indexOf("SET LOCAL ROLE bthwani_wlt_owner");
  assert.ok(create>=0 && create<owner,"the no-login role must be created by the transaction administrator before owner-scoped DDL");
  assert.match(sql,/has_table_privilege\('bthwani_wlt_command','wlt\.latest_commercial_agreement_reviews','SELECT'\)/);
  assert.match(sql,/has_function_privilege\('bthwani_wlt_command',\s*'wlt\.append_commercial_agreement_proposal\(/);
  assert.match(sql,/has_function_privilege\('bthwani_wlt_command',\s*'wlt\.record_commercial_agreement_decision\(/);
  assert.match(sql,/NOT\s+(?:pg_catalog\.)?has_database_privilege\('bthwani_wlt_command',current_database\(\),'CONNECT,CREATE,TEMP'\)/);
  assert.match(sql,/NOT EXISTS\s*\(\s*SELECT 1 FROM pg_catalog\.pg_auth_members[\s\S]*?member=[\s\S]*?roleid=/);
  assert.doesNotMatch(sql,/CREATE ROLE bthwani_wlt_command LOGIN/);
});

test("native Compose replaces the separate owner-image builder scripts", async () => {
  const fs = await import("node:fs");
  const root = new URL("../../", import.meta.url);
  const base = new URL("tools/dev/docker/", root);
  assert.equal(fs.existsSync(new URL("build-owner-image.ps1",base)),false);
  assert.equal(fs.existsSync(new URL("infra/build-owner-image.ps1",root)),false);
  for (const old of ["build-owner-image.ps1","build-dsh-image.ps1","build-identity-verifier-image.ps1","build-wlt-image.ps1"]) {
    assert.equal(fs.existsSync(new URL(old,base)),false,old);
    assert.equal(fs.existsSync(new URL("infra/"+old,root)),false,old);
    for(const consumer of ["tools/dev/docker/reconcile-owner-runtime.mjs","tools/dev/dev.ps1","tools/dev/sync-lenovo-source.mjs","infra/README.md","services/wlt/backend/README.md"]) {
      assert.equal(fs.readFileSync(new URL(consumer,root),"utf8").includes(old),false,consumer);
    }
  }
});

test("native build plan selects exactly one owner and distinguishes committed and preview provenance", async () => {
  const { ownerBuildPlan } = await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const sha="a".repeat(40), digest="b".repeat(64);
  const committed=ownerBuildPlan("identity",sha,"sha-aaaaaaaaa","owner");
  assert.deepEqual(committed.args.slice(-2),["build","identity"]);
  assert.equal(committed.env.BTHWANI_BUILD_SHA,sha);
  assert.equal(committed.env.BTHWANI_BUILD_PREVIEW_BASE,"");
  assert.equal(committed.env.BTHWANI_BUILD_CONTEXT,"owner");
  const preview=ownerBuildPlan("wlt",sha,"preview","snapshot",digest);
  assert.deepEqual(preview.args.slice(-2),["build","wlt"]);
  assert.equal(preview.env.BTHWANI_BUILD_SHA,"");
  assert.equal(preview.env.BTHWANI_BUILD_REVISION,"worktree-"+digest);
  assert.equal(preview.env.BTHWANI_BUILD_PREVIEW_BASE,sha);
  assert.equal(preview.env.BTHWANI_BUILD_PREVIEW_DIGEST,digest);
  assert.throws(()=>ownerBuildPlan("foreign",sha,"dev","owner"),/Invalid/);
  assert.throws(()=>ownerBuildPlan("dsh",sha,"bad/tag","owner"),/Invalid/);
});

test("every owner operation uses one canonical Compose input without serving profiles", async () => {
  const { composeArgs } = await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const { fileURLToPath } = await import("node:url");
  const args = composeArgs();
  const composeFile = fileURLToPath(new URL("../../infra/compose.yaml", import.meta.url));
  assert.deepEqual(args, [
    "compose", "--project-directory", fileURLToPath(new URL("../../infra", import.meta.url)),
    "--env-file", "infra/.env", "-f", composeFile,
  ]);
  assert.deepEqual(composeArgs(), args);
  assert.equal(args.filter(arg => arg === "-f").length, 1);
});

test("serving owner provenance permits only the canonical Compose file", async () => {
  const { composeFileNames } = await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const root = "D:/samrim";
  const files = names => names.map(name => root + "/infra/" + name).join(",");
  assert.deepEqual(composeFileNames(files(["compose.yaml"]),root),["compose.yaml"]);
  for (const names of [
    ["compose.yaml","compose.apps.yaml"],["compose.yaml","compose.wlt.yaml"],
    ["compose.yaml","compose.yaml"],["compose.dsh.yaml"],["../infra/compose.yaml"],
    ["compose.identity-verifier.yaml"],["compose.captain-development.yaml"]
  ]) assert.throws(()=>composeFileNames(files(names),root),/Unowned/);
  assert.throws(()=>composeFileNames("D:/other/infra/compose.yaml",root),/Unowned/);
});
test("baseline owner and archive scope rejects inherited keys, coercion and wrong owner",async()=>{
  const {transitionScope}=await import("../../tools/dev/docker/owner-baseline-transition.mjs");
  const schema="dsh_test_agent01", archive="bthwani_recovery_dsh_abcdef123456";
  for(const args of [
    ["constructor",schema,archive],["__proto__",schema,archive],
    [{toString:()=>"dsh"},schema,archive],
    ["dsh",{toString:()=>schema},archive],
    ["dsh",schema,{toString:()=>archive}],
    ["dsh",schema,"bthwani_recovery_identity_abcdef123456"],
    ["dsh",schema,archive+";"],
  ])assert.throws(()=>transitionScope(...args),/Invalid owner baseline transition scope/);
  assert.equal(transitionScope("dsh",schema,archive).archive,archive);
  assert.equal(transitionScope("identity","identity_test_agent01","bthwani_recovery_identity_abcdef123456").database,"bthwani_identity_dev");
  assert.equal(transitionScope("wlt","wlt","bthwani_recovery_wlt_abcdef123456").runtime,"bthwani_wlt_reader");
});

test("baseline SQL read is bounded, regular and rejects hard links", async()=>{
  const {readBaselineFile}=await import("../../tools/dev/docker/owner-baseline-transition.mjs");
  const {mkdtempSync,writeFileSync,linkSync,rmSync}=await import("node:fs");
  const {tmpdir}=await import("node:os");
  const {join}=await import("node:path");
  const dir=mkdtempSync(join(tmpdir(),"bthwani-baseline-read-"));
  try {
    const file=join(dir,"00_schema.sql"), alias=join(dir,"01_alias.sql");
    writeFileSync(file,"SELECT 1;");
    assert.equal(readBaselineFile(file),"SELECT 1;");
    linkSync(file,alias);
    assert.throws(()=>readBaselineFile(alias),/Unexpected baseline entry/);
    rmSync(alias);
    writeFileSync(file,Buffer.alloc(512*1024+1,65));
    assert.throws(()=>readBaselineFile(file),/Unexpected baseline entry/);
    assert.throws(()=>readBaselineFile(dir));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("source host guard accepts only the actual Surface and canonical checkout", async () => {
  const { assertSourceHost } = await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const checkout = "D:\\samrim";
  assert.doesNotThrow(() => assertSourceHost("BTHWANI", undefined, checkout));
  assert.doesNotThrow(() => assertSourceHost("bthwani", "BTHWANI", checkout));
  assert.doesNotThrow(() => assertSourceHost("BTHWANI", "", checkout));
  assert.throws(() => assertSourceHost("BTHWANI", "BTHWANI-DOCKER", checkout), /Wrong source host/);
  assert.throws(() => assertSourceHost("BTHWANI-DOCKER", "BTHWANI", checkout), /Wrong source host/);
  assert.throws(() => assertSourceHost("BTHWANI-DOCKER", undefined, checkout), /Wrong source host/);
  assert.throws(() => assertSourceHost("BTHWANI", undefined, "D:\\other"), /Wrong source host/);
});

test("configuration rollback admits only a proven image and its paired config hash", async () => {
  const { isKnownImageConfigPair } = await import("../../tools/dev/docker/reconcile-owner-runtime.mjs");
  const prior={image:"old-image",hash:"old-hash"};
  const candidate={image:"new-image",hash:"new-hash"};
  assert.equal(isKnownImageConfigPair("old-image","old-hash",prior,candidate),true);
  assert.equal(isKnownImageConfigPair("new-image","new-hash",prior,candidate),true);
  for(const [image,hash] of [["old-image","new-hash"],["new-image","old-hash"],["unknown","new-hash"],["new-image","unknown"]])
    assert.equal(isKnownImageConfigPair(image,hash,prior,candidate),false);
});

test("all owners classify workspace metadata consistently for committed and dirty inputs",async()=>{
  const {ownerSourceState,ownerReconcilePlan,isOwnerNonRuntimePath}=await import("../../tools/dev/docker/owner-preview-source.mjs");
  const {readFileSync}=await import("node:fs");
  for(const owner of ["dsh","identity","wlt"]){
    const base="services/"+owner+"/";
    const files=[base+"package.json",base+"tsconfig.json"];
    const dockerfile=readFileSync(new URL("../../"+base+"backend/Dockerfile",import.meta.url),"utf8");
    assert.doesNotMatch(dockerfile,/package\.json|tsconfig\.json/);
    assert.ok(files.every(isOwnerNonRuntimePath));
    assert.deepEqual(ownerSourceState(owner,files,files),{imageChanges:[],previewChanges:[],clientPending:false});
    assert.deepEqual(ownerReconcilePlan({changed:files,committed:{[owner]:files},preview:false,captain:true}).blocked,{});
    const unknown=base+"backend/internal/runtime.conf";
    assert.equal(isOwnerNonRuntimePath(unknown),false);
    assert.deepEqual(ownerSourceState(owner,[],[...files,unknown]).imageChanges,[unknown]);
    assert.equal(ownerReconcilePlan({changed:[...files,unknown],committed:{},preview:true,captain:true}).blocked[owner],"UNCOMMITTED_NON_GO");
  }
});

test("owner Docker build contexts admit only needed Go module, source and owner SQL inputs", async()=>{
  const {readFileSync}=await import("node:fs");
  for(const owner of ["dsh","identity","wlt"]){
    const text=readFileSync(new URL("../../services/"+owner+"/.dockerignore",import.meta.url),"utf8");
    const rules=text.split(/\r?\n/).filter(line=>line&&!line.startsWith("#"));
    assert.deepEqual(rules,["**","!backend/go.mod","!backend/go.sum","!backend/cmd/**/*.go",
      "!backend/internal/**/*.go",...(owner==="dsh"?["!database/schema/*.sql"]:[]),"**/*_test.go"]);
  }
});
