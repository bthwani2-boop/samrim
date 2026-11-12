#!/usr/bin/env node
// Structural, adversarially tested refoundation policy guard.
// IMPORTANT: a passing check is NOT semantic, legal, financial or runtime approval.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args=process.argv.slice(2);
if(args.length!==0 && (args.length!==2 || args[0]!=='--root')) throw Error('usage: node verify-foundation.mjs [--root PATH]');
const root=path.resolve(args.length?args[1]:scriptRoot);
const owners=['product','platform','architecture','identity','stores','catalog','commerce','fulfillment','finance','hr','experience','safety','engineering','journeys'];
const domainFiles=owners.map(name=>'governance/'+name+'.md');
const required=[
 'AGENTS.md','REPOSITORY-STRUCTURE.md','.coderabbit.yaml','governance/README.md',...domainFiles,'docs/REFOUNDATION-PLAN.md','docs/reference/README.md','docs/reference/HISTORICAL-SOURCE-INVENTORY.md','docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md',
 '.specify/init-options.json','.specify/integration.json','.specify/integrations/speckit.manifest.json','.specify/memory/constitution.md',
 '.github/workflows/foundation-guard.yml','tools/governance/verify-foundation.mjs','tools/governance/verify-foundation.test.mjs'
];
const fail=(reason)=>{ throw Error('FOUNDATION_GATE_FAIL: '+reason); };
const exists=(p)=>fs.existsSync(path.join(root,...p.split('/')));
const get=(p)=>{
 const q=path.join(root,...p.split('/'));
 const s=fs.lstatSync(q);
 if(!s.isFile()||s.isSymbolicLink())fail('unsafe/nonfile '+p);
 const b=fs.readFileSync(q);
 if(!b.length||(b[0]===0xef&&b[1]===0xbb&&b[2]===0xbf))fail('empty or BOM '+p);
 const value=new TextDecoder('utf-8',{fatal:true}).decode(b);
 if(/\r(?!\n)/.test(value)||value.includes('\ufffd'))fail('bad text encoding '+p);
 return value;
};
const contents={};
for(const p of required){
 try {contents[p]=get(p);}catch(error){fail('required '+p+': '+error.message);}
}
const agent=contents['AGENTS.md'],repo=contents['REPOSITORY-STRUCTURE.md'];
// The official Spec Kit installer owns CLI scaffolding. This compatibility router is not another constitution.
const init = JSON.parse(contents['.specify/init-options.json']);
const integration = JSON.parse(contents['.specify/integration.json']);
const manifest = JSON.parse(contents['.specify/integrations/speckit.manifest.json']);
const adapter = contents['.specify/memory/constitution.md'];
if(init.integration!=='none'||init.script!=='ps'||integration.default_integration!=='none'||integration.integration!=='none')
 fail('Spec Kit foundation must use agent-neutral PowerShell integration');
if(!/^\d+\.\d+\.\d+$/.test(init.speckit_version)||init.speckit_version!==integration.version||init.speckit_version!==manifest.version)
 fail('Spec Kit generated assets/integration version mismatch');
if(!/^ARTIFACT_CLASS: DERIVED_SPEC_KIT_ROUTER$/m.test(adapter)||!/^SEMANTIC_AUTHORITY: NONE$/m.test(adapter)
 || !adapter.includes('governance/README.md') || !adapter.includes('AGENTS.md')
 || !adapter.includes('REPOSITORY-STRUCTURE.md') || adapter.includes('[PRINCIPLE_1_NAME]')
 || adapter.includes('docs/governance/README.md'))
 fail('Spec Kit constitution is not a nonauthoritative router to canonical owners');
if(!manifest.files||typeof manifest.files!=='object'||Object.keys(manifest.files).length<8)
 fail('Spec Kit bundled asset provenance manifest missing');
for(const [asset,expectedHash] of Object.entries(manifest.files)){
 if(!asset.startsWith('.specify/')||asset.includes('..')||!/^[a-f0-9]{64}$/.test(expectedHash))fail('unsafe Spec Kit manifest entry: '+asset);
 const absolute=path.join(root,...asset.split('/'));
 if(!fs.existsSync(absolute)||!fs.statSync(absolute).isFile())fail('Spec Kit asset missing: '+asset);
 const actualHash=createHash('sha256').update(fs.readFileSync(absolute)).digest('hex');
 if(actualHash!==expectedHash)fail('Spec Kit vendor asset modified/mismatched: '+asset);
}

const rabbit=contents['.coderabbit.yaml'];
if(!/^inheritance: true$/m.test(rabbit)||!/^\s*auto_review:\s*$/m.test(rabbit)||!/\s*enabled: true\s*$/m.test(rabbit))fail('CodeRabbit local review configuration must not be silently disabled');
const gov=contents['governance/README.md'],plan=contents['docs/REFOUNDATION-PLAN.md'];
if(!/^BUSINESS_POLICY_AUTHORITY: NONE$/m.test(contents['docs/reference/README.md']))fail('external research index cannot become policy authority');
if(!/^BUSINESS_POLICY_AUTHORITY: NONE$/m.test(contents['docs/reference/HISTORICAL-SOURCE-INVENTORY.md']) || !/^VERIFICATION: URL extraction only; live link, license and content checks NOT_RUN$/m.test(contents['docs/reference/HISTORICAL-SOURCE-INVENTORY.md']))fail('historical link extraction cannot claim live verification or policy authority');

const controlIndex=contents['docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md'];
if(!/^ARTIFACT_CLASS: NON_AUTHORITATIVE_SOURCE_INVENTORY$/m.test(controlIndex) || !/^BUSINESS_POLICY_AUTHORITY: NONE$/m.test(controlIndex)
 || !/^SOURCE_EXECUTION_STATE: UNVERIFIED_ON_HEAD_16$/m.test(controlIndex))
 fail('historical Control Panel trace cannot become Product policy or current execution proof');
const controlIDs=[...controlIndex.matchAll(/^\| (R\d{3}) \|/gm)].map(m=>m[1]);
const controlSet=new Set(controlIDs);
if(controlIDs.length!==112||controlSet.size!==112||Array.from({length:112},(_,i)=>'R'+String(i+1).padStart(3,'0')).some(x=>!controlSet.has(x)))
 fail('historical Control Panel source ID inventory must retain 112 unique IDs');

if(!/^STATUS: ACTIVE_FOR_FOUNDATION_ONLY$/m.test(agent))fail('agent must declare foundation-only state');
if(!/^STATUS: ACTIVE_FOR_FOUNDATION_ONLY$/m.test(repo))fail('placement law must declare foundation-only state');
if(!/^GOVERNANCE_CUTOVER: NOT_READY$/m.test(gov))fail('do not mark governance ready without independent semantic/risk acceptance');
if(!/^BUSINESS_DECISION_AUTHORITY: NONE_WHILE_NOT_READY$/m.test(gov))fail('no competing policy authority during reconstruction');
if(!/^STATUS: IN_PROGRESS_FOUNDATION$/m.test(plan))fail('temporary plan must remain in progress');
if(!agent.includes('governance/README.md')||!agent.includes('REPOSITORY-STRUCTURE.md')||!agent.includes('NOT_READY'))fail('agent must know the unfinished governance target');
if(!agent.includes('Policy-first')&&!agent.includes('Policy-first for legitimate'))fail('agent must require owner-backed configurable business rules');
if(!repo.includes('docs/governance/')||!repo.includes('governance/'))fail('placement must explain clean policy root');
if(!plan.includes('D01')||!plan.includes('Phase 2')||!plan.includes('NOT_RUN'))fail('plan must expose reconciliation and unexecuted scope');

for(const [filename,content] of domainFiles.map(p=>[p,contents[p]])){
 if(!/^STATUS: DRAFT_PENDING_FULL_GOVERNANCE_CUTOVER$/m.test(content))fail('draft status absent: '+filename);
 if(!/^IMPLEMENTATION_STATE_AUTHORITY: NONE$/m.test(content))fail('domain document claims implementation authority: '+filename);
 if(!content.includes('SEMANTIC_OWNER: '+filename))fail('domain semantic owner marker mismatch: '+filename);
 if(content.length<550)fail('empty/skeletal domain document: '+filename);
}

// This is a cross-check against the ONE Product admission table, not another capability catalog.
// The Product table is source; domain owner sections must account for it exactly once.
const product=contents['governance/product.md'];
const expected=new Map();
for(const line of product.split(/\r?\n/)){
 const row=line.match(/^\|\s*`([a-z]+\.md)`\s*\|\s*(.*?)\s*\|\s*$/);
 if(!row)continue;
 const owner='governance/'+row[1];
 if(!domainFiles.includes(owner))fail('Product capability routed to unknown owner '+owner);
 const items=[...row[2].matchAll(/`([A-Z][A-Z_]+)`/g)].map(m=>m[1]);
 for(const id of items){
  if(expected.has(id))fail('Product duplicates capability '+id);
  expected.set(id,owner);
 }
}
if(expected.size!==26)fail('Product admission set must enumerate 26 unique capabilities; observed '+expected.size);
const seen=new Map();
for(const file of domainFiles){
 const source=contents[file];
 for(const match of source.matchAll(/^CAPABILITY_ID:\s*([A-Z][A-Z_]+)\s*$/gm)){
  const id=match[1];
  if(seen.has(id))fail('duplicate capability owner '+id+' '+seen.get(id)+' '+file);
  if(!expected.has(id))fail('capability not present in Product admission set '+id);
  if(expected.get(id)!==file)fail('wrong capability owner '+id+' expected '+expected.get(id)+' got '+file);
  // Require a real section, not just an ID token in arbitrary prose.
  const prefix=source.slice(0,match.index);
  const header=prefix.split(/\r?\n/).reverse().find(line=>/^## /.test(line));
  if(!header||!header.includes(id))fail('capability needs own titled section: '+id);
  const after=source.slice(match.index+match[0].length).split(/\n## /,1)[0];
  if(after.trim().length<120)fail('capability section is empty or token-only: '+id);
  seen.set(id,file);
 }
}
if(seen.size!==expected.size)fail('unmapped capabilities: '+[...expected.keys()].filter(k=>!seen.has(k)).join(','));

const journeys=contents['governance/journeys.md'];
const sections=[...journeys.matchAll(/^## ([A-Z][A-Z_]+) —[^\r\n]*$/gm)];
const journeyIds=new Set();
for(let i=0;i<sections.length;i++){
 const [heading,id]=[sections[i][0],sections[i][1]];
 const section=journeys.slice(sections[i].index,sections[i+1]?.index??journeys.length);
 const matches=[...section.matchAll(/^JOURNEY_ID:\s*([A-Z_]+)$/gm)];
 if(matches.length!==1||matches[0][1]!==id)fail('journey heading/id mismatch: '+id);
 if(journeyIds.has(id))fail('duplicate Journey ID: '+id);
 journeyIds.add(id);
 if(!/^SURFACES:\s*\S+/m.test(section)||!/^OWNERS:\s*\S+/m.test(section)||!/^ENTRY:\s*\S+/m.test(section)
  ||!/^EXIT:\s*\S+/m.test(section)||!/^READBACK:\s*\S+/m.test(section)||section.length<450)
  fail('missing material journey evidence boundary: '+id);
}
if(journeyIds.size!==16)fail('expected 16 named source-reconciled journeys: observed '+journeyIds.size);
for(const id of ['FIRST_THREE_ORDER_CONTACT','ORDER_SCOPED_OPERATIONS_EXCEPTION','PARTNER_COMMISSION_REMITTANCE','BENEFICIARY_SETTLEMENT']){
 if(!journeyIds.has(id))fail('material historical journey lost: '+id);
}
const experience=contents['governance/experience.md'];
if(!experience.includes('WCAG 2.2 AA')||!/saved views/i.test(experience)||!experience.includes('owner-side search/filter/sort'))
 fail('operator experience missing accessible/at-scale acceptance boundaries');
const catalog=contents['governance/catalog.md'];
if(!catalog.includes('الأكثر رواجًا')||!catalog.includes('distinct canonically completed Store Orders')||!catalog.includes('Operator Policies'))
 fail('canonical popularity read model or Operator-managed ranking window lost');


const arch=contents['governance/architecture.md'];
const finance=contents['governance/finance.md'];
const delivery=contents['governance/fulfillment.md'];
const engineering=contents['governance/engineering.md'];
if(!arch.includes('policy')||!arch.includes('Operator Policies')||!arch.includes('one canonical engine'))fail('architecture policy/single-engine boundary missing');
if(!finance.includes('PLATFORM_MANAGED')||!finance.includes('STORE_MANAGED')||!finance.includes('COMMISSION')||!finance.includes('SUBSCRIPTION'))fail('finance must distinguish collection responsibility and fees');
if(!delivery.includes('DIRECT')||!delivery.includes('BTHWANI_CAPTAIN')||!delivery.includes('WLT'))fail('fulfillment must address relation-independent safety gates');
if(!engineering.includes('ADD NOW')||!engineering.includes('DEFER')||!engineering.includes('DO NOT ADD'))fail('engineering must distinguish mutable rules from invariants');
const policySections=[
 ['governance/commerce.md','## Operator-managed commercial thresholds — explicit policy, not compiled law'],
 ['governance/fulfillment.md','## Operator-managed dispatch and location thresholds'],
 ['governance/catalog.md','## Owner-backed merchandising and media limits'],
 ['governance/finance.md','## Operator-managed financial values versus immutable accounting rules'],
 ['governance/engineering.md','## Mandatory operator-policy inventory at implementation time']
];
for(const [owner,heading] of policySections){
 if(!contents[owner].includes(heading))fail('owner-backed configurable-values section missing: '+owner);
}


for(const p of ['docs/governance','CODEOWNERS','.github/CODEOWNERS','docs/CODEOWNERS']){
 if(exists(p))fail('forbidden duplicate governance or unneeded CODEOWNERS: '+p);
}
for(const p of ['.github/workflows/fast-guard.yml','.github/workflows/sonar-observe.yml','.github/workflows/fast-guard-routing.test.mjs']){
 if(exists(p))fail('source-dependent inherited CI remains executable in foundation-only tree: '+p);
}
if(exists('services')||exists('apps'))fail('foundation guard cannot be reused as full-app proof');

const ci=contents['.github/workflows/foundation-guard.yml'];
if(!/permissions:\s*\n\s*contents: read/.test(ci))fail('CI must run with least privilege');
if(!ci.includes('node --test tools/governance/verify-foundation.test.mjs')||!ci.includes('node tools/governance/verify-foundation.mjs'))fail('CI must run actual guard tests and live verification');
if(/continue-on-error:\s*true|\bsecrets\./.test(ci))fail('CI cannot silently skip proof or read secrets in foundation stage');

console.log('FOUNDATION_STRUCTURE_PASS domain_owners='+domainFiles.length+' capability_ids='+seen.size+' one_census=true');
console.log('GOVERNANCE_CUTOVER_NOT_READY: semantic donor reconciliation, risk review and product runtime gates not proven');
