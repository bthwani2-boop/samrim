# Mobile Tooling

This directory owns cross-repository mobile automation and validation only.

App deployable identity is app-owned in:

`apps/<app>/mobile.config.json`

The tooling may derive Expo/Metro behavior from those app-owned facts. It must not become Product/capability ownership authority.

The repository-owned `mobile:prepare` and `mobile:build` commands are target-aware. They do not create a second capability registry or provider map.

Development builds must not bake a localhost Metro target or app-specific development-server port into native config. The daily `pnpm client|partner|captain|field` command supplies the current launch URL through Expo CLI, while app-owned native configuration stays independent of the developer machine's Metro port.

Each app keeps Expo's automatic resolver/watch-folder behavior but uses an app-scoped Metro cache namespace instead of SDK57's shared `%TEMP%\\metro-cache`, so a later Fast Refresh/request cannot reuse another app's route graph.

Before claiming an existing Development Build remains compatible after a cutover, compare native characteristics and resolved native configuration. JavaScript/TypeScript/path-only changes are not by themselves permission to claim native equivalence.


## Local development preparation

`pnpm mobile:prepare -- --app app-client` validates only the selected app's external local signing inputs. It does not require EAS authentication, remote build inventory, a provider file, or a connected phone.

Use `pnpm mobile:prepare -- --app app-client -Mode Eas` for authenticated target-scoped EAS fingerprint/build compatibility discovery. Use `-Mode InstallMatchingBuilds` only when downloading and installing a matching existing development build is the explicit device operation.

Use `pnpm mobile:build -- --app app-captain` to check the selected app and discover a compatible finished/pending build. It does not submit a new build by default. Add `-Submit` only when a new remote Android development build for that app is intended. A compatible finished/pending build is reused even with `-Submit`. The command requires a clean committed candidate, checks the frozen lockfile and native dependencies locally, then checks app-owned EAS CLI/project binding and the native fingerprint. Reused-build output reports the current candidate separately from the reused build's actual source SHA. Before materialization, both repository destinations must be absent; each file is owned from its create operation and removed on every later failure or normal exit. Pre-existing repository material is never overwritten.

## Dependency changes

Normal `pnpm install`, CI and EAS installation use the committed lockfile without updating it. External direct dependencies use exact versions; compatible peer ranges describe requirements without choosing or upgrading a version. To intentionally update a dependency, edit the exact version in its owning package, run `pnpm install --no-frozen-lockfile`, review the manifest/lockfile diff and run `pnpm mobile:verify-config`. Do not broadly update or deduplicate the workspace as part of building one app.

Each app owns its native Expo UI dependency. The design system declares it as an optional peer for native consumers and keeps its own development dependency for type checking. Its development dependency is not part of a consuming app's native graph. Expo's standard monorepo autolinking resolution makes Metro use the same native package selected for that app's build. The launcher preserves workspace resolution and Expo's normal network behavior. Forcing `EXPO_OFFLINE=1` aborts manifest-schema requests when the Expo cache is absent; explicitly offline work can use that environment variable, but daily startup must not force it.

The existing verifier checks exact dependency versions and conflicting native versions. pnpm can keep multiple physical installations of the same version for different peer contexts; Expo's standard resolver maps these to the app's canonical native installation. Daily mobile startup, the remote build command and EAS's post-install hook all call this same verifier. `node tools/mobile/verify-mobile-config.mjs --app app-partner` checks native dependencies for only the selected app; the default checks all mobile apps. Shared native changes require checking every affected app; each app can be built separately when its installed development client needs updating. JavaScript changes alone do not submit remote builds.
