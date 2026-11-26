// One source-mirror decision boundary. Pure decisions do not perform remote
// effects; only the existing watcher and guarded owner reconciler may do so.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const sha=/^[a-f0-9]{64}$/;
const attemptId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const pending=state=>["running","uncertain"].includes(state?.status);
const digest=text=>createHash("sha256").update(text).digest("hex");
const readState=file=>JSON.parse(readFileSync(file,"utf8"));
const validKey=(state,key)=>state?.version===1&&sha.test(key)&&state.key===key;
const matchingAttempt=(state,key,attempt)=>validKey(state,key)&&pending(state)&&attemptId.test(attempt)&&state.attempt===attempt;

// Only the reconciler writes the receipt; only the watcher writes scheduling
// state. Bind every terminal acknowledgement to its exact outstanding attempt.
function publishReceipt(file,record) {
  const temporary=file+"."+randomUUID()+".tmp";
  let owned=false;
  try{
    writeFileSync(temporary,JSON.stringify(record),{flag:"wx"});
    owned=true;
    renameSync(temporary,file);
    owned=false;
  }finally{
    if(owned)rmSync(temporary,{force:true});
  }
}
export function acknowledgeRuntimeAttempt(stateFile,receiptFile,key,attempt) {
  if(!matchingAttempt(readState(stateFile),key,attempt))throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  publishReceipt(receiptFile,{version:1,key,attempt,status:"pass"});
}
export function acknowledgeRuntimeRecovery(stateFile,receiptFile,key,reviewed) {
  const text=readFileSync(stateFile,"utf8"),state=JSON.parse(text);
  if(text!==reviewed||!validKey(state,key)||!pending(state))throw new Error("RUNTIME_ATTEMPT_MISMATCH");
  publishReceipt(receiptFile,{version:1,key,status:"retry",reviewed:digest(text)});
}
export function runtimeReceiptStatus(stateFile,receiptFile) {
  try{
    const text=readFileSync(stateFile,"utf8"),state=JSON.parse(text),receipt=readState(receiptFile);
    if(receipt.version!==1)return null;
    if(receipt.status==="pass"&&matchingAttempt(state,receipt.key,receipt.attempt))return "pass";
    if(receipt.status==="retry"&&validKey(state,receipt.key)&&pending(state)&&receipt.reviewed===digest(text))return "retry";
  }catch{/* Missing or corrupt proof cannot release a hold. */}
  return null;
}

export function parseRemoteHashes(output,expected) {
  const requested=new Set(expected),result=new Map();
  for(const line of output.split(/\r?\n/).filter(Boolean)){
    const split=line.lastIndexOf("|"),rel=line.slice(0,split),hash=line.slice(split+1);
    if(split<0||!requested.has(rel)||result.has(rel)||(hash!=="MISSING"&&!/^[0-9A-F]{64}$/.test(hash)))
      throw new Error("REMOTE_HASH_RESPONSE_INVALID");
    result.set(rel,hash);
  }
  if(result.size!==requested.size)throw new Error("REMOTE_HASH_RESPONSE_INCOMPLETE");
  return result;
}
export function isUnchanged(state,current,currentHead) {
  return Boolean(state&&state.head===currentHead&&Object.keys(state.files).length===current.size&&
    [...current].every(([rel,hash])=>state.files[rel]===hash));
}
export function needsReconcile(state,current,currentHead,remoteFiles,currentBranch=state?.branch) {
  return state?.branch!==currentBranch||!isUnchanged(state,current,currentHead)||
    [...remoteFiles].some(([rel,hash])=>hash!==(current.get(rel)??"MISSING"));
}
export function remoteConflict(actual,desired,previous) {
  return ![desired,"MISSING",previous].includes(actual);
}
export function remoteAuditDue(previous,deadline,now=Date.now()) {
  return !previous||now>=deadline;
}

// Canonical app-mirror path projection. The workspace convention admits
// purpose-named shared packages, without a second registry of package names.
// Lexical admission also applies to old manifest entries so a deleted package
// can be removed from the mirror; live inventory separately proves its manifest.
const surfaces = ["customer","merchant","captain","control-panel"];
const owners = ["identity","dsh","wlt"];
const rootInputs = ["package.json","pnpm-workspace.yaml","pnpm-lock.yaml",".node-version","tsconfig.base.json","nx.json","biome.json"];
const sharedName = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const privatePath = /^(?:\.env(?:\..*)?|\.npmrc|\.git-credentials|google-services\.json|GoogleService-Info\.plist|credentials(?:\..*)?|secrets\.local\..*|.*local.*\.secret\.json|id_rsa|id_ed25519|.*\.(?:pem|key|p12|p8|pfx|jks|keystore))$/i;
const generatedPath = new Set([".git","node_modules",".expo",".next",".next-dev","dist","build","coverage",".cache",".turbo","test-results","private",".ssh",".secrets","logs",".pnpm-store","tmp",".tmp",".nx",".local",".artifacts",".diagnostics",".bthwani-local","graphify-out"]);
const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
export const mirrorSourceRoots = Object.freeze([
  ...surfaces.map(name=>"apps/"+name),
  "packages",
  ...owners.flatMap(owner=>["package.json","tsconfig.json","clients"].map(entry=>"services/"+owner+"/"+entry)),
  "tools/mobile","tools/dev","patches",...rootInputs,
]);
export function mirrorPathAllowed(rel) {
  if(typeof rel!=="string"||!rel||rel.includes("\\")||rel.startsWith("/")||rel.includes("//")||rel.includes("\0"))return false;
  const parts=rel.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||/[<>:"|?*]/.test(part)||
    /[ .]$/.test(part)||windowsDevice.test(part)||[...part].some(char=>char.codePointAt(0)<32)||
    generatedPath.has(part.toLowerCase())||privatePath.test(part)||/\.tsbuildinfo$|\.log$/i.test(part)))return false;
  if(parts.length===1)return rootInputs.includes(rel);
  const [group,name,entry]=parts;
  if(group==="apps")return parts.length>=3&&surfaces.includes(name)&&rel!=="apps/control-panel/next-env.d.ts";
  if(group==="packages")return parts.length>=3&&sharedName.test(name)&&!surfaces.includes(name)&&!owners.includes(name);
  if(group==="services")return owners.includes(name)&&((parts.length===3&&["package.json","tsconfig.json"].includes(entry))||(entry==="clients"&&parts.length>=4));
  if(group==="tools")return parts.length>=3&&["mobile","dev"].includes(name)&&!(name==="dev"&&entry==="docker");
  return group==="patches"&&parts.length===2&&name.endsWith(".patch");
}
export function mirrorPackageName(rel) {
  return /^packages\/([^/]+)\//.exec(rel)?.[1]??null;
}
export function assertMirrorPackageManifest(name,bytes) {
  let value;
  try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}
  catch{throw new Error("MIRROR_PACKAGE_MANIFEST_INVALID "+name);}
  if(value?.name!=="@bthwani/"+name||value.private!==true)
    throw new Error("MIRROR_PACKAGE_MANIFEST_INVALID "+name);
}
export function mirrorCandidatePaths(paths) {
  const seen=new Map();
  for(const rel of paths){
    if(!mirrorPathAllowed(rel))continue;
    const folded=rel.toLowerCase(),previous=seen.get(folded);
    if(previous&&previous!==rel)throw new Error("MIRROR_CASE_COLLISION "+previous+" "+rel);
    seen.set(folded,rel);
  }
  return [...seen.values()].sort((a,b)=>a<b?-1:a>b?1:0);
}

export const branchTransitionPins=Object.freeze([
  ".node-version","pnpm-lock.yaml","package.json",
  ...surfaces.map(name=>"apps/"+name+"/package.json"),
  ...owners.map(name=>"services/"+name+"/package.json")
]);
export function isDependencyInput(rel) {
  return branchTransitionPins.includes(rel)||rel==="pnpm-workspace.yaml"||
    /^packages\/[a-z0-9-]+\/package\.json$/.test(rel)||/^patches\/[^/]+\.patch$/.test(rel);
}
export function dependencyInputChanges(previous,current) {
  if(!previous)return [];
  return [...new Set([...Object.keys(previous.files),...current.keys()])]
    .filter(rel=>isDependencyInput(rel)&&previous.files[rel]!==current.get(rel)).sort();
}
export function assertCompatibleBranchTransition(previous,current,currentBranch) {
  if(!currentBranch||currentBranch.startsWith("archive/"))throw new Error("SOURCE_SYNC_BRANCH_UNAUTHORIZED");
  return Boolean(previous&&previous.branch!==currentBranch);
}

// Idle observation has no write authority. A changed key or an explicit retry
// requests a guarded apply; a settled current/review state gets only an audit.
export function runtimePollAction({enabled,dirty,active,key,last,now,nextAudit}) {
  if(!enabled||dirty||active||!key||pending(last))return null;
  if(last?.key!==key)return "apply";
  if(last.status==="blocked"||now<nextAudit)return null;
  return last.status==="retry"?"apply":"audit";
}
export function runtimeBaselineProofDue(key,last) {
  return Boolean(key&&!pending(last)&&(last?.key!==key||last.status==="retry"));
}
const lines=text=>text.split(/\r?\n/);
function terminalResult(stdout) {
  const results=lines(stdout).map(line=>/^RECONCILE_(PASS|PARTIAL) HEAD=([a-f0-9]{40})$/.exec(line)).filter(Boolean);
  return results.length===1?{status:results[0][1],head:results[0][2]}:null;
}
function selectedOwners(stdout,head) {
  const selections=lines(stdout).map(line=>/^SELECTED=(NONE|[a-z,]+) HEAD=([a-f0-9]{40}) CAPTAIN_ADMISSION=(true|false)$/.exec(line)).filter(Boolean);
  if(selections.length!==1||selections[0][2]!==head)return null;
  const owners=selections[0][1]==="NONE"?[]:selections[0][1].split(",");
  return owners.every(owner=>["dsh","identity","wlt"].includes(owner))&&new Set(owners).size===owners.length?owners:null;
}
// The existing reconciler --check is read-only and emits its exact selected
// owners. It may see preview candidates that committed-only automation cannot
// admit. Only an eligible selected owner can schedule a new apply.
export function runtimeAuditResult(code,signal,stdout,head,eligible) {
  if(signal||lines(stdout).some(line=>/^OWNER_APPLY_/.test(line)))return "retry";
  const terminal=terminalResult(stdout),selected=selectedOwners(stdout,head);
  if(!terminal||terminal.head!==head||selected===null)return "retry";
  if(code===0&&terminal.status==="PASS"&&selected.length===0)return "pass";
  if(code===3&&terminal.status==="PARTIAL")
    return selected.some(owner=>eligible.includes(owner))?"apply":"review";
  return "retry";
}
export function runtimeAttemptResult(code,signal,stdout,stderr) {
  if(signal||/ROLLBACK_BLOCKED|ROLLBACK_READBACK_FAILED/.test(stderr))return "uncertain";
  if(/ROLLBACK_PASS/.test(stderr))return "blocked";
  const sequence=lines(stdout).map(line=>/^OWNER_APPLY_(STARTED|VERIFIED) (.+)$/.exec(line)).filter(Boolean);
  let active=null;
  for(const [,event,owner] of sequence){
    if(event==="STARTED"){
      if(active!==null)return "uncertain";
      active=owner.trim();
    }else{
      if(active!==owner.trim())return "uncertain";
      active=null;
    }
  }
  if(active!==null)return "uncertain";
  const terminal=terminalResult(stdout);
  if(code===0&&terminal?.status==="PASS")return "pass";
  if(terminal?.status!=="PARTIAL")return "retry";
  if(/BASELINE_PROOF_FAIL/.test(stderr))return "retry";
  const holds=lines(stdout).filter(line=>line.includes(" RUNTIME=BLOCKED "));
  const local=/^(?:dsh|identity|wlt) RUNTIME=BLOCKED revision=[a-f0-9]{40} reason=(?:PREVIEW_NOT_AUTHORIZED|UNCOMMITTED_NON_GO|SHARED_INPUT_REVIEW_REQUIRED)$/;
  const peer=/^(?:dsh|identity|wlt) RUNTIME=BLOCKED revision=[a-f0-9]{40} reason=PEER_REVIEW_REQUIRED:(?:dsh|identity|wlt)$/;
  return holds.some(line=>local.test(line))&&holds.every(line=>local.test(line)||peer.test(line))?"blocked":"review";
}

export function graphifyRefreshAction(assessment) {
  if(assessment?.refreshing===true)return "busy";
  if(assessment?.unsafeUntracked>0)return "deferred";
  if(assessment?.status==="PASS"&&assessment.queryable===true)return "current";
  if(assessment?.status==="INVALIDATED"&&assessment.queryable===true)return "refresh";
  if(assessment?.status==="BLOCKED"&&assessment.queryable===false&&assessment.reason==="indexed branch differs")return "refresh";
  return "blocked";
}
export function watcherReloadAction({loaded,current,dirty,busy}) {
  return loaded===current?"current":dirty?"defer":busy?"drain":"reload";
}
const excludedEvent=/^(?:\.git|node_modules|graphify-out|\.next|\.expo|\.nx|dist|build|coverage|\.cache|\.pnpm-store|\.env(?:\..*)?|\.ssh|\.secrets)$/i;
export function graphifySourceEvent(name) {
  if(!name)return true;
  const rel=String(name).replaceAll("\\","/");
  if(/^\.git\/(?:HEAD|refs\/heads\/)/.test(rel))return true;
  if(rel.split("/").some(part=>!part||part===".."||excludedEvent.test(part)))return false;
  return !rel.includes("/")||/^(?:apps|services|packages|infra|tools|governance|specs|docs|tests|\.specify|\.agents|\.github)(?:\/|$)/.test(rel);
}
export function sourceCycleDue({pending,now,nextAudit}) {
  return pending||now>=nextAudit;
}
export function graphifyPollDue({now,dirtySince,lastEvent,nextAudit,busy,debounce=3000,maxWait=15000}) {
  return !busy&&(now>=nextAudit||(dirtySince!==null&&(now-lastEvent>=debounce||now-dirtySince>=maxWait)));
}
