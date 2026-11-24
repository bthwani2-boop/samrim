import assert from "node:assert/strict";
import test from "node:test";
import { differingKeys, selectOwners, assertSameHashes, isolatedTestEnv, sourceIdentity } from "./reconcile-owner-runtime.mjs";

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
test("configuration comparison detects differing or absent keys without leaking their values", () => {
  assert.deepEqual(differingKeys({ A: "secret-old", B: "unchanged" }, { A: "secret-new", B: "unchanged", C: "extra" }), ["A","C"]);
  assert.doesNotThrow(() => assertSameHashes({ identity: "same", dsh: "unchanged" }, { dsh: "unchanged", identity: "same" }));
  assert.throws(() => assertSameHashes({ identity: "secret-old" }, { identity: "secret-new" }), e => !e.message.includes("secret-") && /refusing replacement/.test(e.message));
});

test("owner tests cannot inherit live database or synthetic activation configuration", () => {
  assert.deepEqual(isolatedTestEnv({ PATH:"toolchain", BTHWANI_ISOLATED_TEST_MODE:"true", BTHWANI_CAPTAIN_TEST_DATABASE_URL:"private", REF_POSTGRES_PASSWORD:"private", PGHOST:"private", DATABASE_URL:"private", GOTOOLCHAIN:"auto" }), {PATH:"toolchain",GOTOOLCHAIN:"local"});
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
  const { ownerReconcilePlan } = await import("./owner-preview-source.mjs");
  const plan = ownerReconcilePlan({
    changed: ["services/wlt/contracts/openapi/wlt.openapi.yaml", "services/dsh/backend/cmd/dsh/main.go"],
    committed: {}, preview: true, captain: true,
  });
  assert.deepEqual(plan.eligible, ["dsh", "identity"]);
  assert.equal(plan.blocked.wlt, "UNCOMMITTED_NON_GO");
});

test("a committed DSH schema change stays blocked without suppressing independent WLT", async () => {
  const { ownerReconcilePlan } = await import("./owner-preview-source.mjs");
  const plan = ownerReconcilePlan({
    changed: [], committed: { dsh: ["services/dsh/database/schema/45_customer_addresses.sql"] },
    preview: true, captain: true,
  });
  assert.deepEqual(plan.eligible, ["wlt"]);
  assert.equal(plan.blocked.dsh, "SCHEMA_REVIEW_REQUIRED");
  assert.equal(plan.blocked.identity, "PEER_REVIEW_REQUIRED:dsh");
});

test("Identity runtime changes requiring review hold dependent owners, but client-only dirt does not", async () => {
  const { ownerReconcilePlan } = await import("./owner-preview-source.mjs");
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

test("WLT-only Compose review does not freeze independent owners or admit WLT writes", async () => {
  const { ownerReconcilePlan, isSharedRuntimeInput } = await import("./owner-preview-source.mjs");
  const base={committed:{},preview:true,captain:true};
  const overlay="infra/compose.wlt.yaml";
  assert.equal(isSharedRuntimeInput(overlay),false);
  assert.equal(isSharedRuntimeInput("infra/compose.yaml"),true);
  assert.deepEqual(ownerReconcilePlan({...base,changed:[overlay]}),{
    eligible:["dsh","identity"],blocked:{wlt:"CONFIG_REVIEW_REQUIRED"}
  });
  assert.deepEqual(ownerReconcilePlan({...base,changed:[],wltConfigDrift:true}),{
    eligible:["dsh","identity"],blocked:{wlt:"CONFIG_REVIEW_REQUIRED"}
  });
  assert.deepEqual(ownerReconcilePlan({...base,changed:[overlay,"infra/compose.yaml"]}).eligible,[]);
});

test("ordinary reconciliation isolates verified WLT config drift, but special transitions and shared drift fail closed", async () => {
  const { wltConfigReviewRequired } = await import("./reconcile-owner-runtime.mjs");
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
  const { ownerReconcilePlan } = await import("./owner-preview-source.mjs");
  const plan = ownerReconcilePlan({changed:["services/wlt/backend/cmd/wlt/main.go"], committed:{}, preview:false,captain:true});
  assert.deepEqual(plan.eligible, ["dsh","identity"]);
  assert.equal(plan.blocked.wlt, "PREVIEW_NOT_AUTHORIZED");
});

test("client-only edits cannot make the Go image stale or admit changed contracts", async () => {
  const { ownerReconcilePlan, ownerSourceState } = await import("./owner-preview-source.mjs");
  const changed=["services/identity/clients/persistent-sessions.ts"];
  const committed={identity:["services/identity/clients/index.ts"]};
  const plan=ownerReconcilePlan({changed,committed,preview:true,captain:true});
  assert.equal(plan.blocked.identity,undefined);
  assert.deepEqual(ownerSourceState("identity",changed,committed.identity),{
    imageChanges:[], previewChanges:[], clientPending:true, requiresCommittedRefresh:false
  });
  const contract="services/identity/contracts/openapi/identity.openapi.yaml";
  assert.equal(ownerReconcilePlan({changed:[...changed,contract],committed,preview:true,captain:true}).blocked.identity,"UNCOMMITTED_NON_GO");
  const go="services/identity/backend/cmd/identity/main.go";
  assert.equal(ownerReconcilePlan({changed,committed:{identity:[go]},preview:false,captain:true}).blocked.identity,"PREVIEW_NOT_AUTHORIZED");
});

test("committed client-only changes eventually refresh strict provenance without rebuilding for ongoing client edits",async()=>{
  const {ownerSourceState}=await import("./owner-preview-source.mjs");
  const clients=["services/identity/clients/persistent-sessions.ts"];
  assert.equal(ownerSourceState("identity",[],clients).requiresCommittedRefresh,true);
  assert.equal(ownerSourceState("identity",clients,clients).requiresCommittedRefresh,false);
  assert.equal(ownerSourceState("identity",clients,[]).requiresCommittedRefresh,false);
});

test("fresh baseline preparation is confined to explicit isolated apply with committed schema drift", async () => {
  const { baselineProofOwners, verifyBaselineProofOutput }=await import("./reconcile-owner-runtime.mjs");
  const base={apply:true,prepare:true,blocked:{dsh:"SCHEMA_REVIEW_REQUIRED",identity:"PEER_REVIEW_REQUIRED:dsh"},dirtyInputs:[]};
  assert.deepEqual(baselineProofOwners(base),["dsh"]);
  for(const patch of [{apply:false},{prepare:false},{dirtyInputs:["services/dsh/database/schema/00_marketplace.sql"]},{blocked:{identity:"UNCOMMITTED_NON_GO"}}]) {
    assert.deepEqual(baselineProofOwners({...base,...patch}),[]);
  }
  const proof=["PG_FRESH_DSH_BASELINE=PASS count=8","PG_READER_ACCESS=PASS","PG_RESTORE_READBACK=PASS","PG_DSH_DEDICATED_RUNTIME=PASS","PG_FRESH_IDENTITY_BASELINE=PASS","PG_FRESH_WLT_BASELINE=PASS","PG_BASELINE_TRANSITION_DSH=PASS","PG_BASELINE_TRANSITION_IDENTITY=PASS","PG_BASELINE_TRANSITION_WLT=PASS","PG_ISOLATION=PASS"].join("\n");
  assert.doesNotThrow(()=>verifyBaselineProofOutput(proof));
  assert.throws(()=>verifyBaselineProofOutput(proof+"\nPG_ISOLATION=FAIL"),/BASELINE_PROOF_INCOMPLETE/);
  assert.throws(()=>verifyBaselineProofOutput(proof.replace("PG_RESTORE_READBACK=PASS","PG_RESTORE_READBACK=FAIL")),/BASELINE_PROOF_INCOMPLETE/);
});

test("dedicated DSH transfer fingerprints only validated owner tables and sequences",async()=>{
  const {ownerDataFingerprintSql}=await import("./reconcile-owner-runtime.mjs");
  const sql=ownerDataFingerprintSql("dsh_test_agent01",["stores","public_revision"],["employee_id_seq"]);
  assert.match(sql,/REPEATABLE READ READ ONLY/);
  assert.match(sql,/sha256/);
  assert.match(sql,/dsh_test_agent01\.stores/);
  assert.match(sql,/last_value,is_called/);
  assert.throws(()=>ownerDataFingerprintSql("identity_test_actor",["actors"],[]),/Invalid owner snapshot scope/);
  assert.throws(()=>ownerDataFingerprintSql("dsh_test_agent01",["stores;drop"],[]),/Invalid owner snapshot scope/);
  assert.throws(()=>ownerDataFingerprintSql("dsh_test_agent01",["stores","stores"],[]),/Invalid owner snapshot scope/);
});

// Public extension reference reads are distinct from owner tables and never allow writes.
test("legacy DSH access excludes only named extension reference reads", async () => {
  const { legacyOwnerAccessSql } = await import("./reconcile-owner-runtime.mjs");
  const sql = legacyOwnerAccessSql();
  assert.match(sql, /BEGIN READ ONLY/);
  assert.match(sql, /INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER/);
  assert.match(sql, /d\.deptype=\x27e\x27/);
  assert.match(sql, /e\.extname=\x27postgis\x27 AND n\.nspname=\x27public\x27 AND c\.relname IN/);
});

test("database handoff rejects a changed or incomplete owner snapshot", async()=>{
  const {assertHandoffParity}=await import("./reconcile-owner-runtime.mjs");
  assert.doesNotThrow(()=>assertHandoffParity("a|1\nb|2","a|1\nb|2",2));
  assert.throws(()=>assertHandoffParity("a|1\nb|2","a|1\nb|3",2),/DATA_PARITY_FAILED/);
  assert.throws(()=>assertHandoffParity("a|1","a|1",2),/DATA_PARITY_FAILED/);
  assert.throws(()=>assertHandoffParity("","",0),/DATA_PARITY_FAILED/);
});

test("Identity relocation admits only the verified owner URL and changes only owner credentials and database",async()=>{
  const {identityDestinationUrl,identityAclSql,ownerDataFingerprintSql,legacyOwnerAccessSql}=await import("./reconcile-owner-runtime.mjs");
  const source="postgres://identity_runtime_docker_abcdef123456:fixture@postgres:5432/bthwani_refoundation?sslmode=disable";
  const result=new URL(identityDestinationUrl(source,"a".repeat(64)));
  assert.equal(result.username,"bthwani_identity_runtime");
  assert.equal(result.pathname,"/bthwani_identity_dev");
  assert.equal(result.hostname,"postgres");
  assert.throws(()=>identityDestinationUrl(source.replace("@postgres:","@other:"),"a".repeat(64)),/Unverified/);
  assert.throws(()=>identityDestinationUrl(source.replace("bthwani_refoundation","bthwani_wlt_test"),"a".repeat(64)),/Unverified/);
  assert.throws(()=>identityAclSql("identity_test_docker_abcdef123456","identity_runtime_docker_abcdef123457"),/Unverified/);
  const acl=identityAclSql("identity_test_docker_abcdef123456","identity_runtime_docker_abcdef123456");
  assert.match(acl,/aclexplode\(t.attacl\)/);
  assert.match(acl,/is_grantable/);
  assert.match(acl,/TO bthwani_identity_runtime/);
  assert.match(ownerDataFingerprintSql("identity_test_docker_abcdef123456",["actors","auth_sessions"],[],"identity"),/auth_sessions/);
  assert.match(legacyOwnerAccessSql("bthwani_identity_runtime"),/bthwani_identity_runtime/);
  assert.throws(()=>legacyOwnerAccessSql("bthwani_refoundation_admin"),/Invalid/);
});

test("Identity schema normalization tolerates only known redundant CHECK grouping",async()=>{
  const {normalizeIdentitySchemaDump}=await import("./reconcile-owner-runtime.mjs");
  const original="    CONSTRAINT operator_permission_commands_reason_check CHECK ((((char_length(reason) >= 10) AND (char_length(reason) <= 500)) AND (reason = btrim(reason)) AND (POSITION((chr(10)) IN (reason)) = 0) AND (POSITION((chr(13)) IN (reason)) = 0))),";
  const restored="    CONSTRAINT operator_permission_commands_reason_check CHECK (((char_length(reason) >= 10) AND (char_length(reason) <= 500) AND (reason = btrim(reason)) AND (POSITION((chr(10)) IN (reason)) = 0) AND (POSITION((chr(13)) IN (reason)) = 0))),";
  assert.equal(normalizeIdentitySchemaDump(original),normalizeIdentitySchemaDump(restored));
  assert.notEqual(normalizeIdentitySchemaDump(original.replace(">= 10",">= 9")),normalizeIdentitySchemaDump(restored));
  assert.notEqual(normalizeIdentitySchemaDump(original.replace("AND (reason", "OR (reason")),normalizeIdentitySchemaDump(restored));
});

test("only a current successful committed baseline proof admits canonical schema changes", async()=>{
  const {ownerReconcilePlan}=await import("./owner-preview-source.mjs");
  const base={changed:[],committed:{dsh:["services/dsh/database/schema/45_customer_addresses.sql"]},preview:true,captain:true};
  assert.equal(ownerReconcilePlan(base).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
  assert.deepEqual(ownerReconcilePlan({...base,schemaReady:["dsh"]}).eligible,["dsh","identity","wlt"]);
  assert.equal(ownerReconcilePlan({...base,schemaReady:["dsh"],changed:["services/dsh/backend/cmd/dsh/main.go"]}).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
  assert.equal(ownerReconcilePlan({...base,schemaReady:["dsh"],committed:{dsh:["services/dsh/database/migrations/001_bad.sql"]}}).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
  assert.equal(ownerReconcilePlan({...base,schemaReady:["wlt"]}).blocked.dsh,"SCHEMA_REVIEW_REQUIRED");
});
test("baseline transition is owner-local, transactional and never disables triggers",async()=>{
  const {buildOwnerBaselineTransition,transitionScope}=await import("./owner-baseline-transition.mjs");
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

test("one owner-image builder replaces the three duplicated scripts", async () => {
  const fs = await import("node:fs");
  const base = new URL("./", import.meta.url);
  assert.equal(fs.existsSync(new URL("build-owner-image.ps1",base)),true);
  for (const old of ["build-dsh-image.ps1","build-identity-verifier-image.ps1","build-wlt-image.ps1"]) {
    assert.equal(fs.existsSync(new URL(old,base)),false,old);
    for(const consumer of ["reconcile-owner-runtime.mjs","../tools/dev/dev.ps1","../tools/dev/sync-lenovo-source.mjs","README.md","../services/wlt/backend/README.md"]) {
      assert.equal(fs.readFileSync(new URL(consumer,base),"utf8").includes(old),false,consumer);
    }
  }
});
