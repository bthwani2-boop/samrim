import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const owners = JSON.parse(fs.readFileSync(path.join(root, "infra/local/runtime-owners.json"), "utf8"));
const launcher = path.join(root, "tools/dev/start-surface.mjs");
const sync = path.join(root, "tools/dev/sync-lenovo-source.mjs");

test("one canonical source host and bounded native Windows runtime ownership", () => {
  assert.equal(owners.schemaVersion, 1);
  assert.equal(owners.sourceHost, "BTHWANI");
  assert.equal(owners.remoteHost, "BTHWANI-DOCKER");
  assert.equal(owners.sshTarget, "bthwani-docker");
  const names = ["app-client", "app-partner", "app-captain", "control-panel"];
  assert.deepEqual(Object.keys(owners.surfaces).sort(), names.sort());
  for (const surface of Object.values(owners.surfaces)) {
    assert.ok(["surface","lenovo-native"].includes(surface.owner));
    assert.ok(Number.isInteger(surface.remotePort) && surface.remotePort > 0);
  }
});

test("captain launcher refuses a competing local Surface Metro", () => {
  const r = spawnSync(process.execPath, [launcher, "app-captain", "--check-local-config"], {
    cwd: root, env: {...process.env, COMPUTERNAME: owners.sourceHost}, encoding: "utf8", timeout: 12000
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /RUNTIME_OWNER_IS_LENOVO/);
});

test("source mirroring rejects forbidden sensitive paths before SSH", () => {
  for (const forbidden of ["infra/local/.env", "apps/app-client/google-services.json", "apps/app-client/key.jks", "../private.env"]) {
    const r = spawnSync(process.execPath,[sync,"--verify",forbidden],{
      cwd: root, env: {...process.env, COMPUTERNAME: owners.sourceHost}, encoding: "utf8", timeout: 12000
    });
    assert.equal(r.status, 1, forbidden);
    assert.match(r.stderr, /MIRROR_VERIFY_PATH_REJECTED/, forbidden);
  }
});
