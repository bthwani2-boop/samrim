import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const workspace = readFileSync(resolve(root, "src/features/navigation/merchant-workspace.tsx"), "utf8");
const component = resolve(root, "src/features/catalog/merchant-published-offers.tsx");

test("verified Merchant products section renders private owner-scoped DSH catalog, not public-only data", () => {
  const privateComponent = resolve(root, "src/features/catalog/merchant-private-catalog.tsx");
  assert.ok(existsSync(privateComponent), "private Store Catalog reader must be implemented");
  assert.match(workspace, /section === "products"\s*\?\s*\(?.*MerchantPrivateCatalog/s);
  assert.match(workspace, /<MerchantPrivateCatalog\s+actorId=\{actorId\}\s+stores=\{stores\}/);
  const code = readFileSync(privateComponent, "utf8");
  assert.match(code, /readMerchantCatalogPage\(/, "private owner catalog transport is required");
  assert.match(code, /actorId/, "visible read must be scoped to the current verified actor");
  assert.match(code, /AbortController/, "switching Stores or account must cancel pending read");
  assert.match(code, /page\.nextCursor/, "pagination must use owner-issued keyset");
  assert.doesNotMatch(code, /listPublicOffers\(/, "public discovery excludes Store drafts");
  assert.doesNotMatch(code, /localStorage|AsyncStorage|SecureStore/, "no duplicate local catalogue");
});

test("Merchant published-offer search uses DSH query for every page and isolates Store/actor results", () => {
  const code = readFileSync(component, "utf8");
  assert.match(code, /TextInput/);
  assert.match(code, /onSubmitEditing=/);
  assert.match(code, /setSearchQuery\(/);
  assert.match(code, /JSON\.stringify\(\[actorId, storeId, searchQuery\]\)/);
  assert.match(code, /query: searchQuery/);
  assert.match(code, /listPublicOffers\(origin, storeId/);
  assert.match(code, /activeRequest\.current\?\.abort\(\)/);
});
