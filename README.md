# BThwani Platform

Canonical repository for the BThwani platform.

## Authority

- `AGENTS.md`: repository execution/safety law.
- `REPOSITORY-STRUCTURE.md`: repository placement rules.
- `knowledge.sources.json`: immutable Governance binding.
- Live source/config/schema/runtime/database/readback: current implementation truth.

## Local development

Setup only when dependencies/toolchain inputs changed:

```text
pnpm bootstrap
```

Backend/state lifecycle:

```text
pnpm dev
pnpm dev status
pnpm dev down
```

Start only the surface being developed:

```text
pnpm client
pnpm partner
pnpm captain
pnpm field
pnpm control
```

Device transport/scrcpy when needed:

```text
pnpm scr
```

Fast local static feedback for the current working-tree change:

```text
pnpm check
```

`pnpm check` does not start runtime services or contact Nx Cloud. Push with standard Git. CI plus the active GitHub ruleset own final candidate, security, runtime and merge assurance.

Local development restores reusable real sessions where available. Explicit authentication-journey proof can disable the development fallback with `EXPO_PUBLIC_BTHWANI_AUTH_JOURNEY_PROOF=1` for Mobile or `BTHWANI_AUTH_JOURNEY_PROOF=1` for Control.

## Secrets

Never commit credentials, Firebase service files, signing files, real `.env` files, tokens or private keys.
