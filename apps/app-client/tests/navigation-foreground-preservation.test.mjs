import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const scope = readFileSync(new URL("../src/features/service-city/service-city-scope.tsx", import.meta.url), "utf8");
const refresh = scope.split("const refreshCities = useCallback(async () => {")[1]?.split("}, [linkedCityID]);")[0];

test("foreground city refresh keeps the mounted navigator rather than resetting to loading", () => {
  assert.ok(refresh, "expected canonical refreshCities callback");
  assert.doesNotMatch(refresh, /setState\(["']loading["']\)/u);
  assert.match(scope, /useState<"loading" \| "ready" \| "error">\("loading"\)/u);
  assert.match(scope, /<ScopeContext\.Provider value=\{value\}>/u);
});

test("transient refresh failures preserve the last ready screen; initial failures show retry", () => {
  assert.match(refresh, /setState\(\(previous\) => previous === "ready" \? previous : "error"\)/u);
  assert.match(scope, /if \(state === "error"\) return/u);
  assert.match(scope, /onPress=\{\(\) => void refreshCities\(\)\}/u);
});

test("app resume rechecks service cities without replacing navigation", () => {
  assert.match(scope, /next === "background" \|\| next === "inactive"/u);
  assert.match(scope, /next === "active" && wasBackgrounded/u);
  assert.match(scope, /void refreshCities\(\)/u);
});
