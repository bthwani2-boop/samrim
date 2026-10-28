import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/features/partner-onboarding/partners-workbench.tsx", import.meta.url), "utf8");

 test("partner workbench uses controlled Ant Design tabs with route-backed selection", () => {
  assert.match(source, /import \{ Input, Select, Tabs \} from "antd"/);
  assert.doesNotMatch(source, /RecordTabs|RecordTabPanel/);
  assert.match(source, /<Tabs id="partners-workspace" activeKey=\{activeTab\}/);
  assert.match(source, /renderTabBar=\{\(props, DefaultTabBar\) => <DefaultTabBar \{\.\.\.\{ \.\.\.props, "aria-label":/);
  assert.match(source, /onChange=\{\(key\) => \{ if \(key === "directory" \|\| key === "joining" \|\| key === "access"\) selectTab\(key\); \}\}/);
  assert.match(source, /classNames=\{\{ header: "partner-unified-section-tabs" \}\}/);
  assert.match(source, /items=\{workspaceTabs\.map\(\(tab\) => \(\{ key: tab\.key, label: tab\.label, children: activeTab === tab\.key \? registryPanel : null \}\)\)\}/);
  assert.match(source, /const selectTab = \(nextTab: WorkspaceTab\) => navigate\(nextTab, defaultKindByTab\[nextTab\], "", "", "newest", appliedSearch\)/);
});

test("the registry content and actions are rendered through the active item's children", () => {
  const tabs = source.indexOf("<Tabs id=\"partners-workspace\"");
  const content = source.indexOf("const registryPanel = <section className=\"partner-unified-tab-panel\">");
  assert.ok(content >= 0 && content < tabs);
  assert.match(source.slice(content, tabs), /partner-unified-toolbar[\s\S]*partner-unified-table[\s\S]*partner-unified-cards[\s\S]*CursorPagination/);
  assert.match(source.slice(tabs), /items=\{workspaceTabs\.map[\s\S]*children: activeTab === tab\.key \? registryPanel : null/);
  assert.doesNotMatch(source.slice(tabs), /<section id="partners-workspace-panel" role="tabpanel"/);
  assert.match(source, /const load = useCallback\(async \(\) =>/);
  assert.match(source, /useEffect\(\(\) => \{\s*if \(page\.ready && revision >= 0\) void load\(\)/);
});

test("URL filters, private phone search and record details remain on their current owners", () => {
  assert.match(source, /if \(nextTab !== "directory"\) url\.set\("tab", nextTab\)/);
  assert.match(source, /if \(nextStatus\) url\.set\("status", nextStatus\)/);
  assert.match(source, /if \(nextCity\) url\.set\("serviceCityId", nextCity\)/);
  assert.match(source, /if \(nextQuery && !isPhone\(nextQuery\)\) url\.set\("q", nextQuery\)/);
  assert.match(source, /setPrivateSearch\(nextQuery\)/);
  assert.match(source, /StoreInspector key=\{openStore\} storeId=\{openStore\}/);
  assert.match(source, /JoiningCaseDetail key=\{openCase\}/);
  assert.match(source, /PartnerDetailWorkspace key=\{actor\.actorId\}/);
  assert.match(source, /async function approve\(grant: StoreAccessGrant\)/);
});
