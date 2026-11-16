import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { discoverNodeSourceTests } from "./source-test-discovery.mjs";

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
