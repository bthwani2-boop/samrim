# BThwani — Stage-4 environment and configuration source inventory

ARTIFACT_CLASS: NON_AUTHORITATIVE_SOURCE_INVENTORY
SEMANTIC_OWNER: docs/reference/environment-config-inventory.md
IMPLEMENTATION_STATE_AUTHORITY: NONE
SOURCE_BRANCH: refoundation/clean-house-20261112
DONOR_REFERENCE: 41 (read only)
STATUS: FOUNDATION_ONLY; NO_SECRETS_OR_RUNTIME_PROVISIONED

This is a **source-derived inventory, not an environment file**, an approved deployment specification, a second configuration owner, or proof of runtime readiness. The current service clients contain no operations; service secrets and runtime endpoints are **deferred** until Identity, DSH and WLT contracts and the governance cutover are approved. Never copy the donor's environment wholesale.

## Current sources and owners

| Source | Canonical responsibility | Current state |
| --- | --- | --- |
| Root `.node-version` and `.nvmrc` | Node 24.22.1 for the repository | Pinned and verified locally |
| Root `.go-version` | Go 1.27.3 for eventual Go owners | Pinned; on the 13 November Bthwani Windows host the system-installed Go 1.27.3 was verified independently with `GOTOOLCHAIN=local` |
| Root `package.json` and `pnpm-lock.yaml` | pnpm 12.15.0, TypeScript 7.0.2 and Biome 2.5.12 | Single workspace/lock; no duplicate package manager |
| `apps/{customer,merchant,captain}/mobile.config.json` | Original Expo public identifiers and native app profiles | Preserved; changing internal directory names must not change issued identities |
| `tools/mobile/define-bthwani-expo-app.cjs` | Native config inputs, optional maps and Firebase file references | Source/config only, not a native build |
| `packages/design-system/` and `packages/tamagui-config/` | Semantic colors and appearance integration | Canonical presentation sources; not environment secrets |
| `services/{identity,dsh,wlt}/` | Future service-specific environment ownership | Scaffold only; no Go backend, API operations, SQL or connection credentials |

## Currently referenced local/native environment keys

Only **names**, never credential values, belong in this table. "Required" means required for the named future feature/build, **not** required to preview Stage-4 presentation shells.

| Variable | Reader or owner | Classification | Admission and validation |
| --- | --- | --- | --- |
| `BTHWANI_SECRETS_ROOT` | Shared Expo config reader in `tools/mobile/` | Non-secret path to externally protected local secret root | Optional override; must point to the **new Worktree's** secret location, not the donor |
| `BTHWANI_ENFORCE_NATIVE_KEYS` | Shared Expo config reader | Non-secret build guard (`1`) | Enforce missing Google Maps key failures for a separately authorized maps-enabled native build |
| `GOOGLE_MAPS_ANDROID_API_KEY_APP_CLIENT` | Customer Expo map configuration | Provider key; platform and app restricted | Required only for accepted Customer native maps integration |
| `GOOGLE_MAPS_ANDROID_API_KEY_APP_PARTNER` | Merchant Expo map configuration | Provider key; platform and app restricted | Required only for accepted Merchant native maps integration |
| `GOOGLE_MAPS_ANDROID_API_KEY_APP_CAPTAIN` | Captain Expo map configuration | Provider key; platform and app restricted | Required only for accepted Captain native maps integration |
| `GOOGLE_MAPS_IOS_API_KEY` | Customer/Merchant Expo map configuration | Provider key; platform and app restricted | Required only for accepted iOS maps integration for those apps |
| `GOOGLE_MAPS_IOS_API_KEY_APP_CAPTAIN` | Captain Expo map configuration | Provider key; platform and app restricted | Required only for accepted Captain iOS maps integration |
| `GOOGLE_MAPS_ANDROID_API_KEY` / `GOOGLE_MAPS_IOS_API_KEY` | Shared Expo map reader | Generic fallback keys; avoid cross-app key scope | Present as fallbacks in source; verify provider restrictions and intended consumers before enabling |
| `GOOGLE_SERVICES_JSON` | Shared Expo Android configuration | Path/reference to Firebase configuration file | Optional until authorized native integration; never commit the referenced file or an unreviewed project identity |
| `NODE_OPTIONS` (`--dns-result-order=ipv4first`) | Local Expo launch session | Process-local developer compatibility setting | Only for affected Windows/ADB IPv4 preview; do not globally override Node behavior |

When a platform-specific Maps key is not supplied as an environment variable, the current config reader may look in `<BTHWANI_SECRETS_ROOT>/env/mobile.env`. Its stage-specific default is `C:\\BTHWANI-Secrets\\samrim-refoundation-clean-20261112`, **not automatically the original donor's secret location**. On 2026-11-13 the user explicitly identified `C:\\BTHWANI-Secrets`; read-only metadata checks found the original `C:\\BTHWANI-Secrets\\samrim\\env\\mobile.env` with per-app Customer/Merchant Android maps keys and shared iOS map key present, plus `firebase/app-client/google-services.json` and `firebase/app-partner/google-services.json` whose Android package declarations match the unchanged `com.bthwani.client` and `com.bthwani.partner`. **No key values, signatures or Firebase files were copied or committed; this is not authorization to share donor secrets with a new environment automatically.** A local preflight may explicitly point `BTHWANI_SECRETS_ROOT` to a reviewed key location only for that process. The EAS build runners require their **own** project/environment-scoped variables and File secrets.

The `GOOGLE_SERVICES_JSON` path is different from a Google Maps key. Expo configuration may alternatively reference an app-local `google-services.json` if present; keep its provenance, application identity, Git exclusion and native-build admission independently verified.

## Isolation and future service environment admission

1. **Identity** alone will own authentication/session and identity-to-service credentials; **DSH** owns Store/catalog/Order/fulfillment settings; **WLT** owns money/ledger/settlement and its secrets. The Operator app and Expo apps must not become alternative service policy writers.
2. **Do not map donor environment values or account IDs to this Worktree automatically.** Create a per-key service environment manifest only when the owning Go/config consumer is admitted, with owner, required stage, secret/public classification, validation, rotation and non-secret example. Existing donor keys are historical evidence, not automatic requirements.
3. Any separately authorized Docker Compose project must have a **unique project name**, exclusive network, isolated PostgreSQL and media volumes, distinct verified listening ports and per-environment secrets. Never attach to `samrim-local`, `samrim-remote-stage` or their restore-test volumes. A running daemon alone does not satisfy isolation, data restore or tenant-safety tests.
4. Preserve the native app owner, slug, package, bundle identifier, scheme, EAS project ID and runtime update contract exactly; choose a build image only after explicit reproducibility review. Do not copy old Android/iOS signing files into the repository.
5. Before permitting an API environment to run, prove a healthcheck, an authorized failed-auth response, owner-scoped persistence, isolated backup/restore, unique ports and no traffic or data crossing into branch 41 or production. Avoid HTTP 200 from an unrelated SSH forward as proof.
6. Keep `GOVERNANCE_CUTOVER: NOT_READY` until 14 semantic owners, all 26 admitted capabilities and independent critical-risk reviews are approved. This inventory does not authorize Go services, executable OpenAPI operations, SQL migrations, Docker startup, deployment or financial activity.

## Verification status (13 November 2026)

- Source pin and Stage-4 app configuration checks: **PASS (source/config only)**.
- Exact Go toolchain for repository: **PASS on the audited Windows host** via global `C:\Program Files\Go\bin\go.exe` returning `go version go1.27.3 windows/amd64` with `GOTOOLCHAIN=local`. Other hosts must run `pnpm check:toolchain`; this inventory cannot establish their installed state.
- Native maps, Firebase project ownership, provider key restrictions, Android/iOS binary and native permission acceptance: **NOT_RUN**.
- Isolated Compose instance, backup/restore and service credential provisioning: **NOT_RUN**.
- Critical security, finance, SQL and legal approvals: **REVIEW_BLOCKED**.

For accepted work and phase evidence use only the active execution plan in `docs/REFOUNDATION-PLAN.md`; this file is a non-normative configuration inventory.

## 2026-11-13 — Customer/Merchant EAS remote-build configuration preflight (non-secret evidence)

This inventory records **names, ownership and readiness only**, not the value of any API key, file secret, signing credential or client configuration. The original EAS projects were authenticated read-only via the pinned globally installed `eas-cli/24.7.0` as `@bthwani1/app-client` (`4adf3184-fc07-4186-b49e-0dc821a5ab73`) and `@bthwani1/app-partner` (`bcd22a76-d4b2-4de0-93b3-f6d13074a802`). Those IDs match the legal `mobile.config.json` files and do **not** justify new EAS project creation or changing published Android/iOS IDs, schemes or channels.

| EAS environment | Customer Google Maps Android / shared iOS names | Merchant Google Maps Android / shared iOS names | `GOOGLE_SERVICES_JSON` name | Evidence |
| --- | --- | --- | --- | --- |
| Customer `development` / `preview` | Listed | N/A | Listed | EAS authenticated environment-name readback only |
| Merchant `development` | N/A | Listed | Listed | EAS authenticated environment-name readback only |
| Merchant `preview` | N/A | **NOT_LISTED** | Listed | EAS authenticated environment-name readback only |

For Customer and Merchant the `development` and `internal` build profiles retain exact pinned Node/pnpm, original app identity, explicit `development/preview` EAS environments and update channels, installable Android APK distribution, no auto-submit, and remote-managed **internal build** credentials. A future production-app update **must compare remote signing fingerprints with the original protected keystore and store identity**; the presence of `credentialsSource: remote` alone neither proves signing-key parity nor authorizes replacing the published key. No remote build was submitted and no native APK/IPA was accepted.

The app config now fails closed on an `EAS_BUILD=true` native maps configuration missing its required platform keys. On Customer/Merchant Android EAS runners it also requires a present, parseable `GOOGLE_SERVICES_JSON` File-secret path containing the correct app Android package. It does not print Firebase JSON or API key values. Existing local source tests exercise missing keys, malformed/mismatched Firebase, valid synthetic fixture, profile-signing/config drift and successful resolved Expo identity. These are **source/preflight checks**, not a cloud binary, an actual Firebase project tenancy review or proof of Google key API restrictions.

A narrowly targeted attempt to provision the absent Merchant-`preview` Google Maps values from the user-indicated protected local directory was **blocked by the execution safety boundary before a successful transfer was evidenced**. No alternate tool or bypass was used. Status: `BLOCKED` until an authorized credential-management operation is permitted; verify EAS environment presence afterward. The existing `GOOGLE_SERVICES_JSON` EAS entries were **not** downloaded, modified or content-verified.

**Stage-4 boundary:** `pnpm check` and locally evaluated Expo config/TypeScript/RTL/owner tests can pass without proving EAS cloud availability. `requireCommit: true` intentionally prevents build-archive inspection on a dirty Git revision; rerun archive inspection on a committed candidate. Remote managed Android signing, restricted API keys, correctly scoped and typed EAS File secrets, actual Android-native build/install, iOS provisioning and device UX remain `NOT_RUN` or `BLOCKED` until real evidence exists. Do not report 100% cloud readiness from file presence alone.
