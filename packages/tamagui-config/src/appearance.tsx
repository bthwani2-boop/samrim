import {
  isThemePreference,
  resolveTheme,
  resolveThemeName,
  type ThemeColors,
  type ThemeName,
  type ThemePreference,
} from "@bthwani/design-system/theme";
import * as React from "react";
import { Appearance, Platform } from "react-native";
import { TamaguiProvider, Theme } from "tamagui";
import { tamaguiConfig } from "./index";

// The controller awaits reads and serializes writes. Platform storage adapters
// may be synchronous or asynchronous; neither owns a second promise boundary.
export type AppearanceStorage = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
};

const webStorage: AppearanceStorage = {
  getItem(key) {
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
  },
};

export type MobileAppearanceSnapshot = {
  preference: ThemePreference;
  themeName: ThemeName;
  theme: ThemeColors;
  ready: boolean;
};

export type MobileAppearanceController = ReturnType<typeof createMobileAppearanceController>;

// One controller owns one app-scoped preference. Construction is render-safe;
// only a mounted provider may subscribe to or mutate native appearance.
export function createMobileAppearanceController({ storage, key }: { storage: AppearanceStorage; key: string }) {
  let systemScheme = Appearance.getColorScheme();
  const listeners = new Set<() => void>();
  const snapshotFor = (preference: ThemePreference, ready: boolean): MobileAppearanceSnapshot => {
    const themeName = resolveThemeName(preference, systemScheme);
    return { preference, themeName, theme: resolveTheme(themeName), ready };
  };
  let snapshot = snapshotFor("system", false);
  let confirmedPreference: ThemePreference = "system";
  let mounted: object | undefined;
  let initialRead: Promise<ThemePreference> | undefined;
  let revision = 0;
  let writeTail: Promise<void> = Promise.resolve();
  let pendingWrite: Promise<void> | undefined;

  const publish = (preference: ThemePreference, ready: boolean, applyNative = false) => {
    snapshot = snapshotFor(preference, ready);
    if (!mounted) return;
    if (applyNative) {
      Appearance.setColorScheme?.(preference === "system" ? "unspecified" : preference);
    }
    for (const listener of listeners) listener();
  };

  async function readPreference(): Promise<ThemePreference> {
    try {
      const stored = await storage.getItem(key);
      return isThemePreference(stored) ? stored : "system";
    } catch {
      // Unavailable storage must not prevent initial rendering.
      return "system";
    }
  }

  async function restore() {
    if (!mounted || snapshot.ready) return;
    // React effect replay shares the original read, including a failed read.
    // A user intent marks the snapshot ready before persistence begins.
    initialRead ??= readPreference();
    const preference = await initialRead;
    if (!mounted || snapshot.ready) return;
    confirmedPreference = preference;
    publish(preference, true, true);
  }

  async function setPreference(preference: ThemePreference) {
    if (!mounted) throw new Error("Appearance controller not mounted");
    if (!isThemePreference(preference)) throw new Error("Invalid theme preference");
    if (snapshot.ready && snapshot.preference === preference) return pendingWrite;

    const intent = ++revision;
    const write = writeTail.then(() => storage.setItem(key, preference));
    writeTail = write.then(
      () => undefined,
      () => undefined,
    );
    pendingWrite = write;
    publish(preference, true, true);
    try {
      await write;
      confirmedPreference = preference;
    } catch (error) {
      if (pendingWrite === write) pendingWrite = undefined;
      if (intent === revision) publish(confirmedPreference, true, true);
      throw error;
    } finally {
      if (pendingWrite === write) pendingWrite = undefined;
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    mount() {
      if (mounted) throw new Error("Appearance controller already mounted");
      const lease = {};
      mounted = lease;
      systemScheme = Appearance.getColorScheme();
      const subscription = Appearance.addChangeListener(({ colorScheme }) => {
        if (mounted !== lease) return;
        systemScheme = colorScheme;
        if (snapshot.preference === "system") publish("system", snapshot.ready);
      });
      // On remount, reapply the current intent rather than rereading storage.
      publish(snapshot.preference, snapshot.ready, snapshot.ready);
      return () => {
        if (mounted !== lease) return;
        mounted = undefined;
        subscription.remove();
      };
    },
    restore,
    setPreference,
  };
}

function useAppearanceController(
  key: string,
  nativeGetItem: AppearanceStorage["getItem"],
  nativeSetItem: AppearanceStorage["setItem"],
): MobileAppearanceController {
  const storage = React.useMemo<AppearanceStorage>(
    () => Platform.OS === "web" ? webStorage : { getItem: nativeGetItem, setItem: nativeSetItem },
    [nativeGetItem, nativeSetItem],
  );
  return React.useMemo(() => createMobileAppearanceController({ storage, key }), [key, storage]);
}

const AppearanceContext = React.createContext<MobileAppearanceController | null>(null);

// A stable server snapshot makes SSR and the initial hydration render agree.
const serverAppearance: MobileAppearanceSnapshot = {
  preference: "system",
  themeName: "light",
  theme: resolveTheme("light"),
  ready: false,
};
const getServerAppearance = () => serverAppearance;

export function AppearanceProvider({ controller, children }: { controller: MobileAppearanceController; children: React.ReactNode }) {
  React.useEffect(() => {
    const unmount = controller.mount();
    void controller.restore();
    return unmount;
  }, [controller]);
  return <AppearanceContext.Provider value={controller}>{children}</AppearanceContext.Provider>;
}

export function useMobileAppearance(): MobileAppearanceSnapshot & {
  setPreference(preference: ThemePreference): Promise<void>;
} {
  const controller = React.useContext(AppearanceContext);
  if (!controller) throw new Error("AppearanceProvider required");
  return {
    ...React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, getServerAppearance),
    setPreference: controller.setPreference,
  };
}

export function MobileThemeProvider({ children }: { children: React.ReactNode }) {
  const { themeName } = useMobileAppearance();
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme={themeName}>
      <Theme name={themeName}>{children}</Theme>
    </TamaguiProvider>
  );
}

// The renderer owns appearance only; apps retain their route trees and keys.
export function createMobileAppearanceRoot(
  key: string,
  nativeGetItem: AppearanceStorage["getItem"],
  nativeSetItem: AppearanceStorage["setItem"],
  renderRoutes: (background: string) => React.ReactNode,
) {
  function Routes() {
    const { theme } = useMobileAppearance();
    return <MobileThemeProvider>{renderRoutes(theme.background)}</MobileThemeProvider>;
  }
  return function RootLayout() {
    const controller = useAppearanceController(key, nativeGetItem, nativeSetItem);
    return (
      <AppearanceProvider controller={controller}>
        <Routes />
      </AppearanceProvider>
    );
  };
}
