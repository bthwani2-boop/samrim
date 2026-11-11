import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript-ast";

const repository = resolve(import.meta.dirname, "../..");
const sharedSource = readFileSync(resolve(repository, "packages/design-system/src/native/network-status.tsx"), "utf8");
const selector = sharedSource.match(/export function isConfirmedOffline\([\s\S]*?\n\}/)?.[0];
assert.ok(selector, "the design system must own the single connectivity decision");
const compiled = ts.transpileModule(
  selector.replace(/^export /, "") + "\nisConfirmedOffline;",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const isConfirmedOffline = runInNewContext(compiled);

test("the shared decision never treats one stale or unknown network signal as confirmed offline", () => {
  for (const [connected, reachable, expected] of [
    [false, false, true],
    [false, true, false],
    [true, false, false],
    [false, null, false],
    [undefined, false, false],
    [null, null, false],
    [true, true, false],
  ]) {
    assert.equal(isConfirmedOffline(connected, reachable), expected, `signals ${connected}/${reachable}`);
  }
});

for (const app of ["app-client", "app-partner", "app-captain"]) {
  test(app + " delegates its connectivity decision to the one design-system owner", () => {
    const source = readFileSync(resolve(repository, "apps", app, "app", "_layout.tsx"), "utf8");
    assert.match(source, /import \{[^\n]*isConfirmedOffline[^\n]*\} from "@bthwani\/design-system\/native"/);
    assert.match(source, /offline=\{isConfirmedOffline\(isConnected, isInternetReachable\)\}/);
    assert.doesNotMatch(source, /offline=\{isConnected === false (?:&&|\|\|) isInternetReachable === false\}/);
  });
}

test("the shared notice is read-only and cannot initiate a hidden domain retry", () => {
  assert.match(sharedSource, /if \(!offline\) return null/);
  const component = sharedSource.slice(sharedSource.indexOf("export function BthwaniNetworkStatusNotice"));
  assert.doesNotMatch(component, /fetch\(|useEffect\(|setInterval\(|retry\(|mutat/i);
});
