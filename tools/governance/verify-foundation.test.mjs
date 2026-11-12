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
const files=[...new Set([
 'AGENTS.md','REPOSITORY-STRUCTURE.md','.coderabbit.yaml','governance/README.md',
 ...owners.map(owner=>'governance/'+owner+'.md'),'docs/REFOUNDATION-PLAN.md','docs/reference/README.md','docs/reference/HISTORICAL-SOURCE-INVENTORY.md','docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md',
 '.github/workflows/foundation-guard.yml','tools/governance/verify-foundation.mjs','tools/governance/verify-foundation.test.mjs',
 '.node-version','.nvmrc','.go-version','.editorconfig','.gitattributes','.gitignore',
 'package.json','pnpm-workspace.yaml','pnpm-lock.yaml','tsconfig.base.json','biome.json',
 'README.md','docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md','tools/dev/verify-workspace.mjs',
 '.specify/init-options.json','.specify/integration.json','.specify/integrations/speckit.manifest.json',
 '.specify/memory/constitution.md',...Object.keys(assetManifest.files)
])];
function run({edit={},add={},del=[]}={}){
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
});
rejects('rejects absent AGENTS law',{del:['AGENTS.md']},/required AGENTS\.md/);
rejects('rejects premature READY',{edit:{'governance/README.md':s=>s.replace('GOVERNANCE_CUTOVER: NOT_READY','GOVERNANCE_CUTOVER: READY')}},/do not mark governance ready/);
rejects('rejects duplicate old policy directory',{add:{'docs/governance/README.md':'legacy duplicate'}},/forbidden duplicate governance/);
rejects('rejects unnecessary CODEOWNERS',{add:{'.github/CODEOWNERS':'* @fake'}},/unneeded CODEOWNERS/);
rejects('rejects code-dependent Fast Guard inherited prematurely',{add:{'.github/workflows/fast-guard.yml':'name: Fast Guard'}},/source-dependent inherited CI/);
rejects('rejects CI bypass',{edit:{'.github/workflows/foundation-guard.yml':s=>s+'\ncontinue-on-error: true\n'}},/silently skip proof/);
rejects('rejects claimed financial production truth',{edit:{'governance/finance.md':s=>s.replace('IMPLEMENTATION_STATE_AUTHORITY: NONE','IMPLEMENTATION_STATE_AUTHORITY: ACTIVE')}},/implementation authority/);
rejects('rejects missing domain document',{del:['governance/identity.md']},/required governance\/identity.md/);
rejects('rejects missing capability',{edit:{'governance/finance.md':s=>s.replace('CAPABILITY_ID: ORDER_PAYMENT_COLLECTION','CAPABILITY_REMOVED: ORDER_PAYMENT_COLLECTION')}},/unmapped capabilities/);
rejects('rejects duplicated capability',{edit:{'governance/commerce.md':s=>s+'\n## STORE_RELATION_MODEL\nCAPABILITY_ID: STORE_RELATION_MODEL\nA duplicated Store model authority must not be added to Commerce.\n'}},/duplicate capability owner/);
rejects('rejects capability wrong owner in Product census',{edit:{'governance/product.md':s=>s.replace('| `finance.md` |','| `commerce.md` |')}},/wrong capability owner/);
rejects('rejects extra unadmitted capability',{edit:{'governance/hr.md':s=>s+'\n## UNSANCTIONED_ENGINE\nCAPABILITY_ID: UNSANCTIONED_ENGINE\nA new engine not in Product census must be rejected.\n'}},/not present in Product/);
rejects('rejects deleted owner-backed policy law',{edit:{'AGENTS.md':s=>s.replace(/- \*\*Policy-first for legitimate business choices:\*\*[^\n]+\n/,'')}},/owner-backed configurable business rules/);
rejects('rejects finance policy fee dimensional collapse',{edit:{'governance/finance.md':s=>s.replaceAll('STORE_MANAGED','NOT_SUPPORTED')}},/distinguish collection responsibility/);
rejects('rejects UTF-8 BOM',{edit:{'governance/hr.md':s=>'\uFEFF'+s}},/empty or BOM/);

rejects('rejects CodeRabbit review disabled',{edit:{'.coderabbit.yaml':s=>s.replace('enabled: true','enabled: false')}},/CodeRabbit local review/);
rejects('rejects missing CodeRabbit config',{del:['.coderabbit.yaml']},/required \.coderabbit\.yaml/);

rejects('rejects missing research provenance index',{del:['docs/reference/README.md']},/required docs\/reference\/README.md/);
rejects('rejects research masquerading as Product policy',{edit:{'docs/reference/README.md':s=>s.replace('BUSINESS_POLICY_AUTHORITY: NONE','BUSINESS_POLICY_AUTHORITY: ACTIVE')}},/research index cannot become policy authority/);

rejects('rejects missing Spec Kit constitution router',{del:['.specify/memory/constitution.md']},/required \.specify\/memory\/constitution.md/);
rejects('rejects generic Spec Kit placeholder constitution',{edit:{'.specify/memory/constitution.md':s=>s.replace('ARTIFACT_CLASS: DERIVED_SPEC_KIT_ROUTER','ARTIFACT_CLASS: INDEPENDENT_POLICY')}},/nonauthoritative router/);
rejects('rejects Spec Kit routing to the deleted governance root',{edit:{'.specify/memory/constitution.md':s=>s+'\nsee docs/governance/README.md\n'}},/nonauthoritative router/);
rejects('rejects wrong Spec Kit installation mode',{edit:{'.specify/init-options.json':s=>s.replace('"integration": "none"','"integration": "codex"')}},/agent-neutral PowerShell integration/);
rejects('rejects Spec Kit vendor script modification',{edit:{'.specify/scripts/powershell/common.ps1':s=>s+'\n# unwanted drift\n'}},/vendor asset modified/);
rejects('rejects Spec Kit version mismatch',{edit:{'.specify/integration.json':s=>s.replace('1.3.0','0.9.0')}},/version mismatch/);

rejects('rejects a missing source URL inventory',{del:['docs/reference/HISTORICAL-SOURCE-INVENTORY.md']},/required docs\/reference\/HISTORICAL-SOURCE-INVENTORY.md/);
rejects('rejects a falsely verified external URL inventory',{edit:{'docs/reference/HISTORICAL-SOURCE-INVENTORY.md':s=>s.replace('live link, license and content checks NOT_RUN','live link, license and content checks PASS')}},/historical link extraction cannot claim live verification/);

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
rejects('rejects premature Nx configuration',{add:{'nx.json':'{}'}},/stage 4\+ projects/);
rejects('rejects a missing exact source baseline file',{del:['docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md']},/required docs\/reference\/TOOLCHAIN-SOURCE-VERSIONS.md/);
