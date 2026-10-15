# Quality Policy

ARTIFACT_CLASS: DURABLE_CROSS_CUTTING_POLICY
SEMANTIC_OWNER: docs/governance/policies/quality.md
EXECUTION_AUTHORITY: NONE
IMPLEMENTATION_STATE_AUTHORITY: NONE

Quality is the correctness of the approved outcome for its intended actors and materially affected use, not a score, tool count or universal checklist.

- A mock, screenshot, isolated HTTP response or passing component test proves only the seam it exercises. A connected outcome requires the materially affected handoffs to reach canonical owner readback.
- Where available, expected results for a material claim come from an applicable contract, invariant or canonical readback independent of the implementation decision being tested. Higher-consequence claims need relevant negative, authorization, failure, concurrency or recovery evidence.
- Synthetic proof state is isolated and created through canonical owner operations. Reuse valid state when safe. Direct persistence mutation is limited to persistence, fault or recovery claims; synthetic state never becomes Product truth.
- Performance and capacity claims use a representative end-to-end workload and realistic bounded data. Do not infer scale from toy fixtures or impose one threshold on unrelated resources.
- User-facing correctness includes rendered behavior and materially applicable interaction, recovery, RTL, responsive and accessibility needs. The Experience and Design policies own those durable semantics; AGENTS.md owns agent execution.
- Text integrity is a cross-surface invariant: source files, build scripts, APIs, persistence boundaries and rendered text must preserve Unicode correctly. UTF-8 without BOM is the canonical repository text encoding; external legacy encodings are decoded explicitly once at their ingestion boundary. No double decoding or lossy transcoding is permitted.
- Encoding faults (including Mojibake) are diagnosed at their first corrupted boundary by comparing original bytes, source text, transport and rendering before mutation. Restore from a trusted source or a provably reversible transform; do not bulk replace, guess lost characters, rewrite byte-adopted migrations or mutate persistent customer data without owner-backed proof and an authorized safe recovery path.
- Run one baseline text-integrity scan, then block confirmed UTF-8 corruption on new or modified repository text using the existing local/candidate check path. Exclude binaries, avoid repeating whole-repository scans during routine development and review ambiguous multilingual content without destructive automatic repair.
- Material UI additions and changes preserve the canonical design foundation through structural checks and representative behavioral/rendered proof in the existing required integration checks. A failed applicable design check blocks merge; a written design rule alone is not enforcement.
- Use a small set of approved visual baselines where rendered stability has material value. Keep the browser/rendering environment reproducible, review intentional baseline changes with the affected behavior, and never update expected images automatically to hide a regression. Visual comparisons supplement interaction and canonical-readback proof rather than replacing them.
