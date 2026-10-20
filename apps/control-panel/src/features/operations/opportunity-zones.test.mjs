import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./opportunity-zones.tsx", import.meta.url), "utf8");

test("operator map rejects dated opportunity samples before drawing", () => {
  assert.match(source, /isFreshOpportunitySample\(body\.measuredAt\)/);
  assert.match(source, /setValue\(\(previous\) => previous && !isFreshOpportunitySample\(previous\.measuredAt\) \? null : previous\)/);
});

test("background refresh failure removes circles rather than showing stale data", () => {
  const handler = source.match(/\} catch \(cause\) \{([\s\S]*?)\} finally \{/);
  assert.ok(handler);
  assert.match(handler[1], /setValue\(null\)/);
  assert.doesNotMatch(handler[1], /if\s*\(!quiet\)/);
});

test("returning to operations tab refreshes the sample", () => {
  assert.match(source, /addEventListener\("visibilitychange", refreshOnReturn\)/);
  assert.match(source, /removeEventListener\("visibilitychange", refreshOnReturn\)/);
});


test("missing Google Maps API after SDK load must display a failure instead of loading forever", () => {
  const onLoad = source.match(/const onLoad = \(\) => \{([\s\S]*?)\};/);
  assert.ok(onLoad);
  assert.match(onLoad[1], /if \(window\.google\?\.maps\)/);
  assert.match(onLoad[1], /setMapError\(true\)/);
});

test("an SDK load timeout must display an error instead of a perpetual spinner", () => {
  assert.match(source, /setTimeout\(\(\) => setMapError\(true\), 15_000\)/);
  assert.match(source, /clearTimeout\(timeout\)/);
});

test("a late response from an older refresh cannot replace a newer map sample", () => {
  assert.match(source, /const latestRequest = useRef\(0\)/);
  assert.match(source, /const request = \+\+latestRequest\.current/);
  assert.match(source, /if \(request !== latestRequest\.current\) return;/);
  assert.match(source, /if \(request === latestRequest\.current\) setLoading\(false\)/);
});
