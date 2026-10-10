import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const app = process.argv[2];
if (!app) {
  console.error("Usage: node test-mobile-app.mjs <app-name>");
  process.exit(1);
}

const role =
  app === "app-client" ? "client" :
  app === "app-partner" ? "partner" :
  app === "app-captain" ? "captain" :
  app === "app-field" ? "field" : null;

if (!role) {
  console.error(`Unknown mobile app: ${app}`);
  throw new Error("Mobile app must be one of the supported application names");
}

const root = path.resolve(import.meta.dirname, "../..");
const appDir = path.join(root, "apps", app);
const surface = app;

// 1. Structural and Configuration Verification
const configPath = path.join(appDir, "mobile.config.json");
assert.ok(fs.existsSync(configPath), `${app}: missing mobile.config.json`);
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
assert.equal(Object.hasOwn(config, "nativeCapabilities"), false, `${app}: nativeCapabilities shadow registry survived`);

// 2. Current native/config contract verification.
const pkgPath = path.join(appDir, "package.json");
assert.ok(fs.existsSync(pkgPath), `${app}: missing package.json`);
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
assert.equal(allDeps["expo-localization"], "57.0.2", `${app}: static RTL requires expo-localization`);

  const identityPath = path.join(appDir, "src", "bootstrap", "identity.ts");
  assert.ok(fs.existsSync(identityPath), `${app}: missing src/bootstrap/identity.ts`);
const identityContent = fs.readFileSync(identityPath, "utf8");
assert.ok(identityContent.includes(`const role = "${role}"`), `${app}: wrong role in src/bootstrap/identity.ts`);
assert.ok(identityContent.includes(`const surface = "${surface}"`), `${app}: wrong surface in src/bootstrap/identity.ts`);

const entryPath = path.join(appDir, "app", "index.tsx");
assert.ok(fs.existsSync(entryPath), `${app}: missing app/index.tsx`);

// The authenticated application must be a real route tree. The identity
// surface remains the unauthenticated entry point; it must not own the
// authenticated workflow body or act as a navigation substitute.
const routePaths =
  app === "app-client" ? ["home.tsx", "orders.tsx", "orders/[orderId].tsx", "cart/[storeId].tsx", "wallet-cash-in.tsx", "account.tsx"] :
  app === "app-partner" ? ["store.tsx", "orders.tsx", "onboarding.tsx", "account.tsx"] :
  app === "app-captain" ? ["home.tsx", "offers.tsx", "deliveries.tsx", "account.tsx"] :
  ["home.tsx", "cases.tsx", "wallet.tsx", "new-case.tsx", "account.tsx"];
const appRouteDir = path.join(appDir, "app", "(app)");
assert.ok(fs.existsSync(path.join(appRouteDir, "_layout.tsx")), `${app}: missing authenticated route layout`);
assert.ok(fs.readFileSync(path.join(appRouteDir, "_layout.tsx"), "utf8").includes("AuthenticatedMobileBoundary"), `${app}: authenticated routes must be session guarded`);
for (const routePath of routePaths) assert.ok(fs.existsSync(path.join(appRouteDir, routePath)), `${app}: missing route ${routePath}`);
if (app === "app-client") assert.ok(fs.existsSync(path.join(appDir, "app", "store", "[storeId].tsx")), `${app}: missing public store catalog route`);
const shellPath = path.join(appDir, "src", "shell", `${role}-shell.tsx`);
assert.ok(fs.existsSync(shellPath), `${app}: missing actor-specific application shell`);
const shellContent = fs.readFileSync(shellPath, "utf8");
assert.ok(!shellContent.includes('accessibilityRole="tablist"'), `${app}: manual bottom navigation must not remain beside the canonical Tabs owner`);
assert.ok(!shellContent.includes("<Slot />"), `${app}: application shell must not own a parallel Expo Router slot`);
  assert.ok(shellContent.includes('flexDirection: "row"'), `${app}: application shell must use the native logical row direction`);
  assert.ok(!shellContent.includes("direction:"), `${app}: application shell must not duplicate Expo RTL direction ownership`);
  assert.ok(!shellContent.includes("textAlign:"), `${app}: application shell must not duplicate text alignment ownership`);
  const navigationStyle = shellContent.match(/navigation:\s*\{([^}]*)\}/)?.[1] ?? "";
  assert.ok(!navigationStyle.includes("direction:") && !navigationStyle.includes("flexDirection:") && !navigationStyle.includes("row-reverse"), `${app}: native tab bar must use Expo Router route order, not a manual direction override`);
  assert.ok(!navigationStyle.includes("paddingBottom:") && !navigationStyle.includes("paddingVertical:"), `${app}: native tab bar must own the bottom safe-area inset; do not override it in tabBarStyle`);
const layoutContent = fs.readFileSync(path.join(appRouteDir, "_layout.tsx"), "utf8");
assert.ok(layoutContent.includes("Tabs"), `${app}: authenticated layout must declare stable Expo Router JS Tabs`);
assert.ok(layoutContent.includes("<Tabs"), `${app}: authenticated layout must compose route content through Expo Router Tabs`);
if (app === "app-client") {
  assert.ok(layoutContent.includes('<Tabs.Screen name="wallet-cash-in"'), `${app}: Cash-In route must be registered in the authenticated route tree`);
  assert.ok(layoutContent.includes('pathname === "/wallet-cash-in"'), `${app}: Cash-In route must require an authenticated session`);
}
const tabRoutes =
  app === "app-client" ? ["home", "orders", "account", "cart/[storeId]", "orders/[orderId]"] :
  app === "app-partner" ? ["store", "orders", "account", "onboarding"] :
  app === "app-captain" ? ["home", "offers", "deliveries", "account"] :
  ["home", "cases", "wallet", "account", "new-case"];
 let previousTabRouteIndex = -1;
 for (const tabRoute of tabRoutes) {
   const tabRouteIndex = layoutContent.indexOf(`<Tabs.Screen name="${tabRoute}"`);
   assert.ok(tabRouteIndex >= 0, `${app}: missing canonical Tabs route ${tabRoute}`);
   assert.ok(tabRouteIndex > previousTabRouteIndex, `${app}: canonical Tabs route order drifted at ${tabRoute}`);
   previousTabRouteIndex = tabRouteIndex;
 }
const identityGatePath = path.join(appDir, "src", "features", "access", "identity-gate.tsx");
const identityGateContent = fs.readFileSync(identityGatePath, "utf8");
const notificationsRouteContent = fs.readFileSync(path.join(appDir, "app", "notifications.tsx"), "utf8");
assert.ok(notificationsRouteContent.includes("AuthenticatedMobileBoundary"), `${app}: notifications route must wait for authenticated session restoration`);
assert.ok(notificationsRouteContent.includes("restoreIdentitySession") && notificationsRouteContent.includes("subscribeIdentitySession"), `${app}: notifications route must restore and subscribe to identity state`);
assert.ok(notificationsRouteContent.includes("/?returnTo=/notifications"), `${app}: notifications route must preserve its return destination after sign-in`);
assert.ok(identityGateContent.includes("notifications"), `${app}: identity gate must allow the notifications return path`);
if (app === "app-client") {
  assert.ok(!identityGateContent.includes("LocationCore"), `${app}: identity gate must not own the account workflow`);
  assert.ok(!identityGateContent.includes("ClientOrders"), `${app}: identity gate must not own the orders workflow`);
} else {
  assert.ok(identityGateContent.includes("authenticatedContent={<Redirect"), `${app}: managed identity gate must redirect into the authenticated route tree`);
}
console.log(`MOBILE_ROUTE_TREE=PASS app=${app} routes=${routePaths.join(",")}`);
if (app === "app-partner") {
  const storeOfferContent = fs.readFileSync(path.join(appDir, "src", "features", "store-offer", "store-offer.tsx"), "utf8");
  assert.ok(storeOfferContent.includes("label={category.pathAr}"), `${app}: shared catalog category choices must display their full hierarchy path`);
  console.log("MOBILE_CATALOG_CATEGORY_PATH=PASS shared catalog proposals display the full category hierarchy");
  for (const route of ["store", "orders", "wallet"]) {
    const routeContent = fs.readFileSync(path.join(appRouteDir, `${route}.tsx`), "utf8");
    assert.ok(routeContent.includes(`PartnerSurfaceGate surface="${route}"`), `${app}: the ${route} route must be guarded by the authority surface gate`);
  }
  assert.ok(layoutContent.includes('authority.canUse("store")') && layoutContent.includes('authority.canUse("orders")') && layoutContent.includes('authority.canUse("wallet")'), `${app}: tab visibility must derive from the live authority projection`);
  assert.equal(layoutContent.split("{ href: null }").length, 5, `${app}: exactly the three authority-gated tabs plus onboarding may be hidden from navigation`);
  assert.ok(shellContent.includes("canSearchOrders"), `${app}: the header search entry must be gated by orders authority`);
  assert.ok(shellContent.includes('navigate("orders", { focus: "search" })'), `${app}: the authorized search entry must keep targeting the orders surface`);
  const accountContent = fs.readFileSync(path.join(appDir, "src", "features", "account", "account.tsx"), "utf8");
  assert.ok(accountContent.includes("usePartnerStoreScope") && accountContent.includes("authority.canUse"), `${app}: account workspace entry points must derive from live authority`);
  assert.ok(accountContent.includes("PartnerAccessInvitationsCard"), `${app}: the account surface must keep identity-directed access invitations reachable`);
  const partnerStoreContent = fs.readFileSync(path.join(appDir, "src", "features", "partner-onboarding", "partner-store.tsx"), "utf8");
  assert.ok(partnerStoreContent.includes("STORE_SURFACE_PERMISSIONS"), `${app}: the Store surface selector must list only stores with material store functions`);
  assert.ok(partnerStoreContent.includes("isStoreSurfaceEligible"), `${app}: the Store surface must land on a store with material store functions`);
  const partnerOrdersContent = fs.readFileSync(path.join(appDir, "src", "features", "partner-onboarding", "partner-orders.tsx"), "utf8");
  assert.ok(partnerOrdersContent.includes('requiredPermissions={["orders"]}'), `${app}: the orders selector must stay scoped to stores granting orders`);
  const storeAccessContent = fs.readFileSync(path.join(appDir, "src", "features", "partner-onboarding", "partner-store-access.tsx"), "utf8");
  assert.ok(!storeAccessContent.includes("listOwnStoreAccessInvitations"), `${app}: owner-side store access must not duplicate the actor-directed invitations readback owner`);
  assert.ok(storeAccessContent.includes("storeID: string"), `${app}: owner-side store access must require an owned store`);
}

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register(pathToFileURL(path.join(root, "packages/design-system/tools/ts-resolver.mjs")).href, import.meta.url);
if (app === "app-field") {
  const newCaseRoute = fs.readFileSync(path.join(appDir, "app/(app)/new-case.tsx"), "utf8");
  assert.match(newCaseRoute, /key=\{`field-case:\$\{caseId\}`\}/, "app-field: changing the edited case identity must remount the draft editor rather than reuse another partner's state");
  const admissionProviderOpen = layoutContent.indexOf("<FieldAdmissionProvider>");
  const authenticatedBoundaryOpen = layoutContent.indexOf("<AuthenticatedMobileBoundary");
  const authenticatedBoundaryClose = layoutContent.indexOf("</AuthenticatedMobileBoundary>");
  assert.ok(
    authenticatedBoundaryOpen >= 0 && admissionProviderOpen > authenticatedBoundaryOpen && admissionProviderOpen < authenticatedBoundaryClose,
    "app-field: admission read state must remain inside the authenticated route boundary",
  );
  const { fieldAdmissionActionability } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-eligibility.ts")).href
  );
  const completeAdmission = { state: "eligible", requiresProfileReview: false, fullNameAr: "ميداني" };
  assert.equal(fieldAdmissionActionability(completeAdmission), "available");
  assert.equal(fieldAdmissionActionability({ ...completeAdmission, requiresProfileReview: true }), "profile_review");
  assert.equal(fieldAdmissionActionability({ ...completeAdmission, fullNameAr: "" }), "profile_review");
  assert.equal(fieldAdmissionActionability({ ...completeAdmission, fullNameAr: "  " }), "profile_review");
  assert.equal(fieldAdmissionActionability({ ...completeAdmission, state: "suspended" }), "not_eligible");
  assert.equal(fieldAdmissionActionability({ ...completeAdmission, state: "pending_review" }), "not_eligible");
  assert.equal(fieldAdmissionActionability({ ...completeAdmission, fullNameAr: undefined }), "profile_review");
  for (const consumer of [
    "app/(app)/_layout.tsx",
    "src/shell/field-admission-gate.tsx",
    "src/features/field-operations/field-readiness.tsx",
    "src/features/field-operations/field-new-case.tsx",
    "src/features/account/account.tsx",
  ]) {
    const source = fs.readFileSync(path.join(appDir, consumer), "utf8");
    assert.ok(source.includes("fieldAdmissionActionability"), `app-field: ${consumer} must use canonical admission actionability`);
  }
  const gateSource = fs.readFileSync(path.join(appDir, "src/shell/field-admission-gate.tsx"), "utf8");
  assert.match(gateSource, /fieldAdmissionActionability\(state\.admission\) !== "available"/, "app-field: guarded routes reject non-available admissions");
  const accountSource = fs.readFileSync(path.join(appDir, "src/features/account/account.tsx"), "utf8");
  assert.match(accountSource, /verifiedWorkspace = verification === "verified" && profileActionability === "available"/, "app-field: admission and a fresh successful readback must both authorize invitation actions");
  assert.match(accountSource, /verifiedWorkspace \? <StoreAccessInvitationSummary/, "app-field: unavailable or unverified admission must not show invitation actions");
  const providerSource = fs.readFileSync(path.join(appDir, "src/features/field-operations/use-field-admission.ts"), "utf8");
  assert.doesNotMatch(providerSource, /setState\(\{ kind: "loading" \}\)/, "app-field: foreground revalidation must not unmount unsaved forms");
  assert.match(providerSource, /setState\(\(current\) => current\.kind === "ready" \? current : \{ kind: "loading" \}\)/, "app-field: retries preserve admitted forms but show progress for missing or failed admission");
  assert.match(gateSource, /pointerEvents=\{verified \? "auto" : "none"\}/, "app-field: forms must be non-interactive until admission readback succeeds");
  assert.match(layoutContent, /if \(becameActive\) \{[\s\S]*?recordOpen\(\);[\s\S]*?void refresh\(\);[\s\S]*?\}/, "app-field: refresh admission after returning to foreground");
  const { fieldDraftMatchesReadback, fieldDraftMediaUploadConfirmed, markFieldDraftReadbackUncertain, markFieldMediaReadbackUncertain } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-draft-readback.ts")).href
  );
  const { wrapDayMinutes, parseClockTime, formatClockTime, rotateClockMinutes, clockHandDegrees, clockDarkness } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-circular-clock.ts")).href
  );
  assert.equal(parseClockTime("21:57"), 1317, "Field dial must reopen at the exact persisted time");
  assert.equal(parseClockTime("garbage"), 540, "Invalid legacy time should fall back to 09:00");
  assert.equal(formatClockTime(-1), "23:59", "Minute decrement must wrap to the preceding day");
  assert.equal(formatClockTime(1440), "00:00", "Midnight must persist as a valid HH:mm time");
  assert.equal(clockHandDegrees(9 * 60), 270, "Nine o'clock should aim at the nine on the dial");
  let rotated = parseClockTime("21:57");
  const quarterAngles = [-Math.PI / 2, 0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
  for (let pass = 0; pass < 2; pass++) {
    for (let index = 1; index < quarterAngles.length; index++) {
      rotated = rotateClockMinutes(rotated, quarterAngles[index - 1], quarterAngles[index]);
    }
    assert.equal(formatClockTime(rotated), pass === 0 ? "09:57" : "21:57", "Each complete turn must advance exactly twelve hours");
  }
  assert.equal(formatClockTime(rotateClockMinutes(0, Math.PI - 0.01, -Math.PI + 0.01)), "00:02", "Dial crossing at the angle seam must advance, not jump backwards");
  assert.equal(wrapDayMinutes(-1441), 1439);
  assert.equal(clockDarkness(5 * 60), 1);
  assert.equal(clockDarkness(6 * 60 + 30), 0.5);
  assert.equal(clockDarkness(7 * 60), 0);
  assert.equal(clockDarkness(18 * 60), 0);
  assert.equal(clockDarkness(19 * 60 + 30), 0.5);
  assert.equal(clockDarkness(21 * 60), 1);
  const dialSource = fs.readFileSync(path.join(appDir, "src/features/field-operations/field-circular-time-picker.tsx"), "utf8");
  assert.ok(dialSource.includes("onResponderMove={move}"), "Clock hand must respond to actual drag gestures");
  assert.ok(dialSource.includes("onChange(formatClockTime(precise.current))"), "Field time must be persisted from precise hand position via existing 24-hour schema");
  assert.doesNotMatch(dialSource, /react-native-svg/, "Circular clock must need no additional native dependency");
  console.log("MOBILE_FIELD_CIRCULAR_CLOCK=PASS twelve-hour rotations, minute precision, midnight and day-night transitions");
  const intervals = [{ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", closesNextDay: false }, { dayOfWeek: 2, opensAt: "10:00", closesAt: "18:00", closesNextDay: false }];
  const draft = { contactPhoneE164: "+967777123456", ownerFullName: "مالك النشاط", businessName: "نشاط الاختبار", firstStoreName: "المتجر الأول", walletProviderKey: "wallet_provider_test", firstStoreAddress: "صنعاء", serviceCityId: "city-1", firstStoreVerticalId: "vertical-1", firstStoreCommercialTypeId: "type-1", firstStoreProofType: "COMMERCIAL_REGISTRATION", firstStoreNotes: "ملاحظات", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, firstStoreWorkingHours: { intervals }, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP", "BTHWANI_CAPTAIN"] };
  const saved = { ...draft, state: "draft", origin: "field", version: 3, firstStoreWorkingHours: { intervals: [...intervals].reverse() }, firstStoreFulfillmentModes: [...draft.firstStoreFulfillmentModes].reverse() };
  const { fieldStoreImageProvenance } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-store-image-provenance.ts")).href
  );
  const employeeImage = fieldStoreImageProvenance("camera", "مالك المتجر", "موظف الميدان");
  const ownerImage = fieldStoreImageProvenance("library", "مالك المتجر");
  assert.equal(employeeImage.rightsAttested, false, "Store image consent must never be fabricated or prechecked");
  assert.equal(ownerImage.rightsAttested, false, "Gallery media requires the field worker's explicit owner-permission confirmation");
  assert.equal(ownerImage.creator, "مالك المتجر", "Gallery media must record the supplied owner source");
  assert.match(employeeImage.sourceDescription, /موظف الميدان/, "Camera provenance must retain the actual capture context");
  const { getFieldJoiningRequirements } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-joining-readiness.ts")).href
  );
  const completeReadback = {
    ...saved,
    firstStoreProofNumberPresent: true,
    firstStoreProofImageUploaded: true,
    storeProfileImage: { uri: "https://example.test/store.png" },
  };
  assert.deepEqual(getFieldJoiningRequirements(completeReadback).filter((item) => !item.saved), [], "Complete canonical draft must have no phantom missing fields");
  assert.deepEqual(
    getFieldJoiningRequirements({ ...completeReadback, firstStoreProofImageUploaded: false, storeProfileImage: null }).filter((item) => !item.saved).map((item) => item.key),
    ["proofImage", "storeImage"],
    "Readiness must reflect actual canonical upload flags, not local image selection",
  );
  assert.deepEqual(
    getFieldJoiningRequirements(null).filter((item) => !item.saved).length,
    6,
    "Unsaved local inputs must not be reported as persisted",
  );
  const threeModes = ["BTHWANI_CAPTAIN", "PARTNER_CAPTAIN", "CUSTOMER_PICKUP"];
  assert.equal(fieldDraftMatchesReadback({ ...draft, firstStoreFulfillmentModes: threeModes }, {
    ...saved, firstStoreFulfillmentModes: [...threeModes].reverse(),
  }, 3), true, "A trial restaurant must preserve all three fulfillment modes in canonical readback");
  assert.equal(fieldDraftMatchesReadback(draft, saved, 3), true, "Field draft readback should allow server-normalized set ordering");
  for (const key of ["ownerFullName", "businessName", "firstStoreName", "walletProviderKey", "firstStoreAddress", "serviceCityId", "firstStoreVerticalId", "firstStoreCommercialTypeId", "firstStoreProofType", "firstStoreNotes"]) {
    assert.equal(fieldDraftMatchesReadback(draft, { ...saved, [key]: "different" }, 3), false, `Field draft readback missed ${key} divergence`);
  }
  for (const [name, altered] of [
    ["version", { version: 2 }], ["origin", { origin: "control_panel" }], ["state", { state: "submitted" }],
    ["latitude", { firstStoreLatitude: 15.35 }], ["longitude", { firstStoreLongitude: 44.2 }],
    ["hours", { firstStoreWorkingHours: { intervals: [intervals[0]] } }], ["modes", { firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] }],
  ]) assert.equal(fieldDraftMatchesReadback(draft, { ...saved, ...altered }, 3), false, `Field draft readback missed ${name} divergence`);
  const partial = { contactPhoneE164: draft.contactPhoneE164 };
  const partialSaved = { ...saved, ownerFullName: null, businessName: "", firstStoreName: "", walletProviderKey: "", firstStoreAddress: null, serviceCityId: null, firstStoreVerticalId: "", firstStoreCommercialTypeId: null, firstStoreProofType: null, firstStoreNotes: null, firstStoreLatitude: null, firstStoreLongitude: null, firstStoreWorkingHours: null, firstStoreFulfillmentModes: [] };
  assert.equal(fieldDraftMatchesReadback(partial, partialSaved, 3), true, "Omitted fields in a partial snapshot may read back as null or empty");
  assert.equal(fieldDraftMatchesReadback(partial, { ...partialSaved, walletProviderKey: "obsolete-wallet" }, 3), false, "Clearing an omitted wallet must be reflected in canonical readback");
  assert.equal(fieldDraftMatchesReadback(partial, { ...partialSaved, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] }, 3), false, "Clearing modes must not silently retain old modes");
  assert.equal(fieldDraftMatchesReadback(partial, { ...partialSaved, firstStoreWorkingHours: { intervals: [intervals[0]] } }, 3), false, "Clearing hours must not silently retain old intervals");
  assert.equal(fieldDraftMatchesReadback(partial, { ...partialSaved, firstStoreLatitude: 15.3, firstStoreLongitude: 44.2 }, 3), false, "Clearing a map pin must not silently retain old coordinates");
  const newCaseSource = fs.readFileSync(path.join(appDir, "src/features/field-operations/field-new-case.tsx"), "utf8");
  assert.match(newCaseSource, /cause\.message === "FIELD_JOINING_CASE_CANONICAL_READBACK_MISMATCH"/, "Field readback mismatch must retain the original idempotency identity for a safe retry");
  assert.match(newCaseSource, /cause\.message === "FIELD_JOINING_CASE_CANONICAL_READBACK_UNAVAILABLE"/, "A failed post-write draft readback must preserve the original attempt identity");
  assert.match(newCaseSource, /readOwnFieldJoiningCase\(token, response\.case\.id\)\.catch\(\(cause: unknown\) => \{ throw markFieldDraftReadbackUncertain\(cause\); \}\)/, "Post-write readback errors must not be classified as draft write failures");
  for (const status of [401, 403, 404]) {
    const readFailure = Object.assign(new Error("Draft readback failed"), { kind: "http", status });
    const uncertain = markFieldDraftReadbackUncertain(readFailure);
    assert.equal(uncertain.message, "FIELD_JOINING_CASE_CANONICAL_READBACK_UNAVAILABLE", "Post-write readback must remain uncertain regardless of 4xx status");
    assert.equal(uncertain.cause, readFailure, "Original draft readback error must be retained for diagnosis");
  }
  assert.match(newCaseSource, /if \(isOutcomeUncertain\(cause\)\) \{\s*setError/, "Field uncertain results must remain recoverable instead of starting a duplicate draft");
  console.log("MOBILE_FIELD_DRAFT_READBACK=PASS complete and cleared drafts, normalized sets, mismatches, version and uncertain retry");
  const uploadedMedia = { ...saved, id: "field-case-1", version: 4, storeProfileImage: { uri: "https://media.example/store-1.png", contentSha256: "digest-one" }, firstStoreProofImageUploaded: true };
  assert.equal(fieldDraftMediaUploadConfirmed(uploadedMedia, { ...uploadedMedia }, "store", 3), true, "Field store image needs canonical confirmation");
  assert.equal(fieldDraftMediaUploadConfirmed(uploadedMedia, { ...uploadedMedia }, "proof", 3), true, "Field private proof image needs canonical confirmation");
  for (const [name, changed] of [
    ["case identity", { id: "other-case" }], ["version", { version: 3 }],
    ["lost store image", { storeProfileImage: null }],
    ["changed media URI", { storeProfileImage: { uri: "https://media.example/store-2.png", contentSha256: "digest-one" } }],
    ["missing canonical digest", { storeProfileImage: { uri: "https://media.example/store-1.png" } }],
    ["image digest divergence", { storeProfileImage: { uri: "https://media.example/store-1.png", contentSha256: "digest-two" } }],
  ]) assert.equal(fieldDraftMediaUploadConfirmed(uploadedMedia, { ...uploadedMedia, ...changed }, "store", 3), false, `Field media confirmation missed ${name}`);
  assert.equal(fieldDraftMediaUploadConfirmed({ ...uploadedMedia, storeProfileImage: { uri: "https://media.example/store-1.png" } }, uploadedMedia, "store", 3), false, "A response lacking an upload digest cannot prove the same media was persisted");
  assert.equal(fieldDraftMediaUploadConfirmed({ ...uploadedMedia, version: 3 }, uploadedMedia, "store", 3), false, "A non-advancing upload version cannot prove media persistence");
  assert.equal(fieldDraftMediaUploadConfirmed(uploadedMedia, { ...uploadedMedia, firstStoreProofImageUploaded: false }, "proof", 3), false, "Private proof confirmation requires canonical uploaded flag");
  for (const status of [401, 403, 404]) {
    const readFailure = Object.assign(new Error("Readback failed"), { kind: "http", status });
    const uncertain = markFieldMediaReadbackUncertain(readFailure);
    assert.equal(uncertain.message, "FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_UNAVAILABLE", "Post-upload readback failure must remain uncertain");
    assert.equal(uncertain.cause, readFailure, "Preserve original readback failure for diagnosis");
  }
  const casesSource = fs.readFileSync(path.join(appDir, "src/features/field-operations/field-cases.tsx"), "utf8");
  for (const source of [newCaseSource, casesSource]) {
    assert.match(source, /fieldDraftMediaUploadConfirmed\([^\n]+"store"/, "Field store upload must use canonical readback before discarding selected media");
    assert.match(source, /fieldDraftMediaUploadConfirmed\([^\n]+"proof"/, "Field proof upload must use canonical readback before discarding selected media");
    assert.match(source, /cause\.message === "FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_MISMATCH"/, "Unconfirmed media upload must retain original idempotency identity for retry");
    assert.match(source, /cause\.message === "FIELD_MEDIA_UPLOAD_CANONICAL_READBACK_UNAVAILABLE"/, "Failed post-upload readback must retain the same pending upload identity");
    assert.equal([...source.matchAll(/readOwnFieldJoiningCase\(token, attempt\.caseID\)\.catch\(\(cause: unknown\) => \{ throw markFieldMediaReadbackUncertain\(cause\); \}\)/g)].length, 2, "Both media flows must classify post-upload read failures separately from upload request failures");
  }
  assert.match(casesSource, /if \(busy \|\| item\.state !== "draft" \|\| storeImage \|\| proofImage \|\| pendingImageAttempt \|\| pendingProofImageAttempt\) return;/, "Field submission must reject unsaved media even if directly invoked");
  assert.match(casesSource, /disabled=\{Boolean\(busy\) \|\| Boolean\(pendingImageAttempt\) \|\| Boolean\(pendingProofImageAttempt\) \|\| Boolean\(storeImage\) \|\| Boolean\(proofImage\)\} label="إرسال للمراجعة"/, "Field must not submit a case while unsaved store or proof images are selected");
  assert.match(casesSource, /if \(busy \|\| storeImage \|\| proofImage \|\| pendingImageAttempt \|\| pendingProofImageAttempt \|\| item\.state !== "draft"\) return;/, "Opening other media details must not replace a pending proof image or upload attempt");
  assert.equal([...casesSource.matchAll(/disabled=\{Boolean\(busy\) \|\| Boolean\(storeImage\) \|\| Boolean\(proofImage\) \|\| Boolean\(pendingImageAttempt\) \|\| Boolean\(pendingProofImageAttempt\)\}/g)].length, 2, "Draft editing and media navigation must both protect unsaved proof selection");
  assert.match(casesSource, /setMediaCase\(null\); setStoreImage\(null\); setProofImage\(null\);/, "Closing media details must discard both uncommitted image selections");
  assert.match(newCaseSource, /if \(!createdCase \|\| !storeImage \|\| busy \|\| pendingProofImageAttempt\) return;/, "Store retry must not overtake unresolved proof upload in draft editor");
  assert.match(newCaseSource, /if \(!createdCase \|\| !proofImage \|\| busy \|\| pendingImageAttempt\) return;/, "Proof retry must not overtake unresolved store upload in draft editor");
  assert.match(newCaseSource, /if \(busy \|\| pendingImageAttempt \|\| pendingProofImageAttempt\) return;/, "Store selection must remain locked during either pending upload");
  assert.match(newCaseSource, /if \(busy \|\| pendingProofImageAttempt \|\| pendingImageAttempt\) return;/, "Proof selection must remain locked during either pending upload");
  assert.match(casesSource, /if \(!mediaCase \|\| !storeImage \|\| busy \|\| pendingProofImageAttempt\) return;/, "Store upload must not overtake unresolved proof upload in cases");
  assert.match(casesSource, /if \(!mediaCase \|\| !proofImage \|\| busy \|\| pendingImageAttempt\) return;/, "Proof upload must not overtake unresolved store upload in cases");
  assert.match(casesSource, /if \(!mediaCase \|\| busy \|\| pendingImageAttempt \|\| pendingProofImageAttempt\) return;/, "Cases store picker must guard both pending uploads");
  assert.match(casesSource, /if \(!mediaCase \|\| mediaCase\.case\.state !== "draft" \|\| busy \|\| pendingProofImageAttempt \|\| pendingImageAttempt\) return;/, "Cases proof picker must guard both pending uploads");
  assert.equal([...casesSource.matchAll(/disabled=\{Boolean\(busy\) \|\| Boolean\(pendingImageAttempt\) \|\| Boolean\(pendingProofImageAttempt\)\} label=/g)].length, 3, "Cases store image, camera and close-detail actions must protect pending uploads");
  assert.match(newCaseSource, /pendingProofImageAttempt && proofImage \? <BthwaniButton disabled=\{busy \|\| Boolean\(pendingImageAttempt\)\}/, "Proof retry is visible only for unresolved uploads and never overtakes a store upload");
  assert.match(newCaseSource, /pendingImageAttempt && storeImage \? <BthwaniButton busy=\{busy\} disabled=\{busy \|\| Boolean\(pendingProofImageAttempt\)\}/, "Draft store retry must be visible only on unresolved uploads and blocked by pending proof upload");
  for (const [surface, source] of [["new-case", newCaseSource], ["cases", casesSource]]) {
    const start = source.indexOf("async function pickStoreImage(");
    const end = source.indexOf("async function pickProofImage()", start);
    assert.ok(start !== -1 && end > start, "Field " + surface + " must expose store-image selection");
    const picker = source.slice(start, end);
    assert.match(picker, /if \(asset\.fileSize && asset\.fileSize > 10 \* 1024 \* 1024\) throw new Error\("STORE_IMAGE_SIZE_INVALID"\);/, "Field " + surface + " must reject oversized picker metadata before loading bytes");
    assert.match(picker, /if \(!blob\.size \|\| blob\.size > 10 \* 1024 \* 1024\) throw new Error\("STORE_IMAGE_SIZE_INVALID"\);/, "Field " + surface + " must reject empty and oversized image bytes even without picker metadata");
    assert.match(picker, /cause\.message === "STORE_IMAGE_SIZE_INVALID" \? "يجب ألا يتجاوز حجم صورة المتجر 10 ميغابايت\."/, "Field " + surface + " must explain the DSH size limit in Arabic");
    assert.ok(picker.indexOf('throw new Error("STORE_IMAGE_SIZE_INVALID")') < picker.indexOf("setStoreImage("), "Field " + surface + " must reject invalid media before storing a selected image");
  }
  const { fieldJoiningImageDimensionsSupported } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-image-dimensions.ts")).href
  );
  for (const [width, height] of [[1, 1], [6000, 6000], [1, 6000], [6000, 1]]) {
    assert.equal(fieldJoiningImageDimensionsSupported(width, height), true, "DSH-valid boundary dimensions must remain selectable");
  }
  for (const [width, height] of [[0, 1], [1, 0], [6001, 1], [1, 6001], [-1, 2], [1.5, 2], [NaN, 2], [2, Infinity], [undefined, 2]]) {
    assert.equal(fieldJoiningImageDimensionsSupported(width, height), false, "Invalid image dimensions must be rejected before upload");
  }
  for (const [surface, source] of [["new-case", newCaseSource], ["cases", casesSource]]) {
    const storeStart = source.indexOf("async function pickStoreImage(");
    const proofStart = source.indexOf("async function pickProofImage()", storeStart);
    const proofEnd = source.indexOf("async function uploadProofImage(", proofStart);
    assert.ok(storeStart !== -1 && proofStart > storeStart && proofEnd > proofStart, "Field " + surface + " must have bounded store and proof pickers");
    for (const [kind, picker] of [["STORE", source.slice(storeStart, proofStart)], ["PROOF", source.slice(proofStart, proofEnd)]]) {
      assert.ok(picker.includes(`if (!fieldJoiningImageDimensionsSupported(asset.width, asset.height)) throw new Error("${kind}_IMAGE_DIMENSIONS_INVALID");`), `Field ${surface} ${kind} picker must use the tested dimensions guard`);
      assert.ok(picker.indexOf("fieldJoiningImageDimensionsSupported(asset.width, asset.height)") < picker.indexOf("await fetch(asset.uri)"), `Field ${surface} ${kind} must reject dimensions before reading bytes`);
      assert.ok(picker.includes(`cause.message === "${kind}_IMAGE_DIMENSIONS_INVALID"`), `Field ${surface} ${kind} must show a distinct dimensions error`);
      assert.match(picker, /يجب أن تكون أبعاد صورة (المتجر|الإثبات) بين 1 و6000 بكسل للعرض والارتفاع/, `Field ${surface} ${kind} must explain accepted dimensions in Arabic`);
    }
  }
  console.log("MOBILE_FIELD_MEDIA_READBACK=PASS image marker, private proof, version, isolation, recovery and both Field surfaces");
  const { percentTextFromBps, parsePercentToBps, sameAgreementRates } = await import(
    pathToFileURL(path.join(appDir, "src/features/field-operations/field-commercial-agreement-rate.ts")).href
  );
  for (const [bps, expected] of [[0, "0"], [1, "0.01"], [10, "0.1"], [100, "1"], [1201, "12.01"], [1225, "12.25"], [1250, "12.5"], [10000, "100"]]) {
    assert.equal(percentTextFromBps(bps), expected, `Field rate display drift for ${bps} bps`);
  }
  for (let bps = 0; bps <= 10000; bps += 1) {
    assert.equal(parsePercentToBps(percentTextFromBps(bps)), bps, `Field rate precision loss for ${bps} bps`);
  }
  for (const invalid of ["", "-1", "100.01", "12.", "12.345", "1e2", "101"]) {
    assert.equal(parsePercentToBps(invalid), null, `Invalid Field agreement rate was accepted: ${invalid}`);
  }
  assert.equal(parsePercentToBps("١٢.٢٥"), 1225, "Arabic-Indic digits must be normalized");
  assert.equal(parsePercentToBps("12,25"), 1225, "Decimal comma must be normalized");
  const agreedRates = [
    { fulfillmentMode: "BTHWANI_CAPTAIN", commissionRateBps: 1225 },
    { fulfillmentMode: "CUSTOMER_PICKUP", commissionRateBps: 0 },
  ];
  assert.equal(sameAgreementRates(agreedRates, [...agreedRates].reverse()), true, "Rate comparison must be independent of mode order");
  assert.equal(sameAgreementRates(agreedRates, [{ ...agreedRates[0], commissionRateBps: 1220 }, agreedRates[1]]), false, "Canonical readback must detect rate loss");
  assert.equal(sameAgreementRates(agreedRates, [agreedRates[0]]), false, "Canonical readback must detect missing modes");
  console.log("MOBILE_FIELD_AGREEMENT_RATE=PASS exact basis-point roundtrip 0..10000 and canonical rate comparison");
}
if (app === "app-client") {
  const { normalizeDiscoveryTaxonomy } = await import(pathToFileURL(path.join(appDir, "src/features/store-discovery/discovery-taxonomy.ts")).href);
  assert.deepEqual(normalizeDiscoveryTaxonomy(undefined, undefined), { verticals: [], categories: [] });
  assert.equal(normalizeDiscoveryTaxonomy(undefined, undefined).verticals.find((vertical) => vertical.id === "food"), undefined);
  console.log("MOBILE_DISCOVERY_TAXONOMY=PASS missing collections remain empty arrays");
}
if (app === "app-captain") {
  const {
    matchesCaptainFundingAttempt,
    matchesCaptainFundingRequest,
    parseCaptainFundingAttempt,
  } = await import(pathToFileURL(path.join(appDir, "src/features/wallet/cash-in-recovery.ts")).href);
  const intent = {
    id: "funding-captain-1",
    actorType: "captain",
    actorId: "captain-1",
    fundingPurpose: "CAPTAIN_TOPUP",
    providerKey: "DEVELOPMENT_SIMULATOR",
    externalReference: "external-1",
    amountMinor: 2500,
    currency: "YER",
    state: "PENDING_PROVIDER",
    version: 1,
    createdAt: "2026-10-03T00:00:00Z",
    updatedAt: "2026-10-03T00:00:00Z",
  };
  const legacyAttempt = parseCaptainFundingAttempt(JSON.stringify({ version: 1, actorID: "captain-1", amountMinor: 2500, idempotencyKey: "captain_cashin_key", correlationID: "captain_cashin_corr" }), "captain-1");
  assert.ok(legacyAttempt, "app-captain: legacy retries without an intent ID must remain recoverable");
  assert.equal(parseCaptainFundingAttempt(null, "captain-1"), null, "app-captain: absent local retry state must be handled safely");
  assert.equal(matchesCaptainFundingRequest(intent, "captain-1", 2500), true);
  assert.equal(matchesCaptainFundingRequest({ ...intent, actorType: "customer", fundingPurpose: "CUSTOMER_TOPUP" }, "captain-1", 2500), false);
  const exactAttempt = { ...legacyAttempt, fundingIntentID: intent.id };
  assert.equal(matchesCaptainFundingAttempt(intent, exactAttempt), true);
  assert.equal(matchesCaptainFundingAttempt({ ...intent, id: "another-intent" }, exactAttempt), false, "same actor and amount do not identify the same funding intent");

  const panel = fs.readFileSync(path.join(appDir, "src", "features", "wallet", "cash-in-panel.tsx"), "utf8");
  assert.ok(panel.indexOf("setWallet(walletResponse)") < panel.indexOf("readOwnFundingIntent(token, attempt.fundingIntentID)"), "app-captain: wallet state remains available when recovery of a stale saved intent fails");
  assert.ok(panel.includes("readOwnFundingIntent(token, attempt.fundingIntentID)"), "app-captain: stored retry intent must use canonical owner readback");
  assert.ok(!panel.includes("simulateOwnFundingIntent"), "app-captain: development-only simulator controls must not be exposed by the current cash-in panel");
  assert.ok(panel.includes("matchesCaptainFundingAttempt(intent, storedAttempt)"), "app-captain: terminal readback must clear only its exact local retry intent");
  console.log("MOBILE_CAPTAIN_CASH_IN_RECOVERY=PASS canonical intent, actor scope, retry identity, and terminal cleanup");
}
if (app === "app-partner") {
  const { isRecoverablePartnerPayout, matchesPartnerPayoutReadback } = await import(
    pathToFileURL(path.join(appDir, "src/features/account/partner-payout-readback.ts")).href
  );
  const payout = (id, actor, amount) => ({
    id, actorType: "partner", actorId: actor, beneficiaryActorId: actor,
    amountMode: "SPECIFIED", requestedAmountMinor: amount, resolvedAmountMinor: amount,
    currency: "YER", destinationId: "wallet-" + actor, destinationVersion: 1,
    status: "HELD", policyVersion: "v1", createdAt: "2026-10-10T00:00:00Z",
  });
  const payoutRequest = {
    id: "request-1", status: "PARTITIONED", scopeMode: "SPECIFIED", totalAmountMinor: 3000,
    currency: "YER", createdAt: "2026-10-10T00:00:00Z",
    stores: [
      { storeId: "store-a", amountMinor: 1000, beneficiaryActorId: "partner-a", recipientAssignmentVersion: 3, currency: "YER" },
      { storeId: "store-b", amountMinor: 2000, beneficiaryActorId: "partner-b", recipientAssignmentVersion: 5, currency: "YER" },
    ],
    payouts: [payout("payout-a", "partner-a", 1000), payout("payout-b", "partner-b", 2000)],
  };
  const payoutInput = {
    scopeMode: "SPECIFIED", storeIds: ["store-a", "store-b"],
    storeAmounts: [{ storeId: "store-a", amountMinor: 1000 }, { storeId: "store-b", amountMinor: 2000 }],
  };
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, payoutRequest), true);
  assert.equal(isRecoverablePartnerPayout(payoutRequest, payoutInput), true, "Recovered request must match a saved modern attempt");
  assert.equal(isRecoverablePartnerPayout(payoutRequest), true, "A legacy GET needs internally valid financial facts");
  assert.equal(isRecoverablePartnerPayout({ ...payoutRequest, payouts: payoutRequest.payouts.map((item) => ({ ...item, status: "CANCELLED" })) }), false, "Recovery must not clear an attempt for cancelled transfers");
  assert.equal(isRecoverablePartnerPayout({ ...payoutRequest, payouts: payoutRequest.payouts.map((item) => ({ ...item, status: "EXCEPTION" })) }, payoutInput), false, "Recovery must not clear an attempt for exceptional transfers");
  assert.equal(isRecoverablePartnerPayout(payoutRequest, { ...payoutInput, storeIds: ["incorrect-store"] }), false, "Modern recovery must prove original requested stores");
  assert.equal(isRecoverablePartnerPayout({ ...payoutRequest, payouts: [...payoutRequest.payouts, payoutRequest.payouts[0]] }), false, "Legacy recovery must reject duplicate transfer IDs");
  assert.equal(isRecoverablePartnerPayout({ ...payoutRequest, stores: [...payoutRequest.stores, payoutRequest.stores[0]] }), false, "Legacy recovery must reject duplicate store allocations");
  assert.equal(isRecoverablePartnerPayout({ ...payoutRequest, totalAmountMinor: 4000 }), false, "Legacy recovery must reject mismatched totals");
  assert.equal(matchesPartnerPayoutReadback({ ...payoutInput, storeIds: ["other-store", "store-b"] }, payoutRequest, payoutRequest), false, "Canonical response must retain the stores originally requested");
  assert.equal(matchesPartnerPayoutReadback({ ...payoutInput, storeAmounts: [{ storeId: "store-a", amountMinor: 2000 }, { storeId: "store-b", amountMinor: 1000 }] }, payoutRequest, payoutRequest), false, "Matching POST and GET cannot hide a change to requested amounts");
  assert.equal(matchesPartnerPayoutReadback({ ...payoutInput, storeIds: ["store-a", "store-a"] }, payoutRequest, payoutRequest), false, "Repeated requested Store IDs must fail");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, stores: [...payoutRequest.stores].reverse(), payouts: [...payoutRequest.payouts].reverse() }), true, "Readback order must not matter");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, stores: payoutRequest.stores.map((store) => ({ ...store, amountMinor: store.amountMinor === 1000 ? 2000 : 1000 })) }), false, "Same aggregate cannot hide swapped Store allocations");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, stores: payoutRequest.stores.map((store) => ({ ...store, beneficiaryActorId: "different-recipient" })) }), false, "The recipient assignment must match");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, payouts: payoutRequest.payouts.map((entry) => ({ ...entry, destinationId: "changed-wallet" })) }), false, "Canonical payout destination must match");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, payouts: payoutRequest.payouts.map((entry) => ({ ...entry, status: "PREPARED" })) }), true, "Legitimate later WLT status must not reject financial identity");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, payouts: payoutRequest.payouts.map((entry) => ({ ...entry, status: "CANCELLED" })) }), false, "Cancelled payouts cannot be reported as successful requests");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, payouts: payoutRequest.payouts.map((entry) => ({ ...entry, status: "EXCEPTION" })) }), false, "Exceptional payouts need human review, not a success notice");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, payouts: payoutRequest.payouts.map((entry) => ({ ...entry, resolvedAmountMinor: entry.resolvedAmountMinor === 1000 ? 2000 : 1000 })) }), false, "Same aggregate cannot hide swapped payout allocations");
  assert.equal(matchesPartnerPayoutReadback(payoutInput, payoutRequest, { ...payoutRequest, stores: [payoutRequest.stores[0], payoutRequest.stores[0]] }), false, "Repeated Store allocation IDs must be rejected");
  console.log("MOBILE_PARTNER_PAYOUT_READBACK=PASS allocation, recipient, destination and immutable financial identity");

  const { canonicalPartnerSurfacePath, derivePartnerAuthority, RESOLVING_PARTNER_AUTHORITY } = await import(pathToFileURL(path.join(appDir, "src/shell/partner-authority.ts")).href);
  const accessibleStore = (id, owned, permissions) => ({ id, name: `متجر ${id}`, serviceCityId: "city", primaryVerticalId: "vertical", publicationState: "published", fulfillmentModes: [], owned, permissions });
  const surfacesOf = (stores) => derivePartnerAuthority(stores).surfaces;

  assert.deepEqual(surfacesOf([accessibleStore("owned", true, [])]), ["store", "orders", "wallet", "account"], "app-partner: owner must keep the four current surfaces");
  assert.deepEqual(surfacesOf([accessibleStore("orders-staff", false, ["orders"])]), ["orders", "account"], "app-partner: ORDER_STAFF must not see Store management or Wallet");
  assert.deepEqual(surfacesOf([accessibleStore("catalog-staff", false, ["catalog"])]), ["store", "account"], "app-partner: CATALOG_STAFF must not see Orders or Wallet without a grant");
  assert.deepEqual(surfacesOf([accessibleStore("operations-staff", false, ["store_operations"])]), ["store", "account"], "app-partner: store_operations must unlock only the Store surface");
  assert.deepEqual(surfacesOf([accessibleStore("promotions-staff", false, ["promotions"])]), ["store", "account"], "app-partner: promotions must unlock only the Store surface");
  assert.deepEqual(surfacesOf([accessibleStore("accountant", false, ["finance_read"])]), ["wallet", "account"], "app-partner: ACCOUNTANT with finance_read must see Wallet and nothing more");
  assert.deepEqual(surfacesOf([accessibleStore("accountant", false, ["finance_read", "payout_request"])]), ["wallet", "account"], "app-partner: payout_request must keep the Wallet surface without adding other surfaces");
  assert.deepEqual(surfacesOf([accessibleStore("delivery-staff", false, ["fulfillment", "orders"])]), ["orders", "account"], "app-partner: DELIVERY_STAFF must see only the surfaces its orders/fulfillment grants require");
  assert.deepEqual(surfacesOf([accessibleStore("fulfillment-only", false, ["fulfillment"])]), ["account"], "app-partner: fulfillment without orders must not open a Store surface without a material function inside it");
  assert.deepEqual(surfacesOf([accessibleStore("multi-a", false, ["orders"]), accessibleStore("multi-b", false, ["catalog"])]), ["store", "orders", "account"], "app-partner: multi-store actors must see the union of authorized surfaces");
  assert.equal(derivePartnerAuthority([accessibleStore("multi-a", false, ["orders"]), accessibleStore("multi-b", false, ["catalog"])]).canUse("wallet"), false, "app-partner: one store's permissions must never leak another surface from another store's grant");
  assert.equal(derivePartnerAuthority([accessibleStore("multi-a", false, ["orders"]), accessibleStore("multi-b", false, ["finance_read"])]).canUse("wallet"), true, "app-partner: wallet authority must come only from a store that actually grants it");
  assert.deepEqual(surfacesOf([]), ["store", "account"], "app-partner: zero accessible stores must keep the identity-scoped Store empty state reachable");
  assert.deepEqual(RESOLVING_PARTNER_AUTHORITY.surfaces, ["account"], "app-partner: resolving authority must fail safe to the Account surface only");
  assert.equal(canonicalPartnerSurfacePath(derivePartnerAuthority([accessibleStore("owned", true, [])])), "/store", "app-partner: owner canonical landing must stay Store");
  assert.equal(canonicalPartnerSurfacePath(derivePartnerAuthority([accessibleStore("orders-staff", false, ["orders"])])), "/orders", "app-partner: ORDER_STAFF canonical landing must be Orders");
  assert.equal(canonicalPartnerSurfacePath(derivePartnerAuthority([accessibleStore("accountant", false, ["finance_read"])])), "/wallet", "app-partner: ACCOUNTANT canonical landing must be Wallet");
  assert.equal(canonicalPartnerSurfacePath(RESOLVING_PARTNER_AUTHORITY), "/account", "app-partner: resolving canonical landing must be Account");

  const scopeContextContent = fs.readFileSync(path.join(appDir, "src", "features", "partner-onboarding", "partner-store-scope-context.tsx"), "utf8");
  assert.ok(scopeContextContent.includes("derivePartnerAuthority"), "app-partner: the accessible-store scope must own the authority derivation");
  const walletContent = fs.readFileSync(path.join(appDir, "src", "features", "wallet", "wallet.tsx"), "utf8");
  assert.ok(walletContent.includes('permissions.includes("finance_read")'), "app-partner: finance readback must stay gated by finance_read");
  assert.ok(walletContent.includes('permissions.includes("payout_request")'), "app-partner: the payout action must stay gated by payout_request");
  console.log("MOBILE_PARTNER_AUTHORITY=PASS adaptive surfaces, per-store unions, fail-safe resolution, and canonical redirects");
}
const { IdentitySessionManager } = await import(pathToFileURL(path.join(root, "services/identity/clients/session.ts")).href);
const { identitySessionSignOutMessage } = await import(pathToFileURL(path.join(root, "services/identity/clients/errors.ts")).href);
const {
  createOrderConversationMessageAttempt,
  orderConversationMessageAttemptStorageKey,
  parseOrderConversationMessageAttempt,
} = await import(pathToFileURL(path.join(root, "services/dsh/clients/order-conversation-attempt.ts")).href);
const { createDshMobileClient } = await import(pathToFileURL(path.join(root, "services/dsh/clients/mobile.ts")).href);

const { defineSamrimExpoApp } = await import(pathToFileURL(path.join(root, "tools/mobile/define-samrim-expo-app.cjs")).href);
const expectsForegroundLocation = ["app-client", "app-captain", "app-field"].includes(app);
const expectsMaps = ["app-client", "app-captain", "app-field"].includes(app);
const expectsBarcodeCamera = ["app-field", "app-partner"].includes(app);
const mapsKeyVars = {
  "app-client": ["GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT", "GOOGLE_MAPS_IOS_API_KEY"],
  "app-captain": ["GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN", "GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN"],
  "app-field": ["GOOGLE_MAPS_ANDROID_API_KEY_APP_FIELD", "GOOGLE_MAPS_IOS_API_KEY"],
};
const priorMapsEnv = new Map();
if (expectsMaps) {
  for (const [index, name] of mapsKeyVars[app].entries()) {
    priorMapsEnv.set(name, process.env[name]);
    process.env[name] ||= `maps-config-placeholder-${index}`;
  }
}
const expoConfig = defineSamrimExpoApp(app, {
  ...(expectsBarcodeCamera ? { cameraMode: "barcode" } : {}),
  ...(expectsForegroundLocation ? { locationMode: "foreground" } : {}),
  ...(expectsMaps ? { maps: true } : {}),
});
for (const [name, value] of priorMapsEnv) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
assert.equal(expoConfig.extra.nativeCapabilities, undefined, `${app}: Expo config must not expose native capability shadow truth`);
assert.equal(expoConfig.android.blockedPermissions, undefined, `${app}: manual RECORD_AUDIO workaround must be absent`);
assert.equal(expoConfig.android.config, undefined, `${app}: Android map configuration must be owned by the react-native-maps plugin`);
if (expectsMaps) {
  const mapsPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "react-native-maps");
  assert.ok(mapsPlugin, `${app}: native maps plugin must configure both platforms`);
  assert.ok(mapsPlugin[1].androidGoogleMapsApiKey && mapsPlugin[1].iosGoogleMapsApiKey, `${app}: native maps plugin needs both platform keys`);
}
assert.equal(expoConfig.ios.config, undefined, `${app}: manual iOS provider config must be absent`);
const localizationPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-localization");
assert.deepEqual(localizationPlugin, [
  "expo-localization",
  {
    supportedLocales: { ios: ["ar"], android: ["ar"] },
    forcesRTL: true,
    allowDynamicLocaleChangesAndroid: false,
  },
], `${app}: native localization config must be Arabic-only and statically RTL`);
const locationPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-location");
const cameraPlugin = expoConfig.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === "expo-camera");
if (expectsBarcodeCamera) {
  assert.equal(allDeps["expo-camera"], "57.0.6", `${app}: barcode scanning requires the Expo camera module`);
  assert.deepEqual(cameraPlugin, [
    "expo-camera",
    {
      cameraPermission: "نحتاج الوصول إلى الكاميرا لمسح باركود المنتجات.",
      microphonePermission: false,
      recordAudioAndroid: false,
      barcodeScannerEnabled: true,
    },
  ], `${app}: barcode scanning must declare its camera permission without microphone access`);
} else {
  assert.equal(allDeps["expo-camera"], undefined, `${app}: unadmitted camera must not be a direct dependency`);
  assert.equal(cameraPlugin, undefined, `${app}: camera permission must not be inferred without an app-owned request`);
}
if (expectsForegroundLocation) {
  const expectedLocationVersion = "57.0.20";
  assert.equal(allDeps["expo-location"], expectedLocationVersion, `${app}: foreground location requires the Expo location module`);
  assert.ok(locationPlugin, `${app}: foreground location must be owned by expo-location`);
  assert.deepEqual(locationPlugin, [
    "expo-location",
    {
      locationWhenInUsePermission: "نحتاج الوصول إلى موقعك عند طلب التقاط موقع العنوان أو أصل المتجر.",
    },
  ], `${app}: foreground location must be owned by expo-location`);
} else {
  assert.equal(allDeps["expo-location"], undefined, `${app}: unadmitted location must not be a direct dependency`);
  assert.equal(locationPlugin, undefined, `${app}: location permissions must not be inferred without an explicit app-owned request`);
}
assert.equal(expoConfig.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-image-picker"), false, `${app}: image-picker plugin must not be inferred from package presence`);
assert.equal(allDeps["react-native-maps"], expectsMaps ? "1.27.2" : undefined, `${app}: map native dependency must be explicit per admitted surface`);
assert.equal(expoConfig.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "react-native-maps"), expectsMaps, `${app}: maps plugin must be explicitly admitted for this app`);
assert.equal(expoConfig.plugins.some((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-notifications"), false, `${app}: notifications plugin must not be inferred from package presence`);
console.log(`MOBILE_AR_RTL_NATIVE_CONFIG=PASS app=${app} locale=ar forcesRTL=true`);

for (const reason of ["no_local_session", "corrupt_local_session", "terminal_invalidated", "surface_mismatch", "local_proof_invalid", "explicit_logout", "recovery"]) {
  assert.ok(identitySessionSignOutMessage(reason).length > 0, `${app}: missing sign-out reason message: ${reason}`);
}
console.log(`MOBILE_SESSION_REASON_COPY=PASS app=${app}`);

// 3. Behavioral Unit Tests for Mobile Session State Machine
class MockStorage {
  constructor(initial = {}) {
    this.store = new Map(Object.entries(initial));
  }
  async getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  async setItem(key, value) {
    this.store.set(key, value);
  }
  async removeItem(key) {
    this.store.delete(key);
  }
}

const sampleIdentity = {
  subject: "usr_test_001",
  role,
  surface,
  state: "active",
};

const samplePair = {
  accessToken: "token_access_valid_len_32_characters_ok",
  refreshToken: "token_refresh_valid_len_32_characters_ok",
  identity: sampleIdentity,
};

if (app !== "app-field") {
  const attempt = createOrderConversationMessageAttempt(
    sampleIdentity.subject,
    "order_conversation_test_001",
    "  محادثة تشغيلية  ",
    "conversation_idempotency_001",
    "conversation_correlation_001",
  );
  const serializedAttempt = JSON.stringify(attempt);
  assert.deepEqual(parseOrderConversationMessageAttempt(serializedAttempt, sampleIdentity.subject, attempt.orderID), attempt);
  assert.notEqual(
    orderConversationMessageAttemptStorageKey(role, sampleIdentity.subject, attempt.orderID),
    orderConversationMessageAttemptStorageKey(role, sampleIdentity.subject, "order_conversation_test_002"),
  );
  assert.throws(
    () => parseOrderConversationMessageAttempt(serializedAttempt, "usr_another_actor", attempt.orderID),
    /DSH_ORDER_CONVERSATION_ATTEMPT_SCOPE_MISMATCH/,
  );

  const originalFetch = globalThis.fetch;
  const capturedHeaders = [];
  globalThis.fetch = async (_input, init) => {
    capturedHeaders.push(new Headers(init?.headers));
    return new Response("{}", { status: 201, headers: { "Content-Type": "application/json" } });
  };
  try {
    const dshClient = createDshMobileClient("https://dsh.test", { cryptoRandomUUID: () => "fallback-generated-id" });
    await dshClient.sendOrderConversationMessage("access-token", attempt.orderID, { body: attempt.body }, attempt.idempotencyKey, attempt.correlationID);
    await dshClient.sendOrderConversationMessage("access-token", attempt.orderID, { body: attempt.body }, attempt.idempotencyKey, attempt.correlationID);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(capturedHeaders.length, 2);
  for (const headers of capturedHeaders) {
    assert.equal(headers.get("Idempotency-Key"), attempt.idempotencyKey);
    assert.equal(headers.get("X-Correlation-ID"), attempt.correlationID);
    assert.notEqual(headers.get("Idempotency-Key"), "fallback-generated-id");
  }
  console.log(`MOBILE_ORDER_CONVERSATION_RETRY=PASS app=${app}`);
}

// Test 1: Clean storage -> signed_out
{
  const storage = new MockStorage();
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
}

// Test 2: Corrupt storage -> clears and signed_out
{
  const storage = new MockStorage({ [`test.${app}.identity.session.v1`]: "not-valid-json" });
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
  assert.equal(await storage.getItem(`test.${app}.identity.session.v1`), null);
}

// Test 2b: Ambiguous local development identity -> signed_out so the real login form is reachable.
{
  const conflict = new Error("multiple ready development actors");
  conflict.kind = "http";
  conflict.status = 409;
  const storage = new MockStorage();
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, undefined, async () => {
    throw conflict;
  });
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
  assert.equal(res.reason, "no_local_session");
}

// Test 3: Valid stored tokens -> authenticated
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = { async session() { return sampleIdentity; } };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "authenticated");
  assert.equal(res.identity.subject, "usr_test_001");
}

// Test 4: Role/surface mismatch -> clears storage and signs out
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = { async session() { return { ...sampleIdentity, role: "other_role" }; } };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "signed_out");
  assert.equal(await storage.getItem(`test.${app}.identity.session.v1`), null);
}

// Test 5: Service unavailable -> preserves tokens, returns degraded(service_unavailable)
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = {
    async session() {
      const err = new Error("gateway timeout");
      err.kind = "http";
      err.status = 504;
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "service_unavailable");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 6: The live 401 REFRESH_STALE contract is non-terminal and preserves the durable session intent.
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  const client = {
    async session() {
      const err = new Error("token expired");
      err.kind = "http";
      err.status = 401;
      throw err;
    },
    async refresh() {
      const err = new Error("stale refresh token");
      err.kind = "http";
      err.status = 401;
      err.code = "REFRESH_STALE";
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "refresh_conflict");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 7: Non-terminal refresh failures preserve session material and remain fail-closed.
for (const [status, code, reason] of [[429, "RATE_LIMITED", "rate_limited"], [503, "IDENTITY_UNAVAILABLE", "service_unavailable"], [409, "CONFLICT", "unexpected_http"]]) {
  const key = `test.${app}.identity.session.v1`;
  const storage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const client = {
    async session() {
      const err = new Error("access unavailable");
      err.kind = "http";
      err.status = 401;
      throw err;
    },
    async refresh() {
      const err = new Error(code);
      err.kind = "http";
      err.status = status;
      err.code = code;
      throw err;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, reason);
  assert.ok(await storage.getItem(key));
}

// Test 8: Unknown restore failures do not fabricate sign-out or authentication.
{
  const key = `test.${app}.identity.session.v1`;
  const storage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const client = { async session() { throw new Error("unexpected restore failure"); } };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "unknown");
  assert.ok(await storage.getItem(key));
}

// Test 9: SecureStore read failure is recoverable and preserves opaque session material.
{
  const storage = {
    async getItem() { throw new Error("secure storage is temporarily unavailable"); },
    async setItem() {},
    async removeItem() {},
  };
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.restore();
  assert.equal(res.kind, "degraded");
  assert.equal(res.reason, "storage_read");
}

// Test 10: A committed rotation whose response is lost is reconstructed by a new manager from durable state.
{
  const key = `test.${app}.identity.session.v1`;
  const storage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const rotatedPair = { ...samplePair, accessToken: "token_access_rotated_len_32_characters_ok", refreshToken: "token_refresh_rotated_len_32_characters_ok" };
  let refreshCalls = 0;
  let requestId;
  const client = {
    async session(token) {
      if (token === rotatedPair.accessToken) return sampleIdentity;
      const err = new Error("expired"); err.kind = "http"; err.status = 401; throw err;
    },
    async refresh(request) {
      refreshCalls += 1;
      if (!requestId) {
        requestId = request.refreshRequestId;
        const err = new Error("response lost after remote commit"); err.kind = "network"; throw err;
      }
      assert.equal(request.refreshRequestId, requestId);
      return rotatedPair;
    },
  };
  const firstManager = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "a".repeat(36));
  const first = await firstManager.restore();
  assert.equal(first.kind, "degraded");
  assert.equal(first.reason, "network");
  assert.match(await storage.getItem(key), /pendingRefresh/);
  const restartedManager = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "b".repeat(36));
  const recovered = await restartedManager.restore();
  assert.equal(recovered.kind, "authenticated");
  assert.equal(refreshCalls, 2);
  assert.equal(JSON.parse(await storage.getItem(key)).pendingRefresh, undefined);
}

// Test 11: A write that committed but reported failure is recovered after complete manager/process loss.
{
  const key = `test.${app}.identity.session.v1`;
  const durableStorage = new MockStorage({ [key]: JSON.stringify({ accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken }) });
  const rotatedPair = { ...samplePair, accessToken: "token_access_pending_len_32_characters_ok", refreshToken: "token_refresh_pending_len_32_characters_ok" };
  let writeCount = 0;
  let refreshCalls = 0;
  const client = {
    async session(token) {
      if (token === rotatedPair.accessToken) return sampleIdentity;
      const err = new Error("expired"); err.kind = "http"; err.status = 401; throw err;
    },
    async refresh() { refreshCalls += 1; return rotatedPair; },
  };
  const uncertainStorage = {
    async getItem(keyName) { return durableStorage.getItem(keyName); },
    async setItem(keyName, value) {
      writeCount += 1;
      await durableStorage.setItem(keyName, value);
      if (writeCount === 2) throw new Error("secure storage reported after commit");
    },
    async removeItem(keyName) { return durableStorage.removeItem(keyName); },
  };
  const firstManager = new IdentitySessionManager(client, uncertainStorage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "c".repeat(36));
  const first = await firstManager.restore();
  assert.equal(first.kind, "degraded");
  assert.equal(first.reason, "storage_write");
  const pendingAfterUnknownWrite = JSON.parse(await durableStorage.getItem(key));
  assert.equal(pendingAfterUnknownWrite.accessToken, rotatedPair.accessToken);
  assert.equal(pendingAfterUnknownWrite.pendingRefresh.previous.accessToken, samplePair.accessToken);
  const restartedManager = new IdentitySessionManager(client, durableStorage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "d".repeat(36));
  const recovered = await restartedManager.restore();
  assert.equal(recovered.kind, "authenticated");
  assert.equal(refreshCalls, 1);
  assert.equal(JSON.parse(await durableStorage.getItem(key)).pendingRefresh, undefined);
}

// Test 12: Adopt credentials -> stores tokens and authenticated
{
  const storage = new MockStorage();
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  const res = await mgr.adopt(samplePair);
  assert.equal(res.kind, "authenticated");
  assert.ok(await storage.getItem(`test.${app}.identity.session.v1`));
}

// Test 13: Logout -> calls remote and clears local storage
{
  const storage = new MockStorage({
    [`test.${app}.identity.session.v1`]: JSON.stringify({
      accessToken: samplePair.accessToken,
      refreshToken: samplePair.refreshToken,
    }),
  });
  let loggedOut = false;
  const client = {
    async logout(tok) {
      assert.equal(tok, samplePair.accessToken);
      loggedOut = true;
    },
  };
  const mgr = new IdentitySessionManager(client, storage, async () => "device-fp-12345", role, surface, `test.${app}`);
  await mgr.logout();
  assert.equal(mgr.state.kind, "signed_out");
  assert.equal(await storage.getItem(`test.${app}.identity.session.v1`), null);
  assert.ok(loggedOut);
}

// Test 14: Development fallback authenticates a fresh runtime with no stored session
{
  const storage = new MockStorage();
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "e".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  const restored = await mgr.restore();
  assert.equal(restored.kind, "authenticated");
  assert.equal(developmentCalls, 1);
}

// Test 15: Explicit logout remains signed out in the same runtime
{
  const storage = new MockStorage({[`test.${app}.identity.session.v1`]: JSON.stringify({accessToken: samplePair.accessToken, refreshToken: samplePair.refreshToken})});
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({async logout() {}}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "f".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  await mgr.logout();
  const restored = await mgr.restore();
  assert.equal(restored.kind, "signed_out");
  assert.equal(restored.reason, "explicit_logout");
  assert.equal(developmentCalls, 0);
}

// Test 16: Recovery intent remains signed out in the same runtime
{
  const storage = new MockStorage();
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "g".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  await mgr.adopt(samplePair);
  const cleared = await mgr.clearLocalSession();
  assert.equal(cleared.kind, "signed_out");
  assert.equal(cleared.reason, "recovery");
  const restored = await mgr.restore();
  assert.equal(restored.kind, "signed_out");
  assert.equal(restored.reason, "recovery");
  assert.equal(developmentCalls, 0);
}

// Test 17: A new runtime can use development continuity again
{
  const storage = new MockStorage();
  let developmentCalls = 0;
  const mgr = new IdentitySessionManager({}, storage, async () => "device-fp-12345", role, surface, `test.${app}`, () => "h".repeat(36), async () => {
    developmentCalls += 1;
    return samplePair;
  });
  const restored = await mgr.restore();
  assert.equal(restored.kind, "authenticated");
  assert.equal(developmentCalls, 1);
}

console.log(`MOBILE_TEST=PASS app=${app} cases=${app === "app-field" ? "19+" : "20+"}`);
