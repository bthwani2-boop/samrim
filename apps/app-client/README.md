# Client App

Customer-facing deployable application host.

## Current stage

This root is intentionally Foundation-only. It currently owns only the deployable shell, Expo/EAS/native identity, minimal routing/bootstrap, app assets, and build/runtime configuration required to prove the host can exist independently.

Business routes, DSH/WLT capabilities, Identity session semantics, and cross-capability composition are deferred until Stage B after the Foundation Construction and A2 gates pass.

The existing native dependency set is preserved during Foundation Construction where it is part of the already established development-build fingerprint; dependency reduction requires explicit deployable-identity/fingerprint evidence rather than incidental cleanup.
