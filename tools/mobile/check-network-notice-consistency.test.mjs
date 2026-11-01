import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repository = resolve(import.meta.dirname, "../..");
const expected = /offline=\{isConnected === false && isInternetReachable === false\}/;

for (const app of ["app-client", "app-partner", "app-captain"]) {
  test(app + " does not report offline on one stale connectivity signal", () => {
    const source = readFileSync(resolve(repository, "apps", app, "app", "_layout.tsx"), "utf8");
    assert.match(source, expected);
    const misclassified = source.replace(
      "isConnected === false && isInternetReachable === false",
      "isConnected === false || isInternetReachable === false",
    );
    assert.notEqual(misclassified, source);
    assert.doesNotMatch(misclassified, expected);
  });
}

test("the shared status notice is presentation only and does not retry owner requests", () => {
  const source = readFileSync(resolve(repository, "packages/design-system/src/native/network-status.tsx"), "utf8");
  assert.match(source, /if \(!offline\) return null/);
  const component = source.slice(source.indexOf("export function BthwaniNetworkStatusNotice"));
  assert.doesNotMatch(component, /fetch\(|useEffect\(|setInterval\(|retry\(|mutat/i);
});
