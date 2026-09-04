# Mobile Android EAS Operations Runbook

DOCUMENT_CLASS: HUMAN_DEVELOPMENT_GUIDE
PRODUCT_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

Status: OPERATIONAL_RUNBOOK
Owner: Mobile release/tooling operations

Current `package.json`, app runtime configuration, Expo/EAS project configuration and secrets policy override stale commands or host-local paths in this document.

## Scope

Covers Android development/build preparation for the mobile applications currently registered in the repository. Operate one application at a time unless the current tooling explicitly supports and authorizes a broader operation.

## Entry point

Use the current registered mobile EAS command from `package.json`. When the repository still exposes the application-scoped workflow, the intended lifecycle is:

```text
Initialize → Preflight → Build
```

Verify the exact command and supported arguments before execution; a runbook does not make an absent script valid.

## Initialize

Application-scoped initialization should be idempotent and should:

- create or reuse the approved Android development signing material;
- derive the signing certificate fingerprint used by provider restrictions;
- create/reuse the matching Firebase Android application when authorized;
- refresh and validate package-specific provider configuration;
- ensure Maps/API restrictions bind to the exact package + certificate identity;
- stage only ignored/local inputs required by Expo/EAS.

It must not silently modify another application or commit secrets/generated provider credentials.

## Preflight

Before remote build, verify for the selected app as applicable:

- resolved Expo/EAS configuration;
- provider input presence and package identity;
- TypeScript;
- Expo Doctor;
- local export/prebuild checks required by the current app;
- native configuration/signing compatibility.

A preflight result is valid only for the exact source/config/provider/signing inputs it tested.

## Build

Submit a remote build only after the current preflight contract passes. If the repository implements a preflight stamp, source/config/signing drift after preflight must invalidate the stamp and fail closed.

Cache clearing is a troubleshooting option, not a correctness substitute.

## Local/generated files

Provider configs, keystores, credentials, `.env.local`, local mobile environment manifests and temporary EAS request files must remain ignored/private according to current repository policy. Host-specific paths shown by local tooling are operational state, not repository truth.

## Provider ownership

Each app remains isolated by its package/application identity, Expo/EAS project identity, signing certificate and provider restrictions. Push-sending credentials are separate operational secrets and should not be required merely to prove that compilation succeeds unless the active build contract explicitly says otherwise.

## Failure and evidence

- Missing required build-time inputs must fail preflight/build rather than produce a falsely ready candidate.
- A successful remote build does not prove login, push delivery, Maps behavior or runtime API reachability.
- Record the exact source commit, app identity, build profile and remote build result for release evidence.
- Never commit secret/provider files to make a preflight pass.
