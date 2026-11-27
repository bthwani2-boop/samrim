import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

const preload = new URL("./ts-resolver.mjs", import.meta.url).href;
function fixture(callback) {
  const root = mkdtempSync(join(tmpdir(), "bthwani-resolver-"));
  const write = (name, text) => {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  };
  const run = source => {
    write("probe.mjs", source);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_V8_COVERAGE;
    const result = spawnSync(process.execPath, ["--import", preload, join(root, "probe.mjs")], {
      cwd: root, env, encoding: "utf8", timeout: 20000,
    });
    if (result.error) throw result.error;
    return result;
  };
  try {
    write("package.json", '{"type":"module"}');
    return callback({ write, run });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("native import resolution admits local TypeScript and index fallback with original explicit-file precedence", () => fixture(({ write, run }) => {
  write("model.ts", 'export const name: string = "typed";');
  write("nested/index.ts", 'export const name: string = "index";');
  write("ordinary.js", 'export const name = "js";');
  write("exact.mjs", 'export const name = "exact";');
  write("exact.mjs.ts", 'export const name = "wrong";');
  const result = run([
    'import { name as a } from "./model";',
    'import { name as b } from "./nested";',
    'import { name as c } from "./ordinary";',
    'import { name as d } from "./exact.mjs";',
    'console.log([a,b,c,d].join(","));',
  ].join("\n"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "typed,index,js,exact");
  assert.doesNotMatch(result.stderr, /experimental-loader/);
}));

test("missing bare packages cannot resolve a different package with a TypeScript suffix", () => fixture(({ write, run }) => {
  write("node_modules/fixture-missing.ts/package.json", '{"type":"module","exports":"./index.js"}');
  write("node_modules/fixture-missing.ts/index.js", 'export default "WRONG_PACKAGE";');
  const result = run('import value from "fixture-missing"; console.log(value);');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /ERR_MODULE_NOT_FOUND/);
  assert.doesNotMatch(result.stdout, /WRONG_PACKAGE/);
}));

test("explicit missing extensions and package export restrictions remain native failures", () => fixture(({ write, run }) => {
  write("missing.js.ts", 'export default "WRONG_EXTENSION";');
  write("node_modules/fixture-package/package.json", '{"type":"module","exports":{".":"./index.js"}}');
  write("node_modules/fixture-package/index.js", 'export default "ok";');
  write("node_modules/fixture-package/private.ts", 'export default "PRIVATE";');
  const missing = run('import value from "./missing.js"; console.log(value);');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ERR_MODULE_NOT_FOUND/);
  const blocked = run('import value from "fixture-package/private"; console.log(value);');
  assert.equal(blocked.status, 1);
  assert.match(blocked.stderr, /ERR_PACKAGE_PATH_NOT_EXPORTED/);
  const allowed = run('import value from "fixture-package"; console.log(value);');
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(allowed.stdout.trim(), "ok");
}));
