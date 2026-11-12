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
const files=[
 'AGENTS.md','REPOSITORY-STRUCTURE.md','.coderabbit.yaml','governance/README.md',
 ...owners.map(owner=>'governance/'+owner+'.md'),'docs/REFOUNDATION-PLAN.md','docs/reference/README.md',
 '.github/workflows/foundation-guard.yml','tools/governance/verify-foundation.mjs','tools/governance/verify-foundation.test.mjs'
];
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
