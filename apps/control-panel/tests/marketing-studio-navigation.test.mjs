import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const registry = readFileSync(new URL("../src/navigation/workspace-registry.ts", import.meta.url), "utf8");
const entries = readFileSync(new URL("../src/features/webmcp/workspace-entry-access.ts", import.meta.url), "utf8");
const marketing = readFileSync(new URL("../src/features/marketing/marketing-center-workspace.tsx", import.meta.url), "utf8");
const marketingPage = readFileSync(new URL("../app/(workspace)/marketing/page.tsx", import.meta.url), "utf8");

test("Studio is a permitted Marketing child, not a second primary workspace", () => {
  assert.match(registry, /const marketingChildren:[\s\S]*?href: "\/studio", label: "استوديو التصميم"/);
  assert.match(registry, /href: "\/marketing", label: "التسويق والتصميم", children: marketingChildren, permission: "marketing"/);
  assert.doesNotMatch(registry, /href: "\/studio", label: "استوديو التصميم", children:/);
  assert.match(registry, /destination\.children\.some\(\(child\) => isCurrentWorkspacePath\(pathname, child\.href\)\)/);
});

test("Legacy Studio route remains reachable from Marketing and registry-backed entry search", () => {
  assert.ok(existsSync(new URL("../app/(workspace)/studio/page.tsx", import.meta.url)));
  assert.match(marketing, /aria-label="التسويق والتصميم"/);
  assert.match(marketingPage, /title: "التسويق والتصميم"/);
  assert.match(marketing, /<Link href="\/studio" className="button button-secondary">فتح استوديو التصميم<\/Link>/);
  assert.match(entries, /entry\.children\.some\(child => path === child\.href \|\| path\.startsWith\(child\.href \+ "\/"\)\)/);
  assert.match(entries, /if \(!canOpenWorkspaceRoute\(identity, href\)\) return false/);
});
