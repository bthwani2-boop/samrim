import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("Identity owns the platform storage entrypoint without shadow app writers", () => {
  assert.deepEqual(manifest.exports["./secure-storage"], {
    types: "./clients/native-storage.ts",
    browser: "./clients/browser-storage.ts",
    node: "./clients/browser-storage.ts",
    default: "./clients/native-storage.ts",
  });
  const native = readFileSync(new URL("./native-storage.ts", import.meta.url), "utf8");
  assert.match(native, /from "expo-secure-store"/);
  assert.equal(manifest.peerDependencies["expo-secure-store"], "58.0.2");
  assert.equal(manifest.peerDependenciesMeta["expo-secure-store"].optional, true);
});

test("mobile consumers use canonical Identity storage and obsolete app shims are absent", () => {
  for (const app of ["app-client", "app-partner"]) {
    const base = new URL(`../../../apps/${app}/src/bootstrap/`, import.meta.url);
    for (const suffix of ["compatible-storage.ts", "compatible-storage.web.ts"]) {
      assert.equal(existsSync(new URL(suffix, base)), false, `obsolete ${app} storage shim remains`);
    }
    const runtime = readFileSync(new URL("identity.ts", base), "utf8");
    assert.ok(runtime.includes('from "@bthwani/identity/secure-storage"'));
  }
});

test("Node SSR and browser resolve memory-safe browser storage instead of native SecureStore", () => {
  const resolved = fileURLToPath(import.meta.resolve("@bthwani/identity/secure-storage"))
    .replaceAll("\\", "/");
  const expected = "/clients/browser-storage.ts";
  assert.ok(resolved.endsWith(expected), "storage resolver selected unexpected platform entrypoint");
});
