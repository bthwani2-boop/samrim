"use client";

import { isThemePreference, type ThemePreference } from "@bthwani/design-system";
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
  if (preference === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.dataset.theme = preference;
  }
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
    <fieldset className="appearance-control" aria-describedby={error ? "appearance-error" : undefined}>
      <legend>المظهر</legend>
      <div className="appearance-options">
        {[
          ["system", "حسب النظام"],
          ["light", "فاتح"],
          ["dark", "داكن"],
        ].map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="appearance"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value as ThemePreference)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      {error ? <small id="appearance-error" role="alert">{error}</small> : null}
    </fieldset>
  );
}
