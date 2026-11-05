# BThwani Platform

Canonical repository for the BThwani platform.

## Authority

- `AGENTS.md`: repository execution/safety law.
- `REPOSITORY-STRUCTURE.md`: repository placement rules.
- `docs/governance/README.md`: local approved decision and owner routing.
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

Application dev servers may run **natively on Lenovo Windows**, not on this source machine. Read [the current local runtime map and operational runbook](infra/local/README.md) before starting, stopping or testing any app. Surface keeps canonical source/Git, browser and ADB; Docker services stay on Lenovo through the SSH Docker context.

`pnpm client`, `pnpm partner`, `pnpm captain`, and `pnpm control` invoke local package launchers. They **fail closed** if another host is the declared runtime owner; they are not remote start commands. Use the documented Windows Scheduled Tasks and SSH loopback tunnels, then verify the running host and mirrored file SHA before claiming Fast Refresh/HMR or test success. Never start a competing local server to bypass an unreachable Lenovo.

Device transport/scrcpy when needed:

```text
pnpm scr
```

Fast local static feedback for the current working-tree change:

```text
pnpm check
```

`pnpm check` does not start runtime services or contact Nx Cloud. Push with `pnpm safe:push`, which verifies and confirms the exact published candidate. CI plus the active GitHub ruleset own final candidate, security, runtime and merge assurance.

Local development restores reusable real sessions where available. Explicit authentication-journey proof can disable the development fallback with `EXPO_PUBLIC_BTHWANI_AUTH_JOURNEY_PROOF=1` for Mobile or `BTHWANI_AUTH_JOURNEY_PROOF=1` for Control.

## Secrets

Never commit credentials, Firebase service files, signing files, real `.env` files, tokens or private keys.
