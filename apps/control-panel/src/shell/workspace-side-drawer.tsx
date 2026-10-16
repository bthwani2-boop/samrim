"use client";

import { type ReactNode, useEffect, useRef } from "react";

type WorkspaceSideDrawerProps = Readonly<{
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  onPrevious?: (() => void) | undefined;
  onNext?: (() => void) | undefined;
  className?: string;
}>;

/** One native modal and focus boundary for detailed record workspaces. */
export function WorkspaceSideDrawer({ title, subtitle, children, actions, onClose, onPrevious, onNext, className = "" }: WorkspaceSideDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    closeRef.current?.focus();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return (
    <dialog ref={dialogRef} className={`workspace-side-drawer ${className}`} aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="workspace-side-drawer-header">
        <div className="workspace-side-drawer-heading">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </div>
        <div className="workspace-side-drawer-controls">
          {(onPrevious || onNext) ? <>
            <button type="button" className="workspace-side-icon" disabled={!onPrevious} onClick={onPrevious} aria-label="السجل السابق" title="السجل السابق">›</button>
            <button type="button" className="workspace-side-icon" disabled={!onNext} onClick={onNext} aria-label="السجل التالي" title="السجل التالي">‹</button>
          </> : null}
          <button ref={closeRef} type="button" className="workspace-side-icon" onClick={onClose} aria-label="إغلاق التفاصيل" title="إغلاق التفاصيل">×</button>
        </div>
      </header>
      <div className="workspace-side-drawer-scroll">{children}</div>
      {actions ? <footer className="workspace-side-drawer-actions">{actions}</footer> : null}
    </dialog>
  );
}
