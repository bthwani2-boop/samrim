import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

function verifyPartnerModel() {
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
}

function normalizeTokens(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasSequence(tokens, words) {
  if (words.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - words.length; index += 1) {
    if (words.every((word, offset) => tokens[index + offset] === word)) return true;
  }
  return false;
}

function verifyRetiredFulfillmentResidue() {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));

  const retired = [
    ["part" + "ner", "del" + "ivery"],
    ["cli" + "ent", "pick" + "up"],
    ["part" + "ner", "fle" + "et"],
    ["fulfill" + "ment", "mo" + "de"],
    ["del" + "ivery", "mo" + "de"],
  ];
  const failures = [];

  for (const file of tracked) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;

    const pathTokens = normalizeTokens(file);
    for (const words of retired) {
      if (hasSequence(pathTokens, words)) failures.push(`${file} -> retired fulfillment path concept: ${words.join(" ")}`);
    }

    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue;
    const contentTokens = normalizeTokens(buffer.toString("utf8"));
    for (const words of retired) {
      if (hasSequence(contentTokens, words)) failures.push(`${file} -> retired fulfillment content concept: ${words.join(" ")}`);
    }
  }

  if (failures.length) {
    console.error("RETIRED_FULFILLMENT_RESIDUE=FAIL");
    for (const failure of [...new Set(failures)].sort()) console.error("  " + failure);
    process.exit(1);
  }

  console.log("RETIRED_FULFILLMENT_RESIDUE=0");
  console.log("CANONICAL_FULFILLMENT_PATH=BTHWANI_DELIVERY");
}

verifyPartnerModel();
verifyRetiredFulfillmentResidue();

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const checks = [
  ["repository liveness", ["run", "repository:verify-liveness"]],
  ["workspace verification", ["run", "workspace:verify"]],
];

for (const [name, args] of checks) {
  console.log(`=== CANONICAL STATIC: ${name} ===`);
  const result = spawnSync(pnpm, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.error) {
    console.error(`CANDIDATE_STATIC=FAIL check=${name} error=${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`CANDIDATE_STATIC=FAIL check=${name} exit=${result.status ?? "unknown"}`);
    process.exit(result.status ?? 1);
  }
}

console.log("CANDIDATE_STATIC=PASS");
