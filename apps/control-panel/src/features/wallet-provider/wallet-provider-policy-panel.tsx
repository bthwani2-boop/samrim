"use client";

import type { WalletProvider, WalletProviderListResponse } from "../../server/dsh/dsh-bff";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { useReadOnReturn } from "../shared/use-read-on-return";

const arabicNamePattern = /^[\p{Script=Arabic}\p{White_Space}\p{Number}\p{Punctuation}]+$/u;

function validArabicName(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && Array.from(name).length <= 80 && arabicNamePattern.test(name) && /\p{Script=Arabic}/u.test(name);
}

type ProviderFilter = "all" | "active" | "inactive";

export function WalletProviderPolicyPanel() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [providers, setProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ProviderFilter>("all");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newActive, setNewActive] = useState(true);
  const [selectedKey, setSelectedKey] = useState("");
  const [name, setName] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const createAttempt = useRef<{ name: string; active: boolean; id: string } | null>(null);
  const uploadAttempt = useRef<{ fingerprint: string; id: string } | null>(null);
  const restoreFocus = useRef("");

  useEffect(() => {
    if (!logoFile) { setPreview(""); return; }
    const url = URL.createObjectURL(logoFile);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logoFile]);

  useEffect(() => {
    if (!selectedKey && restoreFocus.current) {
      document.getElementById("wallet-provider-manage-" + restoreFocus.current)?.focus();
      restoreFocus.current = "";
    }
  }, [selectedKey]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/wallet-providers?includeInactive=true", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      const payload = await response.json() as WalletProviderListResponse;
      if (!Array.isArray(payload.walletProviders)) throw new Error("shape");
      setProviders(payload.walletProviders);
    } catch {
      setError("تعذّرت قراءة مزوّدي المحافظ. حاول مرة أخرى.");
    } finally {
      setLoading(false);
    }
  }, []);

  useReadOnReturn(load, !busy && !loading && !selectedKey);
  useEffect(() => { void load(); }, [load]);

  function resetLogo() {
    setLogoFile(null);
    uploadAttempt.current = null;
  }

  function closeEditor() {
    restoreFocus.current = selectedKey;
    setSelectedKey("");
    resetLogo();
  }

  function selectProvider(provider: WalletProvider) {
    if (selectedKey === provider.key) { closeEditor(); return; }
    setSelectedKey(provider.key);
    setCreating(false);
    setName(provider.displayNameAr);
    resetLogo();
    setError("");
  }

  async function createProvider() {
    if (!canEdit || busy) return;
    const value = newName.trim();
    if (!validArabicName(value)) { setError("أدخل اسمًا عربيًا صحيحًا من حرفين إلى 80 حرفًا."); return; }
    if (!createAttempt.current || createAttempt.current.name !== value || createAttempt.current.active !== newActive) {
      createAttempt.current = { name: value, active: newActive, id: crypto.randomUUID() };
    }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/wallet-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": createAttempt.current.id },
        body: JSON.stringify({ displayNameAr: value, active: newActive }),
      });
      if (!response.ok) throw new Error("create");
      setCreating(false); setNewName(""); createAttempt.current = null;
      await load();
      setNotice("تمت إضافة مزوّد المحفظة.");
    } catch { setError("تعذّر إنشاء المزوّد. راجع البيانات وحاول مجددًا."); }
    finally { setBusy(false); }
  }

  async function updateProvider(provider: WalletProvider, nextName: string, nextActive: boolean) {
    if (!canEdit || busy) return;
    if (!validArabicName(nextName)) { setError("أدخل اسمًا عربيًا صحيحًا من حرفين إلى 80 حرفًا."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/wallet-providers/" + encodeURIComponent(provider.key), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(provider.version) },
        body: JSON.stringify({ displayNameAr: nextName.trim(), active: nextActive }),
      });
      if (!response.ok) throw new Error("update");
      await load();
      setName(nextName.trim());
      setNotice("تم حفظ بيانات المزوّد.");
    } catch { setError("تعذّر الحفظ. ربما تغيّر إصدار المزوّد؛ حدّث البيانات وأعد المحاولة."); }
    finally { setBusy(false); }
  }

  async function uploadLogo(provider: WalletProvider, file: File) {
    if (!canEdit || busy) return;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size < 1 || file.size > 10 * 1024 * 1024) {
      setError("اختر شعارًا بصيغة JPG أو PNG بحجم لا يتجاوز 10 ميجابايت.");
      return;
    }
    // The key is held stable for an idempotent retry of the same file/version.
    const fingerprint = [provider.key, provider.version, file.name, file.size, file.lastModified].join(":");
    if (uploadAttempt.current?.fingerprint !== fingerprint) {
      uploadAttempt.current = { fingerprint, id: crypto.randomUUID() };
    }
    setLogoFile(file); // Immediate local preview while saving remotely.
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch("/api/wallet-providers/" + encodeURIComponent(provider.key) + "/logo", {
        method: "POST",
        headers: { "Idempotency-Key": uploadAttempt.current.id, "X-Expected-Version": String(provider.version) },
        body,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("upload");
      const payload = await response.json() as { walletProvider?: WalletProvider };
      const saved = payload.walletProvider;
      if (!saved || saved.key !== provider.key || !saved.logoUri || saved.version <= provider.version) {
        throw new Error("upload response invalid");
      }
      // Publish the new immutable image immediately without collapsing the editor.
      setProviders((previous) => previous.map((item) => item.key === saved.key ? saved : item));
      resetLogo();
      setNotice("تم تحديث الشعار.");
    } catch {
      setLogoFile(null); // Restore the previous server-confirmed image on failure.
      setError("تعذّر حفظ الصورة. أعد اختيارها للمحاولة مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  const results = providers.filter((provider) =>
    provider.displayNameAr.includes(query.trim()) &&
    (filter === "all" || provider.active === (filter === "active"))
  );

  return <section className="wallet-policy-panel" dir="rtl" aria-label="إدارة مزوّدي المحافظ الرسمية">
    <div className="wallet-policy-intro">
      <div>
        <strong>المحافظ الرسمية</strong>
        <p>تحكّم في الأسماء والشعارات والحالة من مكان واحد.</p>
      </div>
      {canEdit ? <button type="button" className="button button-primary" disabled={busy} aria-expanded={creating} onClick={() => { setCreating((value) => !value); closeEditor(); }}>
        + إضافة مزوّد
      </button> : null}
    </div>

    {creating && canEdit ? <form className="wallet-policy-editor" onSubmit={(event) => { event.preventDefault(); void createProvider(); }}>
      <strong>مزوّد جديد</strong>
      <label>اسم المزوّد بالعربية
        <input id="wallet-provider-name" maxLength={80} required disabled={busy} value={newName} onChange={(event) => setNewName(event.target.value)} />
      </label>
      <label className="wallet-policy-check">
        <input type="checkbox" checked={newActive} disabled={busy} onChange={(event) => setNewActive(event.target.checked)} />
        تفعيل المزوّد
      </label>
      <div className="wallet-policy-form-actions">
        <button type="submit" className="button button-primary" disabled={busy || !validArabicName(newName)}>إضافة المزوّد</button>
        <button type="button" className="button button-secondary" onClick={() => setCreating(false)} disabled={busy}>إلغاء</button>
      </div>
    </form> : null}

    {notice ? <p role="status" className="managed-status managed-status-success">{notice}</p> : null}
    {error ? <p role="alert" className="identity-error">{error} <button className="button button-secondary" type="button" onClick={() => void load()} disabled={busy}>تحديث</button></p> : null}

    <div className="wallet-policy-toolbar">
      <label htmlFor="wallet-provider-search" className="wallet-policy-search">
        <span className="visually-hidden">البحث عن مزوّد</span>
        <input id="wallet-provider-search" type="search" placeholder="ابحث عن محفظة..." value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <label className="wallet-policy-status-select">
        <span className="visually-hidden">تصفية بحسب الحالة</span>
        <select value={filter} disabled={busy} onChange={(event) => setFilter(event.target.value as ProviderFilter)}>
          <option value="all">كل الحالات</option>
          <option value="active">مفعّلة</option>
          <option value="inactive">متوقّفة</option>
        </select>
      </label>
    </div>
    <p className="wallet-policy-count" role="status">{loading ? "جارٍ تحميل المحافظ..." : results.length + " من " + providers.length + " مزوّد"}</p>

    <div className="wallet-policy-list" aria-busy={loading}>
      {!loading && results.length === 0 ? <p className="wallet-policy-empty">لا توجد محافظ مطابقة للبحث.</p> : null}
      {results.map((provider) => {
        const selected = selectedKey === provider.key;
        return <article className={"wallet-provider-card" + (selected ? " is-selected" : "")} key={provider.key}>
          <div className="wallet-provider-summary">
            <span className="wallet-provider-avatar" aria-hidden="true">
              {provider.logoUri ? <img src={provider.logoUri} alt="" width={44} height={44} /> : <span>◈</span>}
            </span>
            <div className="wallet-provider-identity">
              <strong>{provider.displayNameAr}</strong>
              <span className={provider.active ? "wallet-provider-status is-on" : "wallet-provider-status"}>{provider.active ? "● مفعّلة" : "○ متوقّفة"}</span>
            </div>
            {canEdit ? <button type="button" className="button button-secondary wallet-provider-manage" id={"wallet-provider-manage-" + provider.key} aria-expanded={selected} onClick={() => selectProvider(provider)} disabled={busy}>{selected ? "إغلاق" : "إدارة"}</button> : null}
          </div>
          {selected && canEdit ? <div className="wallet-provider-settings">
            <div className="wallet-provider-settings-heading"><strong>تفاصيل المزوّد</strong><span>الإصدار {provider.version}</span></div>
            <form className="wallet-policy-form" onSubmit={(event) => { event.preventDefault(); void updateProvider(provider, name, provider.active); }}>
              <label>اسم المزوّد
                <input value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} />
              </label>
              <div className="wallet-policy-inline-actions">
                <button className="button button-primary" type="submit" disabled={busy || !validArabicName(name) || name.trim() === provider.displayNameAr}>حفظ الاسم</button>
                <button className="button button-secondary" type="button" disabled={busy} onClick={() => void updateProvider(provider, provider.displayNameAr, !provider.active)}>{provider.active ? "إيقاف المزوّد" : "تفعيل المزوّد"}</button>
              </div>
            </form>
            <div className="wallet-policy-form wallet-provider-logo-form">
              <strong>الشعار الرسمي</strong>
              <label className="wallet-provider-logo-picker">
                <span className="wallet-provider-logo-preview" aria-hidden="true">
                  {preview || provider.logoUri ? <img src={preview || provider.logoUri} alt="" /> : <span>◈</span>}
                </span>
                <span className="wallet-provider-file-copy">
                  <strong>{busy ? "جارٍ حفظ الصورة..." : "تغيير صورة الشعار"}</strong>
                  <small>JPG أو PNG · يحفظ تلقائيًا</small>
                  <small>باختيار الصورة تؤكد السماح بعرضها في بثواني.</small>
                </span>
                <input type="file" aria-label="اختيار صورة شعار المزوّد وحفظها مباشرة" accept="image/png,image/jpeg"
                  disabled={busy} onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void uploadLogo(provider, file);
                  }} />
              </label>
            </div>
          </div> : null}
        </article>;
      })}
    </div>
  </section>;
}
