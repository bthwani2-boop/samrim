import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

const types = readFileSync(new URL("./icon-types.ts", import.meta.url), "utf8");
const web = readFileSync(new URL("./icons.web.tsx", import.meta.url), "utf8");
const native = readFileSync(new URL("./icons.tsx", import.meta.url), "utf8");

test("every native Material Symbol has exactly one identical web SVG path", () => {
  const names = [...types.matchAll(/\| "([^"]+)"/g)].map((x) => x[1]);
  const ast = ts.createSourceFile("icons.web.tsx", web, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  const body = /const materialPaths[^=]+=\s*\{([\s\S]*?)\n\};/.exec(web)?.[1];
  assert.ok(body, "Web SVG mapping is required");
  const entries = [...body.matchAll(/^\s*"([^"]+)":\s*"([^"]+)"/gm)];
  const mapped = new Map(entries.map((x) => [x[1], x[2]]));
  assert.deepEqual(new Set(mapped.keys()), new Set(names));
  assert.equal(entries.length, names.length);
  const assets = [...native.matchAll(/^\s*(?:"([^"]+)"|([a-z-]+)): Icon\.select\(\{ ios: [^,]+, android: require\("@expo\/material-symbols\/([^"]+)"\)/gm)];
  assert.equal(assets.length, names.length);
  for (const [, quoted, plain, file] of assets) {
    const xml = readFileSync(new URL(`../../node_modules/@expo/material-symbols/icons/${file}`, import.meta.url), "utf8");
    const original = /android:pathData="([^"]+)"/.exec(xml)?.[1];
    assert.ok(original, `Missing XML source for ${file}`);
    assert.equal(mapped.get(quoted ?? plain), original, `Wrong Material Symbol path for ${file}`);
  }
  assert.match(web, /<svg[\s\S]*<path d=\{materialPaths\[name\]\} \/>/);
  assert.doesNotMatch(web, /import [^\n]*@expo\/ui|@expo\/material-symbols\//);
  assert.match(native, /import \{ Host, Icon \} from "@expo\/ui"/);
});

test("web icons retain native size, theme color and accessibility", () => {
  assert.match(web, /aria-label=\{accessibilityLabel\}/);
  assert.match(web, /role=\{accessibilityLabel \? "img" : undefined\}/);
  assert.match(web, /width=\{size\}/);
  assert.match(web, /height=\{size\}/);
  assert.match(web, /fill=\{typeof color === "string" \? color : "currentColor"\}/);
  assert.match(web, /viewBox="0 0 960 960"/);
});
