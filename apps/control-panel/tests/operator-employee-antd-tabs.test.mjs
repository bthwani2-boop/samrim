import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const operatorPath = new URL("../app/(workspace)/access/operators/[operatorPhone]/page.tsx", import.meta.url);
const employeePath = new URL("../src/features/hr/employee-profile-workspace.tsx", import.meta.url);

test("operator and employee profiles own their panel content in Ant Design Tabs items", async () => {
  const [operator, employee] = await Promise.all([
    readFile(operatorPath, "utf8"),
    readFile(employeePath, "utf8"),
  ]);

  for (const [source, keys] of [
    [operator, ["overview", "performance", "permissions", "employment"]],
    [employee, ["overview", "employment", "attendance", "access", "history"]],
  ]) {
    assert.match(source, /import \{ Tabs \} from "antd"/);
    assert.doesNotMatch(source, /RecordTabs|RecordTabPanel/);
    assert.match(source, /<Tabs aria-label=/);
    assert.match(source, /activeKey=\{tab\} onChange=\{selectTab\} destroyOnHidden=\{false\} items=\{/);
    for (const key of keys) {
      assert.ok(source.includes(`key: "${key}", label: tabs[`), `${key} remains an Ant Design item`);
    }
    assert.equal((source.match(/children: \(<>/g) ?? []).length, keys.length);
  }

  assert.match(operator, /if \(state\.kind !== "authenticated"\) return null;/);
  assert.match(operator, /if \(!canManage\) return/);
  assert.match(operator, /if \(next === "performance"\) setPerformanceOpened\(true\);/);
  assert.match(operator, /canReadHR && employee && performanceOpened/);
  assert.match(operator, /key: "permissions", label: tabs\[2\]!\.label, forceRender: true/);
  assert.match(operator, /<AccountAccessPanel key=\{phone\} embedded selectedPhone=\{phone\} onActorResolved=\{resolveActor\} onStatusResolved=\{resolveStatus\}/);
  assert.match(employee, /if \(state\.kind !== "authenticated"\) return null;/);
  for (const key of ["employment", "attendance", "access", "history"]) {
    assert.ok(employee.includes(`visited.has("${key}")`), `employee ${key} panel remains visit-gated`);
  }
});
