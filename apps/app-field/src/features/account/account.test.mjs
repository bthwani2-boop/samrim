import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const accountSource = new URL("./account.tsx", import.meta.url);

test("app version copy uses a themed native button with a usable touch target", async () => {
  const source = await readFile(accountSource, "utf8");
  assert.match(source, /import \{ Button, Host \} from "@expo\/ui"/u);
  const action = source.match(/<Host colorScheme=\{themeName\} matchContents seedColor=\{theme\.brandAction\}>\s*<Button variant="text" style=\{\{ height: 48 \}\}[\s\S]*?testID="field-copy-app-version" \/>\s*<\/Host>/u);

  assert.ok(action, "the copy action should use the Expo UI button inside the selected appearance theme");
  assert.match(action[0], /label=\{[^\n]*\}/u);
  assert.match(action[0], /Clipboard\.setStringAsync/u);
  assert.doesNotMatch(action[0], /<Pressable/u);
});
