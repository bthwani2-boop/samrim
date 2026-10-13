"use client";

import { useEffect, useEffectEvent } from "react";

// Entry and post-mutation reads stay with the feature. Returning never saves a draft.
export function useReadOnReturn(read: () => unknown, enabled = true) {
  const readCurrent = useEffectEvent(() => { if (enabled) { void read(); return true; } return false; });
  useEffect(() => {
    let lastRead = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastRead < 30_000) return;
      if (readCurrent()) lastRead = Date.now();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);
}
