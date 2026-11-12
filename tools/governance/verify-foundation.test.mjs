import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'verify-foundation.mjs');
const fixtures={
 'AGENTS.md':'STATUS: ACTIVE_FOR_FOUNDATION_ONLY\nREPOSITORY-STRUCTURE.md governance/README.md NOT_READY\n',
 'REPOSITORY-STRUCTURE.md':'STATUS: ACTIVE_FOR_FOUNDATION_ONLY\ndocs/governance/ governance/\n',
 'governance/README.md':'GOVERNANCE_CUTOVER: NOT_READY\nBUSINESS_DECISION_AUTHORITY: NONE_WHILE_NOT_READY\n',
 'docs/REFOUNDATION-PLAN.md':'STATUS: IN_PROGRESS_FOUNDATION\nD01 Phase 2 NOT_RUN\n',
 '.github/workflows/foundation-guard.yml':'permissions:\n  contents: read\nnode --test tools/governance/verify-foundation.test.mjs\nnode tools/governance/verify-foundation.mjs\n',
 'tools/governance/verify-foundation.mjs':'// exists',
 'tools/governance/verify-foundation.test.mjs':'// exists',
 'docs/governance/README.md':'# historical donor'
};
function run(changes={},deleted=[]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bthwani-foundation-'));
 try {
  for(const [p,s] of Object.entries({...fixtures,...changes})){
   const f=path.join(dir,...p.split('/'));
   fs.mkdirSync(path.dirname(f),{recursive:true});
   fs.writeFileSync(f,s,'utf8');
  }
  for(const p of deleted)fs.rmSync(path.join(dir,...p.split('/')),{force:true,recursive:true});
  const result=spawnSync(process.execPath,[script,'--root',dir],{encoding:'utf8'});
  return {code:result.status,combined:result.stdout+result.stderr};
 } finally { fs.rmSync(dir,{force:true,recursive:true}); }
}
test('foundation fixture succeeds without pretending full governance is ready',()=>{
 const result=run();
 assert.equal(result.code,0,result.combined);
 assert.match(result.combined,/GOVERNANCE_CUTOVER_NOT_READY/);
});
test('rejects missing agent',()=>{const result=run({},['AGENTS.md']);assert.notEqual(result.code,0);assert.match(result.combined,/AGENTS\.md/);});
test('rejects premature governance acceptance',()=>{const result=run({'governance/README.md':'GOVERNANCE_CUTOVER: READY\nBUSINESS_DECISION_AUTHORITY: ACTIVE\n'});assert.notEqual(result.code,0);assert.match(result.combined,/do not mark governance ready/);});
test('rejects inherited code-dependent CI in sparse tree',()=>{const result=run({'.github/workflows/fast-guard.yml':'name: Fast Guard\n'});assert.notEqual(result.code,0);assert.match(result.combined,/inherited workflow/);});
test('rejects absence of donor reference during transition',()=>{const result=run({},['docs/governance']);assert.notEqual(result.code,0);assert.match(result.combined,/historic donor/);});
test('rejects fake passing via continue-on-error',()=>{const result=run({'.github/workflows/foundation-guard.yml':fixtures['.github/workflows/foundation-guard.yml']+'\ncontinue-on-error: true'});assert.notEqual(result.code,0);assert.match(result.combined,/quietly skip/);});
