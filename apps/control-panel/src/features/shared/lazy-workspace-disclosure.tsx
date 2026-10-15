"use client";

import { useState, type ReactNode } from "react";

// One disclosure behavior for all work centers: load expensive work on first
// expansion and retain the editor component after collapse to preserve drafts.
export function LazyWorkspaceDisclosure({ name, description, children, initiallyOpen = false, className = "" }: Readonly<{
  name: string;
  description: string;
  children: ReactNode;
  initiallyOpen?: boolean;
  className?: string;
}>) {
  const [visited, setVisited] = useState(initiallyOpen);
  const [expanded, setExpanded] = useState(initiallyOpen);
  return <details className={["policy-center-disclosure", className].filter(Boolean).join(" ")}
    open={expanded}
    onToggle={(event) => {
      const isOpen = event.currentTarget.open;
      setExpanded(isOpen);
      if (isOpen) setVisited(true);
    }}>
    <summary>
      <span className="policy-center-disclosure-title">{name}</span>
      <span className="muted">{description}</span>
    </summary>
    {visited ? <div className="policy-center-disclosure-body">{children}</div> : null}
  </details>;
}
