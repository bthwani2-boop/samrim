import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

test("Field joining case actions sit inside the native bottom safe area", () => {
  const source = readFileSync(new URL("./field-new-case.tsx", import.meta.url), "utf8");
  assert.match(source, /import \{ SafeAreaView \} from "react-native-safe-area-context"/);
  const start = source.indexOf('<SafeAreaView edges={["bottom"]}');
  const end = source.indexOf("</SafeAreaView>", start);
  assert.ok(start > 0 && end > start, "the fixed action footer must respect Android system navigation");
  const footer = source.slice(start, end);
  assert.match(footer, /label="التالي"/, "step navigation remains inside the safe area");
  assert.match(footer, /onPress=\{\(\) => void createCase\(\)\}/, "draft save remains inside the safe area");
});
