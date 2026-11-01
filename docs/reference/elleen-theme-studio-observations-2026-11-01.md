# Elleen theme editor → BThwani Studio: independently evidenced gap map

Date: 2026-11-01 (Asia/Aden). Reference: user-authorized live Edge session at
`https://elleen.ye/admin/theme` and `https://elleen.ye/admin/theme/editor/elegance`.
Method: Playwright CDP on an isolated tab in the user's browser, visible DOM
labels, page selectors and section settings only. No source bundles, internal
APIs, personal records, uploads, activation or saving on Elleen.
Raw local evidence (not shipped): `%LOCALAPPDATA%\Temp\elleen-theme-pages-evidence-20261101.json`,
`%LOCALAPPDATA%\Temp\elleen-theme-elegance-20261101.png`.

**Evidence key:** OBSERVED = actually rendered labels/fields; INFERRED =
candidate independent BThwani behavior, not a claim about Elleen internals;
UNVERIFIED = controls or account conditions not successfully exercised.
This file is benchmarking evidence, not Product governance or a roadmap approval.

## 1. Visible route and page matrix

| Surface / route | Observed | BThwani landing / safe disposition |
| --- | --- | --- |
| Elleen `/admin/theme` | Theme gallery, a theme called "ثيم أناقة", customization entry | Control Panel → Marketing & Content → Studio; template chooser only when multiple real owned templates exist |
| Editor `/admin/theme/editor/elegance` | Page chooser, section list, visibility, settings, reorder, save, preview | Control Panel → Studio; reuse present section reordering and saved-team version controls |
| Home | Main slider; features; categories; trending products; custom product sections; advertising banners; best sellers; promotions; Instagram; testimonials; brands; newsletter | Client home (Expo Android/iOS/web), not Partner/Operator operational home; activate only sections backed by canonical DSH data and admitted scope |
| Header | Page choice visible; actual settings NOT_RUN | Client storefront header/route shell only, not account-security or authorization screens |
| Product Detail | Page choice visible; actual settings NOT_RUN | Client product detail, only presentation choices that preserve stock/price/checkout truth |
| About | Page choice visible; actual settings NOT_RUN | Public website / about; managed editorial content with proper ownership |
| FAQ | Page choice visible; actual settings NOT_RUN | Public website / FAQ; searchable text and accurate disclosures |
| Contact | Page choice visible; actual settings NOT_RUN | Public website / contact; approved company contact and availability |
| Privacy | Page choice visible; actual settings NOT_RUN | Public website / legal; require policy approval rather than marketing free-edit publication |
| Terms | Page choice visible; actual settings NOT_RUN | Public website / legal; require legal policy approval, preserve revision audit |
| Footer | Page choice visible; actual settings NOT_RUN | Public site and client web footer; privacy/legal/navigation links remain functional |

The editor page selector lists the above nine destinations, but their specific
forms were not all reachable in this run. No claim of complete coverage of
subscription-gated pages or the third party's internal publishing logic.

## 2. Section setting observations

| Area | Actual observed controls | Original BThwani use / owner | Priority |
| --- | --- | --- | --- |
| Hero slider | Visibility; text, CTA, alignment; fixed/full viewport heights; autoplay; arrows/dots; image/video | Client home presentation; marketing media and link targets from DSH; no arbitrary script | P1 |
| Categories | Title/subtitle toggles, grid/carousel, 2–6 columns, 4–100/all, image/name, card style | Client home discovery sourced from DSH categories; responsive layouts and pagination | P1 |
| Custom product groups | Section visibility and product-section control | Client home curated canonical DSH collections; editor must not invent catalog contents | P1 |
| Advertising banners | Section visibility and locale content controls | Existing DSH marketing/content/publication; validated media provenance and targets | P1 |
| Promotions | Grid/carousel, 2–5 columns, 4–12 products, cart/favorite/quick-view/rating/price toggles | DSH published offers only; checkout and truthful prices remain mandatory | P2 |
| Testimonials | Approved ratings/custom source choices; slider/cards; count; stars | Verified order ratings only; never fabricated testimonials | P2 |
| Brands | Visibility, locale inputs observed | Partner/store logo presentation only if licenses and verified data exist | P3 |
| Features, best sellers, Instagram, newsletter | Visible section entries | Adapt to platform value and privacy; avoid social integrations without consent/use case | P3 |

The first visit showed twelve visible section configuration entries and buttons
to show/hide sections, reorder them, open their settings, save and preview.
Settings for some entries timed out during read-only traversal; detailed
unreached fields are **UNVERIFIED**, not reverse-engineered backends.

## 3. BThwani source-of-truth comparison (candidate `77016c3c`)

| Capability | Observed source state | Gap / disposition |
| --- | --- | --- |
| Client-home draft | Control Panel Studio supports sections, slides, responsive/day-night mock preview | Preview is illustrative and explicitly non-published |
| Shared draft | DSH schema-versioned CLIENT_HOME record, version check, idempotency, audit | Retain as authoring draft; do not expose via public read |
| Color publication | DSH published palette version + audit/history + rollback; shared contrast validation | Already exists; do not introduce a second theme store |
| Consumer palette | Client, Partner, Captain Expo root layouts read public publication | Control Panel/Ant Design not yet reading the same published colors; bounded fix targeted here |
| Published page layout | No public publication or client renderer for the Studio section/slide draft | Major remaining gap; requires separately versioned DSH schema, authorized publication and real home consumption |
| Page family | Only CLIENT_HOME admitted in Studio draft | Avoid cosmetic pseudo-pages; add Header/Product/FAQ/Footer only with real content owners and consumers |
| Brand/status accessibility | Canonical design tokens and AA checks, semantic statuses separate | Use `resolveStudioTheme` and `themeToCssVariables`, never raw generated CSS or vendor artwork |
| Roles | Identity operator marketing permission protects mutation | Public color read can be made available to all consumers; never expose private drafts |
| Financial values | WLT remains financial owner | No marketing template field may change wallet/ledger/orders/dispatch |

## 4. Explicit placement by surface

- **Control Panel (operator):** Studio at Marketing & Content for preview,
  team drafts, publication history and rollback. Published corporate palette
  applies to Ant Design and CSS together; personal light/dark preference is
  separate. Identity owns authorization; DSH owns published configuration.
- **Client Expo (Android, iOS, web):** public DSH palette exists; next
  published layout release must drive actual home section order, visibility,
  product group references and approved hero media. Native defaults remain.
- **Partner Expo (Android, iOS, web):** use palette only for shared branding.
  Do not give Store managers a global theme editor; if a store storefront
  customization product is admitted, scope it to Store in DSH + Store ACL.
- **Captain Expo:** apply only safe shared brand colors; no commerce marketing
  template or optional panels may obscure safety, active tasks or status.
- **Public landing site:** legal, FAQ, header and footer templates only through
  their approved content owners, not from an unpublished client-home mock.

## 5. Ordered engineering gates

1. **Now:** read-only Control Panel projection of *public* validated DSH
   publication, apply via existing CSS token projection and Ant Design theme,
   refresh on foreground, restore compiled defaults on invalid/absent versions.
   No new DSH writer, migration or authorization bypass.
2. **Next slice (NOT IMPLEMENTED HERE):** versioned *published* CLIENT_HOME
   layout in DSH, separate from team draft; publication validation,
   audit/rollback/compatibility, client renderer wired to canonical categories,
   products, banners and promotions, locale/asset checks and negative tests.
3. **Then (NOT IMPLEMENTED HERE):** distinct real templates for header,
   footer, product detail, FAQ/about/contact with owner routing, page-scoped
   preview and publication, deep link consistency, RTL/mobile/desktop.
4. **Only if admitted:** grouped product campaigns and storefront-specific
   design choices, with immutable financial/status fields and Store ACL.

### Verification requirements

Check endpoint no-store and malformed/unknown schema fallback; normal operator
without marketing can still read *public* colors; only marketing operator may
publish; no preview draft leaks; light/dark Ant Design and CSS use identical
validated publication; keyboard and RTL; offline errors preserve compiled
defaults/last valid; explicit revision readback. Live publication to real devices
requires separate safe fixtures and authorization; UI mock alone is not proof.

## 6. Stable second-pass verification: all nine editor page surfaces

A second isolated Playwright walkthrough selected **all nine exact option values**
in Elleen's page `select` and waited for each page's own heading before recording
its section list. This supersedes only the page-heading uncertainty in section 1.
It does **not** establish backend persistence, entitlement bypass, preview fidelity,
or complete configuration-field coverage. Section-setting buttons were sampled
where accessible; intermittent panel-opening timeouts remain UNVERIFIED.

| Elleen page (observed) | Actual visible section inventory | Independent BThwani placement and constraints |
| --- | --- | --- |
| Header (`header`) | Announcement bar, brand/logo, navigation, search, language switch, account, favorites, cart | Customer storefront **web header**, not operator/captain navigation. DSH owns route/commerce references; Identity owns account; valid supported locales only. P2 |
| Home (`home`) | Main slider, benefits, categories, trending products, custom product sections, advertising banners, best sellers, offers, Instagram, testimonials, brands, newsletter | Client home only. DSH owns published product, catalog, offer and campaign truth. Avoid fake ratings/social/email features. P1 |
| Product Detail (`product-detail`) | Product information, product tabs, related products, frequently bought together, image gallery | Client product view. DSH canonical product/variants/media; sales recommendations must use real evidence, not invented purchase relations. P2 |
| About (`about`) | Hero, our story, mission/vision, values, stats, team, timeline, testimonials, call-to-action | Public website. Only verified stats/team and approved claims; editorial publication owner. P2 |
| FAQ (`faq`) | Hero, search, FAQ categories, Q&A items, contact CTA | Public website and customer support. Backend search/content taxonomy only where needed; no independent support data cache. P2 |
| Contact (`contact`) | Page banner, contact form, map settings | Public site support; protect personal messages, anti-abuse and verified support destinations. Map must use approved location. P2 |
| Privacy Policy (`privacy-policy`) | Banner settings, content settings, contact CTA | Public **legal** route; review/approved version required. Marketing Studio must not publish legal copy directly. P2 |
| Terms & Conditions (`terms-conditions`) | Banner settings, content settings | Public **legal** route; explicit approval, audit and versioned legal authority. P2 |
| Footer (`footer`) | Footer identity, social links, quick links, customer service, contact information, payment methods | Public website + customer web. Payment icons must reflect actually enabled providers, not display-only fiction; link audit and accessibility. P2 |

**Verified reference labels are presentation structure only.** Third-party
section names, controls and hierarchy inform independently designed BThwani
features; they are not authorizations to copy vendor source code, page content,
brands, assets, or protected interactions. User-facing marketing, legal and
operational surfaces retain their own canonical owners and permissions.

### Resulting operator frontend/backend separation

| Component | Frontend/control-plane responsibility | Owning backend / non-negotiable boundary |
| --- | --- | --- |
| Studio page selector | Show only real template families with published consumers; responsive previews, section visibility, ordering, and honest unpublished indicators | DSH controls versioned nonlegal storefront display publications; only operator marketing permission can mutate; separate draft vs published versions |
| Client storefront publication | Preview published page as actual client consumes it; display source/version and deterministic fallback | DSH validates exact allowed sections, canonical media and content references, stable version and rollback; client consumes only published public projection |
| Product / offer displays | Presentation variants responsive to layout settings | DSH owns product eligibility, stock, seller, price and offers; no template override of monetary/stock truth |
| Operator corporate theme | Shared CSS/Ant tokens, personal day/night switch, safe recovery | Implemented in this slice through existing public DSH palette; status/finance token semantics remain canonical |
| Support/FAQ/contact | Search and reading first, no forced sign-in; moderation and form abuse protection if forms admitted | Approved content/service owner, no leakage of customer or staff data |
| Terms/privacy | Approved copy shown with effective date and accessible revision trail | Legal/governance owner approves each revision; no marketing-only write authority and no silent auto-publication |
| Header/footer navigation | Link and localization selection, previews | Route owners, Identity roles, enabled payment methods; reject broken/unauthorized targets |

**Implementation boundary:** The added operator publication reader and theme
projection are implemented/tested. The multi-page storefront template publishing
model, legal content workflow, and customer layout consumption are still
**NOT_IMPLEMENTED** and require a separate coherent DSH/client/public-site
vertical slice; do not mark these complete based on observed editor headings.
