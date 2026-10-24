"use client";

import type { ActorIdentity } from "@bthwani/identity";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { identityFetch } from "../session/identity-fetch";
import { operatorWorkspacePermissions } from "../session/operator-permissions";
import { AppearanceControl } from "./appearance-control";
import "./operator-account-drawer.css";

type Props = Readonly<{
  identity: ActorIdentity | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onLogout: () => void;
}>;

function sessionExpiry(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "غير متاح"
    : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function AccountGlyph({ name }: Readonly<{ name: "user" | "shield" | "phone" | "clock" | "close" | "logout" | "arrow" }>) {
  const paths = {
    user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.1 3.2-5 7-5s6.3 1.9 7 5" /></>,
    shield: <><path d="M12 2 20 6v6c0 5-3.4 8.4-8 10-4.6-1.6-8-5-8-10V6z" /><path d="m9 12 2 2 4-4" /></>,
    phone: <path d="M8 3h8a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2ZM10 17h4" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    close: <path d="M5 5 19 19M19 5 5 19" />,
    logout: <><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H8" /></>,
    arrow: <path d="m15 6-6 6 6 6" />,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

export function OperatorAccountDrawer({ identity, open, busy, onClose, onLogout }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
      closeRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !identity || phone) return;
    const controller = new AbortController();
    setPhoneLoading(true);
    setPhoneError(false);
    void identityFetch("/api/auth/profile", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error("operator profile unavailable");
      const profile = await response.json() as { phoneE164?: unknown };
      if (typeof profile.phoneE164 !== "string" || !profile.phoneE164.trim()) throw new Error("operator phone unavailable");
      if (!controller.signal.aborted) setPhone(profile.phoneE164.trim());
    }).catch(() => {
      if (!controller.signal.aborted) setPhoneError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setPhoneLoading(false);
    });
    return () => controller.abort();
  }, [identity, open, phone]);

  const permissions = operatorWorkspacePermissions.filter(entry => identity?.permissions?.includes(entry.key) === true);

  return <dialog
    ref={dialogRef}
    id="operator-account-drawer"
    className="operator-account-drawer"
    aria-labelledby="operator-account-drawer-title"
    aria-describedby="operator-account-drawer-caption"
    dir="rtl"
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => { if (event.target === dialogRef.current) onClose(); }}
    onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}
  >
    <div className="operator-account-layout">
      <header className="operator-account-topbar">
        <div className="operator-account-topbar-heading">
          <span className="operator-account-topbar-icon"><AccountGlyph name="user" /></span>
          <div>
            <h2 id="operator-account-drawer-title">الملف الشخصي</h2>
            <p id="operator-account-drawer-caption">حساب المشغّل وإعدادات الجلسة</p>
          </div>
        </div>
        <button ref={closeRef} type="button" className="operator-account-close" aria-label="إغلاق الملف الشخصي" onClick={onClose}>
          <AccountGlyph name="close" />
        </button>
      </header>

      <div className="operator-account-scroll">
        <div className="operator-account-hero">
          <span className="operator-account-avatar" aria-hidden="true"><AccountGlyph name="user" /></span>
          <div className="operator-account-hero-copy">
            <strong>{identity?.role === "operator" ? "مشغّل المنصة" : "حساب معتمد"}</strong>
            <span>حساب بثواني</span>
            <span className="operator-account-active"><span className="operator-account-online-dot" />جلسة نشطة</span>
          </div>
        </div>

        <section className="operator-account-section" aria-labelledby="operator-account-identity-heading">
          <div className="operator-account-section-heading">
            <h3 id="operator-account-identity-heading">معلومات الحساب</h3>
          </div>
          <dl className="operator-account-facts">
            <div className="operator-account-fact">
              <dt><AccountGlyph name="phone" />رقم الهاتف</dt>
              <dd aria-live="polite" dir="ltr">{phoneLoading ? "جارٍ التحميل…" : phoneError ? "غير متاح حاليًا" : phone ?? "لم يُحمّل بعد"}</dd>
            </div>
            <div className="operator-account-fact">
              <dt><AccountGlyph name="clock" />انتهاء الجلسة</dt>
              <dd>{identity?.expiresAt ? <time dateTime={identity.expiresAt}>{sessionExpiry(identity.expiresAt)}</time> : "غير متاح"}</dd>
            </div>
          </dl>
        </section>

        <section className="operator-account-section" aria-labelledby="operator-account-permissions-heading">
          <div className="operator-account-section-heading">
            <h3 id="operator-account-permissions-heading">صلاحيات الوصول</h3>
            <span className="operator-account-count">{permissions.length.toLocaleString("ar-YE")} أقسام</span>
          </div>
          {permissions.length ? <ul className="operator-account-permissions">
            {permissions.map(item => <li key={item.key}><AccountGlyph name="shield" />{item.label}</li>)}
          </ul> : <p className="operator-account-muted">لا توجد صلاحيات تشغيلية مفعّلة.</p>}
          {identity?.canManageOperatorPermissions ? <Link className="operator-account-manage" href="/access" onClick={onClose}>
            إدارة وصول المشغّلين <AccountGlyph name="arrow" />
          </Link> : null}
        </section>

        <section className="operator-account-section operator-account-appearance" aria-label="إعدادات المظهر">
          <AppearanceControl />
        </section>
      </div>

      <footer className="operator-account-footer">
        <button type="button" className="operator-account-signout" disabled={busy} onClick={onLogout}>
          <AccountGlyph name="logout" />{busy ? "جارٍ إنهاء الجلسة…" : "تسجيل الخروج"}
        </button>
      </footer>
    </div>
  </dialog>;
}
