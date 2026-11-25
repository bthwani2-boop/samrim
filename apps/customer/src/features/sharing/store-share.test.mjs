import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import * as serviceability from "../location/serviceability.ts";
import { publicStorefrontPath } from "./store-share.ts";

const root = path.resolve(import.meta.dirname, "../../../../..");
const app = path.join(root, "apps/customer/app");
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-store-link-"));
let storeRoute, storefrontRoute;
try {
  const result = spawnSync(process.execPath, [
    path.join(root, "node_modules/typescript/bin/tsc"),
    path.join(app, "store/[id].tsx"), path.join(app, "storefront/[storeId].tsx"),
    "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022",
    "--module", "commonjs", "--jsx", "react-jsx", "--rootDir", app, "--outDir", temp,
  ], { cwd: root, encoding: "utf8", timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  storeRoute = readFileSync(path.join(temp, "store/[id].js"), "utf8");
  storefrontRoute = readFileSync(path.join(temp, "storefront/[storeId].js"), "utf8");
} finally { rmSync(temp, { recursive: true, force: true }); }

const invalidIds = ["", ".", "..", "../admin", "a/b", "a\\b", "bad\nstore",
  "store name", " store-a", "store-a ", "Store-A", "store_a", "%2fadmin",
  "\ud800", "a".repeat(65)];

test("public Store share links use the current DSH PublicId contract", () => {
  for (const id of ["shop-42", "-", "a".repeat(64)]) {
    assert.equal(publicStorefrontPath(id), `/storefront/${id}`);
  }
  for (const id of invalidIds) assert.equal(publicStorefrontPath(id), "/stores", JSON.stringify(id));
});

function render(compiled, params, os) {
  const mod = { exports: {} };
  const jsx = (type, props) => ({ type, props });
  const modules = {
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "expo-router": { Redirect: "Redirect", useLocalSearchParams: () => params },
    "react-native": { Platform: { OS: os } },
    "../../src/features/stores/storefront-screen": { __esModule: true, default: "StorefrontScreen" },
    "../../src/features/stores/store-detail-screen": { __esModule: true, default: "PublicStoreDetail" },
    "../../src/features/location/serviceability": serviceability,
  };
  new Function("require", "module", "exports", compiled)(name => {
    assert.ok(Object.hasOwn(modules, name), name);
    return modules[name];
  }, mod, mod.exports);
  return mod.exports.default();
}

test("malformed and ambiguous deep links recover on Web and Android without entering Store screens", () => {
  for (const os of ["web", "android"]) {
    for (const [route, key] of [[storeRoute, "id"], [storefrontRoute, "storeId"]]) {
      for (const id of [...invalidIds, undefined, ["store-a", "store-b"]]) {
        const result = render(route, { [key]: id, city: " ADEN ", q: " shop ", actorId: "ignored" }, os);
        assert.equal(result.type, "Redirect", JSON.stringify({ os, key, id }));
        assert.deepEqual(result.props.href, { pathname: "/stores", params: { city: "aden", q: "shop" } });
      }
      assert.equal(render(route, { [key]: "..", city: "../private" }, os).props.href, "/stores");
    }
  }
});

test("valid Store links preserve admitted Web and Android navigation", () => {
  for (const os of ["web", "android"]) {
    const result = render(storeRoute, { id: "store-a" }, os);
    assert.equal(result.type, "PublicStoreDetail");
  }
  const web = render(storefrontRoute, { storeId: "store-a" }, "web");
  assert.equal(web.type, "StorefrontScreen");
  assert.equal(web.props.storeId, "store-a");
  const native = render(storefrontRoute, { storeId: "store-a", city: "sanaa", q: "shop", vertical: "grocery" }, "android");
  assert.equal(native.type, "Redirect");
  assert.deepEqual(native.props.href, { pathname: "/store/store-a", params: { city: "sanaa", vertical: "grocery", q: "shop" } });
  assert.equal(render(storefrontRoute, { storeId: "store-a" }, "android").props.href, "/store/store-a");
});

test("directory context rejects malformed filters without losing the canonical city", () => {
  for (const q of ["a".repeat(81), "bad\u0000query", "\ud800"]) {
    assert.deepEqual(serviceability.readStoreBrowseScope({ city: "sanaa", q, vertical: ["grocery", "restaurant"] }, ""), { city: "sanaa", q: "" });
  }
  assert.deepEqual(serviceability.readStoreBrowseScope({ city: ["sanaa", "aden"], q: ["shop"] }, "aden"), { city: "aden", q: "" });
  assert.deepEqual(serviceability.readStoreBrowseScope({ city: "sanaa", q: "a".repeat(80) }, ""), { city: "sanaa", q: "a".repeat(80) });
  assert.equal(serviceability.serviceCityLabel("sanaa"), "صنعاء");
  assert.equal(serviceability.serviceCityLabel("unknown-city"), "unknown-city");
});
