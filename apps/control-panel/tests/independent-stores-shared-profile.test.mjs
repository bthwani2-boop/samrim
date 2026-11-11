import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import nextConfig from "../next.config.mjs";
import test from "node:test";

const read = (name) => readFileSync(new URL(name, import.meta.url), "utf8");
const partners = read("../src/features/partner-onboarding/partners-workbench.tsx");
const inspector = read("../src/features/stores/store-inspector.tsx");
const storeRoute = read("../app/(workspace)/partners/stores/[storeId]/page.tsx");
const workspaceSearch = read("../app/api/workspace/search/route.ts");
const navigation = read("../src/navigation/workspace-registry.ts");

test("the independent bookmark and Store search use the one registry and Store file", async () => {
  assert.ok(partners.includes("<StoreInspector key={openStore} storeId={openStore}"));
  assert.ok(partners.includes('preferenceKey="partners-unified"'));
  assert.ok(partners.includes("data-adaptive-record-trigger="));
  const aliases = (await nextConfig.redirects()).filter((rule) => rule.source === "/independent-stores");
  assert.deepEqual(aliases, [{
    source: "/independent-stores",
    destination: "/partners?tab=directory&relationModel=INDEPENDENT_STORE",
    permanent: false,
  }]);
  assert.equal(existsSync(new URL("../app/(workspace)/independent-stores/page.tsx", import.meta.url)), false);
  assert.doesNotMatch(navigation, /href: "\/independent-stores"/);
  assert.ok(storeRoute.includes("<StoreWorkspace key={storeId} storeId={storeId}"));
  assert.ok(inspector.includes("/partners/stores/${encodeURIComponent(currentStore.id)}"));
  assert.ok(workspaceSearch.includes("/partners/stores/${encodeURIComponent(item.id)}"));
  assert.doesNotMatch(workspaceSearch, /\/independent-stores/);
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
