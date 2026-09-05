# BThwani Platform

This repository is the canonical BThwani platform repository.

## Branch model

- `main` — protected canonical promotion branch.
- Active implementation/refoundation work occurs on the exact working branch supplied by the current invocation and live Git state.
- Temporary implementation branches are allowed only under the applicable Orchestrator branch/mutation rules and must converge through an explicitly owned integration path.
- Canonical promotion to `main` occurs only after the applicable exact-candidate fixed-point and delivery gates pass.

Durable documentation must not hard-code a temporary campaign branch as the permanently active branch.

## Repository roles

- `governance/` — durable product, system, architecture, security, quality and delivery meaning.
- `docs/` — human development and operational guidance.
- `tools/` — automation, inspection, generation and evidence; not Product Truth.
- `AGENTS.md` — routing-only entrypoint for coding agents; it never replaces Governance, Orchestrator, Docs or source.
- `apps/`, `services/`, `packages/`, `contracts/`, `infra/` — executable implementation roots whose durable placement/admission rules come from Governance; their current contents and existence are proven by live source.

## Secrets

Secret values, signing keys, provider credentials and machine-local bindings are external to Git. The exact secret source/binding is environment- and deployment-specific; live executable configuration is the authority for what is actually supported.

Do not commit credentials, Firebase service files, signing files, real `.env` files, tokens, or private keys.
