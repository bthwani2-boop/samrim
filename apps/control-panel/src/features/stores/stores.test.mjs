import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadMappedRenderFixture } from "../../../../../tools/dev/mapped-render-fixture.mjs";

const loadedModules = [];
process.once("exit", () => loadedModules.length);



test("publication review opens an exact Store, preserves its page, and fails closed outside scope", async t => {
  const previous = process.env.OPERATOR_POLICY_DSH_ORIGIN;
  process.env.OPERATOR_POLICY_DSH_ORIGIN = "http://127.0.0.1:3202";
  t.after(() => {
    if (previous === undefined) delete process.env.OPERATOR_POLICY_DSH_ORIGIN;
    else process.env.OPERATOR_POLICY_DSH_ORIGIN = previous;
  });
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  const app = path.join(root, "apps/control-panel");
  const files = ["app/(workspace)/merchants/joining/page.tsx", "app/(workspace)/merchants/stores/[storeId]/page.tsx",
    "src/features/stores/publication-review-query.ts", "src/features/stores/store-details.tsx", "src/server/operator-publication-review.ts"];
  const temp = mkdtempSync(path.join(tmpdir(), "bth-publication-review-"));
  try {
    const compile = spawnSync(process.execPath, [path.join(root, "node_modules/@typescript/native/bin/tsc"), ...files.map(file => path.join(app, file)),
      "--ignoreConfig", "--noResolve", "--noCheck", "--target", "es2022", "--module", "commonjs",
      "--jsx", "react-jsx", "--inlineSourceMap", "--inlineSources", "--rootDir", app, "--outDir", temp], { cwd: root, encoding: "utf8", timeout: 20000 });
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const jsx = (type, props) => ({type, props});
    const nodes = node => Array.isArray(node) ? node.flatMap(nodes) :
      node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
    const record = {id: "store-b", name: "متجر ب", verticalId: "grocery", cityActive: true, verticalActive: false,
      locationRecorded: false, registrationTermsRecorded: true, weeklyHoursRecorded: false, catalogRecorded: true};
    let items = [record];
    let grants = ["merchant"];
    let ownerDenies = false;
    let cityDirectoryUnavailable = false;
    let cityCalls = 0;
    const calls = [];
    class DshPublicError extends Error { constructor(status) { super("owner denied"); this.status = status; } }
    const mocks = {
      "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
      "next/headers": { cookies: async () => ({ get: () => ({ value: "synthetic" }) }) },
      "server-only": {},
      "@bthwani/dsh": { DshPublicError, listPublicCities: async (origin, options) => {
        assert.equal(origin, "http://127.0.0.1:3202");
        assert.equal(options.limit, 50);
        assert.ok(options.signal instanceof AbortSignal);
        cityCalls++;
        if (cityDirectoryUnavailable) throw new Error("directory unavailable");
        return { items: ["sanaa", "aden"], revision: 1 };
      }, listOperatorStorePublicationReview: async (_origin, city, relation, _bearer, after) => {
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
    const query = loadMappedRenderFixture(readFileSync(path.join(temp, files[2].replace(/\.ts$/, ".js")), "utf8"), path.join(app, files[2]), {});
    loadedModules.push(query);
    const detailsModule = loadMappedRenderFixture(readFileSync(path.join(temp, files[3].replace(/\.tsx$/, ".js")), "utf8"), path.join(app, files[3]), {
      "react/jsx-runtime": mocks["react/jsx-runtime"],
      "./publication-review-query": query.exports,
    });
    loadedModules.push(detailsModule);
    const review = loadMappedRenderFixture(readFileSync(path.join(temp, files[4].replace(/\.ts$/, ".js")), "utf8"), path.join(app, files[4]), {
      "server-only": mocks["server-only"],
      "@bthwani/dsh": mocks["@bthwani/dsh"],
      "next/headers": mocks["next/headers"],
      "../features/stores/public-store-query": mocks["public-store-query"],
      "../features/stores/publication-review-query": query.exports,
      "./current-operator-access": mocks["current-operator-access"],
      "./operator-passkey-bff": mocks["operator-passkey-bff"],
    });
    loadedModules.push(review);
    function load(source, prefix) {
      const mod = loadMappedRenderFixture(readFileSync(path.join(temp, source.replace(/\.tsx$/, ".js")), "utf8"), path.join(app, source), {
        "react/jsx-runtime": mocks["react/jsx-runtime"],
        "@bthwani/dsh": mocks["@bthwani/dsh"],
        [prefix + "features/operator-shell/operator-shell.module.css"]: mocks["operator-shell.module.css"],
        [prefix + "features/operator-shell/workspace-unavailable"]: mocks["workspace-unavailable"],
        [prefix + "features/stores/public-store-query"]: mocks["public-store-query"],
        [prefix + "features/stores/publication-review-query"]: query.exports,
        [prefix + "features/stores/store-details"]: detailsModule.exports,
        [prefix + "server/operator-publication-review"]: review.exports,
      });
      assert.ok(!mod.filename.includes("[") && !mod.filename.includes("]"), "V8 virtual path must not contain dynamic route brackets");
      loadedModules.push(mod);
      return mod.exports;
    }
    const scope = {city: "sanaa", relation: "DIRECT", after: "store-a"};
    const joining = load(files[0], "../../../../src/").default;
    const details = load(files[1], "../../../../../src/").default;
    assert.notEqual(loadedModules.at(-1).filename, loadedModules.at(-2).filename, "same-basename routes must have distinct virtual script identities");
    const render = (storeId, search = scope) => details({params: Promise.resolve({storeId}), searchParams: Promise.resolve(search)});
    const renderJoining = (search = scope) => joining({searchParams: Promise.resolve(search)});
    const initial = nodes(await renderJoining({}));
    const cityInput = initial.find(node => node.type === "input" && node.props.name === "city");
    const cityOptions = initial.find(node => node.type === "datalist");
    assert.ok(cityOptions);
    assert.equal(cityInput.props.list, cityOptions.props.id);
    assert.deepEqual(nodes(cityOptions).slice(1).map(node => node.props.value), ["sanaa", "aden"]);
    const cityPattern = new RegExp(`^${cityInput.props.pattern}$`, "v");
    assert.ok(cityPattern.test("historical-city"));
    assert.ok(!cityPattern.test("invalid/city"));
    assert.equal(calls.length, 0, "an unselected city does not issue a publication review");

    const tree = nodes(await renderJoining());
    assert.ok(tree.some(node => node.props.href === "/merchants/stores/store-b?city=sanaa&relation=DIRECT&after=store-a"));
    const summary = tree.find(node => typeof node.type === "function" && node.type.name === "PublicationReviewPageSummary");
    assert.ok(summary, "current-page readiness facts must be presented");
    const summaryNodes = nodes(summary.type(summary.props));
    const textOf = node => typeof node === "string" || typeof node === "number" ? String(node) :
      Array.isArray(node) ? node.map(textOf).join(" ") : node?.props ? textOf(node.props.children) : "";
    const metrics = Object.fromEntries(summaryNodes.filter(node => node.type === "div" && node.props.children?.[0]?.type === "dt")
      .map(node => [textOf(node.props.children[0]), textOf(node.props.children[1])]));
    assert.equal(metrics["متاجر في الصفحة الحالية"], "1");
    assert.equal(metrics["متاجر لديها حقائق تأسيس ناقصة"], "1 من 1");
    assert.equal(metrics["متاجر سجلت جميع الحقائق الست"], "0 من 1");
    assert.equal(metrics["النشاط غير نشط"], "1 من 1");
    assert.equal(metrics["الموقع غير مسجل"], "1 من 1");
    assert.equal(metrics["الكتالوج غير مسجل"], "0 من 1");
    assert.match(textOf(summary.type(summary.props)), /ليست إجمالي المدينة/);
    const facts = nodes(detailsModule.exports.PublicationReviewFacts({store:record}));
    assert.match(textOf(facts), /راجع تفعيل النشاط/);
    const complete = {...record, verticalActive:true, locationRecorded:true, weeklyHoursRecorded:true};
    const completeSummary = textOf(summary.type({items:[complete]}));
    assert.match(completeSummary, /لا تعني موافقة النشر/);
    assert.match(completeSummary, /1 من 1/);
    const emptySummary = textOf(summary.type({items:[]}));
    assert.match(emptySummary, /لا ينطبق/);
    assert.doesNotMatch(emptySummary, /0 من 0/);
    const detail = nodes(await render("store-b")).find(node => node.props.store);
    assert.deepEqual(detail?.props.store, record);
    assert.ok(nodes(detail.type(detail.props)).some(node => node.props.href === "/merchants/joining?city=sanaa&relation=DIRECT&after=store-a"));
    assert.deepEqual(calls, [["sanaa", "DIRECT", "store-a"], ["sanaa", "DIRECT", "store-a"]]);

    grants = ["operations"];
    assert.equal((await render("store-b")).type, "Unavailable");
    assert.equal((await renderJoining()).type, "Unavailable");
    assert.equal(cityCalls, 2, "city suggestions are only read for authorized list pages");
    grants = ["merchant"];
    for (const [id, query] of [["../store-b", scope], ["store-a", scope], ["store-b", {...scope, city: ["sanaa", "aden"]}]]) {
      assert.ok(nodes(await render(id, query)).some(node => node.props.role === "alert"));
    }
    assert.equal(calls.length, 2, "invalid scope and missing grants never reach DSH");
    items = [{...record, id: "store-c"}];
    assert.ok(!nodes(await render("store-b")).some(node => node.props.store), "a neighboring Store must not fill missing detail");
    ownerDenies = true;
    assert.equal((await render("store-b")).type, "Unavailable");
    assert.equal((await renderJoining()).type, "Unavailable");
    assert.equal(cityCalls, 2, "owner revocation also withholds suggestions");

    ownerDenies = false;
    cityDirectoryUnavailable = true;
    const recovery = nodes(await renderJoining({ city: "historical-city", relation: "DIRECT" }));
    const manual = recovery.find(node => node.type === "input" && node.props.name === "city");
    assert.equal(manual.props.defaultValue, "historical-city");
    assert.equal(manual.props.list, undefined);
    assert.ok(recovery.some(node => node.props.id === manual.props["aria-describedby"]));
    assert.deepEqual(calls.at(-1), ["historical-city", "DIRECT", undefined]);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
