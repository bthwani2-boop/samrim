import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { discoverNodeSourceTests, discoverWindowsPlatformTests, discoverWorkspaceNodeTests, discoverWorkspaceTestSuites } from "./source-test-discovery.mjs";

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

test("project and workspace discovery share deterministic ordinal ordering", () => fixture(({ root, folder, add }) => {
  const names = ["z.test.mjs", "a.test.mjs", "Z-test.test.mjs", "_test.test.mjs", "é.test.mjs"];
  for (const name of names) add(name);
  const expected = ["Z-test.test.mjs", "_test.test.mjs", "a.test.mjs", "z.test.mjs", "é.test.mjs"]
    .map(name => "apps/customer/src/features/" + name);
  assert.deepEqual(discoverNodeSourceTests(root, folder), expected);
  assert.deepEqual(discoverWorkspaceNodeTests(root), expected);
  assert.deepEqual(discoverWorkspaceTestSuites(root).source, expected);
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
    for (const name of ["run-coverage.mjs", "source-test-discovery.mjs", "source-snapshot.mjs"]) {
      const target = add(`tools/dev/${name}`, "");
      copyFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), target);
    }
    add("tools/security/verify-secrets.mjs",readFileSync(new URL("../security/verify-secrets.mjs",import.meta.url),"utf8"));
    add(".gitignore", "coverage/\n.fixture-v8/\ntools/dev/ignored.test.mjs\n");
    add("packages/design-system/tools/ts-resolver.mjs", "export {};\n");
    add("sonar-project.properties", readFileSync(new URL("../../sonar-project.properties", import.meta.url), "utf8"));
    add("tools/mobile/verify-app-identity.mjs", "export const measured = 1;\n");
    add("tools/mobile/define-bthwani-expo-app.cjs", "module.exports = 1;\n");
    add("packages/design-system/src/semantics/themes.ts", "export const measured: number = 1;\n");
    add("tools/dev/measure.test.mjs", [
      'import "../mobile/verify-app-identity.mjs";',
      'import "../mobile/define-bthwani-expo-app.cjs";',
      'import "../../packages/design-system/src/semantics/themes.ts";',
      'import test from "node:test"; test("measured sources", () => {});',
    ].join("\n"));
    const report = add("coverage/lcov.info", "STALE_REPORT");
    const git = (...args) => { const result=spawnSync("git",args,{cwd:root,encoding:"utf8",timeout:10000}); assert.equal(result.status,0,result.stderr); };
    git("init","-q","-b","fixture"); git("config","user.name","Source Fixture"); git("config","user.email","source-fixture@example.invalid"); git("config","commit.gpgsign","false"); git("add","--",".gitignore","tools","packages","sonar-project.properties"); git("commit","-qm","fixture baseline");
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

test("one inventory partitions runtime tests from source and project feedback", () => coverageFixture(({ root, add, report, run }) => {
  const runtime = "apps/control-panel/tests/runtime/real-http.test.mjs";
  const source = "apps/control-panel/tests/source.test.mjs";
  add(runtime, 'import test from "node:test"; test("runtime must actually execute", () => { throw new Error("runtime failure"); });');
  add(source, 'import test from "node:test"; test("source only", () => {});');
  const suites = discoverWorkspaceTestSuites(root);
  assert.deepEqual(suites.operatorRuntime, [runtime]);
  assert.ok(suites.source.includes(source));
  assert.ok(!suites.source.includes(runtime));
  assert.deepEqual([...suites.source, ...suites.operatorRuntime].sort(), discoverWorkspaceNodeTests(root));
  assert.deepEqual(discoverNodeSourceTests(root, join(root, "apps/control-panel")), [source]);
  const check = run("--check-discovery");
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /operator_runtime=1/);
  const coverage = run();
  assert.equal(coverage.status, 0, coverage.stdout + coverage.stderr);
  assert.doesNotMatch(coverage.stdout, /runtime must actually execute/);
  const measured = readFileSync(report, "utf8");
  const failedRuntime = run("--operator-runtime");
  assert.equal(failedRuntime.status, 1, failedRuntime.stdout + failedRuntime.stderr);
  assert.match(failedRuntime.stdout + failedRuntime.stderr, /runtime failure/);
  assert.equal(readFileSync(report, "utf8"), measured);
  add(runtime, 'import test from "node:test"; test("runtime acceptance", () => {});');
  const passedRuntime = run("--operator-runtime");
  assert.equal(passedRuntime.status, 0, passedRuntime.stdout + passedRuntime.stderr);
  assert.match(passedRuntime.stdout, /OPERATOR_RUNTIME_TESTS_PASS files=1/);
  assert.doesNotMatch(passedRuntime.stdout, /source only/);
  assert.equal(readFileSync(report, "utf8"), measured);
}));

test("Windows platform admission fails closed when any required suite is missing", () => fixture(({ root }) => {
  assert.throws(() => discoverWindowsPlatformTests(root), /WINDOWS_PLATFORM_TEST_MISSING/);
}));

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

test("incomplete coverage is not published even when the tests pass", () => coverageFixture(({ root, add, report, run }) => {
  rmSync(join(root, "tools/dev/measure.test.mjs"));
  add("tools/dev/passing.test.mjs", 'import test from "node:test"; test("passes without owner measurement", () => {});');
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
  assert.match(lcov, /SF:tools\/mobile\/verify-app-identity\.mjs/);
  assert.doesNotMatch(lcov, /STALE_REPORT/);
  assert.deepEqual(readdirSync(join(root, "coverage")), ["lcov.info"]);
}));

test("external measured modules never enter the owner LCOV report", () => coverageFixture(({ add, report, run }) => {
  const external = mkdtempSync(join(tmpdir(), "bthwani-external-coverage-"));
  try {
    const externalFile = join(external, "external-measured.mjs");
    writeFileSync(externalFile, "export const measured = 42;\n");
    add("tools/dev/external.test.mjs", [
      `import { measured } from ${JSON.stringify(pathToFileURL(externalFile).href)};`,
      'import test from "node:test";',
      'import assert from "node:assert/strict";',
      'test("actually execute external source", () => assert.equal(measured, 42));',
    ].join("\n"));
    const result = run();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const lcov = readFileSync(report, "utf8");
    assert.match(lcov, /SF:tools\/mobile\/verify-app-identity\.mjs/);
    assert.doesNotMatch(lcov, /SF:[^\r\n]*external-measured\.mjs/);
  } finally {
    rmSync(external, { recursive: true, force: true });
  }
}));

test("Sonar scope is the single report boundary; generated and test files are not published", () => coverageFixture(({ add, report, run }) => {
  add("services/dsh/clients/generated/operations.mjs", "export const generated = 42;");
  add("services/dsh/clients/owner.mjs", "export const owner = 42;");
  add("tools/dev/scope.test.mjs", [
    'import { generated } from "../../services/dsh/clients/generated/operations.mjs";',
    'import { owner } from "../../services/dsh/clients/owner.mjs";',
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'test("actual owner and generated code execute", () => assert.equal(owner, generated));',
  ].join("\n"));
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lcov = readFileSync(report, "utf8");
  assert.match(lcov, /SF:services\/dsh\/clients\/owner\.mjs/);
  assert.doesNotMatch(lcov, /SF:[^\r\n]*\/generated\//);
  assert.doesNotMatch(lcov, /SF:[^\r\n]*\.test\.mjs/);
}));

test("missing or ambiguous scanner scope cannot publish stale or partial evidence", () => coverageFixture(({ add, report, run }) => {
  add("sonar-project.properties", "sonar.sources=apps,tools\nsonar.sources=services\nsonar.exclusions=**/*.test.*\n");
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Expected one Sonar scope property/);
  assert.equal(existsSync(report), false);
}));

test("project feedback executes only the admitted project tests and never replaces full coverage", () => coverageFixture(({ root, add, report }) => {
  add("apps/customer/src/selected.test.mjs", 'import test from "node:test"; test("selected customer test", () => {});');
  add("apps/merchant/src/rejected.test.mjs", 'import test from "node:test"; test("unrelated merchant test", () => { throw new Error("unrelated"); });');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = cwd => spawnSync(process.execPath, [join(root, "tools/dev/run-coverage.mjs"), "--project"], { cwd, env, encoding: "utf8", timeout: 30000 });
  const selected = run(join(root, "apps/customer"));
  assert.equal(selected.status, 0, selected.stdout + selected.stderr);
  assert.match(selected.stdout, /selected customer test/);
  assert.doesNotMatch(selected.stdout, /unrelated merchant test/);
  assert.equal(readFileSync(report, "utf8"), "STALE_REPORT");
  const rejected = run(join(root, "apps/merchant"));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /unrelated merchant test/);
  assert.equal(run(root).status, 1);
}));

test("native LCOV preserves distinct evaluations of the same authored source", () => coverageFixture(({ add, report, run }) => {
  add("tools/dev/repeated-source.mjs", [
    "export function choose(value) {",
    "  if (value) return 1;",
    "  return 2;",
    "}",
  ].join("\n"));
  add("tools/dev/repeated-source.test.mjs", [
    'import { choose as first } from "./repeated-source.mjs";',
    'import { choose as second } from "./repeated-source.mjs?separate-evaluation";',
    'import test from "node:test";',
    'import assert from "node:assert/strict";',
    'test("separate native modules cover distinct branches", () => { assert.equal(first(true), 1); assert.equal(second(false), 2); });',
  ].join("\n"));
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const lcov = readFileSync(report, "utf8");
  const records = lcov.split("end_of_record").filter(record => record.includes("SF:tools/dev/repeated-source.mjs\n"));
  assert.ok(records.length >= 1, "original measured source must survive");
  assert.ok(records.some(record => /DA:2,[1-9]/.test(record)), "positive branch must remain measured");
  assert.ok(records.some(record => /DA:3,[1-9]/.test(record)), "negative branch must remain measured");
  assert.match(result.stdout, /scanner_owns_aggregation=true/);
}));

test("project discovery refuses an ancestor junction that escapes the owner root", (t) => fixture(({ root }) => {
  const external = join(root, "external-owner");
  mkdirSync(join(external, "customer"), { recursive: true });
  writeFileSync(join(external, "customer", "external.test.mjs"), "export {};");
  try {
    symlinkSync(external, join(root, "apps"), "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("source links unavailable");
    throw error;
  }
  assert.throws(() => discoverNodeSourceTests(root, join(root, "apps", "customer")), /UNSCANNED_SOURCE_LINK apps/);
}));

test("a project path outside the supplied checkout is never admitted", () => fixture(({ root, add }) => {
  const file = add("real.test.mjs");
  const actualProject = dirname(file);
  assert.throws(() => discoverNodeSourceTests(join(root, "different-checkout"), actualProject), /SOURCE_SCOPE_OUTSIDE_CHECKOUT/);
}));

test("case-variant test names cannot silently bypass admitted runner format", () => fixture(({ root, folder, add }) => {
  add("nested/candidate.test.MJS");
  assert.throws(() => discoverNodeSourceTests(root, folder), /UNSUPPORTED_SOURCE_TEST_FORMAT/);
}));

test("a competing full coverage invocation cannot invalidate or publish the active writer's report", () => coverageFixture(({ root, add, report, run }) => {
  add("tools/dev/competing.test.mjs", [
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import test from "node:test";',
    'test("active writer excludes competing full run", () => {',
    '  if (process.env.NESTED_COVERAGE_ATTEMPT === "1") return;',
    '  const env = { ...process.env, NESTED_COVERAGE_ATTEMPT: "1" };',
    '  delete env.NODE_TEST_CONTEXT;',
    '  delete env.NODE_V8_COVERAGE;',
    '  const result = spawnSync(process.execPath, ["tools/dev/run-coverage.mjs"], { cwd: process.cwd(), env, encoding: "utf8", timeout: 30000 });',
    '  assert.equal(result.status, 1, result.stdout + result.stderr);',
    '  assert.match(result.stderr, /COVERAGE_WRITER_BUSY/);',
    '});',
  ].join("\n"));
  const result = run();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(readFileSync(report, "utf8"), /SF:tools\/mobile\/verify-app-identity\.mjs/);
  assert.deepEqual(readdirSync(join(root, "coverage")), ["lcov.info"]);
}));

test("a redirected coverage directory is rejected without altering its destination", (t) => coverageFixture(({ root, report, run }) => {
  const outside = mkdtempSync(join(tmpdir(), "bthwani-coverage-outside-"));
  try {
    const sentinel = join(outside, "lcov.info");
    writeFileSync(sentinel, "PROTECTED_EXTERNAL_REPORT");
    rmSync(join(root, "coverage"), { recursive: true });
    try {
      symlinkSync(outside, join(root, "coverage"), "junction");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) return t.skip("source links unavailable");
      throw error;
    }
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /COVERAGE_DIRECTORY_UNSAFE/);
    assert.equal(readFileSync(sentinel, "utf8"), "PROTECTED_EXTERNAL_REPORT");
    assert.equal(readFileSync(report, "utf8"), "PROTECTED_EXTERNAL_REPORT");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
}));


test("source changed by a passing native test invalidates LCOV before publication", () => coverageFixture(({add,report,run})=>{
  add("tools/dev/change.test.mjs",[
    'import test from "node:test";',
    'import {writeFileSync} from "node:fs";',
    'test("change authored file",()=>writeFileSync("tools/mobile/verify-app-identity.mjs","export const measured = 2;\\n"));',
  ].join("\n"));
  const result=run();
  assert.equal(result.status,1,result.stdout+result.stderr);
  assert.match(result.stderr,/TEST_SOURCE_CHANGED_DURING_EXECUTION/);
  assert.equal(existsSync(report),false);
}));
test("ignored tests cannot be executed or silently admitted as candidate evidence", () => coverageFixture(({add,report,run})=>{
  add("tools/dev/ignored.test.mjs",'throw new Error("IGNORED_EXECUTED");');
  const result=run();
  assert.equal(result.status,1,result.stdout+result.stderr);
  assert.match(result.stderr,/TEST_SOURCE_NOT_ADMITTED tools\/dev\/ignored.test.mjs/);
  assert.doesNotMatch(result.stdout+result.stderr,/IGNORED_EXECUTED/);
  assert.equal(existsSync(report),false);
}));
