import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const view = readFileSync(new URL("../src/features/marketing/marketing-center-workspace.tsx", import.meta.url), "utf8");
test("partner participation summary is an authoritative full-registry DSH readback", () => {
  const ast = ts.createSourceFile("marketing-center-workspace.tsx", view, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(ast.parseDiagnostics.length, 0);
  assert.match(view, /fetch\("\/api\/marketing\/summary"/);
  assert.doesNotMatch(view, /marketing\/promotions\?limit=100&sort=starts_desc/);
  for (const fact of ["partnerInvitations", "partnerApproved", "partnerDeclined", "partnerPending"]) {
    assert.match(view, new RegExp("summary\\." + fact));
  }
  assert.match(view, /partnerInvitations !== participation\.partnerApproved \+ participation\.partnerDeclined \+ participation\.partnerPending/);
  assert.match(view, /دون اقتطاع أول 100 عرض/);
});
