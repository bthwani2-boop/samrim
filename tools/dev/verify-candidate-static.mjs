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
    "services/dsh/contracts/openapi/paths/commerce.yaml",
    "services/dsh/contracts/openapi/paths/store-publication.yaml",
    "services/dsh/contracts/openapi/paths/location-core.yaml",
    "services/dsh/contracts/openapi/paths/service-city.yaml",
    "services/dsh/contracts/openapi/paths/serviceability.yaml",
    "services/dsh/clients/generated/dsh-types.ts",
    "services/dsh/backend/internal/contract/dsh_types_generated.go",
    "services/dsh/backend/internal/storage/postgres/joining_case.go",
    "services/dsh/backend/internal/storage/postgres/catalog.go",
    "services/dsh/backend/internal/storage/postgres/catalog_public.go",
    "services/dsh/backend/internal/storage/postgres/cart.go",
    "services/dsh/backend/internal/storage/postgres/order.go",
    "services/dsh/backend/internal/storage/postgres/store_publication.go",
    "services/dsh/backend/internal/storage/postgres/location_core.go",
    "services/dsh/backend/internal/storage/postgres/service_city.go",
    "services/dsh/backend/internal/storage/postgres/serviceability.go",
    "services/dsh/backend/internal/locationcore/service.go",
    "services/dsh/backend/internal/servicecity/service.go",
    "services/dsh/backend/internal/serviceability/service.go",
    "services/dsh/backend/internal/storepublication/service.go",
    "services/dsh/backend/internal/transport/http/joiningcase.go",
    "services/dsh/backend/internal/transport/http/catalog_product.go",
    "services/dsh/backend/internal/transport/http/catalog_offer.go",
    "services/dsh/backend/internal/transport/http/cart.go",
    "services/dsh/backend/internal/transport/http/order.go",
    "services/dsh/backend/internal/transport/http/storepublication.go",
    "services/dsh/backend/internal/transport/http/locationcore.go",
    "services/dsh/backend/internal/transport/http/servicecity.go",
    "services/dsh/backend/internal/transport/http/serviceability.go",
    "apps/control-panel/app/(workspace)/partners/page.tsx",
    "apps/control-panel/src/features/partner-onboarding/joining-case-panel.tsx",
    "apps/control-panel/tests/live-identity.spec.ts",
    "apps/app-partner/src/features/partner-onboarding/store-readback.tsx",
    "apps/app-partner/src/features/partner-onboarding/joining-case-correction.tsx",
    "apps/app-partner/src/features/store-offer/store-offer.tsx",
    "apps/app-client/src/features/store-discovery/store-discovery.tsx",
    "apps/app-client/src/features/cart-checkout/cart-checkout.tsx",
    "apps/app-partner/src/features/order-management/order-management.tsx",
    "apps/control-panel/src/features/central-catalog/central-catalog.tsx",
    "services/dsh/database/migrations/004_central_product_store_assortment_cutover.sql",
    "services/dsh/database/migrations/005_joining_case_partner_correction.sql",
    "services/dsh/database/migrations/006_joining_case_correct_and_resubmit.sql",
    "services/dsh/database/migrations/007_location_core.sql",
    "services/dsh/database/migrations/008_location_core_corrective_boundaries.sql",
    "services/dsh/tools/import-catalog-products.mjs",
    "apps/app-client/src/features/location-core/location-core.tsx",
    "apps/app-client/src/features/service-city/service-city-client.ts",
    "apps/app-client/src/features/service-city/service-city-scope.tsx",
    "apps/app-client/src/features/location-core/delivery-address-client.ts",
    "apps/app-partner/src/features/location-core/store-delivery-origin.tsx",
    "apps/app-partner/src/features/location-core/store-delivery-origin-client.ts",
    "tools/dev/verify-dsh-location-runtime.mjs",
    "tools/dev/verify-dsh-runtime-core.mjs",
    "services/dsh/database/migrations/009_service_city_scope.sql",
    "services/dsh/database/migrations/010_central_catalog_refoundation.sql",
    "services/dsh/database/migrations/011_cart_checkout_order.sql",
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
    "required: [id, partnerActorId, name, serviceCityId, primaryVerticalId, version, publicationState, publicationReadiness, offers, createdAt, updatedAt]",
    "required: [id, name, serviceCity, primaryVerticalId, version, publishedAt, createdAt, updatedAt]",
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
  const cutoverMigrationPath = path.join(root, "services/dsh/database/migrations/010_central_catalog_refoundation.sql");
  const cutoverMigration = fs.existsSync(cutoverMigrationPath) ? fs.readFileSync(cutoverMigrationPath, "utf8") : "";
  const commerceMigrationPath = path.join(root, "services/dsh/database/migrations/011_cart_checkout_order.sql");
  const commerceMigration = fs.existsSync(commerceMigrationPath) ? fs.readFileSync(commerceMigrationPath, "utf8") : "";
  const correctionMigrationPath = path.join(root, "services/dsh/database/migrations/005_joining_case_partner_correction.sql");
  const correctionMigration = fs.existsSync(correctionMigrationPath) ? fs.readFileSync(correctionMigrationPath, "utf8") : "";
  const resubmitMigrationPath = path.join(root, "services/dsh/database/migrations/006_joining_case_correct_and_resubmit.sql");
  const resubmitMigration = fs.existsSync(resubmitMigrationPath) ? fs.readFileSync(resubmitMigrationPath, "utf8") : "";
  const locationMigrationPath = path.join(root, "services/dsh/database/migrations/007_location_core.sql");
  const locationMigration = fs.existsSync(locationMigrationPath) ? fs.readFileSync(locationMigrationPath, "utf8") : "";
  const locationCorrectionMigrationPath = path.join(root, "services/dsh/database/migrations/008_location_core_corrective_boundaries.sql");
  const locationCorrectionMigration = fs.existsSync(locationCorrectionMigrationPath) ? fs.readFileSync(locationCorrectionMigrationPath, "utf8") : "";
  const dshMigrationGraph = migration + "\n" + joiningMigration + "\n" + cutoverMigration + "\n" + commerceMigration + "\n" + correctionMigration + "\n" + resubmitMigration + "\n" + locationMigration + "\n" + locationCorrectionMigration;
  if (!migration.includes("partner_actor_id text NOT NULL")) failures.push("DSH baseline does not persist Store→partner_actor_id directly");
  for (const required of [
    "stores_id_partner_actor_uq",
    "joining_case_idempotency_case_fk",
    "joining_case_audit_case_fk",
  ]) {
    if (!dshMigrationGraph.includes(required)) failures.push(`DSH migration graph missing canonical integrity constraint: ${required}`);
  }
  for (const retired of [
    "services/dsh/backend/internal/storage/postgres/central_product.go",
    "services/dsh/backend/internal/storage/postgres/store_assortment.go",
    "services/dsh/backend/internal/transport/http/store_assortment.go",
    "apps/app-partner/src/features/partner-onboarding/catalog-management.tsx",
  ]) {
    if (fs.existsSync(path.join(root, ...retired.split("/")))) failures.push(`retired central Product cutover path remains: ${retired}`);
  }
  for (const forbidden of ["/dsh/stores/{storeId}/catalog/items", "CatalogItem", "CreateCatalogItem", "UpdateCatalogItem", "readOwnStoreCatalog", "createCatalogItem", "updateCatalogItem"]) {
    if (contract.includes(forbidden)) failures.push(`legacy catalog contract residue remains: ${forbidden}`);
  }
  for (const required of ["CREATE TABLE dsh.commerce_verticals", "CREATE TABLE dsh.catalog_categories", "CREATE TABLE dsh.catalog_products", "CREATE TABLE dsh.catalog_product_variants", "CREATE TABLE dsh.catalog_variant_identifiers", "CREATE TABLE dsh.catalog_media", "CREATE TABLE dsh.catalog_store_offers", "legacy central_products/store_assortments pair", "DROP TABLE dsh.central_products", "DROP TABLE dsh.store_assortments"]) {
    if (!cutoverMigration.includes(required)) failures.push(`central Product cutover migration missing invariant: ${required}`);
  }
  for (const required of ["CREATE TABLE dsh.commerce_carts", "CREATE TABLE dsh.commerce_cart_lines", "commerce_cart_lines_cart_offer_uq", "CREATE TABLE dsh.commerce_orders", "CREATE TABLE dsh.commerce_order_lines", "READY_FOR_DISPATCH", "commerce_order_checkout_cart_uq", "commerce_order_audit"]) {
    if (!commerceMigration.includes(required)) failures.push(`Cart/Checkout/Order migration missing invariant: ${required}`);
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
    "services/dsh/contracts/openapi/paths/service-city.yaml",
    "services/dsh/contracts/openapi/paths/serviceability.yaml",
    "services/dsh/contracts/openapi/paths/commerce.yaml",
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
    ["runtime core proof", runtimeCore, ["/dsh/joining-cases", "/dsh/joining-cases/", "/correct-and-resubmit", "/dsh/catalog/products", "/dsh/catalog/verticals", "/dsh/catalog/categories", "/dsh/stores/", "/dsh/public/stores/", "/auth/managed/activation/request", "PRODUCT_NOT_ELIGIBLE", "IDENTITY_UNAVAILABLE", "DSH_SCHEMA_V11=PASS", "DSH_CITY_SCOPE_RUNTIME=PASS", "DSH_CUSTOMER_VISIBLE_CATALOG=PASS", "DSH_CART_CHECKOUT=PASS", "DSH_ORDER_READY_FOR_DISPATCH=PASS"]],
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
    ["Location Core runtime proof", runtimeLocation, ["DSH_SCHEMA_V11=PASS", "LOCATION_CORE_RUNTIME=PASS", "LOCATION_CORE_PAGINATION=PASS", "LOCATION_CORE_AUTHORIZATION=PASS", "delivery_origin_version"]],
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
  if (failures.length) {
    console.error("LOCATION_CORE_STATIC=FAIL");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  console.log("LOCATION_CORE_STATIC=PASS");
  console.log("LOCATION_CORE_MAPS=NOT_ADMITTED");
  console.log("LOCATION_CORE_SERVICEABILITY_POLICY=SEPARATE_CITY_SCOPE");
}

function verifyCityScope() {
  const failures = [];
  const read = (relative) => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
  const contract = read("services/dsh/contracts/openapi/dsh.openapi.yaml") + "\n" + read("services/dsh/contracts/openapi/paths/service-city.yaml") + "\n" + read("services/dsh/contracts/openapi/paths/serviceability.yaml") + "\n" + read("services/dsh/contracts/openapi/paths/store-publication.yaml");
  const migration = read("services/dsh/database/migrations/009_service_city_scope.sql");
  const cityStorage = read("services/dsh/backend/internal/storage/postgres/service_city.go");
  const serviceabilityStorage = read("services/dsh/backend/internal/storage/postgres/serviceability.go");
  const cityService = read("services/dsh/backend/internal/servicecity/service.go");
  const serviceabilityService = read("services/dsh/backend/internal/serviceability/service.go");
  const cityTransport = read("services/dsh/backend/internal/transport/http/servicecity.go");
  const serviceabilityTransport = read("services/dsh/backend/internal/transport/http/serviceability.go");
  const mobileClient = read("services/dsh/clients/mobile.ts");
  const clientCity = read("apps/app-client/src/features/service-city/service-city-scope.tsx");
  const partnerReadback = read("apps/app-partner/src/features/partner-onboarding/store-readback.tsx");
  const controlCity = read("apps/control-panel/src/features/service-city/service-city-panel.tsx");
  const runtimeCore = read("tools/dev/verify-dsh-runtime-core.mjs");
  const generatedTS = read("services/dsh/clients/generated/dsh-types.ts");
  const generatedGo = read("services/dsh/backend/internal/contract/dsh_types_generated.go");
  for (const required of [
    "ServiceCity:", "CreateServiceCityRequest:", "UpdateServiceCityRequest:", "ServiceabilityStatus:", "ServiceabilityResponse:",
    "serviceCityId", "CITY_SCOPE_V1", "SERVICEABLE", "UNSERVICEABLE", "UNAVAILABLE", "/dsh/service-cities:", "/dsh/serviceability:",
    "service_cities", "service_city_mutation_idempotency", "service_city_audit", "service_city_id", "first_store_service_city_id",
  ]) if (!contract.includes(required) && !migration.includes(required) && !cityStorage.includes(required) && !serviceabilityService.includes(required)) failures.push(`City Scope is missing canonical invariant: ${required}`);
  for (const [name, text, tokens] of [
    ["City storage", cityStorage, ["CreateServiceCity", "UpdateServiceCity", "ErrServiceCityVersion", "pg_advisory_xact_lock", "service_city_audit"]],
    ["City service", cityService, ["ReadActorRole", "operator", "SecurityEnabled", "ActivatedAt", "ListActiveServiceCities", "CreateServiceCity"]],
    ["Serviceability storage", serviceabilityStorage, ["ReadServiceabilityFacts", "HasPublishedOffer", "EvaluatedAt"]],
    ["Serviceability service", serviceabilityService, ["PolicyVersion = \"CITY_SCOPE_V1\"", "identity.Role != \"client\"", "identity.Surface != \"app-client\"", "SERVICEABLE", "UNSERVICEABLE", "UNAVAILABLE"]],
    ["City transport", cityTransport, ["/dsh/service-cities", "ListActiveServiceCities", "Idempotency-Key"]],
    ["Serviceability transport", serviceabilityTransport, ["/dsh/serviceability", "ServiceabilityEvidence", "PolicyVersion"]],
    ["Generated TypeScript contract", generatedTS, ["ServiceCity", "ServiceabilityResponse"]],
    ["Generated Go contract", generatedGo, ["type ServiceCity struct", "type ServiceabilityResponse struct"]],
    ["Mobile DSH client", mobileClient, ["listActiveServiceCities", "listPublishedStores", "evaluateServiceability"]],
    ["app-client City gate", clientCity, ["samrim.app-client.service-city", "ServiceCityScope", "تغيير", "SecureStore"]],
    ["app-partner City readback", partnerReadback, ["listActiveServiceCities", "serviceCity"]],
    ["Control Panel City management", controlCity, ["/api/service-cities", "X-Expected-Version", "active"]],
    ["City runtime proof", runtimeCore, ["DSH_CITY_SCOPE_RUNTIME=PASS", "DSH_SERVICEABILITY=PASS", "serviceCityId", "SERVICEABLE", "UNSERVICEABLE", "UNAVAILABLE"]],
  ]) for (const token of tokens) if (!text.includes(token)) failures.push(`${name} is missing City Scope invariant: ${token}`);
  if (!migration.includes("service_cities") || !migration.includes("stores_service_city_fk") || !migration.includes("joining_cases_service_city_fk") || !migration.includes("delivery_addresses_service_city_fk")) failures.push("City Scope migration does not prove all canonical foreign-key boundaries");
  if (/\bradius\b|\bpolygon\b|\bgeofence\b|\bdistance\b|backgroundlocation|watchposition|startlocationupdates|react-native-maps/i.test([cityStorage, serviceabilityStorage, serviceabilityService, serviceabilityTransport, clientCity].join("\n"))) failures.push("City Scope admits geographic/provider or background-location authority");
  if (/latitude|longitude/i.test(serviceabilityStorage + "\n" + serviceabilityTransport)) failures.push("Serviceability evidence leaks precise coordinates");
  const appFieldDiff = execFileSync("git", ["diff", "--name-only", "--", "apps/app-field"], { cwd: root, encoding: "utf8" }).trim();
  const appFieldStatus = execFileSync("git", ["status", "--short", "--", "apps/app-field"], { cwd: root, encoding: "utf8" }).trim();
  if (appFieldDiff || appFieldStatus) failures.push("app-field changed although City Scope does not affect its onboarding-only boundary");
  if (failures.length) {
    console.error("CITY_SCOPE_STATIC=FAIL");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  console.log("CITY_SCOPE_STATIC=PASS");
  console.log("CITY_SCOPE_SERVICEABILITY_POLICY=CITY_SCOPE_V1");
  console.log("CITY_SCOPE_PROVIDER_AUTHORITY=NOT_ADMITTED");
  console.log("CITY_SCOPE_APP_FIELD=UNAFFECTED");
}

function hasSequence(tokens, words) {
  if (words.length > tokens.length) return false;
  for (let index = 0; index <= tokens.length - words.length; index += 1) {
    if (words.every((word, offset) => tokens[index + offset] === word)) return true;
  }
  return false;
}

function verifyCommerceJourney() {
  const failures = [];
  const read = (relative) => fs.readFileSync(path.join(root, ...relative.split("/")), "utf8");
  const contract = read("services/dsh/contracts/openapi/dsh.openapi.yaml") + "\n" + read("services/dsh/contracts/openapi/paths/commerce.yaml");
  const migration = read("services/dsh/database/migrations/011_cart_checkout_order.sql");
  const cartStorage = read("services/dsh/backend/internal/storage/postgres/cart.go");
  const orderStorage = read("services/dsh/backend/internal/storage/postgres/order.go");
  const cartService = read("services/dsh/backend/internal/cart/service.go");
  const orderService = read("services/dsh/backend/internal/order/service.go");
  const cartTransport = read("services/dsh/backend/internal/transport/http/cart.go");
  const orderTransport = read("services/dsh/backend/internal/transport/http/order.go");
  const main = read("services/dsh/backend/cmd/api/main.go");
  const mobile = read("services/dsh/clients/mobile.ts");
  const clientUI = read("apps/app-client/src/features/cart-checkout/cart-checkout.tsx");
  const partnerUI = read("apps/app-partner/src/features/order-management/order-management.tsx");
  const runtime = read("tools/dev/verify-dsh-runtime-core.mjs");
  const generatedTS = read("services/dsh/clients/generated/dsh-types.ts");
  const generatedGo = read("services/dsh/backend/internal/contract/dsh_types_generated.go");
  for (const required of [
    "/dsh/cart:", "/dsh/cart/lines:", "/dsh/cart/checkout:", "/dsh/orders:", "/dsh/orders/{orderId}:", "/dsh/stores/{storeId}/orders:", "/dsh/stores/{storeId}/orders/{orderId}/transition:",
    "Cart:", "CartLine:", "CheckoutRequest:", "Order:", "OrderLine:", "OrderState:", "READY_FOR_DISPATCH", "CartExpectedVersionRequired",
  ]) if (!contract.includes(required)) failures.push(`Commerce contract missing canonical invariant: ${required}`);
  for (const required of [
    "dsh.commerce_carts", "dsh.commerce_cart_lines", "dsh.commerce_cart_mutation_idempotency", "dsh.commerce_cart_audit", "dsh.commerce_orders", "dsh.commerce_order_lines", "dsh.commerce_order_checkout_idempotency", "dsh.commerce_order_transition_idempotency", "dsh.commerce_order_audit", "commerce_cart_lines_cart_offer_uq", "commerce_orders_state_chk", "commerce_order_audit_event_idempotency_uq",
  ]) if (!migration.includes(required)) failures.push(`Commerce migration missing canonical invariant: ${required}`);
  for (const [name, text, tokens] of [
    ["Cart storage", cartStorage, ["UpsertCartLine", "ReadOpenCart", "ErrCartVersionConflict", "ErrCartOfferUnavailable", "HashCartLineMutation", "commerce_cart_audit", "removed_at"]],
    ["Order storage", orderStorage, ["CreateOrderFromCart", "TransitionOrder", "HashCheckoutRequest", "HashOrderTransition", "readCustomerVisibleOfferTx", "READY_FOR_DISPATCH", "commerce_order_audit"]],
    ["Cart service", cartService, ["requireClient", "serviceability.Evaluate", "ErrCheckoutNotServiceable", "CreateOrderFromCart"]],
    ["Order service", orderService, ["requireOwnedStore", "ReadStoreOwnedByPartner", "TransitionOrder", "app-partner"]],
    ["Cart transport", cartTransport, ["/dsh/cart", "X-Expected-Version", "Idempotency-Key", "X-Actor-ID", "checkout"]],
    ["Order transport", orderTransport, ["/dsh/orders", "/dsh/stores/", "transition", "OrderTransitionRequest", "READY_FOR_DISPATCH"]],
    ["DSH API registration", main, ["NewCart", "NewOrder", "cartServer.Register", "orderServer.Register"]],
    ["Mobile DSH client", mobile, ["readOpenCart", "upsertCartLine", "checkoutCart", "listClientOrders", "transitionStoreOrder"]],
    ["Generated TypeScript contract", generatedTS, ["CartResponse", "OrderResponse", "READY_FOR_DISPATCH"]],
    ["Generated Go contract", generatedGo, ["type CartResponse struct", "type OrderResponse struct", "OrderState"]],
    ["app-client cart journey", clientUI, ["readOpenCart", "upsertCartLine", "checkoutCart", "إتمام الطلب", "serviceableAddressId"]],
    ["app-partner order journey", partnerUI, ["listStoreOrders", "transitionStoreOrder", "READY_FOR_DISPATCH", "قبول الطلب"]],
    ["Commerce runtime proof", runtime, ["DSH_CART_CHECKOUT=PASS", "DSH_ORDER_READY_FOR_DISPATCH=PASS", "cart-offer-hide", "checkout-unserviceable", "commerce_order"]],
  ]) for (const token of tokens) if (!text.includes(token)) failures.push(`${name} is missing Commerce invariant: ${token}`);
  if (/(wallet|wlt|payment|stripe|captain)/i.test([cartStorage, orderStorage, cartService, orderService, cartTransport, orderTransport].join("\n"))) failures.push("Cart/Checkout/Order implementation admits an out-of-cone payment or WLT owner");
  if (failures.length) {
    console.error("COMMERCE_JOURNEY_STATIC=FAIL");
    for (const failure of failures) console.error("  " + failure);
    process.exit(1);
  }
  console.log("COMMERCE_JOURNEY_STATIC=PASS");
  console.log("COMMERCE_ORDER_TERMINAL=READY_FOR_DISPATCH");
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
verifyCityScope();
verifyCommerceJourney();
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
