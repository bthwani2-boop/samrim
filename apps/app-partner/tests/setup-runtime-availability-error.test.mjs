import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const source = readFileSync(new URL("../app/setup.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("setup.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === "errorText") declaration = node;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(declaration, "execute the production errorText function");
const code = ts.transpileModule(declaration.getText(ast) + "; errorText;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const errorText = vm.runInNewContext(code);

test("setup 404 read explains unsupported service instead of a false connection outage", () => {
  const msg = errorText({ kind: "http", status: 404 }, "read");
  assert.match(msg, /الخادم الحالي/);
  assert.match(msg, /حتى تحديث الخدمة/);
  assert.doesNotMatch(msg, /تحقق من اتصال الخدمة/);
});

test("setup distinguishes authentication and genuine network errors", () => {
  assert.match(errorText({ kind: "http", status: 401 }, "read"), /سجّل الدخول مجددًا/);
  assert.match(errorText({ kind: "http", status: 403 }, "read"), /غير مخوّل/);
  assert.match(errorText({ kind: "network" }, "read"), /تحقق من اتصال الخدمة/);
  assert.match(errorText({ kind: "http", status: 500 }, "read"), /تعذر تحميل بيانات إعداد المتجر/);
});

test("read-only 404 handling does not change save errors or unlock enrollment", () => {
  assert.match(errorText({ kind: "http", status: 404 }, "save"), /تعذر حفظ المتجر/);
  assert.match(errorText({ kind: "http", status: 409, code: "STORE_JOINING_CLOSED" }, "read"), /غير متاح للانضمام/);
  assert.match(source, /setRegistryReady\(false\)/);
  assert.match(source, /!checking&&registryReady&&!saved/);
  assert.match(source, /service\(\)\.listStoreJoiningPolicies\(\)/);
});
