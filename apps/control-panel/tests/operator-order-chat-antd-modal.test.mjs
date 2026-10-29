import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const componentPath = new URL("../src/features/operations/operator-order-chat-dialog.tsx", import.meta.url);
const callerPath = new URL("../src/features/operations/order-operation-detail.tsx", import.meta.url);

test("order conversation uses Ant Design modal controls and preserves its order context", async () => {
  const [component, caller] = await Promise.all([
    readFile(componentPath, "utf8"),
    readFile(callerPath, "utf8"),
  ]);

  assert.match(component, /import \{ Button, Modal \} from "antd"/);
  assert.match(component, /<Modal[\s\S]*?open=\{open\}/);
  assert.match(component, /destroyOnHidden/);
  assert.match(component, /keyboard/);
  assert.match(component, /maskClosable=\{false\}/);
  assert.match(component, /<OperatorOrderConversation orderId=\{orderId\} \/>/);
  assert.match(component, /operator-order-chat-unread-badge/);
  assert.match(component, /عرض تفاصيل الطلب/);
  assert.match(caller, /<OperatorOrderChatDialog orderId=\{order\.id\}/);

  assert.doesNotMatch(component, /<dialog|showModal|HTMLDialogElement|style=\{/);
});

test("unread badge still comes from the authenticated order conversation query", async () => {
  const component = await readFile(componentPath, "utf8");

  assert.match(component, /identityFetch\("\/api\/operations\/" \+ encodeURIComponent\(orderId\) \+ "\/conversation"/);
  assert.match(component, /setInterval\(\(\) => void read\(\), 20000\)/);
  assert.doesNotMatch(component, /method:\s*["']POST["']/);
});
