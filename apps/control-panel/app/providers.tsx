"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ConfigProvider, Segmented, theme as antTheme } from "antd";
import arEG from "antd/locale/ar_EG";
import { themes } from "@bthwani/design-system/theme";

export type AppearancePreference = "system" | "light" | "dark";
export function Providers({ children }: Readonly<{ children: ReactNode }>) {
  const [pref, setPref] = useState<AppearancePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
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
          onChange={value => setPref(value as AppearancePreference)}
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
