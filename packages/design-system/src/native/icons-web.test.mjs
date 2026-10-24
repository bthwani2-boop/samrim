import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const types = readFileSync(new URL("./icon-types.ts", import.meta.url), "utf8");
const web = readFileSync(new URL("./icons.web.tsx", import.meta.url), "utf8");
const native = readFileSync(new URL("./icons.tsx", import.meta.url), "utf8");

test("every native icon has a visible Expo Web fallback", () => {
  const names = [...types.matchAll(/\| "([^"]+)"/g)].map((x) => x[1]);
  const ast = ts.createSourceFile("icons.web.tsx", web, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  const body = /const webGlyphs[^=]+=\s*\{([\s\S]*?)\n\};/.exec(web)?.[1];
  assert.ok(body, "Web glyph mapping is required");
  const entries = [...body.matchAll(/^\s*(?:"([^"]+)"|([a-z][a-z-]*)):\s*"([^"]+)"/gm)];
  assert.deepEqual(new Set(entries.map((x) => x[1] ?? x[2])), new Set(names));
  assert.equal(entries.length, names.length);
  assert.ok(entries.every((x) => x[3].trim()));
  assert.match(web, /\{webGlyphs\[name\]\}/);
  assert.doesNotMatch(web, /import [^\n]*@expo\/ui|@expo\/material-symbols\//);
  assert.match(native, /import \{ Host, Icon \} from "@expo\/ui"/);
});

test("web icon preserves size, color and accessible label", () => {
  assert.match(web, /accessibilityLabel=\{accessibilityLabel\}/);
  assert.match(web, /accessibilityRole=\{accessibilityLabel \? "image" : "none"\}/);
  assert.match(web, /width: size, height: size/);
  assert.match(web, /color: color \?\? "currentColor"/);
});
