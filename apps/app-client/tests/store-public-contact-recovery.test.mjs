import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildPublicContactActions } from "../src/features/store-discovery/store-public-contact-actions.ts";
import { storeReadFailureKind } from "../src/features/store-discovery/store-read-state.ts";

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

test("public email links reject ambiguous routing and control characters", () => {
  for (const email of ["a@@example.com", "a@domain", "a@.com", "a@example.", "a@example.com?bcc=other", "a@example.com#other", "a@example.com/other", "a@example.com\ncc:other"]) {
    const links = buildPublicContactActions({ email });
    assert.equal(links.filter((link) => link.href.startsWith("mailto:")).length, 0, email);
  }
  assert.equal(buildPublicContactActions({ email: "تواصل@مثال.اليمن" }).length, 1);
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

test("a withdrawn or denied public Store contact fails closed instead of offering endless retry", () => {
  for (const status of [401, 403, 404, 410]) {
    assert.equal(storeReadFailureKind({ status }), "unavailable");
  }
  assert.equal(storeReadFailureKind({ status: 503 }), "error");
  assert.match(source, /storeReadFailureKind\(cause\) === "unavailable" \? "unavailable" : "error"/u);
  assert.match(source, /current\.kind === "unavailable"/u);
});
