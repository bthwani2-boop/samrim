// Canonical owner source classification and immutable Go preview.
// Workspace metadata, documentation and SDK code are not inputs to the Go
// Dockerfiles. Contract, schema and unknown source changes remain guarded.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { containsLikelySecret, containsLikelySecretBytes, forbiddenName, gitBlobIdentity, openRepositoryReader, readVerifiedFile } from "../../security/verify-secrets.mjs";

const owners=Object.freeze(["dsh","identity","wlt"]);
const goFile=/^backend\/(?:cmd|internal)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.go$/;
const schemaFile=/^database\/schema\/[A-Za-z0-9_-]+\.sql$/;
const workspaceFiles=new Set(["package.json","tsconfig.json","README.md","backend/README.md","backend/project.json"]);
const buildFiles=new Set([".dockerignore","backend/Dockerfile","backend/go.mod","backend/go.sum"]);
const compare=(a,b)=>a<b?-1:a>b?1:0;

export const ownerComposeInputs=Object.freeze(["infra/compose.yaml"]);
export const ownerToolchainInput=".go-version";
const peerScope="services/identity/database/schema";

export function ownerSourceScope(owner) {
  if(!owners.includes(owner))throw new Error("PREVIEW_UNKNOWN_OWNER");
  return ["services/"+owner,ownerToolchainInput];
}
export function ownerTestScope(owner) {
  return [...ownerSourceScope(owner),...(owner==="dsh"?[peerScope]:[])];
}

function classify(rel) {
  const match=/^services\/(dsh|identity|wlt)\/(.+)$/.exec(rel);
  if(!match)return {owner:null,kind:"shared"};
  const [,owner,file]=match;
  const kind=file.startsWith("clients/")?"client":
    workspaceFiles.has(file)?"workspace":
    goFile.test(file)?(file.endsWith("_test.go")?"test":"go"):
    file.startsWith("database/")?"database":"guarded";
  return {owner,file,kind};
}
export function isPreviewGoPath(rel) {
  return ["go","test"].includes(classify(rel).kind);
}
export function isSharedRuntimeInput(rel) {
  return classify(rel).kind==="shared";
}
export function isOwnerNonRuntimePath(rel) {
  return ["client","workspace","test"].includes(classify(rel).kind);
}
// The native Compose build emits a mutually exclusive committed or preview
// identity. Unused label values may be absent or empty; neither is a fallback
// for a required identity field.
export function sourceIdentity(labels,owner) {
  if(!owners.includes(owner))throw new Error("PREVIEW_UNKNOWN_OWNER");
  if(!labels||typeof labels!=="object"||Array.isArray(labels))
    throw new Error("Invalid image source labels: "+owner);
  const values=["org.opencontainers.image.revision","com.bthwani.source-sha","com.bthwani.preview-base","com.bthwani.preview-digest"].map(key=>{
    if(!Object.hasOwn(labels,key))return "";
    const value=labels[key];
    if(typeof value!=="string")throw new Error("Invalid image source labels: "+owner);
    return value;
  });
  const [revision,source,base,digest]=values;
  const sha=(value,length)=>value.length===length&&/^[0-9a-f]+$/.test(value);
  if(base||digest||revision.startsWith("worktree-")){
    if(source!==""||!sha(base,40)||!sha(digest,64)||revision!=="worktree-"+digest)
      throw new Error("Invalid preview provenance: "+owner);
    return {revision:base,digest};
  }
  if(!sha(revision,40)||!sha(source,40))throw new Error("source revision absent or invalid: "+owner);
  if(revision!==source)throw new Error("conflicting image source labels: "+owner);
  return {revision,digest:null};
}
export function ownerSourceState(owner,changed,committed) {
  if(!owners.includes(owner))throw new Error("PREVIEW_UNKNOWN_OWNER");
  const local=changed.filter(rel=>classify(rel).owner===owner);
  return {
    imageChanges:committed.filter(rel=>!isOwnerNonRuntimePath(rel)),
    previewChanges:local.filter(rel=>!isOwnerNonRuntimePath(rel)),
    clientPending:[...local,...committed].some(rel=>classify(rel).kind==="client"),
  };
}

export function ownerReconcilePlan({changed,committed,preview,captain,schemaReady=[],wltConfigDrift=false}) {
  if(changed.some(isSharedRuntimeInput))
    return {eligible:[],blocked:Object.fromEntries(owners.map(owner=>[owner,"SHARED_INPUT_REVIEW_REQUIRED"]))};
  const blocked={}, runtimeChanges={};
  for(const owner of owners){
    const local=changed.filter(rel=>classify(rel).owner===owner);
    const saved=committed[owner]||[];
    const {imageChanges,previewChanges}=ownerSourceState(owner,changed,saved);
    runtimeChanges[owner]=Boolean(imageChanges.length||previewChanges.length);
    const database=saved.filter(rel=>classify(rel).kind==="database");
    const schemaPattern=new RegExp("^services/"+owner+"/database/"+(owner==="wlt"?"(?:schema|sandbox)":"schema")+"/[0-9]{2}_[a-z0-9_]+\\.sql$");
    const schemaAdmitted=schemaReady.includes(owner)&&local.length===0&&database.every(rel=>schemaPattern.test(rel));
    if(owner==="wlt"&&wltConfigDrift){
      runtimeChanges[owner]=true;
      blocked[owner]="CONFIG_REVIEW_REQUIRED";
    }else if(database.length&&!schemaAdmitted){
      blocked[owner]="SCHEMA_REVIEW_REQUIRED";
    }else if(previewChanges.some(rel=>!isPreviewGoPath(rel))){
      blocked[owner]="UNCOMMITTED_NON_GO";
    }else if(!preview&&(previewChanges.length||(local.length&&imageChanges.length))){
      blocked[owner]="PREVIEW_NOT_AUTHORIZED";
    }
  }
  // Each dependency hold is attributable to a blocked owner with actual
  // serving/contract/schema input changes, never workspace metadata alone.
  const edges=[["identity","dsh"],["identity","wlt"],["dsh","wlt"],...(captain?[["dsh","identity"]]:[])];
  for(let pass=0;pass<owners.length;pass++)
    for(const [peer,consumer] of edges)
      if(blocked[peer]&&runtimeChanges[peer]&&!blocked[consumer])blocked[consumer]="PEER_REVIEW_REQUIRED:"+peer;
  return {eligible:owners.filter(owner=>!blocked[owner]),blocked};
}

function gitList(root,args) {
  return openRepositoryReader(root)(...args).toString("utf8").split("\0").filter(Boolean);
}
export function dirtyPaths(root,scope) {
  const records=gitList(root,["status","--porcelain=v1","-z","--no-renames","--untracked-files=all","--",...scope]);
  return [...new Set(records.map(record=>{
    if(!/^[ MADRCU?!][ MADRCU?!] /.test(record))throw new Error("PREVIEW_STATUS_INVALID");
    return record.slice(3);
  }))].sort(compare);
}
function pathParts(rel) {
  const parts=rel.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||!/^[A-Za-z0-9_.-]+$/.test(part))||forbiddenName(rel)||containsLikelySecret(rel))
    throw new Error("PREVIEW_PATH_INVALID");
  return parts;
}
const maxPreviewBytes = 4 * 1024 * 1024;
function admitPreviewBytes(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > maxPreviewBytes ||
      bytes.includes(0) || containsLikelySecretBytes(bytes))
    throw new Error("PREVIEW_SECRET_OR_BINARY_BLOCKED");
  try { new TextDecoder("utf-8",{fatal:true}).decode(bytes); }
  catch { throw new Error("PREVIEW_SECRET_OR_BINARY_BLOCKED"); }
  return bytes;
}
function safeRead(root,rel,missing=false) {
  const parts=pathParts(rel);
  let file=root;
  for(const [i,part] of parts.entries()){
    file=path.join(file,part);
    let stat;
    try{stat=fs.lstatSync(file);}catch(e){if(missing&&e.code==="ENOENT")return null;throw e;}
    if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory()))throw new Error("PREVIEW_UNSAFE_PATH");
  }
  const result=readVerifiedFile(file,maxPreviewBytes,{allowMissing:missing});
  return result===null?null:admitPreviewBytes(result.bytes);
}

export function digestEntries(entries) {
  const hash=createHash("sha256");
  for(const [rel,bytes] of [...entries].sort(([a],[b])=>compare(a,b))){
    hash.update(rel+"\0");
    hash.update(bytes===null?"MISSING":createHash("sha256").update(bytes).digest("hex"));
    hash.update("\0");
  }
  return hash.digest("hex");
}
export function previewChangeKey(root,paths) {
  if(paths.some(rel=>!isPreviewGoPath(rel)))throw new Error("PREVIEW_ONLY_GO_SOURCE_ALLOWED");
  return digestEntries(paths.map(rel=>[rel,safeRead(root,rel,true)]));
}
function snapshotInput(file) {
  return buildFiles.has(file)||goFile.test(file)||schemaFile.test(file);
}
function scopeFor(owner) {
  const [service,pin]=ownerSourceScope(owner);
  return [service+"/.dockerignore",service+"/backend",service+"/database/schema",pin,...(owner==="dsh"?[peerScope]:[])];
}
function ownerInput(owner,rel) {
  const info=classify(rel);
  if(info.owner!==owner)throw new Error("PREVIEW_PATH_INVALID");
  if(info.kind==="workspace")return null;
  if(!snapshotInput(info.file))throw new Error("PREVIEW_UNREVIEWED_BUILD_INPUT");
  pathParts(rel);
  return info.file;
}
function checkedEntries(entries) {
  if(new Set(entries.map(([rel])=>rel.toLowerCase())).size!==entries.length)
    throw new Error("PREVIEW_PATH_COLLISION");
  for(const file of buildFiles)if(!entries.some(([rel])=>rel===file))
    throw new Error("PREVIEW_BUILD_INPUT_MISSING");
  return entries.sort(([a],[b])=>compare(a,b));
}
function checkedPeer(rel) {
  if(!/^services\/identity\/database\/schema\/[A-Za-z0-9_-]+\.sql$/.test(rel))
    throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
  pathParts(rel);
  return rel;
}
export function snapshotGoVersion(snapshot) {
  const pin=Buffer.isBuffer(snapshot.pin)?snapshot.pin.toString("utf8").trim():"";
  if(!/^\d+\.\d+\.\d+$/.test(pin))throw new Error("COMMITTED_GO_PIN_INVALID");
  return pin;
}
function snapshotRootEntries(snapshot) {
  const {owner,entries,peers=[]}=snapshot;
  ownerSourceScope(owner);
  const prefix="services/"+owner+"/";
  for(const [rel,bytes] of entries){
    if(!snapshotInput(rel)||!Buffer.isBuffer(bytes))throw new Error("PREVIEW_PATH_INVALID");
    pathParts(rel);
  }
  checkedEntries(entries);
  if(owner!=="dsh"&&peers.length)throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
  if(owner==="dsh"&&!peers.length)throw new Error("PREVIEW_PEER_SCHEMA_MISSING");
  for(const [rel,bytes] of peers){
    checkedPeer(rel);
    if(!Buffer.isBuffer(bytes))throw new Error("PREVIEW_UNREVIEWED_PEER_INPUT");
  }
  snapshotGoVersion(snapshot);
  const files=[[ownerToolchainInput,snapshot.pin],...entries.map(([rel,bytes])=>[prefix+rel,bytes]),...peers];
  if(new Set(files.map(([rel])=>rel.toLowerCase())).size!==files.length)
    throw new Error("PREVIEW_PATH_COLLISION");
  for(const [,bytes] of files)admitPreviewBytes(bytes);
  return files;
}
function assemble(owner,entries,peers,pin,revision=null) {
  const snapshot={owner,revision,entries,peers,pin};
  return {...snapshot,digest:digestEntries(snapshotRootEntries(snapshot))};
}
function headRevision(root) {
  return gitList(root,["rev-parse","HEAD"])[0]?.trim();
}
export function captureOwner(root,owner) {
  const head=headRevision(root);
  const changes=dirtyPaths(root,ownerSourceScope(owner));
  if(changes.some(rel=>!isPreviewGoPath(rel)&&!isOwnerNonRuntimePath(rel)))
    throw new Error("PREVIEW_ONLY_GO_SOURCE_ALLOWED");
  if(owner==="dsh"&&dirtyPaths(root,[peerScope]).length)throw new Error("PREVIEW_PEER_SCHEMA_CHANGED");
  const base=captureCommittedOwner(root,owner,head);
  const entries=new Map(base.entries);
  for(const rel of changes.filter(isPreviewGoPath)){
    const file=ownerInput(owner,rel);
    const bytes=safeRead(root,rel,true);
    if(bytes===null)entries.delete(file);
    else entries.set(file,bytes);
  }
  if(headRevision(root)!==head)throw new Error("PREVIEW_HEAD_CHANGED");
  return assemble(owner,[...entries],base.peers,base.pin);
}
// Committed builds must never read mutable working-tree files, including
// files hidden by ignore rules or assume-unchanged. Read the exact tree and
// batch its immutable blob IDs, with strict mode, framing and size checks.
export function captureCommittedOwner(root,owner,revision) {
  if(!/^[a-f0-9]{40}$/.test(revision||""))throw new Error("COMMITTED_REVISION_INVALID");
  const scope=scopeFor(owner);
  const requested=[];
  const git=openRepositoryReader(root);
  for(const record of git("ls-tree","-r","-z",revision,"--",...scope).toString("utf8").split("\0").filter(Boolean)){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(record);
    if(!match)throw new Error("COMMITTED_TREE_MODE_INVALID");
    const [, ,oid,rel]=match;
    const kind=rel===ownerToolchainInput?"pin":owner==="dsh"&&rel.startsWith(peerScope+"/")?"peer":"owner";
    const file=kind==="pin"?rel:kind==="peer"?checkedPeer(rel):ownerInput(owner,rel);
    if(file!==null)requested.push({oid,file,kind});
  }
  if(!requested.length)throw new Error("COMMITTED_TREE_EMPTY");
  const raw=git.batchBlobs(requested.map(x=>x.oid));
  let cursor=0,pin;
  const entries=[],peers=[];
  for(const {oid,file,kind} of requested){
    const end=raw.indexOf(10,cursor);
    if(end<0)throw new Error("COMMITTED_BLOB_HEADER_INVALID");
    const header=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(raw.subarray(cursor,end).toString("ascii"));
    if(!header||header[1]!==oid)throw new Error("COMMITTED_BLOB_HEADER_INVALID");
    const size=Number(header[2]);
    if(!Number.isSafeInteger(size)||size>4194304||end+1+size>=raw.length||raw[end+1+size]!==10)
      throw new Error("COMMITTED_BLOB_SIZE_INVALID");
    const bytes=raw.subarray(end+1,end+1+size);
    if(gitBlobIdentity(bytes,"sha1")!==oid)throw new Error("COMMITTED_BLOB_IDENTITY_INVALID");
    admitPreviewBytes(bytes);
    if(kind==="pin")pin=Buffer.from(bytes);
    else (kind==="peer"?peers:entries).push([file,Buffer.from(bytes)]);
    cursor=end+2+size;
  }
  if(cursor!==raw.length)throw new Error("COMMITTED_BLOB_TRAILING_DATA");
  return assemble(owner,entries,peers,pin,revision);
}
function materializedEntries(root) {
  const actual=[];
  function walk(folder,relative=""){
    for(const item of fs.readdirSync(folder,{withFileTypes:true})){
      const rel=relative?relative+"/"+item.name:item.name;
      if(item.isSymbolicLink())throw new Error("PREVIEW_SNAPSHOT_LINK");
      if(item.isDirectory())walk(path.join(folder,item.name),rel);
      else actual.push([rel,safeRead(root,rel)]);
    }
  }
  walk(root);
  return actual;
}
export function verifyMaterializedOwner(dir,snapshot) {
  const root=path.resolve(dir,"../..");
  const expected=snapshotRootEntries(snapshot);
  if(digestEntries(expected)!==snapshot.digest||digestEntries(materializedEntries(root))!==snapshot.digest)
    throw new Error("PREVIEW_SNAPSHOT_MUTATED");
}
function writeEntry(root,rel,bytes) {
  const file=path.join(root,...pathParts(rel));
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,bytes,{flag:"wx"});
}
export function materializeOwner(snapshot) {
  const files=snapshotRootEntries(snapshot);
  if(digestEntries(files)!==snapshot.digest)throw new Error("PREVIEW_SNAPSHOT_MUTATED");
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"bthwani-owner-preview-"));
  const dir=path.join(temp,"services",snapshot.owner);
  const dispose=()=>fs.rmSync(temp,{recursive:true,force:true});
  try{
    for(const [rel,bytes] of files)writeEntry(temp,rel,bytes);
    verifyMaterializedOwner(dir,snapshot);
    return {dir,dispose};
  }catch(e){dispose();throw e;}
}
