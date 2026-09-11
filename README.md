# BThwani Platform

This repository is the canonical BThwani platform repository.

## Branch model

- `main` — protected canonical promotion branch.
- Active implementation/refoundation work occurs on the exact working branch supplied by current human authorization and live Git state.
- Temporary implementation branches must preserve exact-head, non-conflicting ownership and an explicitly owned integration path.
- Promotion to `main` is a separate operation requiring its applicable explicit authorization and delivery gates.

Durable documentation must not hard-code a temporary working branch as permanently active.

## Repository roles

- `knowledge.sources.json` — canonical machine-readable routing manifest for external knowledge/evidence roots. It records the Governance/Docs repository and navigation branch while pinning the exact immutable commit, plus donor provenance and non-authoritative external reference URLs. Branch names are navigational; the exact commit SHA is the immutable knowledge pin.
- `AGENTS.md` — concise repository-local agent operating/safety contract; not Product or current-state truth.
- `tools/` — machine safeguards, automation, inspection, generation and evidence; not Product Truth.
- `apps/`, `services/`, `packages/`, `contracts/`, `infra/` — executable implementation roots whose durable placement/admission rules come from the exact pinned Governance; their current contents and existence are proven by live source.

Logical paths beginning with `governance/` or `docs/` refer to the exact Governance/Docs commit pinned by `knowledge.sources.json`. Use `pnpm knowledge:sync` to materialize that immutable commit into ignored local cache when direct file inspection is required. Donor and external-source entries in the manifest are evidence routes, not automatic Product/System/adoption authority, and mutable external facts must be revalidated at use.

## Secrets

Secret values, signing keys, provider credentials and machine-local bindings are external to Git. The exact secret source/binding is environment- and deployment-specific; live executable configuration is the authority for what is actually supported.

Do not commit credentials, Firebase service files, signing files, real `.env` files, tokens, or private keys.
