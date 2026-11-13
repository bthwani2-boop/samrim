import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const checker=path.join(root,'tools/governance/verify-foundation.mjs');
const owners=['product','platform','architecture','identity','stores','catalog','commerce','fulfillment','finance','hr','experience','safety','engineering','journeys'];
const assetManifest=JSON.parse(fs.readFileSync(path.join(root,'.specify/integrations/speckit.manifest.json'),'utf8'));
const contractGroups=['identity','dsh','wlt'].flatMap(owner=>
 fs.readdirSync(path.join(root,'services',owner,'contracts','openapi','paths'))
  .filter(name=>name.endsWith('.yaml'))
  .map(name=>'services/'+owner+'/contracts/openapi/paths/'+name));
const files=[...new Set([
 'AGENTS.md','REPOSITORY-STRUCTURE.md','.coderabbit.yaml','governance/README.md',
 ...owners.map(owner=>'governance/'+owner+'.md'),'docs/REFOUNDATION-PLAN.md','docs/reference/README.md','docs/reference/HISTORICAL-SOURCE-INVENTORY.md','docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md',
 'docs/reference/environment-config-inventory.md','docs/reference/DONOR-GOVERNANCE-SECTION-CENSUS.md',
 '.github/workflows/ci.yml','.github/workflows/sonar-quality.yml','sonar-project.properties','tools/governance/verify-foundation.mjs','tools/governance/verify-foundation.test.mjs',
 'tools/governance/review-examples.test.mjs','tools/mobile/verify-expo-web-http.mjs',
 '.node-version','.nvmrc','.go-version','.editorconfig','.gitattributes','.gitignore',
 'package.json','pnpm-workspace.yaml','pnpm-lock.yaml','tsconfig.base.json','biome.json',
 'README.md','services/identity/README.md','services/dsh/README.md','services/wlt/README.md',
 ...['identity','dsh','wlt'].flatMap(owner=>['package.json','tsconfig.json','clients/README.md','clients/index.ts','contracts/openapi/README.md','contracts/openapi/'+owner+'.openapi.yaml'].map(file=>'services/'+owner+'/'+file)),
 ...contractGroups,'docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md',
 'docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md','docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json','tools/dev/verify-workspace.mjs','tools/mobile/verify-app-foundations.mjs',
 '.specify/init-options.json','.specify/integration.json','.specify/integrations/speckit.manifest.json',
 '.specify/memory/constitution.md',...Object.keys(assetManifest.files)
])];
function run({edit={},add={},del=[],dirs=[],links={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bthwani-policy-guard-'));
 try{
  for(const f of files){
   const output=path.join(dir,...f.split('/'));
   fs.mkdirSync(path.dirname(output),{recursive:true});
   const original=fs.readFileSync(path.join(root,...f.split('/')),'utf8');
   fs.writeFileSync(output,Object.hasOwn(edit,f)?edit[f](original):original,'utf8');
  }
  for(const [f,c] of Object.entries(add)){
   const output=path.join(dir,...f.split('/'));
   fs.mkdirSync(path.dirname(output),{recursive:true});
   fs.writeFileSync(output,c,'utf8');
  }
  for(const f of del)fs.rmSync(path.join(dir,...f.split('/')),{force:true,recursive:true});
  for(const f of dirs)fs.mkdirSync(path.join(dir,...f.split('/')),{recursive:true});
  for(const [link,target] of Object.entries(links)){
   const destination=path.join(dir,...link.split('/'));
   fs.mkdirSync(path.dirname(destination),{recursive:true});
   fs.symlinkSync(path.join(dir,...target.split('/')),destination,'file');
  }
  const result=spawnSync(process.execPath,[checker,'--root',dir],{encoding:'utf8'});
  return {code:result.status,text:result.stdout+'\n'+result.stderr};
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function rejects(name,mutation,pattern){
 test(name,()=>{
  const r=run(mutation);
  assert.notEqual(r.code,0,r.text);
  assert.match(r.text,pattern);
 });
}
test('live foundation draft is structurally coherent but NOT_READY',()=>{
 const r=run();
 assert.equal(r.code,0,r.text);
 assert.match(r.text,/capability_ids=26/);
 assert.match(r.text,/GOVERNANCE_CUTOVER_NOT_READY/);
 assert.match(r.text,/openapi_zero_operations=true/);
 assert.match(r.text,/openapi_reserved_groups=42/);
 assert.equal(contractGroups.length,42);
 assert.deepEqual(['identity','dsh','wlt'].map(owner=>
  contractGroups.filter(file=>file.startsWith('services/'+owner+'/')).length),[7,21,14]);
});
test('accepts only known empty planned service subdirectories',()=>{
 const r=run({dirs:[
  'services/identity/backend','services/identity/contracts/openapi/paths','services/identity/database/migrations',
  'services/dsh/backend','services/dsh/contracts/openapi/paths','services/dsh/database/migrations',
  'services/wlt/backend','services/wlt/contracts/openapi/paths','services/wlt/database/migrations',
  'services/identity/clients/go','services/dsh/clients/generated','services/wlt/clients/go'
 ]});
 assert.equal(r.code,0,r.text);
 assert.match(r.text,/service_scaffold_only=true/);
});
rejects('rejects missing DSH owner README',{del:['services/dsh/README.md']},/required services\/dsh\/README.md/);
rejects('rejects a fourth HR service',{add:{'services/hr/README.md':'not permitted'}},/unadmitted service directory: services\/hr/);
rejects('rejects missing Identity package manifest',{del:['services/identity/package.json']},/required services\/identity\/package.json/);
rejects('rejects wrong DSH package name',{edit:{'services/dsh/package.json':s=>s.replace('@bthwani/dsh','@bthwani/direct-dsh')}},/service package drift or premature runtime dependency/);
rejects('rejects premature runtime dependencies',{edit:{'services/wlt/package.json':s=>s.replace('"devDependencies":', '"dependencies": {"some-financial-package":"1.0.0"}, "devDependencies":')}},/service package drift or premature runtime dependency/);
rejects('rejects unapproved client export',{edit:{'services/identity/clients/index.ts':s=>s+'export const simulatedLogin = true;\n'}},/premature client behavior or export/);
rejects('rejects wrong TypeScript base',{edit:{'services/dsh/tsconfig.json':s=>s.replace('../../tsconfig.base.json','../old-tsconfig.json')}},/service TypeScript configuration drift/);
rejects('rejects missing client documentation',{del:['services/wlt/clients/README.md']},/required services\/wlt\/clients\/README.md/);
rejects('rejects missing service workspace lock importer',{edit:{'pnpm-lock.yaml':s=>s.replace('  services/identity:', '  services/other:')}},/service missing exact frozen-lockfile importer/);
rejects('rejects old Nx project configuration',{add:{'services/identity/project.json':'{}'}},/premature service source: services\/identity\/project.json/);
rejects('rejects early Go backend source',{add:{'services/identity/backend/main.go':'package main'}},/premature service source: services\/identity\/backend\/main.go/);
rejects('rejects early Go module',{add:{'services/identity/backend/go.mod':'module sample'}},/premature service source: services\/identity\/backend\/go.mod/);
rejects('rejects incomplete DSH OpenAPI entrypoint',{edit:{'services/dsh/contracts/openapi/dsh.openapi.yaml':s=>s.replace('paths: {}','paths:')}},/OpenAPI scaffold mutated or contains unapproved operations\/refs/);
rejects('rejects unapproved DSH endpoint',{edit:{'services/dsh/contracts/openapi/dsh.openapi.yaml':s=>s.replace('paths: {}','paths:\n  /dsh/stores: {}')}},/OpenAPI scaffold mutated or contains unapproved operations\/refs/);
rejects('rejects a duplicate OpenAPI key',{edit:{'services/dsh/contracts/openapi/dsh.openapi.yaml':s=>s+'paths: {}\n'}},/OpenAPI scaffold mutated or contains unapproved operations\/refs/);
rejects('rejects premature server declaration',{edit:{'services/identity/contracts/openapi/identity.openapi.yaml':s=>s+"servers:\n  - url: http://localhost:18082\n"}},/OpenAPI scaffold mutated or contains unapproved operations\/refs/);
rejects('rejects premature financial operation',{edit:{'services/wlt/contracts/openapi/wlt.openapi.yaml':s=>s.replace('paths: {}','paths:\n  /wlt/wallet: {}')}},/OpenAPI scaffold mutated or contains unapproved operations\/refs/);
rejects('rejects unsupported cross-owner ref',{edit:{'services/dsh/contracts/openapi/dsh.openapi.yaml':s=>s.replace('paths: {}','paths:\n  /dsh/stores:\n    $ref: ../../../../identity/contracts/openapi/identity.openapi.yaml')}},/OpenAPI scaffold mutated or contains unapproved operations\/refs/);
rejects('rejects missing DSH path module',{del:['services/dsh/contracts/openapi/paths/stores.yaml']},/required services\/dsh\/contracts\/openapi\/paths\/stores.yaml/);
rejects('rejects malformed DSH path fragment',{edit:{'services/dsh/contracts/openapi/paths/orders.yaml':s=>s.replace('paths: {}','paths: [')}},/OpenAPI path fragment is not an empty placeholder/);
rejects('rejects nonempty DSH path fragment',{edit:{'services/dsh/contracts/openapi/paths/employees.yaml':s=>s.replace('paths: {}','paths:\n  /employees: {}')}},/OpenAPI path fragment is not an empty placeholder/);
rejects('rejects additional speculative DSH path module',{add:{'services/dsh/contracts/openapi/paths/wallet-provider.yaml':'paths: {}\n'}},/premature service source: services\/dsh\/contracts\/openapi\/paths\/wallet-provider.yaml/);
rejects('rejects unapproved Identity path module',{add:{'services/identity/contracts/openapi/paths/shadow-auth.yaml':'paths: {}\n'}},/premature service source: services\/identity\/contracts\/openapi\/paths\/shadow-auth.yaml/);
rejects('rejects unapproved WLT path module',{add:{'services/wlt/contracts/openapi/paths/alternate-ledger.yaml':'paths: {}\n'}},/premature service source: services\/wlt\/contracts\/openapi\/paths\/alternate-ledger.yaml/);
rejects('rejects missing OpenAPI ownership notes',{del:['services/identity/contracts/openapi/README.md']},/required services\/identity\/contracts\/openapi\/README.md/);
rejects('rejects missing source-audited contract inventory',{del:['docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md']},/required docs\/reference\/OPENAPI-DONOR-CONTRACT-INVENTORY.md/);
rejects('rejects missing Identity session fragment',{del:['services/identity/contracts/openapi/paths/session.yaml']},/required services\/identity\/contracts\/openapi\/paths\/session.yaml/);
rejects('rejects missing WLT ledger fragment',{del:['services/wlt/contracts/openapi/paths/ledger.yaml']},/required services\/wlt\/contracts\/openapi\/paths\/ledger.yaml/);
rejects('rejects nonempty WLT ledger fragment',{edit:{'services/wlt/contracts/openapi/paths/ledger.yaml':s=>s.replace('paths: {}','paths:\n  /wlt/credit: {}')}},/OpenAPI path fragment is not an empty placeholder/);
rejects('rejects nonempty Identity authentication fragment',{edit:{'services/identity/contracts/openapi/paths/client-auth.yaml':s=>s.replace('paths: {}','paths:\n  /auth/override: {}')}},/OpenAPI path fragment is not an empty placeholder/);
rejects('rejects misplaced financial writer in DSH',{edit:{'services/dsh/contracts/openapi/paths/financial-views.yaml':s=>s.replace('paths: {}','paths:\n  /dsh/ledger/post: {}')}},/OpenAPI path fragment is not an empty placeholder/);
rejects('rejects early SQL migration',{add:{'services/wlt/database/migrations/001.sql':'select 1;'}},/premature service source: services\/wlt\/database\/migrations\/001.sql/);
rejects('rejects early fresh baseline',{add:{'services/dsh/database/fresh-baseline.sql':'select 1;'}},/premature service source: services\/dsh\/database\/fresh-baseline.sql/);
rejects('rejects untracked placeholders',{add:{'services/dsh/backend/.gitkeep':''}},/premature service source: services\/dsh\/backend\/\.gitkeep/);
rejects('rejects unapproved nested service folder',{add:{'services/dsh/shared/unowned.txt':'wrong owner'}},/unadmitted service directory: services\/dsh\/shared/);
rejects('rejects false service runtime readiness',{edit:{'services/wlt/README.md':s=>s.replace('EXECUTION: NOT_STARTED','EXECUTION: READY')}},/invalid service placement README: services\/wlt\/README.md/);
test('rejects service symlinks on Unix CI',{skip:process.platform==='win32'},()=>{
 const r=run({links:{'services/identity/linked.txt':'governance/README.md'}});
 assert.notEqual(r.code,0,r.text);
 assert.match(r.text,/unsafe service symlink/);
});
test('rejects a required governance symlink without opening its target on Unix CI',{skip:process.platform==='win32'},()=>{
 const r=run({del:['AGENTS.md'],links:{'AGENTS.md':'governance/README.md'}});
 assert.notEqual(r.code,0,r.text);
 assert.match(r.text,/required AGENTS\.md/);
});
rejects('rejects absent AGENTS law',{del:['AGENTS.md']},/required AGENTS\.md/);
rejects('rejects premature READY',{edit:{'governance/README.md':s=>s.replace('GOVERNANCE_CUTOVER: NOT_READY','GOVERNANCE_CUTOVER: READY')}},/do not mark governance ready/);
rejects('rejects duplicate old policy directory',{add:{'docs/governance/README.md':'legacy duplicate'}},/forbidden duplicate governance/);
rejects('rejects unnecessary CODEOWNERS',{add:{'.github/CODEOWNERS':'* @fake'}},/unneeded CODEOWNERS/);
rejects('rejects code-dependent Fast Guard inherited prematurely',{add:{'.github/workflows/fast-guard.yml':'name: Fast Guard'}},/source-dependent inherited CI/);
rejects('rejects required fast-guard with implicit dependency skip',{edit:{'.github/workflows/ci.yml':s=>s.replace('    if: ${{ !cancelled() }}\n','')}},/required fast-guard must evaluate failed dependencies/);
rejects('rejects fast-guard when presentation dependency is removed',{edit:{'.github/workflows/ci.yml':s=>s.replace('    needs: [foundation, presentation]','    needs: [foundation]')}},/required fast-guard must depend on both/);
rejects('rejects an upstream-result gate that cannot fail',{edit:{'.github/workflows/ci.yml':s=>s.replace('          exit 1\n','          exit 0\n')}},/required fast-guard must fail on upstream errors/);
rejects('rejects presentation without locked pnpm install',{edit:{'.github/workflows/ci.yml':s=>s.replace('pnpm install --frozen-lockfile --ignore-scripts','echo no-install')}},/presentation must install locked TypeScript/);
rejects('rejects presentation dropping the app boundary scanner',{edit:{'package.json':s=>s.replace('&& node tools/mobile/verify-application-boundaries.mjs &&','&& node -e 0 &&')}},/presentation must install locked TypeScript/);
rejects('rejects dependency-backed scanner repeated in isolated fast-guard',{edit:{'.github/workflows/ci.yml':s=>s.replace('          node tools/governance/verify-foundation.mjs\n          node --test tools/security/verify-secrets.test.mjs','          node tools/mobile/verify-application-boundaries.mjs\n          node tools/governance/verify-foundation.mjs\n          node --test tools/security/verify-secrets.test.mjs')}},/required fast-guard must not invoke TypeScript scanner without dependency installation/);
rejects('rejects a skipped Sonar required check for fork PRs',{edit:{'.github/workflows/sonar-quality.yml':s=>s.replace('    steps:\n','    if: ${{ github.event_name == "push" }}\n    steps:\n')}},/required Sonar job must not be skipped/);
rejects('rejects Sonar fork gate without failure',{edit:{'.github/workflows/sonar-quality.yml':s=>s.replace('          exit 1\n','          exit 0\n')}},/Sonar fork gate must fail closed/);
rejects('rejects scanning untrusted forks with the Sonar token',{edit:{'.github/workflows/sonar-quality.yml':s=>s.replace("        if: ${{ github.event_name == 'push' || github.event.pull_request.head.repo.full_name == github.repository }}\n        uses: SonarSource/","        if: ${{ always() }}\n        uses: SonarSource/")}},/Sonar scanner must protect its token/);
rejects('rejects changing the existing Sonar project identity',{edit:{'sonar-project.properties':s=>s.replace('sonar.projectKey=bthwani2-boop_samrim','sonar.projectKey=another_project')}},/existing project quality gate/);
rejects('rejects an unpinned Node runtime in foundation CI',{edit:{'.github/workflows/ci.yml':s=>s.replace('node-version-file: .node-version','node-version-file: 20')}},/must use pinned Node/);
rejects('rejects an unpinned Node runtime in fast-guard',{edit:{'.github/workflows/ci.yml':s=>{
 const marker='node-version-file: .node-version';
 const index=s.lastIndexOf(marker);
 return s.slice(0,index)+s.slice(index).replace(marker,'node-version-file: 20');
}}},/must use pinned Node/);
rejects('rejects CI bypass',{edit:{'.github/workflows/ci.yml':s=>s+'\ncontinue-on-error: true\n'}},/silently skip proof/);
rejects('rejects actual CI secret expressions',{edit:{'.github/workflows/ci.yml':s=>s+'\nenv:\n  EXPOSE: ${{ secrets.SONAR_TOKEN }}\n'}},/silently skip proof/);
rejects('rejects claimed financial production truth',{edit:{'governance/finance.md':s=>s.replace('IMPLEMENTATION_STATE_AUTHORITY: NONE','IMPLEMENTATION_STATE_AUTHORITY: ACTIVE')}},/implementation authority/);
rejects('rejects missing domain document',{del:['governance/identity.md']},/required governance\/identity.md/);
rejects('rejects missing capability',{edit:{'governance/finance.md':s=>s.replace('CAPABILITY_ID: ORDER_PAYMENT_COLLECTION','CAPABILITY_REMOVED: ORDER_PAYMENT_COLLECTION')}},/unmapped capabilities/);
rejects('rejects duplicated capability',{edit:{'governance/commerce.md':s=>s+'\n## STORE_RELATION_MODEL\nCAPABILITY_ID: STORE_RELATION_MODEL\nA duplicated Store model authority must not be added to Commerce.\n'}},/duplicate capability owner/);
rejects('rejects capability wrong owner in Product census',{edit:{'governance/product.md':s=>s.replace('| `finance.md` |','| `commerce.md` |')}},/wrong capability owner/);
rejects('rejects extra unadmitted capability',{edit:{'governance/hr.md':s=>s+'\n## UNSANCTIONED_ENGINE\nCAPABILITY_ID: UNSANCTIONED_ENGINE\nA new engine not in Product census must be rejected.\n'}},/not present in Product/);
rejects('rejects losing scheduled-Order exclusion',
 {edit:{'governance/product.md':s=>s.replace('scheduled Customer Orders','unrestricted future booking')}},
 /donor Product non-goal boundary missing: scheduled Customer Orders/);
rejects('rejects losing regulated-pharmacy exclusion',
 {edit:{'governance/product.md':s=>s.replace('Prescription-required and specially regulated pharmacy fulfillment remains excluded','regulated pharmacy default fulfillment enabled')}},
 /donor Product non-goal boundary missing: Prescription-required and specially regulated pharmacy fulfillment remains excluded/);
rejects('rejects losing paid Customer membership exclusion',
 {edit:{'governance/product.md':s=>s.replace('paid Customer membership','unapproved customer subscription')}},
 /donor Product non-goal boundary missing: paid Customer membership/);
rejects('rejects deleted owner-backed policy law',{edit:{'AGENTS.md':s=>s.replace(/- \*\*Policy-first for legitimate business choices:\*\*[^\n]+\n/,'')}},/owner-backed configurable business rules/);
rejects('rejects finance policy fee dimensional collapse',{edit:{'governance/finance.md':s=>s.replaceAll('STORE_MANAGED','NOT_SUPPORTED')}},/distinguish collection responsibility/);
rejects('rejects UTF-8 BOM',{edit:{'governance/hr.md':s=>'\uFEFF'+s}},/empty or BOM/);

rejects('rejects CodeRabbit review disabled',{edit:{'.coderabbit.yaml':s=>s.replace('enabled: true','enabled: false')}},/CodeRabbit local review/);
rejects('rejects missing CodeRabbit config',{del:['.coderabbit.yaml']},/required \.coderabbit\.yaml/);

rejects('rejects missing research provenance index',{del:['docs/reference/README.md']},/required docs\/reference\/README.md/);
rejects('rejects missing linked development environment inventory',
 {del:['docs/reference/environment-config-inventory.md']},
 /broken local Markdown link: docs\/reference\/README\.md -> environment-config-inventory\.md/);
rejects('rejects missing donor governance section provenance',
 {del:['docs/reference/DONOR-GOVERNANCE-SECTION-CENSUS.md']},
 /broken local Markdown link: docs\/(?:REFOUNDATION-PLAN\.md -> reference\/|reference\/README\.md -> )DONOR-GOVERNANCE-SECTION-CENSUS\.md/);
rejects('rejects research masquerading as Product policy',{edit:{'docs/reference/README.md':s=>s.replace('BUSINESS_POLICY_AUTHORITY: NONE','BUSINESS_POLICY_AUTHORITY: ACTIVE')}},/research index cannot become policy authority/);

rejects('rejects missing Spec Kit constitution router',{del:['.specify/memory/constitution.md']},/required \.specify\/memory\/constitution.md/);
rejects('rejects generic Spec Kit placeholder constitution',{edit:{'.specify/memory/constitution.md':s=>s.replace('ARTIFACT_CLASS: DERIVED_SPEC_KIT_ROUTER','ARTIFACT_CLASS: INDEPENDENT_POLICY')}},/nonauthoritative router/);
rejects('rejects Spec Kit routing to the deleted governance root',{edit:{'.specify/memory/constitution.md':s=>s+'\nsee docs/governance/README.md\n'}},/nonauthoritative router/);
rejects('rejects wrong Spec Kit installation mode',{edit:{'.specify/init-options.json':s=>s.replace('"integration": "none"','"integration": "codex"')}},/agent-neutral PowerShell integration/);
rejects('rejects Spec Kit vendor script modification',{edit:{'.specify/scripts/powershell/common.ps1':s=>s+'\n# unwanted drift\n'}},/vendor asset modified/);
rejects('rejects Spec Kit version mismatch',{edit:{'.specify/integration.json':s=>s.replace('1.3.0','0.9.0')}},/version mismatch/);

rejects('rejects a missing source URL inventory',{del:['docs/reference/HISTORICAL-SOURCE-INVENTORY.md']},/required docs\/reference\/HISTORICAL-SOURCE-INVENTORY.md/);
rejects('rejects a falsely verified external URL inventory',{edit:{'docs/reference/HISTORICAL-SOURCE-INVENTORY.md':s=>s.replace('live link, license and content checks NOT_RUN','live link, license and content checks PASS')}},/historical link extraction cannot claim live verification/);

rejects('rejects losing bounded Store-specific Operator import authorization',
 {edit:{'governance/catalog.md':s=>s.replace('specific Store import operation','unbounded import')}},
 /source-grounded catalog import\/resolver boundary missing/);
rejects('rejects treating variable-measure barcode as ordinary Product identity',
 {edit:{'governance/catalog.md':s=>s.replace('existing StoreOffer, eligible SHARED Variant match, STORE_SCOPED match, unknown identifier, and variable-measure identifier','any scanned barcode')}},
 /source-grounded catalog import\/resolver boundary missing/);
rejects('rejects name-only catalog import identity ambiguity',
 {edit:{'governance/catalog.md':s=>s.replace('draft STORE_SCOPED Product and draft StoreOffer','unreviewed Shared Product')}},
 /source-grounded catalog import\/resolver boundary missing/);

rejects('rejects loss of Owner-managed serviceability policy',{edit:{'governance/commerce.md':s=>s.replace('## Operator-managed commercial thresholds — explicit policy, not compiled law','## Removed business parameter controls')}},/owner-backed configurable-values section missing/);
rejects('rejects loss of Owner-managed financial policy parameters',{edit:{'governance/finance.md':s=>s.replace('## Operator-managed financial values versus immutable accounting rules','## Removed financial parameter controls')}},/owner-backed configurable-values section missing/);

rejects('rejects dropping a material historic Journey ID',{edit:{'governance/journeys.md':s=>s.replace('JOURNEY_ID: FIRST_THREE_ORDER_CONTACT','JOURNEY_UNTRACKED: FIRST_THREE_ORDER_CONTACT')}},/journey heading\/id mismatch/);
rejects('rejects duplicate Journey identifier',{edit:{'governance/journeys.md':s=>s.replace('JOURNEY_ID: BENEFICIARY_SETTLEMENT','JOURNEY_ID: BENEFICIARY_SETTLEMENT\nJOURNEY_ID: BENEFICIARY_SETTLEMENT')}},/journey heading\/id mismatch/);
rejects('rejects missing Journey canonical readback',{edit:{'governance/journeys.md':s=>s.replace('READBACK: WLT Store-specific original receivable','OBSERVED: WLT Store-specific original receivable')}},/missing material journey evidence boundary/);
rejects('rejects lost accessibility standard',{edit:{'governance/experience.md':s=>s.replace('WCAG 2.2 AA','generic accessibility')}},/operator experience missing accessible/);
rejects('rejects missing owner-backed popularity ranking',{edit:{'governance/catalog.md':s=>s.replace('distinct canonically completed Store Orders','uninformed frontend clicks')}},/canonical popularity read model/);

rejects('rejects missing historical Control Panel source inventory',{del:['docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md']},/required docs\/reference\/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md/);
rejects('rejects missing R112 archive requirement ID',{edit:{'docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md':s=>s.replace('| R112 |','| MISSING |')}},/retain 112 unique IDs/);
rejects('rejects a duplicated historical source requirement',{edit:{'docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md':s=>s.replace(/^(\| R008 \|[^\n]+)$/m,'$1\n$1')}},/retain 112 unique IDs/);
rejects('rejects historical Control Panel source as authoritative policy',{edit:{'docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md':s=>s.replace('BUSINESS_POLICY_AUTHORITY: NONE','BUSINESS_POLICY_AUTHORITY: ACTIVE')}},/cannot become Product policy/);

rejects('rejects incomplete historical per-ID classification',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^\| R112 \| `DRAFT_ALIGNED_OWNER` \|[^\n]+\n/m,'')}},/classify all 112 historical source IDs exactly once/);
rejects('rejects duplicated historical per-ID classification',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^(\| R042 \| `DRAFT_ALIGNED_OWNER` \|[^\n]+)$/m,'$1\n$1')}},/classify all 112 historical source IDs exactly once/);
rejects('rejects fabricated historical code PASS',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^(\| R041 \| `)DRAFT_ALIGNED_OWNER/m,'$1PASS_IMPLEMENTED')}},/unrecognized documentary classification/);

rejects('rejects loss of closed-by-schedule Store meaning',{edit:{'governance/stores.md':s=>s.replace('CLOSED_BY_SCHEDULE','STORE_UNKNOWN')}},/DSH Store orderability distinction missing/);
rejects('rejects lost historic payout-recipient state',{edit:{'governance/finance.md':s=>s.replaceAll('RECIPIENT_REVIEW_REQUIRED','REVIEW_OPTIONAL')}},/historic WLT money\/recipient preservation missing/);
rejects('rejects lost protected legacy COD state',{edit:{'governance/finance.md':s=>s.replaceAll('REMITTED','NEW_MONEY')}},/historic WLT money\/recipient preservation missing/);

rejects('rejects a changed Node baseline version',{edit:{'.node-version':s=>s.replace('24.22.1','25.0.0')}},/source-matching Node\/Go pins/);
rejects('rejects Go downgrade to installed 1.27.1',{edit:{'.go-version':s=>s.replace('1.27.3','1.27.1')}},/source-matching Node\/Go pins/);
rejects('rejects TypeScript version upgrade',{edit:{'package.json':s=>s.replace('"typescript": "7.0.2"','"typescript": "7.1.0"')}},/root dependencies must match original/);
rejects('rejects an unsupported Nx early install',{edit:{'package.json':s=>s.replace('"typescript": "7.0.2"','"typescript": "7.0.2", "nx": "24.0.1"')}},/root dependencies must match original/);
rejects('rejects a pnpm lockfile missing pinned TypeScript',{edit:{'pnpm-lock.yaml':s=>s.replaceAll('specifier: 7.0.2','specifier: 7.1.0')}},/lockfile incomplete or version drift/);
rejects('rejects premature Nx configuration',{add:{'nx.json':'{}'}},/stage 5\+ service\/DB\/infra introduced prematurely/);
rejects('rejects a missing exact source baseline file',{del:['docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md']},/required docs\/reference\/TOOLCHAIN-SOURCE-VERSIONS.md/);

rejects('rejects broken local governance reference',{edit:{'README.md':s=>s.replace('](governance/README.md)','](governance/missing.md)')}},/broken local Markdown link/);
rejects('rejects Markdown links that escape repo root',{edit:{'README.md':s=>s.replace('](governance/README.md)','](../untrusted.md)')}},/local Markdown link escapes workspace/);

rejects('rejects lost replay-safe recovery challenge policy',
 {edit:{'governance/safety.md':s=>s.replace('one-time/replay use','unbounded token reuse')}},
 /source-grounded safety boundary missing: one-time\/replay use/);
rejects('rejects erased security-safe failure fallback',
 {edit:{'governance/safety.md':s=>s.replace('no silent fallback may switch','fallback may silently switch')}},
 /source-grounded safety boundary missing: no silent fallback may switch/);
rejects('rejects unverified backup before protected schema migration',
 {edit:{'governance/safety.md':s=>s.replace('verified, restricted, restorable backup','unverified remote snapshot')}},
 /source-grounded safety boundary missing: verified, restricted, restorable backup/);
rejects('rejects protected migration without coordinating active writers',
 {edit:{'governance/safety.md':s=>s.replace('Coordinate or stop incompatible writers before the owner migration runner','Run migration concurrently with all business writers')}},
 /source-grounded safety boundary missing: Coordinate or stop incompatible writers before the owner migration runner/);
rejects('rejects migration precondition bypass',
 {edit:{'governance/safety.md':s=>s.replace('fail closed if versions, preconditions, ownership or backup integrity do not match','silently ignore migration checksums')}},
 /source-grounded safety boundary missing: fail closed if versions, preconditions, ownership or backup integrity do not match/);
rejects('rejects unbounded Operator permission administration',
 {edit:{'governance/identity.md':s=>s.replace('Only that original, one-time bootstrapped Operator may grant or revoke','Any Operator may grant or revoke')}},
 /source-grounded identity boundary missing: Only that original, one-time bootstrapped Operator may grant or revoke/);
rejects('rejects exposed cross-origin Customer credential transfer',
 {edit:{'governance/identity.md':s=>s.replace('never place access/refresh credentials','may share access/refresh credentials')}},
 /source-grounded identity boundary missing: never place access\/refresh credentials/);
rejects('rejects loss of approved Operator catalog permission boundary',
 {edit:{'governance/identity.md':s=>s.replace('`catalog`: shared Product identities, category and attribute policy, catalog proposals and imports','`catalog`: unrestricted organization-wide access')}},
 /source-grounded Operator scope meaning missing: `catalog`: shared Product identities/);
rejects('rejects turning read-oriented Leadership into a write authority',
 {edit:{'governance/identity.md':s=>s.replace('Leadership remains a read-oriented center without a separate write scope','Leadership has universal write access')}},
 /source-grounded Operator scope meaning missing: Leadership remains a read-oriented center/);
rejects('rejects loss of bounded HR request reconciliation',
 {edit:{'governance/hr.md':s=>s.replace('already claimed for Identity actor creation cannot be rejected','already claimed for Identity actor creation may be rejected immediately')}},
 /source-grounded HR draft boundary missing: already claimed for Identity actor creation cannot be rejected/);
rejects('rejects HR write-through without current Identity permission readback',
 {edit:{'governance/hr.md':s=>s.replace('current live Identity permission readback','HR proposed permissions alone')}},
 /source-grounded HR draft boundary missing: current live Identity permission readback/);
rejects('rejects independent recipient identity from an order snapshot',
 {edit:{'governance/platform.md':s=>s.replace('Delivery recipient:','New delivery identity:')}},
 /source-grounded actor\/platform draft boundary missing: Delivery recipient:/);
rejects('rejects lost primary Tamagui/Ant design owner decision',{edit:{'governance/experience.md':s=>s.replace('## DESIGN-01 — Exclusive rendering, token and theme authority','## Uncontrolled design')}},/reconciled design owner decision missing/);
rejects('rejects removal of Studio boundary',{edit:{'governance/experience.md':s=>s.replace('## DESIGN-02 — Studio is a bounded editor, not an additional publication engine','## Duplicate publishers')}},/reconciled design owner decision missing/);
rejects('rejects removal of old Merchant published app identifier',{edit:{'governance/platform.md':s=>s.replace('com.bthwani.partner','com.bthwani.merchant')}},/original external identity\/internal naming missing/);
rejects('rejects a lost source-of-truth OpenAPI decision',{edit:{'governance/engineering.md':s=>s.replace('## API-01 — OpenAPI organization and semantic-equivalence gate','## Two incompatible OpenAPI generators')}},/approved API\/SQL\/policy governance decision missing/);
rejects('rejects unprotected historic migrations',{edit:{'governance/engineering.md':s=>s.replace('182 DSH + 30 Identity + 63 WLT = 275','migrations discarded')}},/migration\/configurable policy preservation constraint missing/);
rejects('rejects missing historical design section 24',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^\| 24 [^\n]+\n/m,'')}},/design source 24-section decision concordance incomplete/);
rejects('rejects duplicated historical design decision',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^(\| 07 [^\n]+)$/m,'$1\n$1')}},/design source 24-section decision concordance incomplete/);
rejects('rejects fabricated approval of critical-risk review',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace('GOVERNANCE_CUTOVER stays NOT_READY','GOVERNANCE_CUTOVER declared READY')}},/design-plan concordance cannot claim unreviewed cutover success/);

rejects('rejects governance cutover claiming real app/SQL implementation without evidence',{edit:{'governance/README.md':s=>s.replace('## Cutover readiness is a policy decision, not a claim of implemented software','## False software production readiness')}},/governance policy readiness must stay separate from later runtime implementation tests/);

rejects('rejects missing illustrative risk-review arithmetic tests',{del:['tools/governance/review-examples.test.mjs']},/required tools\/governance\/review-examples.test.mjs/);
rejects('rejects dropped COD financial review case',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^\| FIN-01-COD \|[^\n]*\n/m,'')}},/risk review scenario missing\/duplicated: FIN-01-COD/);
rejects('rejects duplicated Store cash commission review case',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^(\| FIN-02-REMIT \|[^\n]+)$/m,'$1\n$1')}},/risk review scenario missing\/duplicated: FIN-02-REMIT/);
rejects('rejects fake financial signoff',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace('| FIN-01 | NOT_ASSIGNED | NOT_RUN | NOT_PROVIDED | REVIEW_BLOCKED |','| FIN-01 | SELF_APPROVED | TODAY | NO_EVIDENCE | PASS |')}},/do not fabricate independent reviewer approval/);
rejects('rejects lost migration restore review gate',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^\| MIG-01-RESTORE \|[^\n]*\n/m,'')}},/risk review scenario missing\/duplicated: MIG-01-RESTORE/);
rejects('rejects missing full-system historic source section',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^\| 15 \| `SOURCE_BOUND_PROOF` \|[^\n]*\n/m,'')}},/historic full-system 15-section evidence mapping incomplete/);
rejects('rejects missing historic design audit followup',{edit:{'docs/REFOUNDATION-PLAN.md':s=>s.replace(/^\| FOLLOWUP \|[^\n]*\n/m,'')}},/historic design-audit 16\+followup mapping incomplete/);
rejects('rejects omitted production Expo Web SSR smoke in CI',
 {edit:{'.github/workflows/ci.yml':s=>s.replace('node tools/mobile/verify-expo-web-http.mjs','echo no real Expo SSR smoke')}},
 /approved Expo Web SSR exports must have production HTTP smoke/);
rejects('rejects omitted risk review examples from CI',{edit:{'.github/workflows/ci.yml':s=>s.replace(' tools/governance/review-examples.test.mjs','')}},/foundation CI and local commands must include bounded risk-review examples/);

rejects('rejects privacy regression granting customer mission GPS', {edit:{
 'governance/fulfillment.md':s=>s.replace(
  'Customer, Merchant, other Captains and public opportunity maps cannot read that fix',
  'all journey parties may see the latest Captain fix')
}},/source-grounded privacy\/commerce\/finance draft boundary missing: governance\/fulfillment\.md/);
rejects('rejects loss of latest-mission security boundary', {edit:{
 'governance/safety.md':s=>s.replace('Actual assigned-mission location','Any public Captain location')
}},/source-grounded privacy\/commerce\/finance draft boundary missing: governance\/safety\.md/);
rejects('rejects loss of per-recipient Order message audience', {edit:{
 'governance/commerce.md':s=>s.replace('Sender-selected recipient sets constrain visibility','All participants can read all messages')
}},/source-grounded privacy\/commerce\/finance draft boundary missing: governance\/commerce\.md/);
rejects('rejects creation-policy bypass for additional Stores', {edit:{
 'governance/stores.md':s=>s.replace('A DSH relation-admission policy governs **every** creation','New Store creation may ignore admission policy')
}},/source-grounded privacy\/commerce\/finance draft boundary missing: governance\/stores\.md/);
rejects('rejects activating Store Captain membership without invited Captain acceptance',
 {edit:{'governance/fulfillment.md':s=>s.replace("Only the invited actor's own verified acceptance activates membership", 'An Operator may activate membership without consent')}},
 /source-grounded fulfillment lifecycle boundary missing/);
rejects('rejects losing dispatch presence needed for safe retry after offer expiry',
 {edit:{'governance/fulfillment.md':s=>s.replace('An outstanding offer may reserve candidate capacity but must not erase the fresh dispatch-presence fix','An outstanding offer deletes fresh dispatch presence')}},
 /source-grounded fulfillment lifecycle boundary missing/);
rejects('rejects bypassing two-sided Store Captain custody confirmation',
 {edit:{'governance/fulfillment.md':s=>s.replace('There is one two-sided Store-to-Captain custody handoff','There is one unverified client-side custody handoff')}},
 /source-grounded fulfillment lifecycle boundary missing/);
rejects('rejects unverified Customer pickup release',
 {edit:{'governance/fulfillment.md':s=>s.replace('the Store must confirm readiness before one-time release to the authorized Customer','the Store can release goods without authorized proof')}},
 /source-grounded fulfillment lifecycle boundary missing/);

rejects('rejects loss of canonical StoreOffer visibility gate', {edit:{
 'governance/catalog.md':s=>s.replace('one server-side `CUSTOMER_VISIBLE_OFFER` decision','client-side StoreOffer visibility gate')
}},/source-grounded privacy\/commerce\/finance draft boundary missing: governance\/catalog\.md/);
rejects('rejects unverified payout instruction release', {edit:{
 'governance/finance.md':s=>s.replace('Before **every not-yet-executed** manual official-wallet transfer','After the transfer')
}},/source-grounded privacy\/commerce\/finance draft boundary missing: governance\/finance\.md/);
