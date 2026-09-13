# Mobile Tooling

This directory owns cross-repository mobile automation and validation only.

App deployable identity is app-owned in:

`apps/<app>/mobile.config.json`

The tooling may derive Expo/Metro behavior from those app-owned facts. It must not become Product/capability ownership authority.

Current commands are designed for the existing installed Expo Development Builds. They do not run `eas build`, `expo prebuild`, `expo run:android`, or native dependency upgrades.

Before claiming an existing Development Build remains compatible after a cutover, compare native characteristics and resolved native configuration. JavaScript/TypeScript/path-only changes are not by themselves permission to claim native equivalence.


## Local development preparation

`pnpm mobile:prepare` performs local mobile preparation only: it validates the external Firebase, credential, Sentry and environment bindings and materializes ignored local binding maps. It does not require EAS authentication, remote build inventory, or a connected phone.

Use `pnpm mobile:prepare -- -Mode Eas` for authenticated EAS fingerprint/build compatibility discovery. Use `pnpm mobile:prepare -- -Mode InstallMatchingBuilds` only when downloading and installing matching existing development builds is the explicit device operation. Secret values remain external and are never copied into tracked source.
