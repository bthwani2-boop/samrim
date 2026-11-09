import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const independent = read("../src/features/stores/independent-stores-workspace.tsx");
const partners = read("../src/features/partner-onboarding/partners-workbench.tsx");
const inspector = read("../src/features/stores/store-inspector.tsx");
const storeRoute = read("../app/(workspace)/partners/stores/[storeId]/page.tsx");

test("independent and partner registries open exactly the same Store inspector", () => {
  assert.ok(partners.includes("<StoreInspector key={openStore} storeId={openStore}"));
  assert.ok(independent.includes('import { StoreInspector } from "./store-inspector"'));
  assert.ok(independent.includes("<StoreInspector key={selectedStoreId} storeId={selectedStoreId}"));
  assert.ok(independent.includes("<AdaptiveRecordWorkspace open={Boolean(selectedStoreId)} detail={detail}"));
  assert.ok(independent.includes('preferenceKey="partners-unified"'));
  assert.ok(independent.includes("onClick={() => setSelectedStoreId(store.id)}"));
  assert.ok(independent.includes("data-adaptive-record-trigger="));
  assert.ok(!independent.includes("<details><summary>بيانات المتجر</summary>"));
  assert.ok(storeRoute.includes("<StoreWorkspace key={storeId} storeId={storeId}"));
  assert.ok(independent.includes("/partners/stores/${encodeURIComponent(store.id)}"));
});

test("independent registry validates DSH relation and remounts on Identity session change", () => {
  assert.ok(independent.includes('store.relationModel !== "INDEPENDENT_STORE"'));
  assert.ok(independent.includes('state.identity.sessionId'));
  assert.ok(independent.includes("<IndependentStoresRegistry key={sessionKey}"));
  assert.ok(independent.includes('onClose={() => setSelectedStoreId("")}'));
});

test("canonical editor is shared, but marketplace WLT finance remains partner-only", () => {
  assert.ok(inspector.includes('import("./store-workspace")'));
  assert.ok(inspector.includes("<StoreManagement storeId={currentStore.id} embedded"));
  assert.ok(inspector.includes('canViewFinance={canViewFinance && currentStore.relationModel === "BTHWANI_PARTNER"}'));
  assert.ok(inspector.includes("/api/stores/${encodeURIComponent(storeId)}/publication"));
});

// Evaluate the inspector's production action guard against both Store relations.
test("independent Store is never offered public publish while Marketplace readiness is retained", () => {
  const declaration = inspector.match(/const canPublish = Boolean\([^\n]+\);/)?.[0];
  assert.ok(declaration, "the shared Store inspector must guard its publication action");
  const evaluate = (relationModel, publicationState, ready) => {
    const currentStore = { relationModel, publicationState, publicationReadiness: { ready } };
    return Function("currentStore", `${declaration}; return canPublish;`)(currentStore);
  };
  assert.equal(evaluate("INDEPENDENT_STORE", "unpublished", true), false, "readiness alone cannot open independent publication");
  assert.equal(evaluate("INDEPENDENT_STORE", "hidden", true), false);
  assert.equal(evaluate("INDEPENDENT_STORE", "published", false), true, "an existing publication must remain hideable");
  assert.equal(evaluate("BTHWANI_PARTNER", "unpublished", true), true);
  assert.equal(evaluate("BTHWANI_PARTNER", "unpublished", false), false);
  assert.equal(evaluate("UNKNOWN", "unpublished", true), false);
  assert.match(inspector, /nextState === "published" && store\.relationModel !== "BTHWANI_PARTNER"/, "mutation must independently fail closed");
  assert.match(inspector, /النشر العام للمتاجر المستقلة غير مفعّل/, "operator must see the unavailable rollout gate");
});
