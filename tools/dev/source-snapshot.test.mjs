import assert from "node:assert/strict";
import test from "node:test";
import { inspectSourceFiles } from "./source-snapshot.mjs";

test("tracked and untracked source bytes are admitted through one real-file boundary", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "graphify-admission-"));
  const entry = name => "100644 "+"a".repeat(40)+" 0\t"+name;
  try {
    mkdirSync(join(dir,"apps"));
    const file = join(dir,"apps","new.ts");
    writeFileSync(file,"export const n=1;");
    const tracked = [entry("apps/new.ts")];
    const first = inspectSourceFiles(dir, tracked, []);
    assert.deepEqual(first.unsafeTracked, []);
    assert.deepEqual(first.unsafeUntracked, []);
    writeFileSync(file,"export const n=2;");
    assert.notEqual(inspectSourceFiles(dir,tracked,[]).digest,first.digest);
    assert.notEqual(inspectSourceFiles(dir,[],["apps/new.ts"]).digest,first.digest);
    writeFileSync(join(dir,"apps",".env"),"SYNTHETIC=1");
    assert.deepEqual(inspectSourceFiles(dir,[entry("apps/.env")],[]).unsafeTracked,["apps/.env"]);
    assert.deepEqual(inspectSourceFiles(dir,[],["apps/.env"]).unsafeUntracked,["apps/.env"]);
    writeFileSync(file,"const key = 'sk_"+"live_"+"A".repeat(16)+"';");
    assert.deepEqual(inspectSourceFiles(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    const marker = "ghp_"+"a".repeat(30);
    for (const bytes of [Buffer.concat([Buffer.from([0]),Buffer.from(marker)]),Buffer.from(marker,"utf16le"),Buffer.from(marker,"utf16le").swap16()]) {
      writeFileSync(file,bytes);
      assert.deepEqual(inspectSourceFiles(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    }
    writeFileSync(file,Buffer.from([0,1,2,3]));
    assert.deepEqual(inspectSourceFiles(dir,tracked,[]).unsafeTracked,[]);
    writeFileSync(file,"export const n=3;");
    linkSync(file,join(dir,"apps","alias.ts"));
    assert.deepEqual(inspectSourceFiles(dir,tracked,[]).unsafeTracked,["apps/new.ts"]);
    rmSync(join(dir,"apps","alias.ts"));
    symlinkSync(dir,join(dir,"apps","linked"),process.platform==="win32"?"junction":"dir");
    assert.deepEqual(inspectSourceFiles(dir,[entry("apps/linked/apps/new.ts")],[]).unsafeTracked,["apps/linked/apps/new.ts"]);
    assert.deepEqual(inspectSourceFiles(dir,[],["../outside.ts"]).unsafeUntracked,["../outside.ts"]);
    assert.deepEqual(inspectSourceFiles(dir,["120000 "+"a".repeat(40)+" 0\tapps/new.ts"],[]).unsafeTracked,["apps/new.ts"]);
    rmSync(file);
    const removed=inspectSourceFiles(dir,tracked,[]);
    assert.deepEqual(removed.unsafeTracked,[]);
    assert.notEqual(removed.digest,first.digest);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test("source snapshot rejects sensitive staged bytes even after working bytes are repaired or removed", async () => {
  const { captureSourceSnapshot } = await import("./source-snapshot.mjs");
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir=mkdtempSync(join(tmpdir(),"source-stage-admission-"));
  const exe=process.platform==="win32"?"C:\\Program Files\\Git\\cmd\\git.exe":"/usr/bin/git";
  const git=(...args)=>execFileSync(exe,args,{cwd:dir,stdio:"pipe"});
  try {
    git("init","-q");
    const file=join(dir,"sample.ts");
    writeFileSync(file,"export const n=1;\n");
    git("add","sample.ts");
    git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","-c","commit.gpgsign=false","-c","core.hooksPath="+dir,"commit","-qm","initial");
    writeFileSync(file,Buffer.from("ghp_"+"a".repeat(30),"utf16le"));
    git("add","sample.ts");
    writeFileSync(file,"export const n=1;\n");
    assert.equal(captureSourceSnapshot(dir).unsafeTracked,1);
    rmSync(file);
    assert.equal(captureSourceSnapshot(dir).unsafeTracked,1);
    writeFileSync(file,"export const n=2;\n");
    git("add","sample.ts");
    assert.equal(captureSourceSnapshot(dir).unsafeTracked,0);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
