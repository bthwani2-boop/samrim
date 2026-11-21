import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../..");
const files = ["fulfillment-choice", "payment-selection", "recipient-form"];
const temp = mkdtempSync(path.join(tmpdir(), "bthwani-customer-checkout-display-"));

let compiled = new Map();
try {
  const args = [
    path.join(root, "node_modules/typescript/bin/tsc"),
    ...files.map(file => path.join(directory, [file, ".tsx"].join(""))),
    "--ignoreConfig", "--noResolve", "--noCheck",
    "--target", "es2022", "--module", "commonjs", "--jsx", "react-jsx",
    "--rootDir", directory, "--outDir", temp,
  ];
  const result = spawnSync(process.execPath, args, {
    cwd: root, encoding: "utf8", windowsHide: true, timeout: 20_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  compiled = new Map(files.map(file => [file,
    readFileSync(path.join(temp, [file, ".js"].join("")), "utf8")]));
} finally {
  rmSync(temp, { recursive: true, force: true });
}

function component(file) {
  const module = { exports: {} };
  const jsx = (type, props) => ({ type, props: props ?? {} });
  const mocks = {
    "@bthwani/tamagui-config/appearance": {
      useMobileAppearance: () => ({ theme: { colorSecondary: "#ddeeff" } }),
    },
    "react-native": { Text: "Text" },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "Fragment" },
  };
  new Function("require", "module", "exports", compiled.get(file))(name => {
    assert.ok(Object.hasOwn(mocks, name), ["Unapproved dependency: ", name].join(""));
    return mocks[name];
  }, module, module.exports);
  return module.exports.default;
}

for (const file of files) {
  test([file, "shows bounded read-only information in the current theme"].join(" "), () => {
    const render = component(file);
    assert.equal(render({}), null, "absent owner values must not appear");
    assert.equal(render({ label: "" }), null, "empty values must not appear");
    const view = render({ label: "لم يعتمد DSH هذا الحقل بعد" });
    assert.equal(view.type, "Text");
    assert.equal(view.props.children, "لم يعتمد DSH هذا الحقل بعد");
    assert.equal(view.props.style.color, "#ddeeff",
      "checkout information must remain legible in dark mode");
    assert.equal(view.props.style.lineHeight, 24);
    assert.equal(view.props.onPress, undefined, "status is not an actionable permission");
  });
}
