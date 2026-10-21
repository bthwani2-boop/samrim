"use client";

import { type ReactNode, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * All-results options delegate to the server owner; page-only options must
 * announce their bounded scope. Popovers are portaled outside table scrollers.
 */
export function RegistryColumnHeader({
  label, children, active = false, scope = "results",
}: Readonly<{ label: string; children?: ReactNode; active?: boolean; scope?: "results" | "page" }>) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  const reposition = useCallback(() => {
    const rect = detailsRef.current?.getBoundingClientRect();
    if (!rect) return;
    const popupWidth = Math.min(270, window.innerWidth - 16);
    const right = Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - popupWidth - 8));
    const top = rect.bottom + 6 <= window.innerHeight - 205 ? rect.bottom + 6 : Math.max(8, rect.top - 230);
    setPosition({ top, right });
  }, []);

  useEffect(() => {
    const closeOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== popoverId && detailsRef.current?.open) detailsRef.current.open = false;
    };
    window.addEventListener("registry-column-open", closeOther);
    return () => window.removeEventListener("registry-column-open", closeOther);
  }, [popoverId]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      if (detailsRef.current?.contains(node) || popoverRef.current?.contains(node)) return;
      if (detailsRef.current) detailsRef.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (detailsRef.current) detailsRef.current.open = false;
      detailsRef.current?.querySelector("summary")?.focus();
      event.stopPropagation();
    };
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("keydown", escape, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", escape, true);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, reposition]);

  if (!children) return <th scope="col">{label}</th>;
  return <th scope="col" className="registry-column-head">
    <details ref={detailsRef} className="registry-column-details" data-active={active ? "true" : undefined}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open) {
          window.dispatchEvent(new CustomEvent("registry-column-open", { detail: popoverId }));
          reposition();
        }
      }}>
      <summary aria-controls={popoverId} title={"بحث أو تصفية أو ترتيب: " + label}>
        <span>{label}</span>
        <span className="registry-column-arrow" aria-hidden="true">⌄</span>
        {active ? <span className="registry-column-active-mark" aria-hidden="true">•</span> : null}
      </summary>
    </details>
    {open && position ? createPortal(
      <div id={popoverId} ref={popoverRef} role="group" aria-label={"تصفية " + label}
        className="registry-column-popover" dir="rtl"
        style={{ top: position.top, right: position.right }}>
        <div className="registry-column-controls">
          <div className="registry-column-popover-heading">
            <strong>{label}</strong>
            <button type="button" aria-label={"إغلاق تصفية " + label}
              onClick={() => { if (detailsRef.current) detailsRef.current.open = false; detailsRef.current?.querySelector("summary")?.focus(); }}>إغلاق</button>
          </div>
          <small>{scope === "page" ? "الصفحة الحالية فقط" : "كل النتائج المطابقة"}</small>
          {children}
        </div>
      </div>,
      document.body
    ) : null}
  </th>;
}
