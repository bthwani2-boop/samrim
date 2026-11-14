import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { importSpecifiers, sourceBoundaryIssues, stage4WorkspaceIssues } from "./verify-application-boundaries.mjs";

const root = resolve("C:/safe/bthwani");
const customer = resolve(root, "apps/customer/app/index.tsx");

test("captures static, type-only, re-export, require and literal lazy imports", () => {
  const specs = importSpecifiers(
    "import type { X } from '../src/types'; export { Y } from '../../merchant/src/state'; " +
    "import 'react-native'; const x = require('../../../../packages/private'); " +
    "const y = import('../../captain/src/secret');"
  );
  assert.deepEqual(specs, [
    "../src/types", "../../merchant/src/state", "react-native",
    "../../../../packages/private", "../../captain/src/secret"
  ]);
});
test("same-app imports and public package contracts are allowed", () => {
  assert.deepEqual(sourceBoundaryIssues(customer,
    "import { X } from '../src/ui'; import { Y } from '@bthwani/design-system/theme';", root), []);
});
test("customer cannot import merchant or captain implementation", () => {
  const problems = sourceBoundaryIssues(customer,
    "import type { A } from '../../merchant/src/internal'; " +
    "export { B } from '../../captain/app/_layout';", root);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /Cross-owner source import/);
});
test("an app cannot import a private service client by relative path", () => {
  const problems = sourceBoundaryIssues(customer,
    "const api = require('../../../services/identity/clients/session');", root);
  assert.match(problems.join(" "), /Cross-owner source import/);
});
test("shared packages cannot import private app files", () => {
  const file = resolve(root, "packages/tamagui-config/src/index.ts");
  const problems = sourceBoundaryIssues(file,
    "import '../../../apps/customer/app/index';", root);
  assert.match(problems.join(" "), /Cross-owner source import/);
});
test("package aliases cannot bypass service client exports", () => {
  const problems = sourceBoundaryIssues(customer,
    "import { X } from '@bthwani/identity/clients/session';", root);
  assert.match(problems.join(" "), /Private workspace path/);
});
test("bare internal source aliases are rejected", () => {
  const problems = sourceBoundaryIssues(customer,
    "import { X } from 'apps/merchant/src/index';", root);
  assert.match(problems.join(" "), /private source path/);
});

test("another app's bare package name cannot bypass cross-app isolation", () => {
  const problems = sourceBoundaryIssues(customer,
    "import { MerchantState } from '@bthwani/merchant'; " +
    "const admin = require('@bthwani/control-panel/ui');", root);
  assert.equal(problems.length, 2);
  assert.match(problems.join(" "), /Cross-app package import/);
});

test("same app aliases and public service-client package exports remain allowed", () => {
  assert.deepEqual(sourceBoundaryIssues(customer,
    "import { Local } from '@bthwani/customer'; " +
    "import { Session } from '@bthwani/identity';", root), []);
});

test("non-app shared packages cannot depend on app package names", () => {
  const shared = resolve(root, "packages/design-system/src/index.ts");
  const problems = sourceBoundaryIssues(shared,
    "export { Router } from '@bthwani/customer';", root);
  assert.match(problems.join(" "), /Cross-app package import/);
});

test("parses literal template imports, require.resolve and import.meta.resolve", () => {
  const src = "const a = import(`../../merchant/src/private`);" +
    "const b = require.resolve('../../captain/src/secret');" +
    "const c = import.meta.resolve('../../control-panel/app/page');";
  assert.equal(sourceBoundaryIssues(customer, src, root).filter(x => /Cross-owner/.test(x)).length, 3);
});

test("rejects uncheckable computed module imports rather than silently allowing them", () => {
  const cases = [
    "const x = import('../' + other + '/src/private');",
    "const x = require(pathFromRuntime);",
    String.raw`const x = import(\`../../\${target}/src/secret\`);`,
  ];
  for (const src of cases) {
    assert.match(sourceBoundaryIssues(customer, src, root).join(" "), /Computed module specifier/, src);
  }
});

test("comments and string literals do not manufacture false import violations", () => {
  const src = "// import x from '../../merchant/private';\n" +
    "const help = \"require('../../../services/wlt/clients/secret')\";";
  assert.deepEqual(sourceBoundaryIssues(customer, src, root), []);
});

test("keeps Expo and Operator renderers separate", () => {
  const operator = resolve(root, "apps/control-panel/app/page.tsx");
  assert.match(sourceBoundaryIssues(operator, 'import { Button } from "tamagui";', root).join(" "), /Operator cannot import/);
  assert.match(sourceBoundaryIssues(operator, 'import { Text } from "react-native";', root).join(" "), /Operator cannot import/);
  assert.match(sourceBoundaryIssues(customer, 'import { Form } from "antd";', root).join(" "), /Expo renderer cannot import/);
  assert.match(sourceBoundaryIssues(customer, 'import Link from "next/link";', root).join(" "), /Expo renderer cannot import/);
  assert.deepEqual(sourceBoundaryIssues(operator, 'import { Button } from "antd";', root), []);
  assert.deepEqual(sourceBoundaryIssues(customer, 'import { Button } from "tamagui";', root), []);
});

test("semantic design source cannot depend on presentation or native renderers", () => {
  const design = resolve(root, "packages/design-system/src/semantics/themes.ts");
  for (const spec of ["@bthwani/tamagui-config", "expo-location", "next/navigation", "antd"]) {
    assert.match(sourceBoundaryIssues(design, 'import X from "' + spec + '";', root).join(" "), /Semantic design source/);
  }
  assert.deepEqual(sourceBoundaryIssues(design, 'import { brandRoots } from "../brand/colors";', root), []);
});

test("Stage 4 rejects unapproved owner directories and any duplicate src/app route tree", () => {
  const fixture = mkdtempSync(join(tmpdir(), "bthwani-boundary-"));
  try {
    for (const group of ["apps", "packages", "services"]) {
      mkdirSync(join(fixture, group), { recursive: true });
    }
    assert.deepEqual(stage4WorkspaceIssues(fixture), []);
    mkdirSync(join(fixture, "apps", "customer", "src", "app"), { recursive: true });
    mkdirSync(join(fixture, "apps", "storefront"), { recursive: true });
    mkdirSync(join(fixture, "packages", "new-theme-engine"), { recursive: true });
    mkdirSync(join(fixture, "services", "shadow-wallet"), { recursive: true });
    assert.equal(stage4WorkspaceIssues(fixture).length, 4);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("future admitted feature files remain private to their app without bypassing Stage 4", () => {
  const feature = resolve(root, "apps/customer/src/features/stores/StoreCard.tsx");
  assert.deepEqual(sourceBoundaryIssues(feature,
    'import { Button } from "tamagui"; import { X } from "../../ui/components";', root), []);
  assert.match(sourceBoundaryIssues(feature,
    'import { Secret } from "@bthwani/merchant/src/private";', root).join(" "),
    /Cross-app package import/);
  // The repository's Stage-4 foundation verifier separately rejects any
  // real src/features directory until a governed phase transition.
});
