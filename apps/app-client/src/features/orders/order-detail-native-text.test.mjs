import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("order details do not render horizontal whitespace as native View text", () => {
  const source = readFileSync(new URL("./order-detail.tsx", import.meta.url), "utf8");
  const invalid = [...source.matchAll(/(?:\/>|<\/(?:View|BthwaniSurface|Text)>)[ \t]+(?:<|\{)/gu)]
    .map((match) => ({ line: source.slice(0, match.index).split("\n").length, text: match[0] }));
  assert.deepEqual(invalid, [], "Inline spacing between JSX siblings creates raw text in React Native; use a line break");
});
