"use client";

import { createContext, type KeyboardEvent, type PointerEvent, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";

type RecordView = Readonly<{ expanded: boolean; canExpand: boolean; toggleExpanded: () => void; expandForEditing: () => void }>;
const ViewContext = createContext<RecordView | null>(null);
export function useAdaptiveRecordView() { return useContext(ViewContext); }
const minimumListWidth = 510;
const minimumDetailWidth = 440;

export function AdaptiveRecordWorkspace({ children, detail, open, preferenceKey, triggerKey, onClose }: Readonly<{
  children: ReactNode; detail: ReactNode; open: boolean; preferenceKey: string; triggerKey?: string; onClose?: () => void;
}>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const triggerKeyRef = useRef(triggerKey);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) {
      triggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (open && triggerKey) triggerKeyRef.current = triggerKey;
    const justClosed = !open && wasOpen.current;
    wasOpen.current = open;
    if (!justClosed) return;
    const frame = requestAnimationFrame(() => {
      const original = triggerRef.current;
      const visible = (element: HTMLElement | null): element is HTMLElement => Boolean(element?.isConnected
        && element.getClientRects().length && !element.closest('[hidden],[inert]'));
      if (visible(original) && original.tagName !== "BODY") {
        original.focus({ preventScroll: true });
        return;
      }
      const key = original?.dataset.adaptiveRecordTrigger ?? triggerKeyRef.current;
      if (!key) return;
      const equivalent = Array.from(document.querySelectorAll<HTMLElement>("[data-adaptive-record-trigger]"))
        .find((element) => element.dataset.adaptiveRecordTrigger === key && visible(element));
      equivalent?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [open, triggerKey]);
  useEffect(() => {
    if (!open || !onClose) return;
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented ||
        (event.target instanceof Element && event.target.closest("dialog[open]"))) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);
  const [available, setAvailable] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [ratio, setRatio] = useState(40);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`bthwani-record-view:${preferenceKey}`);
      if (!saved) return;
      const preference = JSON.parse(saved) as { mode?: string; ratio?: number; expanded?: boolean };
      setExpanded(preference.expanded === true || preference.mode === "full");
      if (typeof preference.ratio === "number" && Number.isFinite(preference.ratio)) setRatio(Math.round(Math.min(60, Math.max(30, preference.ratio)) / 5) * 5);
    } catch { /* view preference is optional */ }
  }, [preferenceKey]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setAvailable(node.getBoundingClientRect().width));
    observer.observe(node);
    setAvailable(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  const saveView = useCallback((nextExpanded: boolean, nextRatio: number) => {
    try {
      window.localStorage.setItem(`bthwani-record-view:${preferenceKey}`, JSON.stringify({ expanded: nextExpanded, ratio: nextRatio }));
    } catch { /* optional local setting */ }
  }, [preferenceKey]);

  const toggleExpanded = useCallback(() => {
    setExpanded((previous) => {
      saveView(!previous, ratio);
      return !previous;
    });
  }, [ratio, saveView]);

  const expandForEditing = useCallback(() => setExpanded(true), []);
  const split = open && available >= minimumListWidth + minimumDetailWidth + 8 && !expanded;
  const maximumPanelWidth = available - minimumListWidth - 8;
  const minimumPanelWidth = Math.min(maximumPanelWidth, Math.max(minimumDetailWidth, Math.round(available * 0.3)));
  const preferredMaximumPanelWidth = Math.min(maximumPanelWidth, Math.round(available * 0.6));
  const panelWidth = split ? Math.max(minimumDetailWidth, Math.min(Math.round(available * ratio / 100), maximumPanelWidth)) : 0;
  const minimumRatio = available > 0 ? Math.round(minimumPanelWidth / available * 100) : 30;
  const maximumRatio = available > 0 ? Math.round(preferredMaximumPanelWidth / available * 100) : 60;

  const setPanelRatio = (next: number) => {
    const safe = Math.round(Math.min(60, Math.max(30, next)) / 5) * 5;
    setRatio(safe);
    saveView(false, safe);
  };

  const drag = (event: PointerEvent<HTMLHRElement>) => {
    if (!rootRef.current || !split) return;
    const rect = rootRef.current.getBoundingClientRect();
    setPanelRatio((event.clientX - rect.left) / rect.width * 100);
  };

  const keyResize = (event: KeyboardEvent<HTMLHRElement>) => {
    if (!split) return;
    const width = panelWidth / available * 100;
    const next = event.key === "ArrowLeft" ? width - 3 : event.key === "ArrowRight" ? width + 3 :
      event.key === "Home" ? 30 : event.key === "End" ? 60 : null;
    if (next === null) return;
    event.preventDefault();
    setPanelRatio(next);
  };

  return <div ref={rootRef} className="adaptive-record-workspace" data-open={open} data-split={split} data-full={expanded} data-detail-width={ratio}>
    <div className="adaptive-record-registry">{children}</div>
    {open ? <>
      {split ? <hr className="adaptive-record-resizer" tabIndex={0}
        aria-label="تغيير عرض ملف السجل" aria-orientation="vertical"
        aria-valuemin={minimumRatio}
        aria-valuemax={maximumRatio}
        aria-valuenow={Math.round(panelWidth / available * 100)}
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); drag(event); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event); }}
        onKeyDown={keyResize} title="اسحب لتغيير عرض الملف أو استخدم أسهم لوحة المفاتيح" /> : null}
      <ViewContext.Provider value={{ expanded, canExpand: available >= minimumListWidth + minimumDetailWidth + 8, toggleExpanded, expandForEditing }}>
        <div className="adaptive-record-detail">{detail}</div>
      </ViewContext.Provider>
    </> : null}
  </div>;
}

export function AdaptiveRecordPanel({ title, subtitle, children, actions, onClose, onPrevious, onNext }: Readonly<{
  title: string; subtitle?: string; children: ReactNode; actions?: ReactNode;
  onClose: () => void; onPrevious?: (() => void) | undefined; onNext?: (() => void) | undefined;
}>) {
  const view = useContext(ViewContext);
  return <section className="adaptive-record-sheet" aria-label={title} onKeyDown={(event) => {
    if (event.key === "Escape" && !(event.target instanceof HTMLElement && event.target.closest("dialog[open]"))) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  }}>
    <header className="workspace-side-drawer-header">
      <div className="workspace-side-drawer-heading">
        <strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}
      </div>
      <div className="workspace-side-drawer-controls">
        {(onPrevious || onNext) ? <>
          <button type="button" className="workspace-side-icon" disabled={!onPrevious} onClick={onPrevious} aria-label="السجل السابق" title="السجل السابق">›</button>
          <button type="button" className="workspace-side-icon" disabled={!onNext} onClick={onNext} aria-label="السجل التالي" title="السجل التالي">‹</button>
        </> : null}
        {view?.canExpand ? <button type="button" className="workspace-side-icon adaptive-record-expand" onClick={view.toggleExpanded}
          aria-label={view.expanded ? "استعادة عرض القائمة والملف" : "توسيع ملف السجل"} title={view.expanded ? "استعادة القائمة" : "توسيع الملف"}>
          <span aria-hidden="true">{view.expanded ? "⤡" : "⤢"}</span>
        </button> : null}
        <button type="button" className="workspace-side-icon" onClick={onClose} aria-label="إغلاق التفاصيل" title="العودة إلى القائمة">×</button>
      </div>
    </header>
    <div className="workspace-side-drawer-scroll">{children}</div>
    {actions ? <footer className="workspace-side-drawer-actions">{actions}</footer> : null}
  </section>;
}
