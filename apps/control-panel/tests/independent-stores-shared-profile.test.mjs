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
  assert.ok(inspector.includes("<StoreManagement storeId={store.id} embedded"));
  assert.ok(inspector.includes('canViewFinance={canViewFinance && store.publicationReadiness.blockedReason !== "STORE_NOT_MARKETPLACE"}'));
  assert.ok(inspector.includes("/api/stores/${encodeURIComponent(storeId)}/publication"));
});
