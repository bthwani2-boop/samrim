"use client";

import type { WalletProvider, WalletProviderListResponse } from "../../server/dsh/dsh-bff";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";

const arabicNamePattern = /^[\p{Script=Arabic}\p{White_Space}\p{Number}\p{Punctuation}]+$/u;

function validArabicName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 2 && Array.from(normalized).length <= 80 && arabicNamePattern.test(normalized) && /\p{Script=Arabic}/u.test(normalized);
}

export function WalletProviderPolicyPanel() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [providers, setProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [displayNameAr, setDisplayNameAr] = useState("");
  const [renamedValues, setRenamedValues] = useState<Record<string, string>>({});
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingCreate = useRef<Readonly<{ name: string; active: boolean; idempotencyKey: string }> | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/wallet-providers?includeInactive=true", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      setProviders((await response.json() as WalletProviderListResponse).walletProviders);
    } catch {
      setError("تعذر قراءة قائمة المحافظ الرسمية.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!canEdit) return;
    const name = displayNameAr.trim();
    if (!validArabicName(name)) { setError("استخدم اسمًا عربيًا بين حرفين و80 حرفًا."); return; }
    if (!pendingCreate.current || pendingCreate.current.name !== name || pendingCreate.current.active !== active) {
      pendingCreate.current = { name, active, idempotencyKey: crypto.randomUUID() };
    }
    const attempt = pendingCreate.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/wallet-providers", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey }, body: JSON.stringify({ displayNameAr: name, active }) });
      if (!response.ok) throw new Error("create");
      pendingCreate.current = null; setDisplayNameAr(""); setNotice("تمت إضافة مزوّد المحفظة."); await load();
    } catch { setError("تعذرت إضافة المزوّد. أعد المحاولة أو تحقق من اتصال الخدمة."); }
    finally { setBusy(false); }
  }

  async function toggle(provider: WalletProvider) {
    if (!canEdit) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/wallet-providers/${encodeURIComponent(provider.key)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(provider.version) }, body: JSON.stringify({ displayNameAr: provider.displayNameAr, active: !provider.active }) });
      if (!response.ok) throw new Error("update");
      setNotice(`تم ${provider.active ? "إيقاف" : "تفعيل"} ${provider.displayNameAr}.`); await load();
    } catch { setError("تعذر تحديث حالة المزوّد؛ ربما تغيّرت البيانات قبل الحفظ."); }
    finally { setBusy(false); }
  }

  async function rename(provider: WalletProvider) {
    if (!canEdit) return;
    const name = (renamedValues[provider.key] ?? provider.displayNameAr).trim();
    if (name === provider.displayNameAr) return;
    if (!validArabicName(name)) { setError("استخدم اسمًا عربيًا بين حرفين و160 حرفًا."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/wallet-providers/${encodeURIComponent(provider.key)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(provider.version) }, body: JSON.stringify({ displayNameAr: name, active: provider.active }) });
      if (!response.ok) throw new Error("rename");
      setRenamedValues((current) => { const next = { ...current }; delete next[provider.key]; return next; });
      setNotice("تم تحديث اسم المحفظة مع الحفاظ على مفتاحها." ); await load();
    } catch { setError("تعذر تحديث الاسم؛ ربما تغيّرت البيانات قبل الحفظ."); }
    finally { setBusy(false); }
  }

  return <section className="access-card" aria-labelledby="wallet-provider-title"><div className="access-card-heading"><span className="step-chip">إدارة المحافظ</span><p className="eyebrow">القيم المرجعية</p><h2 id="wallet-provider-title">مزودو المحافظ الرسمية</h2><p className="muted">تُحفظ أسماء المزودين في سجل السياسات وتُستخدم قوائمها في النماذج. القيم الحالية لا تغيّر أرقام المحافظ أو بيانات المستفيد.</p></div><div className="access-form"><label className="field-label" htmlFor="wallet-provider-name">اسم المحفظة بالعربية<input id="wallet-provider-name" disabled={busy || !canEdit} value={displayNameAr} onChange={(event) => setDisplayNameAr(event.target.value)} placeholder="اسم المزوّد" /></label><label className="field-label" htmlFor="wallet-provider-active"><input id="wallet-provider-active" type="checkbox" disabled={busy || !canEdit} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط عند الإضافة</label><button type="button" className="button button-primary" disabled={busy || !canEdit} onClick={() => void create()}>إضافة محفظة</button></div>{notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}{error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" onClick={() => void load()}>إعادة المحاولة</button></p> : null}<div className="managed-status managed-status-info"><strong>السجل المعتمد</strong>{providers.length === 0 ? <p>لا توجد محافظ مسجلة.</p> : <ul>{providers.map((provider) => <li key={provider.key}><label className="field-label" htmlFor={`wallet-provider-name-${provider.key}`}>الاسم<input id={`wallet-provider-name-${provider.key}`} value={renamedValues[provider.key] ?? provider.displayNameAr} disabled={busy || !canEdit} onChange={(event) => setRenamedValues((current) => ({ ...current, [provider.key]: event.target.value }))} /></label><span className="muted">المفتاح الثابت: <code>{provider.key}</code> · {provider.active ? "نشطة" : "متوقفة"}</span><button type="button" className="button button-secondary" disabled={busy || !canEdit || (renamedValues[provider.key] ?? provider.displayNameAr).trim() === provider.displayNameAr} onClick={() => void rename(provider)}>حفظ الاسم</button> <button type="button" className="button button-secondary" disabled={busy || !canEdit} onClick={() => void toggle(provider)}>{provider.active ? "تعطيل" : "تفعيل"}</button></li>)}</ul>}</div></section>;
}
