"use client";

import { useState } from "react";
import { OperationalIcon, type OperationalIconName } from "../../shell/workspace-icon";

export function RecordIndicator({ icon, label, tone = "neutral", legend = false }: Readonly<{
  icon: OperationalIconName; label: string; tone?: "neutral" | "success" | "warning"; legend?: boolean;
}>) {
  const [dismissed, setDismissed] = useState(false);
  return <span className="record-indicator" data-tone={tone} data-legend={legend || undefined}>
    <span className="record-indicator-symbol" role="img" aria-label={legend ? undefined : label} aria-hidden={legend || undefined} tabIndex={legend ? undefined : 0} onFocus={() => setDismissed(false)} onMouseEnter={() => setDismissed(false)} onKeyDown={(event) => { if (event.key === "Escape" && !legend && !dismissed) { event.stopPropagation(); setDismissed(true); } }}>
      <OperationalIcon name={icon} />
      {!legend && !dismissed ? <span className="record-indicator-tooltip" aria-hidden="true">{label}</span> : null}
    </span>
    {legend ? <span>{label}</span> : null}
  </span>;
}

export function ActivityIndicator({ active, activeLabel = "نشط", inactiveLabel = "متوقف" }: Readonly<{ active: boolean; activeLabel?: string; inactiveLabel?: string }>) {
  return <RecordIndicator icon={active ? "active" : "paused"} label={active ? activeLabel : inactiveLabel} tone={active ? "success" : "warning"} />;
}

export function ActivityLegend({ activeLabel = "نشط", inactiveLabel = "متوقف" }: Readonly<{ activeLabel?: string; inactiveLabel?: string }>) {
  return <aside className="record-legend" aria-label="دليل رموز الحالة"><div><RecordIndicator legend icon="active" label={activeLabel} tone="success" /><RecordIndicator legend icon="paused" label={inactiveLabel} tone="warning" /></div></aside>;
}
