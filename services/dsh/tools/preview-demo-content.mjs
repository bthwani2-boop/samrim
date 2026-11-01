import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(toolDir, "../demo-content");

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`DEMO_CONTENT_INVALID:${label}`);
}

function readLocalAsset(root, relativePath) {
  requireText(relativePath, "asset path");
  if (path.isAbsolute(relativePath) || relativePath.split("/").includes("..")) {
    throw new Error(`DEMO_CONTENT_PATH_UNSAFE:${relativePath}`);
  }
  const fullPath = path.resolve(root, relativePath);
  if (!fullPath.startsWith(root + path.sep) || !fs.existsSync(fullPath)) throw new Error(`DEMO_CONTENT_ASSET_MISSING:${relativePath}`);
  const source = fs.readFileSync(fullPath, "utf8");
  if (!/^<svg\s/.test(source) || /<!DOCTYPE|<(?:script|image|foreignObject)\b|(?:href|src)\s*=\s*["']https?:/i.test(source)) {
    throw new Error(`DEMO_CONTENT_ASSET_UNSAFE:${relativePath}`);
  }
  const dimensions = source.match(/<svg\b[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
  if (!dimensions || Number(dimensions[1]) > 6000 || Number(dimensions[2]) > 6000) throw new Error(`DEMO_CONTENT_ASSET_DIMENSIONS:${relativePath}`);
  return source;
}

export function inspectDemoContent(root = defaultRoot) {
  const resolvedRoot = path.resolve(root);
  const manifestPath = path.join(resolvedRoot, "content.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.packId !== "bthwani-local-demo-20261101" || manifest.language !== "ar-YE") throw new Error("DEMO_CONTENT_IDENTITY_INVALID");
  if (!Array.isArray(manifest.stores) || manifest.stores.length !== 3 || !Array.isArray(manifest.categories) || !manifest.categories.length) throw new Error("DEMO_CONTENT_COLLECTION_INVALID");
  const storeKeys = new Set();
  const productNames = new Set();
  let productCount = 0;
  const artworkPaths = new Set();
  for (const store of manifest.stores) {
    requireText(store.storeKey, "storeKey");
    requireText(store.nameAr, "store name");
    requireText(store.cityAr, "store city");
    if (storeKeys.has(store.storeKey)) throw new Error(`DEMO_CONTENT_STORE_KEY_DUPLICATE:${store.storeKey}`);
    storeKeys.add(store.storeKey);
    for (const forbidden of ["storeId", "actorId", "database", "connectionString"]) {
      if (Object.hasOwn(store, forbidden)) throw new Error(`DEMO_CONTENT_CANONICAL_BINDING_FORBIDDEN:${store.storeKey}:${forbidden}`);
    }
    const csvPath = path.join(resolvedRoot, store.catalogFile);
    const csv = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "").trim().split(/\r?\n/);
    if (csv[0] !== "name,variant,unit,priceYER" || csv.length < 2) throw new Error(`DEMO_CONTENT_CSV_HEADER_INVALID:${store.storeKey}`);
    for (const [index, row] of csv.slice(1).entries()) {
      const columns = row.split(",");
      if (columns.length !== 4 || !columns[0].trim() || !columns[1].trim() || !["COUNT", "GRAM", "MILLILITER"].includes(columns[2]) || !/^\d+$/.test(columns[3]) || Number(columns[3]) <= 0) {
        throw new Error(`DEMO_CONTENT_CSV_ROW_INVALID:${store.storeKey}:${index + 2}`);
      }
      if (productNames.has(columns[0])) throw new Error(`DEMO_CONTENT_PRODUCT_DUPLICATE:${columns[0]}`);
      productNames.add(columns[0]);
      productCount += 1;
    }
    artworkPaths.add(store.coverArtwork);
  }
  if (productCount !== 9) throw new Error(`DEMO_CONTENT_PRODUCT_COUNT_INVALID:${productCount}`);
  for (const category of manifest.categories) artworkPaths.add(category.artwork);
  for (const item of manifest.productArtwork) artworkPaths.add(item.artwork);
  for (const item of manifest.discovery) {
    if (item.kind !== "BANNER" || item.targetType !== "INFO" || item.publication !== "offline-proposal-only") throw new Error("DEMO_CONTENT_DISCOVERY_MUST_REMAIN_OFFLINE");
    artworkPaths.add(item.artwork);
  }
  for (const assetPath of artworkPaths) readLocalAsset(resolvedRoot, assetPath);
  return {
    stores: manifest.stores.length,
    categories: manifest.categories.length,
    products: productCount,
    productArtwork: manifest.productArtwork.length,
    discoveryProposals: manifest.discovery.length,
    artwork: artworkPaths.size,
    missingStoreBindings: manifest.stores.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = inspectDemoContent();
  console.log(`OFFLINE_DEMO_PREVIEW stores=${result.stores} categories=${result.categories} products=${result.products} product_artwork=${result.productArtwork} banners=${result.discoveryProposals} artwork=${result.artwork} canonical_store_bindings=0/${result.stores} runtime=BLOCKED api_calls=0 file_writes=0`);
}
