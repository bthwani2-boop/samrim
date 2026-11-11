import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import nextConfig from "../next.config.mjs";

const app = new URL("../app/(workspace)/", import.meta.url);
const aliases = [
  { source: "/catalog-activity", destination: "/catalog?catalogView=activity", canonical: "catalog/page.tsx", retired: "catalog-activity/page.tsx" },
  { source: "/partners/stores", destination: "/partners?tab=directory", canonical: "partners/page.tsx", retired: "partners/stores/page.tsx" },
  { source: "/finance/beneficiary-settlement", destination: "/finance/beneficiary-settlement/partners", canonical: "finance/beneficiary-settlement/[actorType]/page.tsx", retired: "finance/beneficiary-settlement/page.tsx" },
];

test("retired registry aliases are native Next redirects, not second app route owners", async () => {
  const redirects = await nextConfig.redirects();
  for (const { source, destination, canonical, retired } of aliases) {
    const matches = redirects.filter(rule => rule.source === source);
    assert.deepEqual(matches, [{ source, destination, permanent: false }], source);
    assert.equal(existsSync(new URL(retired, app)), false, "obsolete page must actually be deleted: " + retired);
    assert.equal(existsSync(new URL(canonical, app)), true, "original canonical page must survive: " + canonical);
  }
});

test("direct Store and beneficiary pages remain distinct from their retired index aliases", () => {
  const store = readFileSync(new URL("partners/stores/[storeId]/page.tsx", app), "utf8");
  const beneficiary = readFileSync(new URL("finance/beneficiary-settlement/[actorType]/page.tsx", app), "utf8");
  assert.match(store, /storeId/);
  assert.match(beneficiary, /params: Promise<\{ actorType: string \}>/);
  assert.match(beneficiary, /<BeneficiarySettlementWorkspace actorType=\{selected.actorType\}/);
});

test("the catalog workspace still guards cross-Store history with Identity permissions", () => {
  const catalog = readFileSync(new URL("../src/features/central-catalog/catalog-center-workspace.tsx", import.meta.url), "utf8");
  assert.match(catalog, /permissions\?\.includes\("catalog"\) && state.identity.permissions\?\.includes\("partners"\)/);
  assert.match(catalog, /requested==="activity"&&!activityAllowed/);
});
