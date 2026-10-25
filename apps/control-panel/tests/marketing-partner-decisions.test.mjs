import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

const panel = readFileSync(new URL("../src/features/marketing/marketing-partner-decisions.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/marketing/promotions/[promotionId]/partner-decisions/route.ts", import.meta.url), "utf8");
const marketing = readFileSync(new URL("../src/features/marketing/marketing-promotions-workspace.tsx", import.meta.url), "utf8");

test("decision panel is lazy, paginated, filterable, and attached to its campaign", () => {
  for (const [file, text] of [["panel.tsx", panel], ["route.ts", route], ["marketing.tsx", marketing]]) {
    const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.equal(parsed.parseDiagnostics.length, 0, "invalid TSX/TS in " + file);
  }
  assert.match(panel, /if \(!open\) return/);
  assert.match(panel, /AbortController/);
  assert.match(panel, /URLSearchParams\(\{ limit: "25" \}\)/);
  assert.match(panel, /q\.set\("decision", filter\)/);
  assert.match(panel, /data\?\.nextCursor/);
  assert.match(marketing, /item\.requiresPartnerOptIn \? <MarketingPartnerDecisions promotionId=\{item\.id\}/);
});

test("decision API checks operator session and marketing permission before reading DSH", () => {
  assert.match(route, /readOperatorSession\(\)/);
  assert.match(route, /identity\.role !== "operator"/);
  assert.match(route, /operatorWorkspacePermissionDenied\(identity, "marketing"\)/);
  assert.match(route, /invalid participation filter/);
  assert.match(route, /listMarketingPartnerDecisions\(/);
});
