"use client";

import {
  parseStudioThemePublication, resolveStudioTheme, themeToCssVariables,
  type StudioPalette,
} from "@bthwani/design-system/theme";
import { ConfigProvider, theme as antTheme } from "antd";
import arEG from "antd/locale/ar_EG";
import { type ReactNode, useEffect, useMemo, useState } from "react";

function browserTheme(): "light" | "dark" {
  const setting = document.documentElement.dataset.theme;
  if (setting === "light" || setting === "dark") return setting;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * The public DSH publication is for every actor; only its operator mutation
 * requires marketing permission. Invalid or unavailable data never changes
 * the compiled design-system defaults.
 */
function usePublishedPalette(): StudioPalette | null {
  const [palette, setPalette] = useState<StudioPalette | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let requestVersion = 0;
    const refresh = () => {
      const currentVersion = ++requestVersion;
      void fetch("/api/appearance/studio-theme", {
        cache: "no-store",
        signal: controller.signal,
      }).then((response) => {
        if (!response.ok) throw new Error("PUBLIC_STUDIO_THEME_UNAVAILABLE");
        return response.json() as Promise<unknown>;
      }).then((value) => {
        if (controller.signal.aborted || currentVersion !== requestVersion) return;
        const publication = parseStudioThemePublication(value);
        setPalette(publication?.palette ?? null);
      }).catch(() => {
        // Keep the last valid publication, or compiled defaults on first load.
      });
    };
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      requestVersion += 1;
      controller.abort();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  return palette;
}

/** One Ant Design boundary; canonical tokens drive CSS and component colors. */
export function AntDesignProvider({ children, nonce }: Readonly<{ children: ReactNode; nonce?: string | undefined }>) {
  const [mode, setMode] = useState<"light" | "dark">("light");
  const palette = usePublishedPalette();

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

  const colors = useMemo(() => resolveStudioTheme(mode, palette), [mode, palette]);
  useEffect(() => {
    if (!palette) return;
    const root = document.documentElement;
    const variables = Object.entries(themeToCssVariables(colors));
    for (const [name, value] of variables) root.style.setProperty(name, value);
    return () => {
      for (const [name] of variables) root.style.removeProperty(name);
    };
  }, [colors, palette]);

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
