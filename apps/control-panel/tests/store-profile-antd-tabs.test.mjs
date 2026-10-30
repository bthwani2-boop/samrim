import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const paths = [
  new URL("../src/features/stores/store-profile-dashboard.tsx", import.meta.url),
  new URL("../src/features/stores/store-profile-tabs.tsx", import.meta.url),
  new URL("../src/features/stores/store-profile-detail-panels.tsx", import.meta.url),
];
const [dashboard, tabs, details] = await Promise.all(paths.map((path) => readFile(path, "utf8")));

test("store profile navigation and panels are owned by one direct Ant Design Tabs", () => {
  assert.match(dashboard, /import \{ Tabs \} from "antd"/);
  assert.doesNotMatch(dashboard + tabs + details, /RecordTabs|RecordTabPanel|role="tabpanel"|hidden=\{/);
  assert.match(dashboard, /<Tabs id="store-profile" aria-label=\{/);
  assert.match(dashboard, /className="store-profile-sections" activeKey=\{activeTab\} onChange=\{selectTab\} size="small" tabBarGutter=\{8\}/);
  assert.match(dashboard, /items=\{tabs\.map\(\(\[key, label\]\) => \(\{/);
  assert.match(dashboard, /forceRender: key === "overview"/);
  assert.match(dashboard, /children: key === "overview" \? <>\{overview\}/);
  for (const key of ["overview", "operations", "catalog", "identity", "quality", "documents"]) {
    assert.ok(dashboard.includes(`["${key}"`), `${key} remains in the primary tab model`);
  }
  assert.match(dashboard, /\.\.\.\(canViewFinance \? \[\["finance"/);
  assert.doesNotMatch(dashboard, /bt-record-tabs-tabs|styles=\{\{ root:/);
});

test("tab changes preserve profile routing, permissions, and readback behavior", () => {
  assert.match(dashboard, /const \[activeTab, setActiveTab\] = useState\("overview"\)/);
  assert.match(dashboard, /const openEditor = \(\) => \{ setActiveTab\("identity"\); openManagement\(\); \}/);
  assert.match(dashboard, /setActiveTab\(group\);\s*if \(group !== "overview"\) recordView\?\.expandForEditing\(\)/);
  assert.match(dashboard, /scrollTo\(\{ top: 0, behavior: "smooth" \}\)/);
  assert.match(dashboard, /if \(!canViewOperations\) return;/);
  assert.match(dashboard, /value\.availability\?\.storeId !== store\.id \|\| !Array\.isArray\(value\.orderabilityByMode\)/);
  assert.match(dashboard, /window\.setInterval\(check, 15000\)/);
  assert.match(tabs, /canViewOperations \? <div className="store-profile-tab-grid/);
  assert.match(details, /\{canViewFinance \? <Panel id="finance"/);
});

test("all existing store profile panel content stays under its matching tab item", () => {
  assert.match(dashboard, /const overview = \([\s\S]*store-profile-alert[\s\S]*store-onboarding-readiness[\s\S]*StoreOperationsPreview/);
  assert.match(tabs, /<Panel id="operations"[\s\S]*StoreAvailabilityControls[\s\S]*StoreModeControls[\s\S]*StoreOperationsPreview/);
  assert.match(tabs, /<Panel id="identity"[\s\S]*PartnerTeamWorkspace[\s\S]*StoreBranchesPreview[\s\S]*store-inline-management/);
  assert.match(details, /StoreProductsWorkspace[\s\S]*StoreOffersPreview[\s\S]*PartnerFinancialRegister/);
  assert.match(tabs, /<StoreProfileDetailPanels activeTab=\{group\}/);
});
