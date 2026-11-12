#!/usr/bin/env node
// Foundation-only verifier: validates local stage constraints, not product readiness.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args=process.argv.slice(2);
if(args.length!==0 && (args.length!==2 || args[0]!=='--root')) throw Error('usage: node verify-foundation.mjs [--root PATH]');
const root=path.resolve(args.length ? args[1] : scriptRoot);
const required=['AGENTS.md','REPOSITORY-STRUCTURE.md','governance/README.md','governance/finance.md','docs/REFOUNDATION-PLAN.md','.github/workflows/foundation-guard.yml','tools/governance/verify-foundation.mjs','tools/governance/verify-foundation.test.mjs'];
const oldWorkflow=['.github/workflows/fast-guard.yml','.github/workflows/sonar-observe.yml','.github/workflows/fast-guard-routing.test.mjs'];
const get=(p)=>{
  const q=path.join(root,...p.split('/'));
  const s=fs.lstatSync(q);
  if(!s.isFile() || s.isSymbolicLink()) throw Error('unsafe/nonfile: '+p);
  const b=fs.readFileSync(q);
  if(b.length===0 || (b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf)) throw Error('empty or BOM: '+p);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(b);
  if(/\r(?!\n)/.test(text)||text.includes('\ufffd')) throw Error('invalid text: '+p);
  return text;
};
function fail(message){throw Error('FOUNDATION_GATE_FAIL: '+message);}
let contents={};
for(const p of required){try{contents[p]=get(p);}catch(e){fail(p+': '+e.message);}}
const agent=contents['AGENTS.md'];
const repo=contents['REPOSITORY-STRUCTURE.md'];
const gov=contents['governance/README.md'];
const finance=contents['governance/finance.md'];
const plan=contents['docs/REFOUNDATION-PLAN.md'];
if(!/^STATUS: ACTIVE_FOR_FOUNDATION_ONLY$/m.test(agent))fail('agent must declare foundation-only state');
if(!/^STATUS: ACTIVE_FOR_FOUNDATION_ONLY$/m.test(repo))fail('placement law must declare foundation-only state');
if(!/^GOVERNANCE_CUTOVER: NOT_READY$/m.test(gov))fail('do not mark governance ready without complete domain owners');
if(!/^BUSINESS_DECISION_AUTHORITY: NONE_WHILE_NOT_READY$/m.test(gov))fail('do not create competing mutable governance authority');
if(!/^STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER$/m.test(finance) || !/^IMPLEMENTATION_STATE_AUTHORITY: NONE$/m.test(finance))fail('finance draft cannot claim active policy or implementation authority');
if(!finance.includes('PLATFORM_MANAGED') || !finance.includes('STORE_MANAGED') || !finance.includes('COMMISSION') || !finance.includes('SUBSCRIPTION'))fail('finance draft must distinguish fee model and collection ownership');
if(!/^STATUS: IN_PROGRESS_FOUNDATION$/m.test(plan))fail('plan must mark incomplete scope');
if(!agent.includes('governance/README.md')||!agent.includes('REPOSITORY-STRUCTURE.md')||!agent.includes('NOT_READY'))fail('agent must route to one unfinished target');
if(!repo.includes('docs/governance/')||!repo.includes('governance/'))fail('placement must explain removed donor path and canonical new root');
if(!plan.includes('D01')||!plan.includes('Phase 2')||!plan.includes('NOT_RUN'))fail('plan must expose conflicts, pending cutover and unexecuted scope');
for(const p of oldWorkflow)if(fs.existsSync(path.join(root,...p.split('/'))))fail('code-dependent inherited workflow remains executable in foundation-only tree: '+p);
const ci=contents['.github/workflows/foundation-guard.yml'];
if(!/permissions:\s*\n\s*contents: read/.test(ci))fail('CI must be least privilege');
if(!ci.includes('node --test tools/governance/verify-foundation.test.mjs')||!ci.includes('node tools/governance/verify-foundation.mjs'))fail('CI must run tests and live verifier');
if(/continue-on-error:\s*true|\bsecrets\./.test(ci))fail('CI cannot quietly skip proof or access secrets in foundation stage');
const oldPath=path.join(root,'docs','governance');
if(fs.existsSync(oldPath))fail('obsolete governance directory must not exist in clean candidate');
for(const codeowners of ['CODEOWNERS','.github/CODEOWNERS','docs/CODEOWNERS']) {
 if(fs.existsSync(path.join(root,...codeowners.split('/'))))fail('solo project does not require CODEOWNERS: '+codeowners);
}
if(fs.existsSync(path.join(root,'services'))||fs.existsSync(path.join(root,'apps')))fail('foundation-only gate cannot be reused as full application proof');
console.log('FOUNDATION_STRUCTURE_PASS required='+required.length+' obsolete_policy_root_absent=true');
console.log('GOVERNANCE_CUTOVER_NOT_READY; PRODUCT_SQL_RUNTIME_CI_NOT_RUN');
