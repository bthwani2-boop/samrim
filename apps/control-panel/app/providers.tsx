"use client";
import { themes } from "@bthwani/design-system/theme";
import { theme as antTheme, ConfigProvider, Segmented } from "antd";
import arEG from "antd/locale/ar_EG";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

export type AppearancePreference = "system" | "light" | "dark";
type AppearanceContextValue = {
  preference: AppearancePreference;
  onChange: (value: AppearancePreference) => void;
};

const AppearanceContext = createContext<AppearanceContextValue | null>(null);
const preferenceKey = (actorId: string) => `bthwani.stage4.operator.theme:${actorId}`;
const isPreference = (value: string | null): value is AppearancePreference =>
  value === "system" || value === "light" || value === "dark";

// The shell displays the existing preference writer; it must not create another one.
export function OperatorAppearanceControl() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) return null;
  return (
    <Segmented
      aria-label="اختيار المظهر"
      value={appearance.preference}
      onChange={value => appearance.onChange(value as AppearancePreference)}
      options={[
        { label: "النظام", value: "system" },
        { label: "فاتح", value: "light" },
        { label: "داكن", value: "dark" },
      ]}
    />
  );
}

export function Providers({ children, cspNonce, operatorActorId }: Readonly<{
  children: ReactNode;
  cspNonce: string;
  operatorActorId: string | null;
}>) {
  const [storedPreference, setStoredPreference] = useState<{ actorId: string | null; value: AppearancePreference }>({
    actorId: operatorActorId, value: operatorActorId ? "light" : "system",
  });
  // An actor change cannot project another actor's stale visual preference.
  const pref = storedPreference.actorId === operatorActorId ? storedPreference.value : (operatorActorId ? "light" : "system");
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    if (!operatorActorId) {
      setStoredPreference({ actorId: null, value: "system" });
      return;
    }
    try {
      const stored = window.localStorage.getItem(preferenceKey(operatorActorId));
      setStoredPreference({ actorId: operatorActorId, value: isPreference(stored) ? stored : "light" });
    } catch {
      // Keep the system default when browser storage is unavailable.
      setStoredPreference({ actorId: operatorActorId, value: "light" });
    }
  }, [operatorActorId]);
  const selectPreference = (value: AppearancePreference) => {
    if (!operatorActorId) return;
    setStoredPreference({ actorId: operatorActorId, value });
    try {
      window.localStorage.setItem(preferenceKey(operatorActorId), value);
    } catch {
      // Persisting a visual preference must never block Operator rendering.
    }
  };
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const dark = pref === "dark" || (pref === "system" && systemDark);
  const colors = dark ? themes.dark : themes.light;
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  return <ConfigProvider direction="rtl" locale={arEG} csp={{ nonce: cspNonce }} theme={{
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: { colorPrimary: colors.actionBackground, colorText: colors.color, colorBgBase: colors.background, colorBorder: colors.borderColor },
  }}>
    <AppearanceContext.Provider value={{ preference: pref, onChange: selectPreference }}>
      <section data-theme-preference={pref} style={{
        minHeight: "100dvh", background: "var(--surface-warm)", color: "var(--color-primary)", fontFamily: "system-ui",
      }}>
        {children}
      </section>
    </AppearanceContext.Provider>
  </ConfigProvider>;
}
