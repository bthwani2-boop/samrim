import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildPublicContactActions } from "../src/features/store-discovery/store-public-contact-actions.ts";

const source = readFileSync(new URL("../src/features/store-discovery/store-public-contact.tsx", import.meta.url), "utf8");

test("published public Contact channels keep correctly scoped tel, email and WhatsApp links", () => {
  const actions = buildPublicContactActions({
    phoneE164: "+967777123456",
    email: "support@example.com",
    whatsappEnabled: true,
    whatsappPhoneE164: "+967777123456",
  });
  assert.deepEqual(actions.map((action) => action.href), [
    "tel:+967777123456",
    "mailto:support%40example.com",
    "https://wa.me/967777123456",
  ]);
});

test("invalid public Contact telephone, email headers and WhatsApp must not become actionable links", () => {
  const actions = buildPublicContactActions({
    phoneE164: "javascript:alert(1)",
    email: "support@example.com\r\nBcc:intruder@example.com",
    whatsappEnabled: true,
    whatsappPhoneE164: "tel:12345678",
  });
  assert.deepEqual(actions, []);
});

test("failed public Contact read offers an explicit retry without using another Store's contact", () => {
  assert.match(source, /readStorePublicContact\(storeID\)/u);
  assert.match(source, /result\.contact\.storeId === storeID/u);
  assert.match(source, /scopeKey/u);
  assert.match(source, /تعذر قراءة وسائل التواصل/u);
  assert.match(source, /إعادة قراءة وسائل التواصل/u);
  assert.match(source, /onPress=\{\(\) => setRetry/u);
});

test("external-link failure is visible without showing a previous Store's error", () => {
  assert.match(source, /Linking\.openURL\(action\.href\)\.catch/u);
  assert.match(source, /activeScope\.current === scopeKey/u);
  assert.match(source, /تعذر فتح وسيلة التواصل/u);
  assert.match(source, /accessibilityRole="alert"/u);
});
