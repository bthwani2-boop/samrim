# BThwani Platform

This repository is the canonical BThwani platform repository.

## Branch model

- `main` — protected canonical promotion branch.
- Active implementation/refoundation work occurs on the exact working branch supplied by current human authorization and live Git state.
- Temporary implementation branches must preserve exact-head, non-conflicting ownership and an explicitly owned integration path.
- Promotion to `main` is a separate operation requiring its applicable explicit authorization and delivery gates.

Durable documentation must not hard-code a temporary working branch as permanently active.

## Repository roles

- `knowledge.sources.json` — the canonical machine-readable binding to the exact immutable Governance/Docs commit used by this repository.
- `AGENTS.md` — the sole repository-local agent operating law; not Product or current-state truth.
- `tools/` — automation, inspection, generation and evidence; not Product Truth.
- `apps/`, `services/`, `packages/`, `contracts/`, `infra/` — executable implementation roots whose durable placement/admission rules come from the exact pinned Governance; their current contents and existence are proven by live source.

Logical paths beginning with `governance/` or `docs/` refer to the exact Governance/Docs commit pinned by `knowledge.sources.json`. Repository tools that need that source materialize the exact pin into ignored local cache automatically. For direct inspection, run `node tools/dev/knowledge-source.mjs`. Mutable external facts must still be revalidated at use.

## Verification and push safety

`pnpm verify` proves the exact current local candidate and does not require the branch to have been pushed already. It requires a clean worktree, keeps the candidate HEAD fixed throughout verification, and runs the repository's applicable static/workspace/runtime evidence.

`pnpm safe:push` reruns `pnpm verify`, requires a clean unchanged HEAD, permits only fast-forward/first push of the same working branch, and confirms the exact remote SHA after push.

GitHub CI independently re-proves the pushed exact SHA.

## Secrets

Secret values, signing keys, provider credentials and machine-local bindings are external to Git. The exact secret source/binding is environment- and deployment-specific; live executable configuration is the authority for what is actually supported.

Do not commit credentials, Firebase service files, signing files, real `.env` files, tokens, or private keys.
