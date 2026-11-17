import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { importSpecifiers, scanPresentationBoundaries, sourceBoundaryIssues, stage4WorkspaceIssues } from "./verify-application-boundaries.mjs";

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
    const leftBehind = join(fixture, "packages", "retired-package");
    mkdirSync(join(leftBehind, "node_modules"), { recursive: true });
    assert.deepEqual(stage4WorkspaceIssues(fixture), [], "generated-only package directory is not source");
    mkdirSync(join(leftBehind, "src"), { recursive: true });
    assert.match(stage4WorkspaceIssues(fixture).join(" "), /retired-package: unapproved/);
    rmSync(join(leftBehind, "src"), { recursive: true });
    mkdirSync(join(fixture, "apps", "customer", "src", "app"), { recursive: true });
    mkdirSync(join(fixture, "apps", "storefront"), { recursive: true });
    mkdirSync(join(fixture, "packages", "new-theme-engine"), { recursive: true });
    mkdirSync(join(fixture, "services", "shadow-wallet"), { recursive: true });
    assert.equal(stage4WorkspaceIssues(fixture).length, 4);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("deep feature placement is checked on disk, including untracked directories", () => {
  const fixture = mkdtempSync(join(tmpdir(), "bthwani-path-placement-"));
  try {
    for (const group of ["apps", "packages", "services"]) mkdirSync(join(fixture, group), { recursive: true });
    const rootFeature = join(fixture, "apps", "customer", "src", "features", "orders");
    const screen = join(rootFeature, "screens", "order-details", "order-details-screen.tsx");
    mkdirSync(dirname(screen), { recursive: true });
    writeFileSync(screen, "export const Screen = 1;\n");
    assert.deepEqual(scanPresentationBoundaries(fixture).issues, []);

    const orphan = join(fixture, "apps", "customer", "src", "features", "orphan.ts");
    writeFileSync(orphan, "export const Orphan = 1;\n");
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /presentation source must belong/);
    rmSync(orphan);

    const unowned = join(fixture, "apps", "customer", "src", "orphan.ts");
    writeFileSync(unowned, "export const Orphan = 1;\n");
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /presentation source must belong/);
    rmSync(unowned);

    const nestedDuplicate = join(rootFeature, "features", "wallet");
    mkdirSync(nestedDuplicate, { recursive: true });
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /unapproved feature layer|duplicate features/);
    rmSync(join(rootFeature, "features"), { recursive: true });

    const generic = join(rootFeature, "misc", "helpers");
    mkdirSync(generic, { recursive: true });
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /unapproved feature layer/);
    rmSync(join(rootFeature, "misc"), { recursive: true });

    const incorrectRoot = join(fixture, "apps", "merchant", "src", "feature", "orders");
    mkdirSync(incorrectRoot, { recursive: true });
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /src\\feature|src\/feature|unapproved presentation root/);
    rmSync(join(fixture, "apps", "merchant", "src", "feature"), { recursive: true });

    const partnerRoute = join(fixture, "apps", "control-panel", "app", "(workspace)", "partners");
    mkdirSync(partnerRoute, { recursive: true });
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /Use Merchant|merchants/);
    rmSync(partnerRoute, { recursive: true });
    const mixedCaseRoute = join(fixture, "apps", "merchant", "app", "Partner-Onboarding");
    mkdirSync(mixedCaseRoute, { recursive: true });
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /Use Merchant/);
    rmSync(mixedCaseRoute, { recursive: true });

    const wrongCase = join(fixture, "apps", "captain", "src", "features", "OrderManagement");
    mkdirSync(wrongCase, { recursive: true });
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /feature name must be lowercase-kebab-case/);
    rmSync(wrongCase, { recursive: true });

    const badFile = join(rootFeature, "screens", "order-details", "OrderDetails.tsx");
    writeFileSync(badFile, "export const OrderDetails = 1;\n");
    assert.match(scanPresentationBoundaries(fixture).issues.join(" "), /feature source filename must be lowercase-kebab-case/);
    rmSync(badFile);

    const shared = join(fixture, "apps", "merchant", "src", "components", "merchant-badge.tsx");
    mkdirSync(dirname(shared), { recursive: true });
    writeFileSync(shared, "export const MerchantBadge = 1;\n");
    assert.deepEqual(scanPresentationBoundaries(fixture).issues, []);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("progressively admitted feature files remain private to their app", () => {
  const feature = resolve(root, "apps/customer/src/features/stores/StoreCard.tsx");
  assert.deepEqual(sourceBoundaryIssues(feature,
    'import { Button } from "tamagui"; import { X } from "../../ui/components";', root), []);
  assert.match(sourceBoundaryIssues(feature,
    'import { Secret } from "@bthwani/merchant/src/private";', root).join(" "),
    /Cross-app package import/);
});

test("actual new feature folders pass owner boundaries and cross-owner imports fail", () => {
  const fixture = mkdtempSync(join(tmpdir(), "bthwani-feature-boundary-"));
  try {
    for (const group of ["apps", "packages", "services"]) {
      mkdirSync(join(fixture, group), { recursive: true });
    }
    const feature = join(fixture, "apps", "customer", "src", "features", "stores", "store-card.tsx");
    mkdirSync(dirname(feature), { recursive: true });
    writeFileSync(feature, 'import { View } from "tamagui"; export const StoreCard = View;\n');
    const allowed = scanPresentationBoundaries(fixture);
    assert.equal(allowed.scanned, 1, "new feature must be scanned, not merely permitted");
    assert.deepEqual(allowed.issues, []);
    writeFileSync(feature, 'import { Secret } from "@bthwani/merchant/src/private";\n');
    const forbidden = scanPresentationBoundaries(fixture);
    assert.equal(forbidden.scanned, 1);
    assert.match(forbidden.issues.join(" "), /Cross-app package import/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("retained Merchant placeholder exemptions are explicit and cannot hide implemented features", () => {
  const repo = fileURLToPath(new URL("../..", import.meta.url));
  const config = readFileSync(join(repo, "knip.jsonc"), "utf8");
  const start = config.indexOf("// BEGIN RETAINED MERCHANT PRESENTATION PLACEHOLDERS");
  const end = config.indexOf("// END RETAINED MERCHANT PRESENTATION PLACEHOLDERS");
  assert.ok(start >= 0 && end > start, "missing explicit preserved-placeholder Knip boundary");
  const block = config.slice(start, end);
  const retained = [...block.matchAll(/"([^"]+\.tsx)"/g)].map((match) => match[1]);
  assert.equal(retained.length, 18, "the user explicitly preserves all 18 known Merchant placeholders");
  assert.equal(new Set(retained).size, 18, "duplicate Knip exclusion");
  for (const path of retained) {
    assert.match(path, /^apps\/merchant\/src\/features\/[a-z-]+\/[a-z-]+\.tsx$/, "no broad directory wildcard exclusion");
    const full = join(repo, ...path.split("/"));
    assert.ok(existsSync(full), "retained placeholder must still exist: " + path);
    const source = readFileSync(full, "utf8");
    assert.match(source, /MerchantCapabilityScreen/, "only explicit presentation-only placeholder may be excluded: " + path);
    assert.match(source, /Presentation only|Protected workspace presentation/, "remove exemption when a real feature is implemented: " + path);
    assert.doesNotMatch(source, /\bfetch\s*\(|\buseMutation\s*\(|\bcreateOrder\s*\(|\bdeleteStore\s*\(/, "no owner mutation in an exempt file: " + path);
  }
});
