import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript-ast";

const source = readFileSync(new URL("../src/features/marketing/marketing-promotions-workspace.tsx", import.meta.url), "utf8");

test("marketing promotion workspace preserves a clear empty state and create action", () => {
  const tree = ts.createSourceFile("marketing-promotions-workspace.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(tree.parseDiagnostics.length, 0, "promotion workspace TSX must parse");
  assert.match(source, /لا توجد عروض خصم محفوظة بعد/);
  assert.match(source, /لا تظهر المسودة للعملاء/);
  assert.match(source, /لا توجد عروض مطابقة للتصفية الحالية/);
  assert.match(source, /onClick=\{startPromotionEditor\}>إنشاء أول عرض/);
});

test("a filtered empty page does not invite the creation of a duplicate offer", () => {
  assert.match(source, /appliedSearch \|\| state \|\| discountKind !== "all" \|\| fundingFilter !== "all" \|\| cursorStack\.length/);
  assert.match(source, /!appliedSearch && !state && discountKind === "all" && fundingFilter === "all" && !cursorStack\.length/);
});
