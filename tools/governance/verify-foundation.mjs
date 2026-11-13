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
const contractPathGroups={
 identity: [
  'actor-legal-name',
  'client-auth',
  'internal-actor-administration',
  'managed-enrollment-auth',
  'operator-passkey-access',
  'runtime',
  'session'
 ],
 dsh: [
  'stores',
  'catalog',
  'offers',
  'cart',
  'orders',
  'fulfillment',
  'employees',
  'runtime',
  'locations',
  'serviceability',
  'store-access',
  'store-publication',
  'captains',
  'order-conversations',
  'promotions',
  'discovery-content',
  'notifications',
  'client-shares',
  'operational-policies',
  'financial-views',
  'customer-discovery'
 ],
 wlt: [
  'runtime',
  'payment-intents',
  'wallets',
  'funding',
  'ledger',
  'cash-custody',
  'fee-policies',
  'commercial-agreements',
  'earnings-receivables',
  'beneficiaries',
  'payouts',
  'settlements',
  'reconciliation',
  'financial-reporting'
 ]
};
const required=[
 'AGENTS.md','REPOSITORY-STRUCTURE.md','.coderabbit.yaml','governance/README.md',...domainFiles,'docs/REFOUNDATION-PLAN.md','docs/reference/README.md','docs/reference/HISTORICAL-SOURCE-INVENTORY.md','docs/reference/HISTORICAL-CONTROL-PANEL-REQUIREMENTS.md',
 '.specify/init-options.json','.specify/integration.json','.specify/integrations/speckit.manifest.json','.specify/memory/constitution.md',
 '.github/workflows/foundation-guard.yml','tools/governance/verify-foundation.mjs','tools/governance/verify-foundation.test.mjs',
 'tools/governance/review-examples.test.mjs',
 '.node-version','.nvmrc','.go-version','.editorconfig','.gitattributes','.gitignore',
 'package.json','pnpm-workspace.yaml','pnpm-lock.yaml','tsconfig.base.json','biome.json',
 'README.md','services/identity/README.md','services/dsh/README.md','services/wlt/README.md',
 ...['identity','dsh','wlt'].flatMap(owner=>['package.json','tsconfig.json','clients/README.md','clients/index.ts','contracts/openapi/README.md','contracts/openapi/'+owner+'.openapi.yaml'].map(file=>'services/'+owner+'/'+file)),
 ...Object.entries(contractPathGroups).flatMap(([owner,groups])=>groups.map(name=>'services/'+owner+'/contracts/openapi/paths/'+name+'.yaml')),
 'docs/reference/OPENAPI-DONOR-CONTRACT-INVENTORY.md',
 'docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md','docs/reference/MOBILE-FOUNDATION-SOURCE-MANIFESTS.json','tools/dev/verify-workspace.mjs','tools/mobile/verify-app-foundations.mjs'
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

const stage3package=JSON.parse(contents['package.json']);
const nodepin=contents['.node-version'].trim();
const gopin=contents['.go-version'].trim();
if(nodepin!=='24.22.1'||contents['.nvmrc'].trim()!==nodepin||gopin!=='1.27.3')
 fail('source-matching Node/Go pins missing or upgraded in stage 3');
if(stage3package.packageManager!=='pnpm@12.15.0'||
 stage3package.engines.node!=='>=24.17.0 <25'||
 stage3package.engines.pnpm!=='12.15.0'||
 stage3package.private!==true)
 fail('branch-41 pnpm/Node versions changed or workspace made publishable');
if(JSON.stringify(Object.entries(stage3package.devDependencies??{}).sort())!==
 JSON.stringify([['@biomejs/biome','2.5.12'],['typescript','7.0.2']]))
 fail('Stage-3 root dependencies must match original exact TypeScript/Biome versions with no extras');
const wsyaml=contents['pnpm-workspace.yaml'];
for(const key of ['"apps/*"','"packages/*"','"services/*"','autoInstallPeers: false','engineStrict: true',
 'saveExact: true','nodeLinker: isolated','strictPeerDependencies: true']){
 if(!wsyaml.includes(key))fail('stage3 pnpm workspace changed expected setting: '+key);
}
if(/nxCloudId:/.test(wsyaml))fail('Nx Cloud must not be adopted');
if(!wsyaml.includes("'@rc-component/util@1.14.0': patches/@rc-component__util@1.14.0.patch"))
 fail('Donor Ant Design CSP patch must remain exact and documented');
const lock=contents['pnpm-lock.yaml'];
for(const key of ["lockfileVersion: '9.0'","specifier: 12.15.0",
 "specifier: 7.0.2","specifier: 2.5.12",
 "typescript@7.0.2:","'@biomejs/biome@2.5.12':"]){
 if(!lock.includes(key))fail('stage3 lockfile incomplete or version drift: '+key);
}
const tsconfig=JSON.parse(contents['tsconfig.base.json']);
if(tsconfig.compilerOptions.strict!==true||tsconfig.compilerOptions.noEmit!==true)
 fail('stage3 base TypeScript must retain strict/non-emitting policy');
const biome=JSON.parse(contents['biome.json']);
if(biome.linter.enabled!==true||biome.formatter.enabled!==false)
 fail('reuse original Biome instead of duplicating ESLint/formatter');
const ref=contents['docs/reference/TOOLCHAIN-SOURCE-VERSIONS.md'];
if(!/^BUSINESS_POLICY_AUTHORITY: NONE$/m.test(ref)||!ref.includes('1.27.1')||!ref.includes('1.27.3')||
 !ref.includes('24.0.1')||!ref.includes('58.0.19'))
 fail('non-governing donor toolchain provenance or mismatch disclosure missing');
if(!contents['README.md'].includes('Stage 4')||!contents['tools/dev/verify-workspace.mjs'].includes('STAGE4_WORKSPACE_STRUCTURE_PASS'))
 fail('stage4 developer onboarding or workspace smoke verifier missing');
for(const folder of ['contracts','infra','nx.json','go.work']){
 if(exists(folder))fail('stage 5+ service/DB/infra introduced prematurely: '+folder);
}

// The structural contract slice permits exact OpenAPI 3.1 entrypoints and named
// domain path placeholders across all three owners, never operations, refs, Go or SQL.

const serviceOwners=['identity','dsh','wlt'];
const openapiReservedGroups=Object.values(contractPathGroups).reduce((sum,groups)=>sum+groups.length,0);
const allowedServiceDirs=new Set();
const allowedServiceFiles=new Set();
for(const owner of serviceOwners){
 const prefix='services/'+owner;
 for(const suffix of ['', '/backend','/clients','/clients/go','/clients/generated',
   '/contracts','/contracts/openapi','/contracts/openapi/paths',
   '/database','/database/migrations']){
  allowedServiceDirs.add(prefix+suffix);
 }
 for(const suffix of ['/README.md','/package.json','/tsconfig.json',
   '/clients/README.md','/clients/index.ts','/contracts/openapi/README.md',
   '/contracts/openapi/'+owner+'.openapi.yaml'])allowedServiceFiles.add(prefix+suffix);
 for(const moduleName of contractPathGroups[owner])
  allowedServiceFiles.add(prefix+'/contracts/openapi/paths/'+moduleName+'.yaml');
 const readme=prefix+'/README.md';
 const doc=contents[readme];
 const contractFile=prefix+'/contracts/openapi/'+owner+'.openapi.yaml';
 const contractName=owner==='identity'?'Identity':owner.toUpperCase();
 const expectedContract='openapi: 3.1.0\ninfo:\n  title: BThwani '+contractName+
   ' API\n  version: 0.0.0\n  description: Contract scaffold only; no operations are defined or approved.\npaths: {}\n';
 if(contents[contractFile]!==expectedContract)
  fail('OpenAPI scaffold mutated or contains unapproved operations/refs: '+contractFile);
 const contractReadme=contents[prefix+'/contracts/openapi/README.md'];
 if(!/^STATUS: CONTRACT_SCAFFOLD_ONLY$/m.test(contractReadme) ||
    !/^EXECUTION: NOT_STARTED$/m.test(contractReadme) ||
    !contractReadme.includes('no server, no security scheme') ||
    !contractReadme.includes('not arbitrary OpenAPI validity'))
  fail('invalid contract scaffold documentation: '+owner);
 for(const moduleName of contractPathGroups[owner]){
  const moduleFile=prefix+'/contracts/openapi/paths/'+moduleName+'.yaml';
  if(contents[moduleFile]!=='paths: {}\n')
   fail('OpenAPI path fragment is not an empty placeholder: '+moduleFile);
 }
 if(!doc.includes('OWNER: '+(owner==='identity'?'Identity':owner.toUpperCase())) ||
    !/^STATUS: SCAFFOLD_ONLY$/m.test(doc) || !/^EXECUTION: NOT_STARTED$/m.test(doc) ||
    !['backend/','contracts/openapi/','database/'].every(s=>doc.includes(s))){
  fail('invalid service placement README: '+readme);
 }
 const pkgPath=prefix+'/package.json';
 const packageConfig=JSON.parse(contents[pkgPath]);
 if(packageConfig.name!=='@bthwani/'+owner ||
   packageConfig.version!=='0.0.0' || packageConfig.private!==true ||
   packageConfig.type!=='module' || packageConfig.types!=='./clients/index.ts' ||
   JSON.stringify(packageConfig.exports)!==JSON.stringify({'.':{types:'./clients/index.ts',default:'./clients/index.ts'}}) ||
   JSON.stringify(packageConfig.scripts)!==JSON.stringify({typecheck:'tsc --noEmit -p tsconfig.json'}) ||
   JSON.stringify(packageConfig.devDependencies)!==JSON.stringify({typescript:'7.0.2'}) ||
   ['dependencies','peerDependencies','optionalDependencies','bin','main'].some(key=>key in packageConfig)){
  fail('service package drift or premature runtime dependency: '+pkgPath);
 }
 const configPath=prefix+'/tsconfig.json';
 const ts=JSON.parse(contents[configPath]);
 if(ts.extends!=='../../tsconfig.base.json' ||
   JSON.stringify(ts.compilerOptions)!==JSON.stringify({noEmit:true}) ||
   JSON.stringify(ts.include)!==JSON.stringify(['clients/**/*.ts','clients/**/*.tsx']) ||
   JSON.stringify(ts.exclude)!==JSON.stringify(['node_modules'])){
  fail('service TypeScript configuration drift: '+configPath);
 }
 const markerPath=prefix+'/clients/index.ts';
 if(contents[markerPath]!=='// Empty contract-bound entrypoint. Add exports only with an approved client implementation.\nexport {};\n'){
  fail('premature client behavior or export: '+markerPath);
 }
 const clientDoc=contents[prefix+'/clients/README.md'];
 if(!/^STATUS: SCAFFOLD_ONLY$/m.test(clientDoc) || !clientDoc.includes('no usable operations')){
  fail('client library falsely claims implementation: '+prefix+'/clients/README.md');
 }
 if(!new RegExp('^  services/'+owner+':\\n    devDependencies:\\n      typescript:\\n        specifier: 7\\.0\\.2\\n        version: 7\\.0\\.2$', 'm').test(lock)){
  fail('service missing exact frozen-lockfile importer: '+owner);
 }
}
const servicesPath=path.join(root,'services');
if(!fs.existsSync(servicesPath)||!fs.lstatSync(servicesPath).isDirectory())
 fail('service placement directory missing or unsafe');
function inspectServiceFolders(dir){
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const absolute=path.join(dir,entry.name);
  const relative=path.relative(root,absolute).split(path.sep).join('/');
  const stat=fs.lstatSync(absolute);
  if(stat.isSymbolicLink())fail('unsafe service symlink: '+relative);
  // pnpm-managed local dependency links are generated, ignored and never business source.
  if(serviceOwners.some(owner=>relative==='services/'+owner+'/node_modules')){
   if(!stat.isDirectory())fail('unsafe service dependency directory: '+relative);
   continue;
  }
  if(stat.isDirectory()){
   if(!allowedServiceDirs.has(relative))fail('unadmitted service directory: '+relative);
   inspectServiceFolders(absolute);
  }else if(!stat.isFile()||!allowedServiceFiles.has(relative)){
   fail('premature service source: '+relative);
  }
 }
}
inspectServiceFolders(servicesPath);


// Validate real in-repository Markdown links instead of accepting a green
// capability census with broken local onboarding and governance references.
for (const sourcePath of required.filter(p => p.endsWith('.md'))) {
  const doc = contents[sourcePath];
  for (const match of doc.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)/g)) {
    const raw = match[1].trim().split(/\s+["']/)[0];
    if (/^(?:https?:\/\/|mailto:|#)/i.test(raw)) continue;
    const pathname = raw.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { fail('invalid local Markdown link in ' + sourcePath); }
    const resolved = path.resolve(root, path.dirname(sourcePath), decoded);
    if (!resolved.startsWith(root + path.sep) && resolved !== root) {
      fail('local Markdown link escapes workspace: ' + sourcePath + ' -> ' + pathname);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      fail('broken local Markdown link: ' + sourcePath + ' -> ' + pathname);
    }
  }
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
if(!/^STATUS: ACTIVE_FOR_FOUNDATION_AND_PRESENTATION_SHELLS$/m.test(repo))fail('placement law must declare Stage-4 foundation shell scope');
if(!/^GOVERNANCE_CUTOVER: NOT_READY$/m.test(gov))fail('do not mark governance ready without independent semantic/risk acceptance');
if(!gov.includes('## Cutover readiness is a policy decision, not a claim of implemented software'))fail('governance policy readiness must stay separate from later runtime implementation tests');
if(!/^BUSINESS_DECISION_AUTHORITY: NONE_WHILE_NOT_READY$/m.test(gov))fail('no competing policy authority during reconstruction');
if(!/^STATUS: IN_PROGRESS_FOUNDATION$/m.test(plan))fail('temporary plan must remain in progress');
if(!agent.includes('governance/README.md')||!agent.includes('REPOSITORY-STRUCTURE.md')||!agent.includes('NOT_READY'))fail('agent must know the unfinished governance target');
if(!agent.includes('Policy-first')&&!agent.includes('Policy-first for legitimate'))fail('agent must require owner-backed configurable business rules');
if(!repo.includes('docs/governance/')||!repo.includes('governance/'))fail('placement must explain clean policy root');
if(!plan.includes('D01')||!plan.includes('Phase 2')||!plan.includes('NOT_RUN'))fail('plan must expose reconciliation and unexecuted scope');

// This crosswalk is a temporary documentary review ledger in the one execution plan,
// NOT a second Product-admission source or confirmation of implemented features.
const startMarker='### 2026-11-12 — Per-ID reconciliation of the 112 historical Control Panel requirements';
const startAt=plan.indexOf(startMarker);
if(startAt<0)fail('historical 112-row decision crosswalk missing from temporary plan');
const reviewChunk=plan.slice(startAt);
const parsedRows=[...reviewChunk.matchAll(/^\| (R\d{3}) \| `([A-Z_]+)` \| `([^\r\n|]+)` \| ([^\r\n|]{5,}) \|$/gm)];
const approvedLabels=new Set(['DRAFT_ALIGNED_OWNER','POLICY_REFRAMED','CONDITIONAL_CANDIDATE','HISTORICAL_ONLY','MIXED_REFRAME_RETIRE','INDEPENDENT_RISK_REVIEW']);
const crosswalkIDs=parsedRows.map(x=>x[1]);
if(parsedRows.length!==112||new Set(crosswalkIDs).size!==112||controlIDs.some(x=>!crosswalkIDs.includes(x)))
 fail('temporary plan must classify all 112 historical source IDs exactly once');
for(const row of parsedRows){
 if(!approvedLabels.has(row[2]))fail('unrecognized documentary classification for '+row[1]);
 if(/PASS|PROVEN|IMPLEMENTED/.test(row[2]))fail('historical document disposition must not claim implementation '+row[1]);
}


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
const storeDocs=contents['governance/stores.md'];
for(const state of ['OPEN_FOR_ORDERS','CLOSED_BY_SCHEDULE','PAUSED','OPERATIONALLY_UNAVAILABLE']){
 if(!storeDocs.includes(state))fail('DSH Store orderability distinction missing: '+state);
}
for(const mode of ['BTHWANI_CAPTAIN','PARTNER_CAPTAIN','CUSTOMER_PICKUP']){
 if(!contents['governance/commerce.md'].includes(mode))fail('canonical DSH fulfillment-mode meaning lost: '+mode);
}
for(const economic of ['PLATFORM_CASH_IN_PROVIDER_FEE_EXPENSE','PLATFORM_DELIVERY_MARGIN_INCOME','RECIPIENT_REVIEW_REQUIRED','FINALIZED','REMITTED']){
 if(!contents['governance/finance.md'].includes(economic))fail('historic WLT money/recipient preservation missing: '+economic);
}
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

const currentDesign=contents['governance/experience.md'];
for(const anchor of ['## DESIGN-01 — Exclusive rendering, token and theme authority',
 '## DESIGN-02 — Studio is a bounded editor, not an additional publication engine',
 '## DESIGN-03 — Exclusive Operator navigation and Policies/Studio split']){
 if(!currentDesign.includes(anchor))fail('reconciled design owner decision missing: '+anchor);
}
for(const invariant of ['packages/design-system/src/brand/colors.ts','packages/tamagui-config',
 'AntDesignProvider','createTamagui(defaultConfig)','CLIENT_HOME','no arbitrary JS/CSS']){
 if(!currentDesign.includes(invariant))fail('design-source/Studio boundary erased: '+invariant);
}
const surfaces=contents['governance/platform.md'];
if(!surfaces.includes('## SURFACE-01 — Canonical internal app names versus immutable external identity'))
 fail('four app identity mapping is missing');
for(const atom of ['apps/customer','apps/merchant','apps/captain','apps/control-panel',
 'com.bthwani.client','com.bthwani.partner','com.bthwani.captain',
 '4adf3184-fc07-4186-b49e-0dc821a5ab73',
 'bcd22a76-d4b2-4de0-93b3-f6d13074a802',
 '7efa39e1-895f-44d7-a597-d613c79297b6']){
 if(!surfaces.includes(atom))fail('original external identity/internal naming missing: '+atom);
}
for(const clause of ['## API-01 — OpenAPI organization and semantic-equivalence gate',
 '## SQL-01 — Safe one-baseline-per-owner fresh bootstrap, protected upgrades',
 '## POLICY-IMPLEMENTATION — Changeable parameter discovery and validation boundary']){
 if(!engineering.includes(clause))fail('approved API/SQL/policy governance decision missing: '+clause);
}
for(const preservation of ['182 DSH + 30 Identity + 63 WLT = 275','go:embed migrations/*.sql',
 'one derived Fresh Baseline','no code deployment']){
 if(!engineering.includes(preservation) && !contents['governance/architecture.md'].includes(preservation))
 fail('migration/configurable policy preservation constraint missing: '+preservation);
}
const concordance=plan.slice(plan.indexOf('## 2026-11-12 — Design refoundation plan: 24-section decision concordance'));
const sourceSections=[...concordance.matchAll(/^\| (0[1-9]|1[0-9]|2[0-4]) [^|\r\n]+ \| (ADOPT_BOUNDED|REFRAME_APPROVED|REFRAME_APPROVED_WITH_CAPABILITY_GATE|SUPERSEDE_INTERNAL_NAME|IMPLEMENTATION_DEFERRED|PARTIAL_DECISION|ADOPT_APPROVED|ADOPT_WITH_INDEPENDENT_RISK_GATE|ADOPT_APPROVED_INTERNAL_NAME) \|/gm)].map(m=>m[1]);
if(sourceSections.length!==24||new Set(sourceSections).size!==24 ||
 Array.from({length:24},(_,i)=>String(i+1).padStart(2,'0')).some(x=>!sourceSections.includes(x)))
 fail('design source 24-section decision concordance incomplete or duplicated');
if(!concordance.includes('REVIEW_BLOCKED')||!concordance.includes('GOVERNANCE_CUTOVER stays NOT_READY'))
 fail('design-plan concordance cannot claim unreviewed cutover success');

const riskMarker='## 2026-11-12 — Critical-risk review evidence matrix and executable illustrative checks';
const riskStart=plan.indexOf(riskMarker);
if(riskStart<0)fail('independent risk review evidence packet missing');
const reviewStart=plan.indexOf('### Independent review sign-off register — no invented approvals',riskStart);
const donorMarker='### Two additional historical execution/audit sources — explicit section-level decision reconciliation';
const donorStart=plan.indexOf(donorMarker,riskStart);
if(reviewStart<0||donorStart<reviewStart)fail('review packet/sign-off/source order corrupted');
const reviewText=plan.slice(reviewStart,donorStart);
const gates=['FIN-01','FIN-02','FIN-03','SEC-01','SEC-02','MIG-01','LEGAL-01'];
const rows=[...reviewText.matchAll(/^\| (FIN-0[123]|SEC-0[12]|MIG-01|LEGAL-01) \| ([^|\r\n]+) \| ([^|\r\n]+) \| ([^|\r\n]+) \| ([^|\r\n]+) \|$/gm)];
if(rows.length!==gates.length || new Set(rows.map(m=>m[1])).size!==gates.length ||
 gates.some(g=>!rows.some(row=>row[1]===g)))
 fail('seven high-risk independent sign-off gates must appear once each');
for(const row of rows){
 const [gate,reviewer,date,evidence,status]=row.slice(1).map(x=>x.trim());
 if(status==='REVIEW_BLOCKED'){
  if(reviewer!=='NOT_ASSIGNED'||date!=='NOT_RUN'||evidence!=='NOT_PROVIDED')
   fail('blocked reviewer row must not claim unverified approval: '+gate);
 }else if(status==='PASS'){
  // Syntax/provenance checks only. Real reviewer independence, qualification,
  // decision and signatures always require human verification.
  if(reviewer.length<12||/SELF_APPROVED|NOT_ASSIGNED|CHATGPT|AI_REVIEW/i.test(reviewer)||
   !/^20\d{2}-\d{2}-\d{2}$/.test(date)||
   !/^(https:\/\/|docs\/|governance\/)/.test(evidence)||
   /NO_EVIDENCE|NOT_PROVIDED|NOT_RUN/i.test(evidence))
   fail('do not fabricate independent reviewer approval in candidate risk packet: '+gate);
 }else fail('unknown independent reviewer status: '+gate);
}
const riskBody=plan.slice(riskStart,reviewStart);
for(const expected of ['FIN-01-WALLET','FIN-01-COD','FIN-01-MIXED','FIN-01-CANCEL',
 'FIN-01-UNKNOWN','FIN-02-AGREEMENT','FIN-02-REMIT','FIN-02-BENEFICIARY',
 'FIN-03-CASHIN','FIN-03-MARKUP','SEC-01-ROOT','SEC-01-SESSION',
 'SEC-02-STORE','SEC-02-SWITCH','SEC-02-CAPTAIN','MIG-01-EMPTY',
 'MIG-01-APPLIED','MIG-01-RESTORE','MIG-01-FAIL','LEGAL-01-MERCHANT',
 'LEGAL-01-CAPTAIN','LEGAL-01-CLIENT','LEGAL-01-PROVIDER']){
 const count=[...riskBody.matchAll(new RegExp('^\\| '+expected+' \\|','gm'))].length;
 if(count!==1)fail('risk review scenario missing/duplicated: '+expected);
}
const donorText=plan.slice(donorStart);
const donorA=donorText.slice(donorText.indexOf('**Donor A:**'),donorText.indexOf('**Donor B:**'));
const donorB=donorText.slice(donorText.indexOf('**Donor B:**'));
const donorAIDs=[...donorA.matchAll(/^\| (0[1-9]|1[0-5]) \|/gm)].map(m=>m[1]);
const donorBIDs=[...donorB.matchAll(/^\| (0[0-9]|1[0-5]|FOLLOWUP) \|/gm)].map(m=>m[1]);
if(donorAIDs.length!==15||new Set(donorAIDs).size!==15||
 Array.from({length:15},(_,i)=>String(i+1).padStart(2,'0')).some(id=>!donorAIDs.includes(id)))
 fail('historic full-system 15-section evidence mapping incomplete');
if(donorBIDs.length!==17||new Set(donorBIDs).size!==17||
 Array.from({length:16},(_,i)=>String(i).padStart(2,'0')).some(id=>!donorBIDs.includes(id))||
 !donorBIDs.includes('FOLLOWUP'))fail('historic design-audit 16+followup mapping incomplete');
const exampleTests=contents['tools/governance/review-examples.test.mjs'];
if(!exampleTests.includes('NOT WLT code')||!exampleTests.includes('Illustrative arithmetic ONLY'))
 fail('risk arithmetic fixtures must never claim WLT implementation evidence');
if(!stage3package.scripts?.['check:foundation']?.includes('review-examples.test.mjs')||
 !contents['.github/workflows/foundation-guard.yml'].includes('review-examples.test.mjs'))
 fail('foundation CI and local commands must include bounded risk-review examples');


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
if(exists('infra')||exists('contracts'))fail('foundation guard cannot be reused as service/SQL proof');

const ci=contents['.github/workflows/foundation-guard.yml'];
if(!/permissions:\s*\n\s*contents: read/.test(ci))fail('CI must run with least privilege');
if(!ci.includes('node --test tools/governance/verify-foundation.test.mjs')||!ci.includes('node tools/governance/verify-foundation.mjs'))fail('CI must run actual guard tests and live verification');
if(/continue-on-error:\s*true|\$\{\{(?:(?!\}\})[\s\S])*\bsecrets\./.test(ci))fail('CI cannot silently skip proof or read secrets in foundation stage');

console.log('FOUNDATION_STRUCTURE_PASS domain_owners='+domainFiles.length+' capability_ids='+seen.size+' one_census=true service_scaffold_only=true openapi_zero_operations=true openapi_reserved_groups='+openapiReservedGroups);
console.log('GOVERNANCE_CUTOVER_NOT_READY: independent risk-policy approvals and material donor reconciliation not proven; software runtime gates are separate');
