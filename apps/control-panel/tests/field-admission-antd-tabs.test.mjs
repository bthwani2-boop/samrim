import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/features/field/field-admission-panel.tsx", import.meta.url), "utf8");

test("field record tabs own each panel through controlled Ant Design items", () => {
  assert.match(source, /import \{ Tabs \} from "antd"/);
  assert.doesNotMatch(source, /<RecordTabs|import \{ RecordTabs \}|role="tabpanel"/);
  assert.match(source, /<Tabs id=\{`field-\$\{id\}`} aria-label="\\u0623\\u0642\\u0633\\u0627\\u0645/);
  assert.match(source, /activeKey=\{activeTab\} onChange=\{\(key\) => selectTab\(key as FieldRecordTab\)\}/);
  assert.match(source, /id=\{`field-\$\{id\}-panel`\} className="field-profile-tab-content"/);
  assert.match(source, /destroyOnHidden items=\{fieldRecordTabs\.map\(\(\{ id: key, label \}\) => \(\{ key, label, children: renderTabContent\(key\) \}\)\)\}/);
  for (const key of ["overview", "stores", "performance", "finance", "account", "history"]) {
    assert.ok(source.includes('{ id: "' + key + '"'), key + " remains in the field tab model");
    assert.ok(source.includes('tab === "' + key + '"'), key + " has content owned by its item");
  }
});

test("field panel keeps record identity, authorized actions, and lazy acquisition readback", () => {
  assert.match(source, /useEffect\(\(\) => \{ setActiveTab\("overview"\); \}, \[id\]\)/);
  assert.match(source, /if \(!field \|\| !\["stores", "performance"\]\.includes\(activeTab\)/);
  assert.match(source, /data\.onLoadAcquisitionCases\(id\)/);
  assert.match(source, /FieldAccountMutationActions[\s\S]*onMutate=\{data\.onAccountMutate\}/);
  assert.match(source, /data\.onCandidateMutate\(admission, "approve"\)/);
  assert.match(source, /ActorWalletStatement actorType="field" actorId=\{field\.actorId\}/);
  assert.match(source, /FieldFinancialRecord key=\{id\} actorId=\{id\}/);
});
