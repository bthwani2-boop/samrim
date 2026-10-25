import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const base = new URL("./", import.meta.url);
const sheet = readFileSync(new URL("./order-chat-sheet.tsx", base), "utf8");
const bubble = readFileSync(new URL("./order-chat-audio-bubble.tsx", base), "utf8");
const surfaces = [
  "../../../../apps/app-client/src/features/orders",
  "../../../../apps/app-partner/src/features/order-management",
  "../../../../apps/app-captain/src/features/captain-operations",
];

test("order chat keeps summary and order details in the same sheet", () => {
  assert.match(sheet, /details\?: ReadonlyArray<Detail>/);
  assert.match(sheet, /quickFacts\?: string/);
  assert.match(sheet, /numberOfLines=\{1\}>\{quickFacts\}<\/Text>/);
  assert.match(sheet, /onPress=\{\(\) => setExpanded\(value => !value\)\}/);
  assert.match(sheet, /<ScrollView nestedScrollEnabled/);
  assert.match(sheet, /accessibilityState=\{\{expanded\}\}/);
  assert.doesNotMatch(sheet, /onDetails/);
  for (const surface of surfaces) {
    const caller = surface.includes("app-client")
      ? new URL(surface + "/order-detail.tsx", base)
      : surface.includes("app-partner")
        ? new URL(surface + "/order-management.tsx", base)
        : new URL(surface + "/captain-deliveries.tsx", base);
    const text = readFileSync(caller, "utf8");
    assert.match(text, /details=\{/);
  }
});

test("voice notes use a compact waveform bubble with playback progress instead of a large play button", () => {
  assert.match(bubble, /BthwaniIcon name=\{playing \? "pause" : "play"\}/);
  assert.match(bubble, /onSeek\(Math\.max\(0, Math\.min\(1,/);
  assert.match(bubble, /formatDuration\(elapsed\)/);
  const media = readFileSync(new URL("./order-chat-private-media.tsx", base), "utf8");
  assert.match(media, /<BthwaniOrderChatAudioBubble/);
  assert.match(media, /playbackStatusUpdate/);
  assert.match(media, /audio\/3gpp/);
  assert.doesNotMatch(media, /label=\{mediaKind=== "audio"/);
  for (const surface of surfaces) {
    const chat = readFileSync(new URL(surface + "/order-conversation.tsx", base), "utf8");
    assert.match(chat, /message\.mediaKind==="audio" \? <OrderConversationMediaMessage/);
    assert.match(chat, /caption=\{message\.body\}/);
    assert.match(chat, /@bthwani\/design-system\/native\/order-chat-private-media/);
  }
});
