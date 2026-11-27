# Implementation plan — Accessible mobile appearance selection

Derived from [spec.md](spec.md) and [experience governance](../../governance/experience.md). Apply the current execution entry and original Spec Kit integration.

## Owner and consumers

The shared renderer component at packages/tamagui-config/src/appearance-preferences.tsx consumes the existing useMobileAppearance controller. Customer account, Merchant workspace and Captain account use its public export. Do not recreate per-app radio controls, storage writers or themes. Keep actual authorization and renderer boundaries unchanged.

## Implementation and verification

1. Reconcile the shared control, all three consumers, controller/persistence tests and the actual pinned React Native Web mapping. Preserve Arabic accessible names, native checked/disabled state and semantic theme tokens.
2. Verify keyboard arrows, roving tab stop, selected state, restore/pending/failure/retry, focus restoration and race handling. Preserve writer serialization and reject duplicate/stale writes. Apply whole-foundation disposition for reproduced defects.
3. Use existing packages/tamagui-config/tools/appearance-preferences.test.mjs and appearance.test.mjs, affected app reachability tests and uncached type/lint checks. Check actual Chrome keyboard and reload and authorized Android accessibility and persistence independently.
4. Verify exact graph/source, Git delivery and mandatory CI according to [AGENTS.md](../../AGENTS.md). Missing evidence remains open in the authorized work source; no second tracking register or inferred journey acceptance.
