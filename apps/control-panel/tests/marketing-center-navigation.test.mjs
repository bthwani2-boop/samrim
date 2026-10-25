import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

const center = readFileSync(new URL("../src/features/marketing/marketing-center-workspace.tsx", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../app/(workspace)/marketing/customers/page.tsx", import.meta.url), "utf8");

test("marketing has five canonical sections with customers and no independent partner tab", () => {
  const parsed = ts.createSourceFile("marketing-center-workspace.tsx", center, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(parsed.parseDiagnostics.length, 0);
  const declaration = parsed.statements.find((stmt) => ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some((decl) => decl.name.getText(parsed) === "sections"));
  assert.ok(declaration, "canonical sections not found");
  const entries = [...declaration.getText(parsed).matchAll(/\{\s*id: "(overview|campaigns|content|customers|partners|analytics)", label: "([^"]+)"/g)];
  assert.deepEqual(entries.map((match) => match[1]), ["overview", "campaigns", "content", "customers", "analytics"]);
  assert.equal(entries[3][2], "العملاء والجمهور");
});

test("customer directory and partner approval information remain accessible in context", () => {
  assert.match(center, /import \{ CustomerDirectory \} from "\.\.\/customers\/customer-directory"/);
  assert.match(center, /section\.id === "customers" \? <CustomerDirectory \/>/);
  assert.match(center, /<summary>مشاركة الشركاء في الحملات<\/summary>/);
  assert.match(center, /<PartnerCampaignSummary snapshot=\{snapshot\} \/>/);
  assert.doesNotMatch(center, /title="التسويق والمحتوى" actions=/);
});

test("direct links and browser history preserve the customer context", () => {
  assert.match(center, /new URLSearchParams\(window\.location\.search\)\.get\("section"\)/);
  assert.match(center, /window\.addEventListener\("popstate", syncSection\)/);
  assert.match(center, /window\.history\.pushState\(window\.history\.state/);
  assert.match(legacy, /redirect\("\/marketing\?" \+ params\)/);
  for (const key of ["q", "enabled", "cursor", "customer", "tab"]) {
    assert.ok(legacy.includes('"' + key + '"'), "legacy customer query discarded: " + key);
  }
});

test("campaign partner read and analytics read fail independently", () => {
  assert.match(center, /if \(section === "campaigns"\)/);
  assert.match(center, /return \{ participation, content: \[\], contentPartial: false \}/);
  assert.match(center, /return \{ participation: null, content: content\.items/);
  assert.doesNotMatch(center, /Promise\.all\(\[/);
});
