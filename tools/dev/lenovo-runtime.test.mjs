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

test("all four remote-owned apps refuse competing local Surface development servers", () => {
  for (const app of ["app-captain", "app-client", "app-partner", "control-panel"]) {
    assert.equal(owners.surfaces[app].owner, "lenovo-native");
    const r = spawnSync(process.execPath, [launcher, app, "--check-local-config"], {
      cwd: root, env: {...process.env, COMPUTERNAME: owners.sourceHost}, encoding: "utf8", timeout: 12000
    });
    assert.equal(r.status, 1, app);
    assert.match(r.stderr, /RUNTIME_OWNER_IS_LENOVO/, app);
  }
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

test("source mirror permits Expo route conventions but rejects secret and traversal paths", () => {
  const accepted = [
    "apps/app-client/app/(app)/_layout.tsx",
    "apps/app-client/app/store/[storeId].tsx",
    "apps/app-partner/app/+html.tsx",
    "apps/app-captain/app/(app)/home.tsx",
  ];
  for (const route of accepted) {
    const r = spawnSync(process.execPath, [sync, "--check-path", route], {
      cwd: root, env: {...process.env, COMPUTERNAME: owners.sourceHost}, encoding: "utf8", timeout: 12000
    });
    assert.equal(r.status, 0, route + ": " + r.stderr);
    assert.match(r.stdout, /MIRROR_PATH_ACCEPTED/, route);
  }
  const forbidden = ["infra/local/.env", "apps/app-client/google-services.json", "apps/app-client/key.jks",
    "apps/app-client/../../private.env", "tools/dev/.npmrc", "tools/dev/.ssh/id_rsa", "apps/app-client/Private/access.ts", "apps/app-client/.Secrets/config.ts", "apps/app-partner/Node_Modules/evil.js"];
  for (const route of forbidden) {
    const r = spawnSync(process.execPath, [sync, "--check-path", route], {
      cwd: root, env: {...process.env, COMPUTERNAME: owners.sourceHost}, encoding: "utf8", timeout: 12000
    });
    assert.equal(r.status, 1, route);
    assert.match(r.stderr, /MIRROR_PATH_REJECTED/, route);
  }
});

test("no unrecognized host can start a Lenovo-owned app", () => {
  for (const host of ["OTHER-HOST", ""]) {
    const r = spawnSync(process.execPath, [launcher, "app-captain", "--check-local-config"], {
      cwd: root, env: {...process.env, COMPUTERNAME: host}, encoding: "utf8", timeout: 12000
    });
    assert.equal(r.status, 1, host);
    assert.match(r.stderr, /RUNTIME_OWNER_IS_LENOVO|RUNTIME_OWNER_UNKNOWN/, host);
  }
});

test("Lenovo runtime launchers do not open extra Windows console windows", () => {
  const source = fs.readFileSync(launcher, "utf8");
  const invoke = fs.readFileSync(path.join(root, "tools/dev/Invoke-LenovoApp.ps1"), "utf8");
  const register = fs.readFileSync(path.join(root, "tools/dev/Register-LenovoAppTasks.ps1"), "utf8");
  assert.match(source, /stdio:"inherit",\s*windowsHide:true/);
  assert.doesNotMatch(source, /windowsHide:false/);
  assert.match(invoke, /'-WindowStyle','Hidden'/);
  assert.match(register, /-WindowStyle Hidden/);
  assert.match(register, /-RestartCount 3 -RestartInterval/);
  for (const name of ["app-client", "app-partner", "app-captain", "control-panel"]) {
    assert.ok(register.includes("'" + name + "'="), name);
  }
});

test("Lenovo scoped stop requires live task, owner, launcher and listener provenance", () => {
  const stop = fs.readFileSync(path.join(root, "tools/dev/Stop-LenovoSurface.ps1"), "utf8");
  for (const check of [
    "LENOVO_ONLY", "LENOVO_RUNTIME_NOT_OWNER", "LENOVO_APP_TASK_OWNER_MISMATCH",
    "LENOVO_APP_NON_LOOPBACK_LISTENER_BLOCKED", "LENOVO_APP_LAUNCHER_PROVENANCE_BLOCKED",
    "LENOVO_APP_ORPHAN_PROVENANCE_BLOCKED", "LENOVO_APP_PROCESS_RACE_BLOCKED",
    "LENOVO_APP_LISTENER_REMAINS", "LENOVO_APP_STOP=PASS",
  ]) assert.ok(stop.includes(check), check);
  assert.match(stop, /taskkill\.exe \/PID \$launcher\.ProcessId \/T \/F/);
});
