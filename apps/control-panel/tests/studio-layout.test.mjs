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
  assert.match(route, /readOperatorSession\(/);
  assert.match(route, /operatorWorkspacePermissionDenied\(identity, "marketing"\)/);
  assert.match(route, /verifySameOrigin\(request\)/);
  assert.match(route, /X-Expected-Version/);
  assert.match(route, /Idempotency-Key/);
  assert.match(route, /expectedDraftVersion/);
  assert.match(route, /targetPublicationVersion/);
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
