import fs from "node:fs";
import path from "node:path";
import "./execution-proof-system.mjs";
import "./verify-ci-exact-sha.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const runtimeProof = fs.readFileSync(path.join(root, "tools/dev/verify-dsh-runtime-core.mjs"), "utf8");
const staleSettlementContracts = [
  'evidenceReference: `wallet-receipt-${suffix}`',
  'statementReference: `official-wallet-statement-${suffix}`',
];
const requiredSettlementContracts = [
  '"/dsh/operator/finance-evidence-documents"',
  '"TRANSFER_RECEIPT"',
  '"SETTLEMENT_STATEMENT"',
  "receiptDocumentId: transferReceiptDocumentID",
  "statementRowId: settlementStatementRowID",
  "settlementStatementRowRecorded",
];

for (const stale of staleSettlementContracts) {
  if (runtimeProof.includes(stale)) {
    console.error(`RUNTIME_SETTLEMENT_PROOF_CONTRACT=FAIL stale=${stale}`);
    process.exit(1);
  }
}
for (const required of requiredSettlementContracts) {
  if (!runtimeProof.includes(required)) {
    console.error(`RUNTIME_SETTLEMENT_PROOF_CONTRACT=FAIL missing=${required}`);
    process.exit(1);
  }
}

console.log("RUNTIME_SETTLEMENT_PROOF_CONTRACT=PASS evidence=canonical reconciliation=statement-row");
