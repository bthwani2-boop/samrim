"use client";
import type { ReactNode } from "react";


type Tab<T extends string> = Readonly<{ key: T; label: ReactNode }>;
export function RecordTabs<T extends string>({ tabs, active, onSelect, id, panelId, ariaLabel = "أقسام الملف", className }: Readonly<{
  tabs: readonly Tab<T>[];
  active: T;
  onSelect: (tab: T) => void;
  id: string;
  panelId?: string;
  ariaLabel?: string;
  className?: string;
}>) {
  return <div className={["bt-record-tabs-tabs", className].filter(Boolean).join(" ")} role="tablist" aria-label={ariaLabel}>{tabs.map((tab, index) => <button key={tab.key} type="button" role="tab"
    id={`${id}-tab-${tab.key}`} aria-controls={panelId ?? `${id}-panel-${tab.key}`} aria-selected={tab.key === active} tabIndex={tab.key === active ? 0 : -1}
    onClick={() => onSelect(tab.key)} onKeyDown={(event) => {
      const step = event.key === "ArrowRight" ? -1 : event.key === "ArrowLeft" ? 1 : 0;
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : step ? (index + step + tabs.length) % tabs.length : -1;
      if (next < 0) return;
      event.preventDefault(); onSelect(tabs[next]!.key);
      document.getElementById(`${id}-tab-${tabs[next]!.key}`)?.focus();
    }}>{tab.label}</button>)}</div>;
}
export function RecordTabPanel({ id, tab, active, children }: Readonly<{ id: string; tab: string; active: boolean; children: ReactNode }>) {
  return <section role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`} hidden={!active} className={"bt-record-tabs-panel"}>{children}</section>;
}
