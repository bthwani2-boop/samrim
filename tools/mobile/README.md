# Mobile Tooling

This directory owns cross-repository mobile automation and validation only.

App deployable identity is app-owned in:

`apps/<app>/mobile.config.json`

The tooling may derive Expo/Metro behavior from those app-owned facts. It must not become Product/capability ownership authority.

The repository-owned `mobile:prepare` and `mobile:build` commands are target-aware. They do not create a second capability registry or provider map.

Before claiming an existing Development Build remains compatible after a cutover, compare native characteristics and resolved native configuration. JavaScript/TypeScript/path-only changes are not by themselves permission to claim native equivalence.


## Local development preparation

`pnpm mobile:prepare -- --app app-client` validates only the selected app's external Firebase and local signing inputs. It does not require EAS authentication, remote build inventory, or a connected phone. Firebase is passed through the canonical `GOOGLE_SERVICES_JSON` environment binding; no repository-local mapping file is created.

Use `pnpm mobile:prepare -- --app app-client -Mode Eas` for authenticated target-scoped EAS fingerprint/build compatibility discovery. Use `-Mode InstallMatchingBuilds` only when downloading and installing a matching existing development build is the explicit device operation.

Use `pnpm mobile:build -- --app app-captain` as the single remote Android development-build owner. It verifies the exact pushed candidate, EAS project binding, development File environment variable, fingerprint, and matching finished/pending builds before any submission. The installed EAS CLI exposes Android credentials only through an interactive command, so automated FCM V1 credential readback is explicitly reported as unsupported and remains a push-delivery concern rather than a build gate. Local signing material is materialized temporarily and removed in a finally block.
