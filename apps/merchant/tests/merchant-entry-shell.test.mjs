import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../tools/dev/mapped-render-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const source = fileURLToPath(new URL("../src/features/navigation/merchant-entry-shell.tsx", import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-merchant-public-shell-"));
let compiled;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/@typescript/native/bin/tsc"), source,
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20_000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = readFileSync(path.join(temp, "merchant-entry-shell.js"), "utf8");
} finally {
  rmSync(temp, { recursive: true, force: true });
}

test("Merchant entry contains only the login card inside the safe area", () => {
  const jsx = (type, props) => ({ type, props });
  const mock = {
    "@bthwani/tamagui-config/appearance": { useMobileAppearance: () => ({ theme: { background: "#000" } }) },
    "react/jsx-runtime": { jsx },
    "react-native-safe-area-context": { SafeAreaView: "SafeAreaView" },
  };
  const mod = loadMappedRenderFixture(compiled, source, mock);
  const form = jsx("LoginForm", { testID: "safe-identity-gate" });
  const shell = mod.exports.default({ children: form });
  assert.equal(shell.type, "SafeAreaView");
  assert.equal(shell.props.children, form, "no workspace navigation or notice may surround the login card");
});

test("mapped render fixtures reject absent maps, wrong sources and unadmitted dependencies", () => {
  assert.throws(() => loadMappedRenderFixture("module.exports = {};", source, {}), /inline source map/);
  assert.throws(() => loadMappedRenderFixture(compiled, path.join(path.dirname(source), "different.tsx"), {}), /source identity/);
  assert.throws(() => loadMappedRenderFixture(compiled, source, {}), /unexpected fixture dependency/);
  const marker = "//# sourceMappingURL=data:application/json;base64,";
  const offset = compiled.lastIndexOf(marker) + marker.length;
  const map = JSON.parse(Buffer.from(compiled.slice(offset).trim(), "base64").toString("utf8"));
  map.sourcesContent[0] += "\n// stale source";
  const stale = compiled.slice(0, offset) + Buffer.from(JSON.stringify(map)).toString("base64");
  assert.throws(() => loadMappedRenderFixture(stale, source, {}), /must match current source/);
});
