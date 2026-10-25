import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

function property(object, name) {
  return object.properties.find(
    (entry) => ts.isPropertyAssignment(entry) && entry.name.getText().replaceAll('"', "") === name,
  )?.initializer;
}

test("all API routes stay behind the origin guard even with prefetch headers", () => {
  const path = join(dirname(fileURLToPath(import.meta.url)), "../proxy.ts");
  const source = readFileSync(path, "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = ast.statements.filter(ts.isVariableStatement).flatMap((statement) => [...statement.declarationList.declarations]);
  const config = declarations.find((item) => item.name.getText() === "config")?.initializer;
  assert.ok(config && ts.isObjectLiteralExpression(config), "proxy must export a static config");
  const matchers = property(config, "matcher");
  assert.ok(matchers && ts.isArrayLiteralExpression(matchers), "proxy must declare matchers");
  const alwaysMatchedApi = matchers.elements.some((entry) => {
    if (!ts.isObjectLiteralExpression(entry)) return false;
    const route = property(entry, "source");
    return (
      route &&
      ts.isStringLiteral(route) &&
      route.text === "/api/:path*" &&
      !property(entry, "missing") &&
      !property(entry, "has")
    );
  });
  assert.ok(alwaysMatchedApi, "API matcher cannot be bypassed with next-router-prefetch or purpose headers");
  assert.match(source, /UNSAFE_METHODS\.has\(request\.method\.toUpperCase\(\)\)/, "unsafe API methods must be checked");
  assert.match(source, /!verifySameOrigin\(request\)/, "origin verification must remain active");
});
