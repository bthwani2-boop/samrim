import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");

function verifyPartnerModel() {
  const failures = [];
  const requiredFiles = [
    "services/dsh/contracts/openapi/dsh.openapi.yaml",
    "services/dsh/contracts/openapi/paths/runtime.yaml",
    "services/dsh/contracts/openapi/paths/joining-cases.yaml",
    "services/dsh/contracts/openapi/paths/catalog.yaml",
    "services/dsh/contracts/openapi/paths/store-publication.yaml",
    "services/dsh/contracts/openapi/paths/location-core.yaml",
    "services/dsh/clients/generated/dsh-types.ts",
    "services/dsh/backend/internal/contract/dsh_types_generated.go",
    "services/dsh/backend/internal/storage/postgres/joining_case.go",
    "services/dsh/backend/internal/storage/postgres/central_product.go",
    "services/dsh/backend/internal/storage/postgres/store_assortment.go",
    "services/dsh/backend/internal/storage/postgres/store_publication.go",
    "services/dsh/backend/internal/storage/postgres/location_core.go",
    "services/dsh/backend/internal/locationcore/service.go",
    "services/dsh/backend/internal/storepublication/service.go",
    "services/dsh/backend/internal/transport/http/joiningcase.go",
    "services/dsh/backend/internal/transport/http/catalog_product.go",
    "services/dsh/backend/internal/transport/http/store_assortment.go",
    "services/dsh/backend/internal/transport/http/storepublication.go",
    "services/dsh/backend/internal/transport/http/locationcore.go",
    "apps/control-panel/app/(workspace)/partners/page.tsx",
    "apps/control-panel/src/features/partner-onboarding/joining-case-panel.tsx",
    "apps/control-panel/tests/live-identity.spec.ts",
    "apps/app-partner/src/features/partner-onboarding/store-readback.tsx",
    "apps/app-partner/src/features/partner-onboarding/joining-case-correction.tsx",
    "apps/app-partner/src/features/store-assortment/store-assortment.tsx",
    "apps/app-client/src/features/store-discovery/store-discovery.tsx",
    "apps/control-panel/src/features/central-catalog/central-catalog.tsx",
    "services/dsh/database/migrations/004_central_product_store_assortment_cutover.sql",
    "services/dsh/database/migrations/005_joining_case_partner_correction.sql",
    "services/dsh/database/migrations/006_joining_case_correct_and_resubmit.sql",
    "services/dsh/database/migrations/007_location_core.sql",
    "services/dsh/database/migrations/008_location_core_corrective_boundaries.sql",
    "services/dsh/tools/import-central-products.mjs",
    "apps/app-client/src/features/location-core/location-core.tsx",
    "apps/app-client/src/features/location-core/delivery-address-client.ts",
    "apps/app-partner/src/features/location-core/store-delivery-origin.tsx",
    "apps/app-partner/src/features/location-core/store-delivery-origin-client.ts",
    "tools/dev/verify-dsh-location-runtime.mjs",
  ];
  for (const relative of requiredFiles) {
    const absolute = path.join(root, ...relative.split("/"));
    if (!fs.existsSync(absolute)) {
      failures.push(`missing Partner-model file: ${relative}`);
    }
  }

  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
  const retiredPartnerTokens = [
    ["Partner", "Organization"].join(""),
    ["partner", "Organization"].join(""),
    ["partner", "organizations"].join("_"),
    ["partner", "organization", "id"].join("_"),
    ["Partner", " ", "Organization"].join(""),
    ["منظمة", " ", "الشريك"].join(""),
  ];
  let residueMatches = 0;
  for (const file of tracked) {
    const absolute = path.join(root, file);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    const buffer = fs.readFileSync(absolute);
    if (buffer.includes(0)) continue;
    const text = buffer.toString("utf8");
    for (const token of retiredPartnerTokens) {
      if (!text.includes(token)) continue;
      residueMatches += 1;
      failures.push(`current Partner-model residue: ${file} contains retired token`);
      break;
    }
  }
  if (residueMatches > 0) failures.push(`current Partner-model residue count is non-zero: ${residueMatches}`);

  const contract = requiredFiles
    .filter((relative) => relative.startsWith("services/dsh/contracts/openapi/"))
    .map((relative) => fs.readFileSync(path.join(root, relative), "utf8"))
    .join("\n");
  for (const required of [
    "required: [case, idempotentReplay]",
    "required: [id, partnerActorId, name, version, publicationState, publicationReadiness, assortments, createdAt, updatedAt]",
    "required: [id, name, version, assortments, publishedAt, createdAt, updatedAt]",
  ]) {
    if (!contract.includes(required)) failures.push(`DSH contract missing canonical Partner invariant: ${required}`);
  }

  const migrationPath = path.join(root, "services/dsh/database/migrations/001_partner_store_baseline.sql");
  if (fs.existsSync(path.join(root, "services/dsh/backend/internal/storage/postgres/001_partner_store_baseline.sql"))) {
    failures.push("DSH baseline migration remains in the legacy storage path");
  }
  if (!fs.existsSync(migrationPath)) {
    failures.push("DSH canonical migration is missing: services/dsh/database/migrations/001_partner_store_baseline.sql");
  }
  const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
  const joiningMigrationPath = path.join(root, "services/dsh/database/migrations/003_joining_cases_and_catalog.sql");
  const joiningMigration = fs.existsSync(joiningMigrationPath) ? fs.readFileSync(joiningMigrationPath, "utf8") : "";
  const cutoverMigrationPath = path.join(root, "services/dsh/database/migrations/004_central_product_store_assortment_cutover.sql");
  const cutoverMigration = fs.existsSync(cutoverMigrationPath) ? fs.readFileSync(cutoverMigrationPath, "utf8") : "";
  const correctionMigrationPath = path.join(root, "services/dsh/database/migrations/005_joining_case_partner_correction.sql");
  const correctionMigration = fs.existsSync(correctionMigrationPath) ? fs.readFileSync(correctionMigrationPath, "utf8") : "";
  const resubmitMigrationPath = path.join(root, "services/dsh/database/migrations/006_joining_case_correct_and_resubmit.sql");
  const resubmitMigration = fs.existsSync(resubmitMigrationPath) ? fs.readFileSync(resubmitMigrationPath, "utf8") : "";
  const locationMigrationPath = path.join(root, "services/dsh/database/migrations/007_location_core.sql");
  const locationMigration = fs.existsSync(locationMigrationPath) ? fs.readFileSync(locationMigrationPath, "utf8") : "";
  const locationCorrectionMigrationPath = path.join(root, "services/dsh/database/migrations/008_location_core_corrective_boundaries.sql");
  const locationCorrectionMigration = fs.existsSync(locationCorrectionMigrationPath) ? fs.readFileSync(locationCorrectionMigrationPath, "utf8") : "";
  const dshMigrationGraph = migration + "\n" + joiningMigration + "\n" + cutoverMigration + "\n" + correctionMigration + "\n" + resubmitMigration + "\n" + locationMigration + "\n" + locationCorrectionMigration;
  if (!migration.includes("partner_actor_id text NOT NULL")) failures.push("DSH baseline does not persist Store→partner_actor_id directly");
  for (const required of [
    "stores_id_partner_actor_uq",
    "joining_case_idempotency_case_fk",
    "joining_case_audit_case_fk",
  ]) {
    if (!dshMigrationGraph.includes(required)) failures.push(`DSH migration graph missing canonical integrity constraint: ${required}`);
  }
  for (const retired of [
    "services/dsh/backend/internal/storage/postgres/catalog.go",
    "services/dsh/backend/internal/transport/http/catalog.go",
    "apps/app-partner/src/features/partner-onboarding/catalog-management.tsx",
  ]) {
    if (fs.existsSync(path.join(root, ...retired.split("/")))) failures.push(`retired central Product cutover path remains: ${retired}`);
  }
  for (const forbidden of ["/dsh/stores/{storeId}/catalog/items", "CatalogItem", "CreateCatalogItem", "UpdateCatalogItem", "readOwnStoreCatalog", "createCatalogItem", "updateCatalogItem"]) {
    if (contract.includes(forbidden)) failures.push(`legacy catalog contract residue remains: ${forbidden}`);
  }
  for (const required of ["central_products", "central_product_mutation_idempotency", "central_product_audit", "store_assortments", "store_assortment_mutation_idempotency", "store_assortment_audit", "legacy catalog evidence is non-empty"]) {
    if (!cutoverMigration.includes(required)) failures.push(`central Product cutover migration missing invariant: ${required}`);
  }
  const publicationMigrationPath = path.join(root, "services/dsh/database/migrations/002_store_publication.sql");
  if (!fs.existsSync(publicationMigrationPath)) failures.push("DSH Store publication migration is missing");
  const publicationMigration = fs.existsSync(publicationMigrationPath) ? fs.readFileSync(publicationMigrationPath, "utf8") : "";
  for (const required of [
    "publication_state text NOT NULL DEFAULT 'unpublished'",
    "store_publication_idempotency",
    "store_publication_audit",
    "store_publication_audit_event_idempotency_uq",
  ]) {
    if (!publicationMigration.includes(required)) failures.push(`DSH Store publication migration missing canonical invariant: ${required}`);
  }
  const publicViewStart = contract.indexOf("    PublicStoreView:");
  const publicViewEnd = contract.indexOf("    PublishedStoreListResponse:", publicViewStart);
  const publicView = publicViewStart >= 0 && publicViewEnd > publicViewStart ? contract.slice(publicViewStart, publicViewEnd) : "";
  if (publicView.includes("partnerActorId")) failures.push("PublicStoreView leaks private partnerActorId scope");
  if (!contract.includes("/dsh/public/stores:") || !contract.includes("/dsh/stores/{storeId}/publication:")) failures.push("DSH publication and public discovery paths are missing");

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
  console.log("PARTNER_MODEL_RESIDUE=0");
}

function verifyPublicationReadiness() {
  const failures = [];
  const contract = [
    "services/dsh/contracts/openapi/dsh.openapi.yaml",
    "services/dsh/contracts/openapi/paths/runtime.yaml",
    "services/dsh/contracts/openapi/paths/joining-cases.yaml",
    "services/dsh/contracts/openapi/paths/catalog.yaml",
    "services/dsh/contracts/openapi/paths/store-publication.yaml",
  ].map((relative) => fs.readFileSync(path.join(root, relative), "utf8")).join("\n");
  const generatedTS = fs.readFileSync(path.join(root, "services/dsh/clients/generated/dsh-types.ts"), "utf8");
  const generatedGo = fs.readFileSync(path.join(root, "services/dsh/backend/internal/contract/dsh_types_generated.go"), "utf8");
  const service = fs.readFileSync(path.join(root, "services/dsh/backend/internal/storepublication/service.go"), "utf8");
  const storage = fs.readFileSync(path.join(root, "services/dsh/backend/internal/storage/postgres/store_publication.go"), "utf8");
  const runtimeEntrypoint = fs.readFileSync(path.join(root, "tools/dev/verify-dsh-runtime.mjs"), "utf8");
  const runtimeCore = fs.readFileSync(path.join(root, "tools/dev/verify-dsh-runtime-core.mjs"), "utf8");

  for (const forbidden of ["CatalogItem", "CreateCatalogItem", "UpdateCatalogItem", "readOwnStoreCatalog", "createCatalogItem", "updateCatalogItem"]) {
    if (generatedTS.includes(forbidden) || generatedGo.includes(forbidden)) failures.push(`legacy generated catalog contract residue remains: ${forbidden}`);
  }

  for (const [name, text, tokens] of [
    ["OpenAPI contract", contract, ["StorePublicationReadiness:", "PARTNER_IDENTITY_NOT_ELIGIBLE", "publicationReadiness:"]],
    ["generated TypeScript contract", generatedTS, ["StorePublicationReadiness", "publicationReadiness"]],
    ["generated Go contract", generatedGo, ["type StorePublicationReadiness struct", "PublicationReadiness"]],
    ["publication service", service, ["SetStorePublicationWithGuard", "ReadinessForStore", "ErrPublicationReadinessBlocked", "ErrPartnerIdentityUnavailable"]],
    ["publication storage", storage, ["PublicationGuard", "before any publication state, idempotency, or audit row is written"]],
    ["runtime entrypoint", runtimeEntrypoint, ["verify-dsh-runtime-core.mjs", "ROLE_ELIGIBILITY_ONLY", "PASSKEY_PROOF=EXTERNAL_TO_THIS_CHECK", "spawnSync(process.execPath, [corePath"]],
    ["runtime core proof", runtimeCore, ["/dsh/joining-cases", "/dsh/joining-cases/", "/correct-and-resubmit", "/dsh/catalog/products", "/dsh/stores/", "/auth/managed/activation/request", "PRODUCT_DISABLED", "IDENTITY_UNAVAILABLE", "DSH_SCHEMA_V8=PASS"]],
  ]) {
    for (const token of tokens) if (!text.includes(token)) failures.push(`${name} is missing readiness invariant: ${token}`);
  }
  if (runtimeCore.includes("/dsh/partner-bootstrap") || runtimeCore.includes("partnerBootstrap")) failures.push("runtime core proof still uses the retired Partner bootstrap contract");
  if (service.includes("return postgres.ListPublishedStores(ctx, s.db)")) failures.push("public discovery still bypasses live Partner readiness evaluation");
  if (service.includes("return postgres.SetStorePublication(ctx, s.db")) failures.push("publication write still bypasses the guarded canonical writer");

  try {
    execFileSync(process.execPath, ["services/dsh/tools/generate-types.mjs", "--check"], { cwd: root, stdio: "inherit" });
  } catch {
    failures.push("generated DSH contracts are stale");
  }

  if (failures.length) {
    console.error("PUBLICATION_READINESS=FAIL");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  console.log("PUBLICATION_READINESS=PASS");
}

function normalizeTokens(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function verifyLocationCore() {
  const failures = [];
  const read = (relative) => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
  const contract = read("services/dsh/contracts/openapi/dsh.openapi.yaml") + "\n" + read("services/dsh/contracts/openapi/paths/location-core.yaml");
  const migration = read("services/dsh/database/migrations/007_location_core.sql");
  const correctiveMigration = read("services/dsh/database/migrations/008_location_core_corrective_boundaries.sql");
  const storage = read("services/dsh/backend/internal/storage/postgres/location_core.go");
  const storePublicationStorage = read("services/dsh/backend/internal/storage/postgres/store_publication.go");
  const service = read("services/dsh/backend/internal/locationcore/service.go");
  const transport = read("services/dsh/backend/internal/transport/http/locationcore.go");
  const mobileClient = read("services/dsh/clients/mobile.ts");
  const runtimeLocation = read("tools/dev/verify-dsh-location-runtime.mjs");
  const clientUI = read("apps/app-client/src/features/location-core/location-core.tsx");
  const partnerUI = read("apps/app-partner/src/features/location-core/store-delivery-origin.tsx");
  const generatedTS = read("services/dsh/clients/generated/dsh-types.ts");
  const generatedGo = read("services/dsh/backend/internal/contract/dsh_types_generated.go");
  for (const required of [
    "DeliveryOrigin:",
    "DeliveryAddress:",
    "CreateDeliveryAddressRequest:",
    "UpdateDeliveryAddressRequest:",
    "DeliveryAddressListResponse:",
    "/dsh/addresses:",
    "/dsh/addresses/{addressId}:",
    "/dsh/stores/{storeId}/delivery-origin:",
    "OriginVersionRequired",
    "originVersion:",
  ]) if (!contract.includes(required)) failures.push(`Location Core contract missing: ${required}`);
  for (const required of [
    "dsh.delivery_addresses",
    "dsh.delivery_address_mutation_idempotency",
    "dsh.delivery_address_audit",
    "dsh.store_origin_mutation_idempotency",
    "dsh.store_origin_audit",
    "stores_delivery_origin_pair_chk",
    "delivery_addresses_latitude_chk",
    "delivery_addresses_longitude_chk",
  ]) if (!migration.includes(required)) failures.push(`Location Core migration missing: ${required}`);
  for (const required of [
    "delivery_origin_version",
    "delivery_origin_updated_at",
    "stores_delivery_origin_version_chk",
    "stores_delivery_origin_updated_at_chk",
    "DROP COLUMN result_version",
    "DROP CONSTRAINT store_origin_idempotency_expected_version_chk",
    "expected_version >= 0",
    "DROP COLUMN address_text",
    "DROP COLUMN latitude",
    "DROP COLUMN longitude",
  ]) if (!correctiveMigration.includes(required)) failures.push(`Location Core corrective migration missing: ${required}`);
  for (const [name, text, tokens] of [
    ["Location Core storage", storage, ["CreateDeliveryAddress", "UpdateDeliveryAddress", "SetStoreDeliveryOrigin", "DeliveryAddressListResult", "deliveryAddressCursor", "pg_advisory_xact_lock", "ErrDeliveryAddressVersion", "ErrStoreOriginVersion"]],
    ["Location Core service", service, ["identity.Role != \"client\"", "identity.Surface != \"app-client\"", "identity.Role != \"partner\"", "identity.Surface != \"app-partner\"", "ReadStoreOwnedByPartner"]],
    ["Location Core transport", transport, ["X-Actor-ID", "X-Acting-Actor-ID", "X-Expected-Version", "Idempotency-Key", "ErrDeliveryAddressInvalidCursor"]],
    ["mobile DSH client", mobileClient, ["listOwnDeliveryAddresses", "createOwnDeliveryAddress", "readStoreDeliveryOrigin", "setStoreDeliveryOrigin", "DeliveryAddressListResponse"]],
    ["Location Core runtime proof", runtimeLocation, ["DSH_SCHEMA_V8=PASS", "LOCATION_CORE_RUNTIME=PASS", "LOCATION_CORE_PAGINATION=PASS", "LOCATION_CORE_AUTHORIZATION=PASS", "delivery_origin_version"]],
    ["app-client Location Core", clientUI, ["requestForegroundPermissionsAsync", "getCurrentPositionAsync", "تم تحديد الموقع", "nextCursor", "عرض المزيد"]],
    ["app-partner Location Core", partnerUI, ["requestForegroundPermissionsAsync", "getCurrentPositionAsync", "تم حفظ موقع أصل المتجر", "originVersion"]],
  ]) for (const token of tokens) if (!text.includes(token)) failures.push(`${name} is missing Location Core invariant: ${token}`);
  const retiredLocationOwnershipError = ["Err", "Store", "Ownership", "Forbidden"].join("");
  const retiredStoreOriginOwnershipError = ["Err", "Store", "Origin", "Ownership"].join("");
  if (service.includes(retiredLocationOwnershipError)) failures.push("Location Core service retains a dead Store ownership error authority");
  if (storage.includes(retiredStoreOriginOwnershipError)) failures.push("Location Core storage retains a dead Store-origin ownership error authority");
  if (transport.includes("locationcore." + retiredLocationOwnershipError) || transport.includes("postgres." + retiredStoreOriginOwnershipError)) failures.push("Location Core transport retains an obsolete ownership 403 mapping");
  const storeViewStart = contract.indexOf("    StoreView:");
  const storeViewEnd = contract.indexOf("    PublicationState:", storeViewStart);
  const storeView = storeViewStart >= 0 && storeViewEnd > storeViewStart ? contract.slice(storeViewStart, storeViewEnd) : "";
  if (!storeView || storeView.includes("deliveryOrigin") || storeView.includes("latitude") || storeView.includes("longitude")) failures.push("generic StoreView exposes precise delivery-origin fields");
  if (storage.includes("StoreVersion") || storePublicationStorage.includes("DeliveryOriginLatitude")) failures.push("Store publication/location storage retains the retired shared Store-version origin model");
  const permissionFunctionStart = clientUI.indexOf("async function captureLocation");
  const clientPermissionCall = clientUI.indexOf("requestForegroundPermissionsAsync");
  const partnerPermissionFunctionStart = partnerUI.indexOf("async function captureLocation");
  const partnerPermissionCall = partnerUI.indexOf("requestForegroundPermissionsAsync");
  if (permissionFunctionStart < 0 || clientPermissionCall < permissionFunctionStart || partnerPermissionFunctionStart < 0 || partnerPermissionCall < partnerPermissionFunctionStart) failures.push("foreground location permission is not confined to an explicit capture action");
  for (const [name, text] of [["app-client Location Core", clientUI], ["app-partner Location Core", partnerUI]]) {
    if (/watchPosition|startLocationUpdates|backgroundLocation|MapView|react-native-maps/i.test(text)) failures.push(`${name} admits background/maps location behavior`);
    if (/coordinates\.(latitude|longitude)\s*<\/Text>|origin\.(latitude|longitude)\s*<\/Text>/.test(text)) failures.push(`${name} renders raw coordinates in normal UI`);
  }
  if (!generatedTS.includes("nextCursor") || !generatedGo.includes("NextCursor") || !generatedTS.includes("originVersion") || !generatedGo.includes("OriginVersion")) failures.push("generated Location Core contracts are missing v8 ownership fields");
  for (const app of ["app-client", "app-partner", "app-captain", "app-field"]) {
    const config = JSON.parse(read(`apps/${app}/mobile.config.json`));
    const pkg = JSON.parse(read(`apps/${app}/package.json`));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (config.nativeCapabilities.includes("maps")) failures.push(`${app}: maps capability must remain unadmitted in Location Core`);
    if (deps["react-native-maps"]) failures.push(`${app}: react-native-maps must not be added without proven provider provisioning`);
  }
  if (transport.includes("serviceability") || storage.includes("serviceability") || mobileClient.includes("serviceability")) failures.push("Location Core admits deferred serviceability semantics");
  if (failures.length) {
    console.error("LOCATION_CORE_STATIC=FAIL");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  console.log("LOCATION_CORE_STATIC=PASS");
  console.log("LOCATION_CORE_MAPS=NOT_ADMITTED");
  console.log("LOCATION_CORE_SERVICEABILITY_POLICY=DEFERRED");
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

  // These sequences are specific to the retired commerce/fulfillment model.
  // Do not ban generic transport vocabulary used by unrelated domains such as
  // Identity challenge delivery (Mailpit/Twilio/webhook selection).
  const retired = [
    ["part" + "ner", "del" + "ivery"],
    ["cli" + "ent", "pick" + "up"],
    ["part" + "ner", "fle" + "et"],
    ["fulfill" + "ment", "mo" + "de"],
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
verifyPublicationReadiness();
verifyLocationCore();
verifyRetiredFulfillmentResidue();

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const checks = [
  ["repository liveness", ["exec", "knip", "--no-progress", "--reporter", "compact", "--no-config-hints"]],
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
