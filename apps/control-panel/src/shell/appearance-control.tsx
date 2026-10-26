"use client";

import { isThemePreference, type ThemePreference } from "@bthwani/design-system";
import { Alert, Segmented, Typography } from "antd";
import { useEffect, useState } from "react";

const STORAGE_KEY = "bthwani.control-panel.appearance";

function readPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isThemePreference(value) ? value : "system";
  } catch {
    return "system";
  }
}

function applyPreference(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.dataset.theme = preference;
}

export function AppearanceControl() {
  const [preference, setPreference] = useState<ThemePreference>(readPreference);
  const [error, setError] = useState("");

  useEffect(() => {
    applyPreference(preference);
    try {
      window.localStorage.setItem(STORAGE_KEY, preference);
      setError("");
    } catch {
      setError("تعذر حفظ المظهر على هذا المتصفح.");
    }
  }, [preference]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (preference === "system") applyPreference("system");
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, [preference]);

  return (
    <fieldset aria-label="المظهر">
      <legend><Typography.Text strong>المظهر</Typography.Text></legend>
      <Segmented<ThemePreference>
        block
        aria-label="اختيار المظهر"
        value={preference}
        onChange={setPreference}
        options={[
          { value: "system", label: "حسب النظام" },
          { value: "light", label: "فاتح" },
          { value: "dark", label: "داكن" },
        ]}
      />
      {error ? <Alert type="error" showIcon message={error} /> : null}
    </fieldset>
  );
}
