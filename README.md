# BThwani Platform

This repository is the canonical BThwani platform repository.

## Branch model

- `main` — protected canonical foundation and promotion branch.
- `a` — active refoundation and implementation branch.
- Temporary implementation branches may branch from `a` and must converge back into `a`.
- Canonical promotion is performed through a pull request from `a` to `main` after the applicable fixed-point gates pass.

## Repository roles

- `governance/` — durable product, system, architecture, security, quality and delivery meaning.
- `docs/` — human development and operational guidance.
- `tools/` — automation, inspection, generation and evidence; not Product Truth.
- `apps/`, `services/`, `packages/`, `contracts/`, `infra/` — admitted by the canonical refoundation target as implementation is rebuilt.

## Secrets

Secret values, signing keys, provider credentials and machine-local bindings are external to Git. Local tooling resolves the external vault through `BTHWANI_SECRETS_ROOT`.

Do not commit credentials, Firebase service files, signing files, real `.env` files, tokens, or private keys.
