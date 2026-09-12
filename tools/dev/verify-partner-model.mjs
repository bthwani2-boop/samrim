import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const failures = [];

const cleanFiles = [
  "services/dsh/contracts/dsh.openapi.yaml",
  "services/dsh/clients/generated/dsh-types.ts",
  "services/dsh/backend/internal/contract/dsh_types_generated.go",
  "services/dsh/backend/internal/storage/postgres/001_partner_bootstrap.sql",
  "services/dsh/backend/internal/storage/postgres/partner_bootstrap.go",
  "services/dsh/backend/internal/partnerbootstrap/server.go",
  "apps/control-panel/app/(workspace)/partners/page.tsx",
  "apps/control-panel/app/components/partner-bootstrap-panel.tsx",
  "apps/control-panel/tests/live-identity.spec.ts",
  "apps/app-partner/src/partner-product-gate.tsx",
];

const forbidden = [
  "PartnerOrganization",
  "partnerOrganization",
  "partner_organizations",
  "partner_organization_id",
  "Partner Organization",
  "منظمة الشريك",
];

for (const relative of cleanFiles) {
  const absolute = path.join(root, ...relative.split("/"));
  if (!fs.existsSync(absolute)) {
    failures.push(`missing Partner-model file: ${relative}`);
    continue;
  }
  const text = fs.readFileSync(absolute, "utf8");
  for (const token of forbidden) {
    if (text.includes(token)) failures.push(`${relative} retains retired Partner-model token: ${token}`);
  }
}

const contract = fs.readFileSync(path.join(root, "services/dsh/contracts/dsh.openapi.yaml"), "utf8");
for (const required of [
  "required: [partnerActorId, firstStore, idempotentReplay]",
  "required: [id, partnerActorId, name, version, createdAt, updatedAt]",
]) {
  if (!contract.includes(required)) failures.push(`DSH contract missing canonical Partner invariant: ${required}`);
}

const migration = fs.readFileSync(path.join(root, "services/dsh/backend/internal/storage/postgres/001_partner_bootstrap.sql"), "utf8");
if (!migration.includes("partner_actor_id text NOT NULL")) failures.push("DSH migration does not persist Store→partner_actor_id directly");
if (/CREATE TABLE IF NOT EXISTS dsh\.partners\b/.test(migration)) failures.push("DSH migration creates a redundant Partner shadow table");

if (failures.length) {
  console.error("PARTNER_MODEL=FAIL");
  for (const failure of failures) console.error("  " + failure);
  process.exit(1);
}

console.log("PARTNER_MODEL=PASS");
console.log("PARTNER_IDENTITY=actor_id");
console.log("PARTNER_ROLE=partner");
console.log("PARTNER_SURFACE=app-partner");
console.log("STORE_LINK=partner_actor_id");
