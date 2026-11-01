import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript-ast");
require.extensions[".ts"] = (mod, filename) => {
  const text = readFileSync(filename, "utf8");
  const output = ts.transpileModule(text, {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  mod._compile(output, filename);
};

const { allowedWorkspaceEntries, canDraftWorkspaceFields } = require("../src/features/webmcp/workspace-entry-access.ts");
const operator = (permissions, manage = false) => ({ role: "operator", permissions, canManageOperatorPermissions: manage });

test("catalog-only operator sees catalog but not partners, financial or privileged pages", () => {
  const links = allowedWorkspaceEntries(operator(["catalog"])).map(item => item.href);
  assert.ok(links.includes("/catalog"));
  assert.ok(links.includes("/catalog/products"));
  assert.ok(links.includes("/workspace"));
  assert.ok(!links.includes("/partners"));
  assert.ok(!links.includes("/fields"));
  assert.ok(!links.some(link => link.startsWith("/finance")));
  assert.ok(!links.includes("/access"));
});

test("finance query routes stay discoverable without leaking other sections", () => {
  const links = allowedWorkspaceEntries(operator(["finance"])).map(item => item.href);
  assert.ok(links.includes("/finance"));
  assert.ok(links.some(link => link.startsWith("/finance?workflow=")));
  assert.ok(!links.includes("/catalog"));
  assert.ok(!links.some(link => link.includes("settlement-field")));
});

test("policy editor respects supplemental finance permission and access admin gate", () => {
  const limited = allowedWorkspaceEntries(operator(["platform_policies"])).map(item => item.href);
  assert.ok(limited.includes("/policies"));
  assert.ok(!limited.includes("/policies?policy=partner-financial-terms&action=manage"));
  assert.ok(!limited.includes("/access"));
  const elevated = allowedWorkspaceEntries(operator(["platform_policies","finance"], true)).map(item => item.href);
  assert.ok(elevated.includes("/policies?policy=partner-financial-terms&action=manage"));
  assert.ok(elevated.includes("/access"));
  assert.deepEqual(allowedWorkspaceEntries({ role:"customer",permissions:["catalog"] }), []);
});

test("draft staging never enters finance, policies, HR, operations or access", () => {
  for (const path of ["/finance","/finance/beneficiary-settlement","/policies","/hr","/operations","/access","/workspace","/partners/actors/123"]) {
    assert.equal(canDraftWorkspaceFields(path), false, path);
  }
  for (const path of ["/catalog","/catalog/import","/partners","/partners/stores/123","/marketing/content"]) {
    assert.equal(canDraftWorkspaceFields(path), true, path);
  }
  assert.equal(canDraftWorkspaceFields("/fields"), false);
  assert.equal(canDraftWorkspaceFields("/catalogue"), false);
});

test("workspace browser tool file is valid TSX and requires review before any draft is applied", () => {
  const source = readFileSync(new URL("../src/features/webmcp/workspace-entry-tools.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("workspace-entry-tools.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  for (const name of ["bthwani_list_workspace_entries","bthwani_open_workspace_entry","bthwani_list_current_entry_fields","bthwani_prepare_entry_draft"]) {
    assert.ok(source.includes(name), name);
  }
  assert.ok(source.includes('role="dialog"'));
  assert.ok(source.includes("proposalRef.current"));
  assert.ok(source.includes("onClick={approveDraft}"));
  assert.ok(!source.includes("fetch("), "navigation and drafts cannot issue generic API writes");
});


test("partner management navigation remains distinct from the Partner workspace", () => {
  const entries = allowedWorkspaceEntries(operator(["partners"]));
  const item = entries.find(entry => entry.href === "/partners");
  assert.equal(item?.label, "الشركاء والمتاجر");
  assert.equal(item?.context, "إدارة الشركاء");
  assert.ok(entries.every(entry => !entry.href.startsWith("/store?")));
});
