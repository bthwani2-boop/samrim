import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript-ast";

const file = new URL("../src/features/partner-onboarding/joining-case-correction.tsx", import.meta.url);
const source = readFileSync(file, "utf8");
const ast = ts.createSourceFile(String(file), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ["parseClock", "workingHoursIssue"];
const declarations = ast.statements
  .filter((item) => ts.isFunctionDeclaration(item) && names.includes(item.name?.text))
  .map((item) => item.getText(ast));
assert.equal(declarations.length, names.length);
const compiled = ts.transpileModule(declarations.join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const workingHoursIssue = vm.runInNewContext(compiled + "\nworkingHoursIssue", {
  toAsciiDigits: (value) => value,
  WEEK_MINUTES: 7 * 24 * 60,
});

test("an empty weekly schedule is optional for a joining-case correction", () => {
  assert.equal(workingHoursIssue([]), "");
  assert.match(source, /const hoursError = workingHoursIssue\(nextWorkingHours\.intervals\)/);
});
test("valid working hours still pass and invalid or overlapping intervals are rejected", () => {
  assert.equal(workingHoursIssue([{ dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", closesNextDay: false }]), "");
  assert.notEqual(workingHoursIssue([{ dayOfWeek: 1, opensAt: "25:00", closesAt: "17:00", closesNextDay: false }]), "");
  assert.notEqual(workingHoursIssue([{ dayOfWeek: 1, opensAt: "09:00", closesAt: "08:00", closesNextDay: false }]), "");
  assert.notEqual(workingHoursIssue([
    { dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", closesNextDay: false },
    { dayOfWeek: 1, opensAt: "16:00", closesAt: "19:00", closesNextDay: false },
  ]), "");
  assert.notEqual(workingHoursIssue(Array.from({ length: 29 }, () => ({
    dayOfWeek: 1, opensAt: "09:00", closesAt: "17:00", closesNextDay: false,
  }))), "");
});
