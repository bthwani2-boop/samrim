"use client";

import { themes } from "@bthwani/design-system/theme";
import { ConfigProvider, theme as antTheme } from "antd";
import arEG from "antd/locale/ar_EG";
import { type ReactNode, useEffect, useState } from "react";

function browserTheme(): "light" | "dark" {
  const setting = document.documentElement.dataset.theme;
  if (setting === "light" || setting === "dark") return setting;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** One Ant Design boundary for Control Panel; the shared design system owns brand tokens. */
export function AntDesignProvider({ children, nonce }: Readonly<{ children: ReactNode; nonce?: string | undefined }>) {
  const [mode, setMode] = useState<"light" | "dark">("light");

  useEffect(() => {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => setMode(browserTheme());
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    preference.addEventListener("change", syncTheme);
    syncTheme();
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", syncTheme);
    };
  }, []);

  const colors = themes[mode];
  return (
    <ConfigProvider
      direction="rtl"
      locale={arEG}
      {...(nonce ? { csp: { nonce } } : {})}
      theme={{
        algorithm: mode === "dark" ? antTheme.darkAlgorithm : antTheme.defaultAlgorithm,
        token: {
          colorPrimary: colors.actionBackground,
          colorPrimaryHover: colors.actionHover,
          colorPrimaryActive: colors.actionPressed,
          colorTextLightSolid: colors.onAction,
          colorLink: colors.interactiveText,
          colorLinkHover: colors.actionHover,
          colorLinkActive: colors.actionPressed,
          colorText: colors.color,
          colorBgBase: colors.background,
          colorBgContainer: colors.surface,
          colorBorder: colors.borderColor,
          colorError: colors.danger,
          colorSuccess: colors.success,
          colorWarning: colors.warning,
          fontFamily: "var(--font-family-arabic)",
        },
      }}
    >
      {children}
    </ConfigProvider>
  );
}
