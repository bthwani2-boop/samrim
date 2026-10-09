# Captured Yemen-Market App Evidence

DOCUMENT_CLASS: NONAUTHORITATIVE_EXTERNAL_REFERENCE
REFERENCE_CLASS: COMPETITOR_EVIDENCE_CACHE_INDEX
ADOPTION_AUTHORITY: NONE
REFERENCE_FRESHNESS: REVALIDATE_AT_USE
EXECUTION_AUTHORITY: NONE
PRODUCT_SEMANTIC_AUTHORITY: NONE
CURRENT_IMPLEMENTATION_AUTHORITY: NONE

These five files record bounded observations from installed competitor apps. Use them only as external evidence for a material decision; compare any relevant observation with pinned Governance and current BThwani implementation. They describe partial reviews, never BThwani requirements or current product guarantees. Revalidate app identity, version and relevant behavior at use. This folder is a small evidence cache, not a market inventory or Product authority.

- [Tawseel One](tawseel-one.md)
- [Tasaheel](tasaheel.md)
- [Etlobni](etlobni.md)
- [Nass](nass.md)
- [HungerStation](hungerstation.md)

Selected screenshots are kept beside these notes under `local-photos/` on the local development machine. The repository-root `.gitignore` explicitly excludes each of the five app-specific capture directories. The captures are not part of this repository's commits, pushes or pull requests. Markdown screenshot links resolve only on a machine that has those local captures.

## Shared black-box review method

Read the selected app's existing evidence file before live inspection. Reuse still-current evidence; inspect relevant, stale or missing areas only; replace stale current facts; append one concise Review history entry. Never create a parallel report.

`COMPETITOR OBSERVATION != BTHWANI REQUIREMENT`.

## Mandatory black-box review method
A review is not complete from screenshots or visual browsing alone. For each material journey/screen/workspace, use normal authorized interaction on the real app/device and cover the applicable dimensions:

```text
PRODUCT / UX
BEHAVIORAL REVERSE ANALYSIS
LOGIC / VISIBLE RULES
INTERACTION / CONTROL COVERAGE
EXPERIMENTAL PATH COVERAGE
VISUAL
TECHNICAL / PLATFORM OBSERVATION
PERFORMANCE / RESPONSIVENESS
FAILURE / RECOVERY
OPERATIONAL FLOW
```

For every relevant route/screen:

```text
ENTER RELEVANT TAB / ROUTE
→ TAP RELEVANT BUTTONS / CTAs / ICONS / ROWS / CARDS
→ EXERCISE MENUS / SHEETS / DIALOGS / FILTERS / SORT / SEARCH / SELECTORS / TOGGLES
→ TEST BACK / CLOSE / CANCEL / CONFIRM / RETRY / REFRESH / SCROLL / PAGINATION / CAROUSEL WHEN PRESENT
→ TRY SAFE ALTERNATIVE INPUTS / PATHS
→ OBSERVE STATE BEFORE / AFTER
→ RECORD RESULT / FAILURE / RECOVERY / PERFORMANCE
```

Every relevant control is either exercised or recorded as `NOT_TESTED_WITH_REASON`. Do not cross an irreversible, paid, destructive or externally consequential boundary without explicit authority.

Do not decompile binaries, bypass protections, intercept secrets, or present hidden implementation as fact. Classify conclusions as `OBSERVED`, `STRONGLY_INFERRED`, `HYPOTHESIS`, or `NOT_TESTED`.


