import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "../..");
const route = readFileSync(path.join(root, "app/api/marketing/studio-layout/route.ts"), "utf8");
const editor = readFileSync(path.join(root, "src/features/studio/template-studio-workspace.tsx"), "utf8");
const publisher = readFileSync(path.join(root, "src/features/studio/published-layout-settings.tsx"), "utf8");
const clientHome = readFileSync(path.join(repo, "apps/app-client/src/features/store-discovery/store-discovery.tsx"), "utf8");
const goPublic = readFileSync(path.join(repo, "services/dsh/backend/internal/transport/http/marketing_studio_layout.go"), "utf8");
const goDB = readFileSync(path.join(repo, "services/dsh/backend/internal/storage/postgres/marketing_studio_layout.go"), "utf8");

test("operator layout mutations require identity marketing authorization and CSRF", () => {
  assert.match(route, /readStudioPublication\("studio-layout", request\)/);
  assert.match(route, /writeStudioPublication\("studio-layout", request\)/);
  assert.doesNotMatch(route, /readOperatorSession|readBoundedJson|verifySameOrigin/, "route must not clone publication authority");
  const owner = readFileSync(path.join(root, "src/server/studio-publication-route.ts"), "utf8");
  assert.match(owner, /readOperatorSession\(/);
  assert.match(owner, /operatorWorkspacePermissionDenied\(identity, "marketing"\)/);
  assert.match(owner, /verifySameOrigin\(request\)/);
  assert.match(owner, /readBoundedJson\(request, 4096\)/);
  assert.match(owner, /X-Expected-Version/);
  assert.match(owner, /Idempotency-Key/);
  assert.match(owner, /expectedDraftVersion/);
  assert.match(owner, /targetPublicationVersion/);
  assert.match(goPublic, /s\.operatorAuthorized\(w, r\)/);
  assert.match(goDB, /FOR UPDATE/);
  assert.match(goDB, /marketing_studio_layout_events/);
});

test("published client home consumes only public layout; operator preview remains separate", () => {
  assert.match(clientHome, /readPublicStudioLayout\(\)/);
  assert.match(clientHome, /parseStudioLayoutPublication\(result\)/);
  assert.match(clientHome, /publishedBeforeStores\.map\(renderPublishedSection\)/);
  assert.match(clientHome, /publishedAfterStores\.map\(renderPublishedSection\)/);
  assert.match(clientHome, /!layoutDoc \? <>/);
  assert.match(clientHome, /showPublishedStores/);
  assert.match(clientHome, /homeStoreLimit/);
  assert.match(clientHome, /HomeProductFeed/);
  assert.match(clientHome, /PromotionCard/);
  assert.match(clientHome, /LoopingHeroBanner/);
  assert.match(editor, /<PublishedLayoutSettings shared=\{shared\} dirty=\{dirty\}/);
  assert.match(publisher, /ACTIVATE_DRAFT/);
  assert.match(publisher, /RESTORE_DEFAULTS/);
  assert.match(publisher, /ROLLBACK/);
  assert.match(publisher, /window\.confirm/);
  assert.match(publisher, /unsupportedVisible/);
  assert.match(publisher, /pending\.current/);
  assert.doesNotMatch(goPublic.slice(goPublic.indexOf("func (s *MarketingServer) readPublicStudioLayout"),goPublic.indexOf("func (s *MarketingServer) readOperatorStudioLayout")), /operatorAuthorized|ReadStudioDraft|PublishedByActorID/);
});


test("missing published layout service gives the operator a recovery action without altering the draft", () => {
  assert.match(publisher, /payload\?\.error\?\.code !== "NOT_FOUND"/);
  assert.match(publisher, /if \(await missingEndpoint\(live\) \|\| await missingEndpoint\(past\)\)/);
  const codeGuard = publisher.indexOf('payload?.error?.code !== "NOT_FOUND"');
  const outdated = publisher.indexOf('خدمة نشر تخطيط الرئيسية غير متاحة');
  assert.ok(codeGuard > -1 && codeGuard < outdated, "404 error classification must precede outdated-DSH message");
  assert.match(publisher, /خدمة نشر تخطيط الرئيسية غير متاحة/);
  assert.match(publisher, /تحديث حالة النشر/);
  assert.match(publisher, /ستبقى مسودتك دون تغيير/);
});
