import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const repository = resolve(import.meta.dirname, "../../../..");
const media = readFileSync(new URL("./order-chat-private-media.tsx", import.meta.url), "utf8");
const video = readFileSync(new URL("./order-chat-private-video.tsx", import.meta.url), "utf8");
const hosts = {
  "app-client": "orders",
  "app-partner": "order-management",
  "app-captain": "captain-operations",
};

test("media display accepts a private read callback and never builds public media URLs", () => {
  assert.match(media, /readPrivateMedia:\s*\(orderId:\s*string,\s*messageId:\s*string\)/);
  assert.equal((media.match(/await readPrivateMedia\(orderId, messageId\)/g) ?? []).length, 1);
  assert.equal((media.match(/await readCheckedMedia\(\)/g) ?? []).length, 2);
  assert.match(media, /result\.mediaKind !== mediaKind \|\| !result\.dataBase64/);
  assert.match(media, /local\.current\?\.delete\(\)/);
  assert.match(media, /audioSubscription\.current\?\.remove\(\)/);
  assert.match(media, /if \(!alive\.current\) return;/);
  assert.doesNotMatch(media, /EXPO_PUBLIC_|createDshMobileClient|getUsableIdentityAccessToken|fetch\(/);
  assert.match(video, /useVideoPlayer\(\{uri,useCaching:false\}\)/);
});

for (const [app, feature] of Object.entries(hosts)) {
  test(app + " reads private media only for the same authenticated actor and uses one UI owner", () => {
    const dir = resolve(repository, "apps", app, "src/features", feature);
    const chat = readFileSync(resolve(dir, "order-conversation.tsx"), "utf8");
    assert.equal(existsSync(resolve(dir, "order-conversation-media.tsx")), false);
    assert.equal(existsSync(resolve(dir, "order-conversation-private-video.tsx")), false);
    assert.match(chat, /from "@bthwani\/design-system\/native\/order-chat-private-media"/);
    assert.match(chat, /const actorID = conversationActorID\(\);/);
    assert.match(chat, /if \(!actorID\) throw new Error\("PRIVATE_MEDIA_SESSION_REQUIRED"\)/);
    assert.match(chat, /const token = await getUsableIdentityAccessToken\(\)/);
    assert.match(chat, /client\(\)\.readOrderConversationMedia\(token, orderID, messageID\)/);
    assert.equal((chat.match(/if \(!isCurrentActor\(actorID\)\) throw new Error\("PRIVATE_MEDIA_ACTOR_CHANGED"\)/g) ?? []).length, 2);
    assert.equal((chat.match(/<OrderConversationMediaMessage readPrivateMedia=\{readPrivateMedia\}/g) ?? []).length, 2);
    assert.match(chat, /loadedActorID === activeActorID/);
  });
}

test("negative fixture detects removing an actor guard", () => {
  const dir = resolve(repository, "apps/app-partner/src/features/order-management/order-conversation.tsx");
  const chat = readFileSync(dir, "utf8");
  const unsafe = chat.replace(
    'if (!isCurrentActor(actorID)) throw new Error("PRIVATE_MEDIA_ACTOR_CHANGED");',
    "/* broken actor switch guard */",
  );
  assert.notEqual(unsafe, chat);
  assert.equal((unsafe.match(/PRIVATE_MEDIA_ACTOR_CHANGED/g) ?? []).length, 1);
});
