import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = readFileSync(new URL('../src/shell/adaptive-record-workspace.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('adaptive record workspace delegates desktop resizing to Ant Design Splitter', () => {
  assert.match(source, /<Splitter className="adaptive-record-splitter" orientation="horizontal" onResize=\{resize\} onResizeEnd=/);
  assert.match(source, /<Splitter\.Panel min=\{minimumListWidth\}/);
  assert.match(source, /<Splitter\.Panel min=\{minimumDetailWidth\} max=\{preferredMaximumPanelWidth\} size=\{panelWidth\}/);
  assert.match(source, /setPanelRatio\(detailSize \/ available \* 100\)/);
  assert.match(source, /setRatio\(detailSize \/ available \* 100\)/);
  assert.doesNotMatch(source, /setPointerCapture|onPointerMove/);
  assert.match(source, /handle\.tabIndex = 0/);
  assert.match(source, /event\.key === "ArrowLeft"/);
});

test('adaptive record workspace retains narrow screen overlay and RTL Splitter layout', () => {
  assert.match(styles, /\.adaptive-record-splitter[\s\S]{0,140}direction: rtl/);
  assert.match(styles, /\.adaptive-record-workspace\[data-open="true"\]\[data-split="false"\] \.adaptive-record-detail \{[\s\S]{0,180}position: fixed/);
  assert.match(source, /bthwani-record-view:\$\{preferenceKey\}/);
  assert.match(source, /toggleExpanded/);
  assert.match(source, /triggerRef\.current/);
});
