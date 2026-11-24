import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findWorkspaceEntry } from "../navigation/workspace-registry.ts";
import { canShowNavigation } from "../session/operator-permissions.ts";

test("stores: routes have the expected navigation permission boundary", () => {
  for (const path of ["/merchants","/merchants/stores/abc"]) {
    assert.equal(findWorkspaceEntry(path)?.permission ?? null, "merchant");
  }
});

test("stores: unauthenticated or unmapped sessions never expose navigation", () => {
  assert.equal(canShowNavigation(false, ["operations", "finance", "platform_policies"], "merchant"), false);
  assert.equal(canShowNavigation(true, [], "merchant"), false);
});

test("publication review opens an exact Store, preserves its page, and fails closed outside scope", async () => {
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const app = path.join(root, "apps/control-panel");
  const files = ["app/(workspace)/merchants/joining/page.tsx", "app/(workspace)/merchants/stores/[storeId]/page.tsx",
    "src/features/stores/publication-review-query.ts", "src/features/stores/store-details.tsx", "src/server/operator-publication-review.ts"];
  const temp = mkdtempSync(path.join(tmpdir(), "bth-publication-review-"));
  try {
    const compile = spawnSync(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), ...files.map(file => path.join(app, file)),
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--rootDir", app, "--outDir", temp], { cwd: root, encoding: "utf8", timeout: 20000 });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const jsx = (type, props) => ({type, props});
    const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
      node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
    const record = {id: "store-b", name: "متجر ب", verticalId: "grocery", cityActive: true, verticalActive: false,
      locationRecorded: false, registrationTermsRecorded: true, weeklyHoursRecorded: false, catalogRecorded: true};
    let items = [record];
    let grants = ["merchant"];
    let ownerDenies = false;
    const calls = [];
    class DshPublicError extends Error { constructor(status) { super("owner denied"); this.status = status; } }
    const mocks = {
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "next/headers": { cookies: async () => ({ get: () => ({ value: "synthetic" }) }) },
      "server-only": {},
      "@bthwani/dsh": { DshPublicError, listOperatorStorePublicationReview: async (_origin, city, relation, _bearer, after) => {
        calls.push([city, relation, after]);
        if (ownerDenies) throw new DshPublicError(403);
        return {cityId: city, relation, items};
      }},
      "current-operator-access": { currentOperatorAccess: async () => ({ grants }) },
      "operator-passkey-bff": { OPERATOR_COOKIE: "operator" },
      "public-store-query": { isolatedPublicDshOrigin: origin => origin },
      "operator-shell.module.css": { __esModule: true, default: {} },
      "workspace-unavailable": { __esModule: true, default: "Unavailable" },
    };
    function load(file) {
      const mod = { exports: {} };
      new Function("require", "module", "exports", "process", readFileSync(path.join(temp, file), "utf8"))(name => {
        if (Object.hasOwn(mocks, name)) return mocks[name];
        const leaf = name.split("/").at(-1);
        if (Object.hasOwn(mocks, leaf)) return mocks[leaf];
        for (const compiled of files.slice(2).map(source => source.replace(/\.tsx?$/, ".js"))) {
          if (path.basename(compiled, ".js") === leaf) return load(compiled);
        }
        assert.fail(`Unexpected dependency ${name}`);
      }, mod, mod.exports, { env: { OPERATOR_POLICY_DSH_ORIGIN: "http://127.0.0.1:3202" } });
      return mod.exports;
    }
    const scope = {city: "sanaa", relation: "DIRECT", after: "store-a"};
    const joining = load(files[0].replace(/\.tsx$/, ".js")).default;
    const details = load(files[1].replace(/\.tsx$/, ".js")).default;
    const render = (storeId, search = scope) => details({params: Promise.resolve({storeId}), searchParams: Promise.resolve(search)});
    const tree = nodes(await joining({searchParams: Promise.resolve(scope)}));
    assert.ok(tree.some(node => node.props.href === "/merchants/stores/store-b?city=sanaa&relation=DIRECT&after=store-a"));
    const detail = nodes(await render("store-b")).find(node => node.props.store);
    assert.deepEqual(detail?.props.store, record);
    assert.ok(nodes(detail.type(detail.props)).some(node => node.props.href === "/merchants/joining?city=sanaa&relation=DIRECT&after=store-a"));
    assert.deepEqual(calls, [["sanaa", "DIRECT", "store-a"], ["sanaa", "DIRECT", "store-a"]]);

    grants = ["operations"];
    assert.equal((await render("store-b")).type, "Unavailable");
    grants = ["merchant"];
    for (const [id, query] of [["../store-b", scope], ["store-a", scope], ["store-b", {...scope, city: ["sanaa", "aden"]}]]) {
      assert.ok(nodes(await render(id, query)).some(node => node.props.role === "alert"));
    }
    assert.equal(calls.length, 2, "invalid scope and missing grants never reach DSH");
    items = [{...record, id: "store-c"}];
    assert.ok(!nodes(await render("store-b")).some(node => node.props.store), "a neighboring Store must not fill missing detail");
    ownerDenies = true;
    assert.equal((await render("store-b")).type, "Unavailable");
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
