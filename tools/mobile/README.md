# Mobile Tooling

This directory owns cross-repository mobile automation and validation only.

App deployable identity is app-owned in:

`apps/<app>/mobile.config.json`

The tooling may derive Expo/Metro behavior from those app-owned facts. It must not become Product/capability ownership authority.

The repository-owned `mobile:prepare` and `mobile:build` commands are target-aware. They do not create a second capability registry or provider map.

Before claiming an existing Development Build remains compatible after a cutover, compare native characteristics and resolved native configuration. JavaScript/TypeScript/path-only changes are not by themselves permission to claim native equivalence.


## Local development preparation

`pnpm mobile:prepare -- --app app-client` validates only the selected app's external local signing inputs. It does not require EAS authentication, remote build inventory, a provider file, or a connected phone.

Use `pnpm mobile:prepare -- --app app-client -Mode Eas` for authenticated target-scoped EAS fingerprint/build compatibility discovery. Use `-Mode InstallMatchingBuilds` only when downloading and installing a matching existing development build is the explicit device operation.

Use `pnpm mobile:build -- --app app-captain` as the single remote Android development-build owner. It verifies the exact upstream candidate, app-owned EAS CLI/project binding, native fingerprint, and matching finished/pending builds before any submission. Reused-build output reports the current candidate separately from the reused build's actual source SHA. Local signing material is materialized temporarily and removed in a finally block.
