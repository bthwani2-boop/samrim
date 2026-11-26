import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureCommittedOwner, captureOwner, dirtyPaths, digestEntries, isPreviewGoPath, materializeOwner, previewChangeKey, verifyMaterializedOwner } from "../../tools/dev/docker/owner-preview-source.mjs";

const exe=process.platform==="win32"?"C:\\Program Files\\Git\\cmd\\git.exe":"/usr/bin/git";
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"bthwani-preview-fixture-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const git=(...args)=>execFileSync(exe,args,{cwd:dir,stdio:"pipe"});
  const write=(rel,value)=>{const file=path.join(dir,...rel.split("/"));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
  const base="services/dsh/";
  git("init","-q");
  write(base+".dockerignore","**\n!backend/\n");
  write(base+"backend/Dockerfile","FROM example\n");
  write(base+"backend/go.mod","module example\n");
  write(base+"backend/go.sum","");
  write(base+"backend/cmd/dsh/main.go","package main\n");
  write(base+"database/schema/00.sql","SELECT 1;\n");
  write("services/identity/database/schema/20_sessions.sql","SELECT 1;\n");
  write(".gitignore",".env\n");
  git("add",".");git("-c","user.name=Preview Test","-c","user.email=preview@example.invalid","commit","-qm","fixture");
  return {dir,git,write,base};
}
test("preview captures changed and added Go bytes; deletion and reversion change fingerprint",t=>{
  const {dir,write,base}=fixture(t);
  const scope=["services/dsh"];
  const rel=base+"backend/cmd/dsh/main.go";
  const before=captureOwner(dir,"dsh");
  assert.deepEqual(dirtyPaths(dir,scope),[]);
  write(rel,"package main\n// changed\n");
  const added=base+"backend/internal/new.go";
  write(added,"package internal\n");
  const dirty=dirtyPaths(dir,scope);
  assert.deepEqual(dirty,[rel,added].sort());
  const key=previewChangeKey(dir,dirty);
  const snap=captureOwner(dir,"dsh");
  assert.notEqual(snap.digest,before.digest);
  assert.ok(snap.entries.some(([p,b])=>p==="backend/internal/new.go"&&b.toString().includes("package internal")));
  const tmp=materializeOwner(snap);
  t.after(tmp.dispose);
  assert.ok(tmp.dir.endsWith(path.join("services","dsh")));
  assert.ok(fs.existsSync(path.resolve(tmp.dir,"../identity/database/schema/20_sessions.sql")));
  assert.doesNotThrow(()=>verifyMaterializedOwner(tmp.dir,snap));
  fs.writeFileSync(path.join(tmp.dir,"backend","cmd","dsh","main.go"),"mutated");
  assert.throws(()=>verifyMaterializedOwner(tmp.dir,snap),/PREVIEW_SNAPSHOT_MUTATED/);
  fs.unlinkSync(path.join(dir,...rel.split("/")));
  assert.notEqual(previewChangeKey(dir,dirtyPaths(dir,scope)),key);
  assert.equal(captureOwner(dir,"dsh").entries.some(([p])=>p==="backend/cmd/dsh/main.go"),false);
  fs.unlinkSync(path.join(dir,...added.split("/")));write(rel,"package main\n");
  assert.equal(captureOwner(dir,"dsh").digest,before.digest);
});
test("preview excludes ignored secrets and refuses changed schema, credentials and non-Go inputs",t=>{
  const {dir,write,base}=fixture(t);
  write(base+"backend/cmd/dsh/.env","private");
  assert.equal(captureOwner(dir,"dsh").entries.some(([p])=>p.endsWith(".env")),false);
  write(base+"database/schema/00.sql","SELECT 2;\n");
  assert.throws(()=>captureOwner(dir,"dsh"),/PREVIEW_ONLY_GO_SOURCE_ALLOWED/);
  write(base+"database/schema/00.sql","SELECT 1;\n");
  write(base+"backend/cmd/dsh/main.go","// "+"ghp_"+"x".repeat(30));
  assert.throws(()=>captureOwner(dir,"dsh"),/PREVIEW_SECRET_OR_BINARY_BLOCKED/);
  assert.equal(isPreviewGoPath("services/dsh/backend/internal/../private.go"),false);
  assert.equal(isPreviewGoPath("services/wlt/database/schema/a.go"),false);
  assert.notEqual(digestEntries([["a",Buffer.from("one")]]),digestEntries([["b",Buffer.from("one")]]));
});
test("a snapshot cannot materialize path traversal",()=>{
  const entries=[["../outside",Buffer.from("x")]];
  assert.throws(()=>materializeOwner({owner:"dsh",entries,digest:digestEntries(entries)}),/PREVIEW_PATH_INVALID/);
});

test("preview captures necessary Go source and test evidence alongside unrelated README edits",t=>{
  const {dir,write,base}=fixture(t);
  write(base+"README.md","owner documentation");
  write(base+"backend/README.md","backend documentation");
  write(base+"backend/cmd/dsh/main_test.go","package main\n");
  write(base+"backend/cmd/dsh/main.go","package main\n// changed\n");
  const snapshot=captureOwner(dir,"dsh");
  assert.ok(snapshot.entries.some(([name])=>name==="backend/cmd/dsh/main_test.go"));
  assert.ok(snapshot.entries.some(([name])=>name==="backend/cmd/dsh/main.go"));
  assert.ok(snapshot.entries.every(([name])=>name!=="README.md"));
  write(base+"contracts/openapi/dsh.openapi.yaml","openapi: 3.1.0");
  assert.throws(()=>captureOwner(dir,"dsh"),/PREVIEW_ONLY_GO_SOURCE_ALLOWED/);
});

test("preview snapshots omit unrelated client edits but still reject contract changes",t=>{
  const {dir,write,base}=fixture(t);
  const before=captureOwner(dir,"dsh");
  write(base+"clients/customer.ts","export const test = 1;");
  assert.equal(captureOwner(dir,"dsh").digest,before.digest);
  write(base+"backend/cmd/dsh/main.go","package main\n// changed\n");
  const snapshot=captureOwner(dir,"dsh");
  assert.notEqual(snapshot.digest,before.digest);
  assert.ok(snapshot.entries.every(([name])=>!name.startsWith("clients/")));
  write(base+"contracts/openapi/dsh.openapi.yaml","openapi: 3.1.0");
  assert.throws(()=>captureOwner(dir,"dsh"),/PREVIEW_ONLY_GO_SOURCE_ALLOWED/);
});

test("workspace-only owner metadata is not a serving input or a snapshot dependency",t=>{
  const {dir,write,base}=fixture(t);
  const before=captureOwner(dir,"dsh");
  write(base+"package.json",'{"scripts":{"test":"node test"}}');
  write(base+"tsconfig.json",'{"compilerOptions":{"strict":true}}');
  write(base+"backend/README.md","documentation");
  assert.equal(captureOwner(dir,"dsh").digest,before.digest);
  write(base+"backend/internal/new.go","package internal\n");
  assert.notEqual(captureOwner(dir,"dsh").digest,before.digest);
  write(base+"contracts/openapi/unknown.yaml","openapi: 3.1.0");
  assert.throws(()=>captureOwner(dir,"dsh"),/PREVIEW_ONLY_GO_SOURCE_ALLOWED/);
});

test("committed owner snapshot uses Git objects, never ignored or hidden working-tree inputs",t=>{
  const {dir,git,write,base}=fixture(t);
  const head=git("rev-parse","HEAD").toString().trim();
  const main=base+"backend/cmd/dsh/main.go";
  git("update-index","--assume-unchanged",main);
  write(main,"package main\n// uncommitted hidden mutation\n");
  write(base+"backend/cmd/dsh/.env","synthetic ignored input");
  write(base+"backend/internal/untracked.go","package internal\n");
  const snap=captureCommittedOwner(dir,"dsh",head);
  assert.equal(snap.revision,head);
  assert.equal(snap.entries.find(([rel])=>rel==="backend/cmd/dsh/main.go")[1].toString(),"package main\n");
  assert.ok(snap.entries.every(([rel])=>!rel.includes(".env")&&!rel.includes("untracked")));
  assert.equal(snap.peers.length,1);
  const staged=materializeOwner(snap);
  t.after(staged.dispose);
  assert.equal(fs.readFileSync(path.join(staged.dir,"backend/cmd/dsh/main.go"),"utf8"),"package main\n");
  assert.doesNotThrow(()=>verifyMaterializedOwner(staged.dir,snap));
  fs.writeFileSync(path.resolve(staged.dir,"../identity/database/schema/extra.sql"),"SELECT 2;");
  assert.throws(()=>verifyMaterializedOwner(staged.dir,snap),/SNAPSHOT_MUTATED/);
  assert.throws(()=>captureCommittedOwner(dir,"dsh","HEAD"),/COMMITTED_REVISION_INVALID/);
});
