import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/finance/beneficiaries/route.ts", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../src/features/finance/finance-unified-settlements.tsx", import.meta.url), "utf8");
const wlt = readFileSync(new URL("../../../services/wlt/backend/internal/storage/postgres/settlement_intake.go", import.meta.url), "utf8");
const dsh = readFileSync(new URL("../../../services/dsh/backend/internal/transport/http/beneficiary_finance.go", import.meta.url), "utf8");

test("retired Field history is accessible only via the Finance-protected GET registry", () => {
  assert.match(route, /export async function GET\(/);
  assert.doesNotMatch(route, /export async function POST\(/);
  assert.match(route, /identity\.permissions\?\.includes\("finance"\)/);
  assert.match(route, /actorType !== "field"/);
  assert.match(dsh, /func \(s \*BeneficiaryFinanceServer\) authorizeAndRequireOperator[\s\S]*?requirePermission\(w, r\.Context\(\), actorID, "finance"\)/);
});

test("Field remains a separate historical read-only selection with no payout actions", () => {
  assert.match(workspace, /<option value="field">الميدان — سجلات تاريخية<\/option>/);
  assert.match(workspace, /active\.actorType==="field"\?<p role="status"/);
  assert.match(workspace, /advanced&&active&&active\.actorType!=="field"/);
  assert.match(workspace, /actor===\"all\"\?\["partner","captain"\]/);
});

test("Field payout intake stays retired in the WLT persistence owner", () => {
  assert.match(wlt, /input\.ActorType != "captain" && input\.ActorType != "partner"/);
});
