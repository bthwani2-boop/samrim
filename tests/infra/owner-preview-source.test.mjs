import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { captureOwner, dirtyPaths, digestEntries, isPreviewGoPath, materializeOwner, previewChangeKey, verifyMaterializedOwner } from "../../tools/dev/docker/owner-preview-source.mjs";

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
