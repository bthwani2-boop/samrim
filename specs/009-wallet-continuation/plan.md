# Plan — Native wallet and Identity cancellation

Follow [spec.md](spec.md) and canonical finance, identity, safety and engineering owners. Reconcile current code and existing proof first.

Trace apps/customer/src/features/wallet/wallet-screen.tsx through verified native wallet transport to Identity/WLT clients; existing customer-native-wallet-screen.test.mjs owns relevant regression. Reuse AbortController and read deadline. Release matching pending operation independently of transport settlement, clean timers, reject late responses with current actor/generation/expiry guards. Preserve prior valid expiry; no new cache/writer. Web remains compatible.

At services/identity/clients/transport.ts and actual tests, use one abort-aware boundary for fetch/header/body, preserving original signal, validation, rejection mapping and independent rotation acknowledgment. Never detach/replay possibly committed mutation or rotation. Observe late settlement and clean listeners; verify pre-abort, noncooperative header/body, successor, late rejection and uncertainty.

Apply native pre-edit evidence and whole-foundation disposition to reproduced faults. Run affected owner/consumer tests, uncached Nx/type/lint, real loopback transport and authorized Android/affected Web, actual owner readback and applicable privacy/finance assessment. No protected runtime, schema or monetary mutation. Exact Git/CI and runtime acceptance are separate.
