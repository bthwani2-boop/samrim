"use client";
import { themes } from "@bthwani/design-system/theme";
import { theme as antTheme, ConfigProvider, Segmented } from "antd";
import arEG from "antd/locale/ar_EG";
import { type ReactNode, useEffect, useState } from "react";

export type AppearancePreference = "system" | "light" | "dark";
const previewPreferenceKey = "bthwani.stage4.operator.theme";
const isPreference = (value: string | null): value is AppearancePreference =>
  value === "system" || value === "light" || value === "dark";

export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [pref, setPref] = useState<AppearancePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(previewPreferenceKey);
      if (isPreference(stored)) setPref(stored);
    } catch {
      // Keep the system default when browser storage is unavailable.
    }
  }, []);
  const selectPreference = (value: AppearancePreference) => {
    setPref(value);
    try {
      window.localStorage.setItem(previewPreferenceKey, value);
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
  return <ConfigProvider direction="rtl" locale={arEG} theme={{
    algorithm: dark ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
    token: { colorPrimary: colors.actionBackground, colorText: colors.color, colorBgBase: colors.background, colorBorder: colors.borderColor },
  }}>
    <section data-theme-preference={pref} style={{ minHeight: "100vh", background: colors.background, color: colors.color, padding: 24, fontFamily: "system-ui" }}>
      <nav aria-label="خيارات المظهر" style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
        <Segmented
          aria-label="اختيار المظهر"
          value={pref}
          onChange={value => selectPreference(value as AppearancePreference)}
          options={[
            { label: "النظام", value: "system" },
            { label: "فاتح", value: "light" },
            { label: "داكن", value: "dark" },
          ]}
        />
      </nav>
      {children}
    </section>
  </ConfigProvider>;
}
