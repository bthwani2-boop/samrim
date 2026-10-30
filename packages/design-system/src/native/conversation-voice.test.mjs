import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const composer = readFileSync(new URL("./conversation-composer.tsx", import.meta.url), "utf8");
const voice = readFileSync(new URL("./conversation-voice-recorder.tsx", import.meta.url), "utf8");
const surfaces = [
  "../../../../apps/app-client/src/features/orders",
  "../../../../apps/app-partner/src/features/order-management",
  "../../../../apps/app-captain/src/features/captain-operations",
];

test("voice recording stays inline instead of opening the legacy form", () => {
  assert.match(composer, /audioControls\?<View style=\{styles\.composer\}>\{audioControls\}/);
  assert.match(composer, /name="mic"/);
  assert.match(composer, /attachmentsOpen&&recipients\.length>1/);
  assert.match(composer, /attachmentsOpen&&recipientOpen/);
  for (const surface of surfaces) {
    assert.equal(existsSync(new URL(surface + "/order-conversation-audio-controls.tsx", import.meta.url)), false, "obsolete app recorder must be removed");
    const chat = readFileSync(new URL(surface + "/order-conversation.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(voice, /TextInput|transcript|نص التسجيل الصوتي|إرسال التسجيل مع نصه/);
    assert.match(voice, /useEffect\(\(\) => \{/);
    assert.match(voice, /recorder\.record\(\)/);
    assert.match(voice, /onRecorded\(savedUri\.current,/);
    assert.match(voice, /accessibilityLabel="إلغاء التسجيل"/);
    assert.match(voice, /accessibilityLabel=\{phase === "failed"/);
    assert.match(chat, /kind==="audio"\?"رسالة صوتية"/);
    assert.doesNotMatch(chat, /AUDIO_TRANSCRIPT_REQUIRED/);
    assert.match(chat, /import\("@bthwani\/design-system\/native\/conversation-voice-recorder"\)/);
    assert.match(chat, /onVoice=\{\(\)=>setShowAudioControls\(true\)\}/);
    assert.match(chat, /onClose=\{\(\)=>setShowAudioControls\(false\)\}/);
  }
});

test("shared composer contains no Order business contract and all apps use its generic name", () => {
  assert.match(composer, /export function BthwaniConversationComposer/);
  assert.doesNotMatch(composer, /BthwaniOrderChatComposer|DSH|orderId|orderReference/);
  for (const surface of surfaces) {
    const chat = readFileSync(new URL(surface + "/order-conversation.tsx", import.meta.url), "utf8");
    assert.match(chat, /<BthwaniConversationComposer/);
  }
});
