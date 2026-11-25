import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverNodeSourceTests, discoverWorkspaceNodeTests } from "./source-test-discovery.mjs";

function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "bthwani-test-inclusion-"));
  const folder = join(root, "apps", "customer", "src", "features");
  const add = (file, text = "") => {
    const path = join(folder, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  try {
    return callback({ root, folder, add });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("new nested .test.mjs is discovered without Git tracking", () => fixture(({ root, folder, add }) => {
  add("cart/new-cart.test.mjs", 'import test from "node:test"; test("pass", () => {});');
  add("store/nested/other.test.mjs");
  add("store/product.tsx");
  assert.deepEqual(discoverNodeSourceTests(root, folder), [
    "apps/customer/src/features/cart/new-cart.test.mjs",
    "apps/customer/src/features/store/nested/other.test.mjs",
  ]);
}));

test("test.tsx, test.ts and spec.tsx cannot silently escape CI coverage", () => {
  for (const name of ["cart/cart.test.tsx", "cart/cart.test.ts", "cart/cart.spec.tsx", "cart/cart.test.js"]) {
    fixture(({ root, folder, add }) => {
      add(name);
      assert.throws(() => discoverNodeSourceTests(root, folder),
        (e) => e.message.includes("UNSUPPORTED_SOURCE_TEST_FORMAT") && e.message.includes(name));
    });
  }
});

test("a newly discovered failing Node test fails the underlying test process", () => fixture(({ root, folder, add }) => {
  const file = add("orders/failure.test.mjs",
    'import test from "node:test"; import assert from "node:assert/strict"; test("bad", () => assert.equal(1, 2));');
  assert.equal(discoverNodeSourceTests(root, folder).length, 1);
  const env = { ...process.env };
  // A nested Node runner must not inherit the enclosing node:test child marker.
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ["--test", "--test-reporter=tap", file], {
    encoding: "utf8", timeout: 15000, env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /not ok|ERR_ASSERTION/);
}));

test("the real source test discovery check runs independently of full coverage", () => {
  const script = fileURLToPath(new URL("./run-coverage.mjs", import.meta.url));
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const result = spawnSync(process.execPath, [script, "--check-discovery"], {
    cwd: repo, encoding: "utf8", timeout: 20000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /SOURCE_TEST_DISCOVERY_PASS/);
});

test("new untracked infrastructure, tooling and package tests enter the actual workspace input set", () => {
  const root = mkdtempSync(join(tmpdir(), "bthwani-workspace-inclusion-"));
  try {
    const add = (relativePath) => {
      const full = join(root, relativePath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "");
    };
    add("infra/new-safety.test.mjs");
    add("tools/dev/future-guard.test.mjs");
    add("packages/new-package/src/new-lib.test.mjs");
    add("apps/merchant/src/features/orders/missing-owner.test.mjs");
    add("apps/customer/node_modules/hidden.test.mjs");
    add("apps/captain/.expo/generated.test.mjs");
    assert.deepEqual(discoverWorkspaceNodeTests(root), [
      "apps/merchant/src/features/orders/missing-owner.test.mjs",
      "infra/new-safety.test.mjs",
      "packages/new-package/src/new-lib.test.mjs",
      "tools/dev/future-guard.test.mjs",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("linked source directories cannot hide untracked test suites from CI", (t) => fixture(({ root, folder }) => {
  const outside = join(root, "hidden-tests");
  mkdirSync(folder, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "hidden.test.mjs"), "import test from 'node:test'; test('hidden', () => {});");
  try {
    symlinkSync(outside, join(folder, "orders"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("source links unavailable");
    throw error;
  }
  assert.throws(() => discoverNodeSourceTests(root, folder),
    /UNSCANNED_SOURCE_LINK apps\/customer\/src\/features\/orders/);
}));

test("linked workspace source roots cannot import tests outside their owner", (t) => fixture(({ root }) => {
  const outside = join(root, "external-tests");
  mkdirSync(outside);
  writeFileSync(join(outside, "outside.test.mjs"), "export {};");
  try {
    symlinkSync(outside, join(root, "tools"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("source links unavailable");
    throw error;
  }
  assert.throws(() => discoverWorkspaceNodeTests(root), /UNSCANNED_SOURCE_LINK tools/);
}));

test("generated dependency symlinks remain excluded, without hiding authored source", (t) => fixture(({ root, folder }) => {
  const generated = join(root, "installed-dependency");
  mkdirSync(generated, { recursive: true });
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(generated, "generated.test.mjs"), "export {};");
  try {
    symlinkSync(generated, join(folder, "node_modules"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("source links unavailable");
    throw error;
  }
  assert.deepEqual(discoverNodeSourceTests(root, folder), [],
    "generated dependency links are deliberately out of the source test set");
}));

test("unsupported new tooling tests fail closed rather than disappear from CI", () => {
  const root = mkdtempSync(join(tmpdir(), "bthwani-tools-inclusion-"));
  try {
    const file = join(root, "tools", "dev", "new-tool.test.tsx");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    assert.throws(() => discoverWorkspaceNodeTests(root), /UNSUPPORTED_SOURCE_TEST_FORMAT tools\/dev\/new-tool\.test\.tsx/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function coverageFixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "bthwani-lcov-publication-"));
  const add = (relativePath, contents) => {
    const file = join(root, relativePath);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, contents);
    return file;
  };
  try {
    for (const name of ["run-coverage.mjs", "source-test-discovery.mjs"]) {
      const target = add(`tools/dev/${name}`, "");
      copyFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), target);
    }
    add("packages/design-system/tools/ts-resolver.mjs", "export {};\n");
    for (const name of [
      "tools/governance/review-examples.test.mjs",
      "tools/security/verify-secrets.test.mjs",
      "tools/mobile/verify-rtl.test.mjs",
      "tools/mobile/verify-expo-config.test.mjs",
      "tools/mobile/verify-application-boundaries.test.mjs",
      "packages/tamagui-config/tools/appearance.test.mjs",
      "tools/dev/verify-source-execution.test.mjs",
      "tools/dev/dsh-public-client.test.mjs",
      "tools/dev/check-openapi.test.mjs",
      "tools/dev/source-test-discovery.test.mjs",
      "tools/mobile/verify-native-config.test.mjs",
    ]) add(name, 'import test from "node:test"; test("fixture pass", () => {});\n');
    add("tools/mobile/verify-app-foundations.mjs", "export const measured = 1;\n");
    add("tools/mobile/define-bthwani-expo-app.cjs", "module.exports = 1;\n");
    add("packages/design-system/src/semantics/themes.ts", "export const measured: number = 1;\n");
    add("tools/dev/measure.test.mjs", [
      'import "../mobile/verify-app-foundations.mjs";',
      'import "../mobile/define-bthwani-expo-app.cjs";',
      'import "../../packages/design-system/src/semantics/themes.ts";',
      'import test from "node:test"; test("measured sources", () => {});',
    ].join("\n"));
    const report = add("coverage/lcov.info", "STALE_REPORT");
    const run = (...args) => {
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT;
      // An absent variable is automatically propagated by Node child_process.
      env.NODE_V8_COVERAGE = join(root, ".fixture-v8");
      return spawnSync(process.execPath, ["tools/dev/run-coverage.mjs", ...args], {
        cwd: root, env, encoding: "utf8", timeout: 30000,
      });
    };
    return callback({ root, add, report, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("failed test discovery cannot leave previous coverage available", () => coverageFixture(({ add, report, run }) => {
  add("tools/dev/unsupported.test.ts", "export {};");
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /UNSUPPORTED_SOURCE_TEST_FORMAT/);
  assert.equal(existsSync(report), false, "stale coverage must not survive failed discovery");
}));

test("failed real Node tests cannot publish partial or stale coverage", () => coverageFixture(({ root, add, report, run }) => {
  add("tools/dev/failing.test.mjs", 'import test from "node:test"; test("intentional failure", () => { throw new Error("fixture failure"); });');
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout + result.stderr, /fixture failure/);
  assert.equal(existsSync(report), false, "failed tests must not publish LCOV");
  assert.deepEqual(readdirSync(join(root, "coverage")), [], "temporary output must be cleaned");
}));

test("incomplete coverage is not published even when the tests pass", () => coverageFixture(({ root, report, run }) => {
  rmSync(join(root, "tools/dev/measure.test.mjs"));
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Real test coverage missing required source/);
  assert.equal(existsSync(report), false);
  assert.deepEqual(readdirSync(join(root, "coverage")), []);
}));

test("discovery-only leaves prior evidence untouched and real success publishes LCOV", () => coverageFixture(({ root, report, run }) => {
  const discovery = run("--check-discovery");
  assert.equal(discovery.status, 0, discovery.stdout + discovery.stderr);
  assert.equal(readFileSync(report, "utf8"), "STALE_REPORT");
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /REAL_SOURCE_LCOV_PASS/);
  const lcov = readFileSync(report, "utf8");
  assert.match(lcov, /SF:tools\/mobile\/verify-app-foundations\.mjs/);
  assert.doesNotMatch(lcov, /STALE_REPORT/);
  assert.deepEqual(readdirSync(join(root, "coverage")), ["lcov.info"]);
}));
