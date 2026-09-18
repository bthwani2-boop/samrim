"use client";

import { type ReactNode } from "react";

function BrandHeader() {
  return (
    <header className="brand-header">
      <div className="brand-lockup">
        <span className="brand-rail" aria-hidden="true" />
        <span className="brand-name">بثواني</span>
      </div>
      <span className="surface-label">لوحة التحكم</span>
    </header>
  );
}

function QuietFooter() {
  return (
    <footer className="quiet-footer">
      <span>هوية موثقة</span>
      <span className="footer-separator" aria-hidden="true" />
      <span>بيئة تشغيل محكومة</span>
    </footer>
  );
}

export function ControlShell({
  children,
  className = "",
  surface = "public",
  header = <BrandHeader />,
  footer = <QuietFooter />,
}: Readonly<{ children: ReactNode; className?: string; surface?: "public" | "workspace" | "state"; header?: ReactNode; footer?: ReactNode }>) {
  return (
    <div className={"control-shell control-shell-" + surface + " " + className}>
      {surface !== "workspace" ? <><div className="ambient-orb ambient-orb-one" aria-hidden="true" /><div className="ambient-orb ambient-orb-two" aria-hidden="true" /></> : null}
      <div className="control-frame">
        {header}
        {children}
        {footer}
      </div>
    </div>
  );
}

export function LoadingState({ title = "جارٍ تجهيز لوحة التحكم", message = "نستعيد جلسة المشغل بأمان." }: Readonly<{ title?: string; message?: string }>) {
  return (
    <ControlShell className="state-shell">
      <main className="state-content" aria-live="polite">
        <section className="state-card">
          <span className="loading-mark" aria-hidden="true" />
          <p className="eyebrow">بثواني</p>
          <h1>{title}</h1>
          <p className="muted">{message}</p>
        </section>
      </main>
    </ControlShell>
  );
}

export function UnavailableState({ message, onRetry, busy }: Readonly<{ message: string; onRetry: () => void; busy: boolean }>) {
  return (
    <ControlShell className="state-shell">
      <main className="state-content">
        <section className="state-card" role="alert">
          <span className="state-icon state-icon-warning" aria-hidden="true">!</span>
          <p className="eyebrow">الخدمة تحتاج انتباهاً</p>
          <h1>تعذر الوصول إلى الهوية</h1>
          <p className="muted">{message}</p>
          <button type="button" className="button button-primary" disabled={busy} onClick={onRetry}>
            {busy ? "جارٍ التحقق…" : "إعادة المحاولة"}
          </button>
        </section>
      </main>
    </ControlShell>
  );
}
