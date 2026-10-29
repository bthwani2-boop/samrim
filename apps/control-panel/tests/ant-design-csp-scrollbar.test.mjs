import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const patch = await readFile(new URL("patches/@rc-component__util@1.14.0.patch", root), "utf8");
const workspace = await readFile(new URL("pnpm-workspace.yaml", root), "utf8");
const provider = await readFile(new URL("../src/shell/ant-design-provider.tsx", import.meta.url), "utf8");

test("Ant Design scrollbar measurement passes the CSP nonce in both module formats", () => {
  assert.match(workspace, /patchedDependencies:[\s\S]*['"]?@rc-component\/util@1\.14\.0['"]?:/);
  assert.equal(patch.split("randomId, { csp: { nonce: document.querySelector").length - 1, 2);
  assert.match(patch, /style\[nonce\], script\[nonce\]/);
  assert.doesNotMatch(patch, /unsafe-inline|unsafe-eval/);
});

test("the existing RTL Ant Design provider still passes a nonce", () => {
  assert.match(provider, /direction="rtl"/);
  assert.match(provider, /csp: \{ nonce \}/);
});
