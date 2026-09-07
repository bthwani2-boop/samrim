# Mobile Tooling

This directory owns cross-repository mobile automation and validation only.

App deployable identity is app-owned in:

`apps/<app>/mobile.config.json`

The tooling may derive Expo/Metro behavior from those app-owned facts. It must not become Product/capability ownership authority.

Current commands are designed for the existing installed Expo Development Builds. They do not run `eas build`, `expo prebuild`, `expo run:android`, or native dependency upgrades.

Before claiming an existing Development Build remains compatible after a cutover, compare native characteristics and resolved native configuration. JavaScript/TypeScript/path-only changes are not by themselves permission to claim native equivalence.
