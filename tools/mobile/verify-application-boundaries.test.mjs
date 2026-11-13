import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { importSpecifiers, sourceBoundaryIssues } from "./verify-application-boundaries.mjs";

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
