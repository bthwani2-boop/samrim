"use client";

import type { WalletProvider, WalletProviderListResponse } from "../../server/dsh/dsh-bff";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { ActivityIndicator, ActivityLegend } from "../shared/record-indicator";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { RegistryColumnHeader } from "../shared/registry-column-header";

const arabicNamePattern = /^[\p{Script=Arabic}\p{White_Space}\p{Number}\p{Punctuation}]+$/u;

function validArabicName(value: string): boolean {
  const normalized = value.trim();
  return normalized.length >= 2 && Array.from(normalized).length <= 80 && arabicNamePattern.test(normalized) && /\p{Script=Arabic}/u.test(normalized);
}

export function WalletProviderPolicyPanel() {
  const { state } = useSession();
  const canEdit = state.kind === "authenticated" && state.identity.permissions?.includes("platform_policies") === true;
  const [providers, setProviders] = useState<ReadonlyArray<WalletProvider>>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [displayNameAr, setDisplayNameAr] = useState("");
  const [editingKey, setEditingKey] = useState("");
  const [renamedValue, setRenamedValue] = useState("");
  const [loading, setLoading] = useState(true);
  const renameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editingKey) renameInput.current?.focus(); }, [editingKey]);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [logoKey,setLogoKey]=useState("");
  const [logoFile,setLogoFile]=useState<File|null>(null);
  const [logoPreview,setLogoPreview]=useState("");
  const [logoCreator,setLogoCreator]=useState("");
  const [logoSource,setLogoSource]=useState("");
  const [logoRights,setLogoRights]=useState(false);
  const logoAttempt=useRef<{key:string;name:string;version:number;idem:string}|null>(null);
  useEffect(()=>{
    if(!logoFile){setLogoPreview("");return;}
    const url=URL.createObjectURL(logoFile);setLogoPreview(url);
    return ()=>URL.revokeObjectURL(url);
  },[logoFile]);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const returnFocusKey = useRef("");
  useEffect(() => {
    if (!editingKey && !busy && !loading && returnFocusKey.current) {
      (document.getElementById(`wallet-provider-edit-${returnFocusKey.current}`) ?? document.getElementById("wallet-provider-search"))?.focus();
      returnFocusKey.current = "";
    }
  }, [editingKey, busy, loading]);
  const pendingCreate = useRef<Readonly<{ name: string; active: boolean; idempotencyKey: string }> | null>(null);

  function closeEdit(key: string) {
    returnFocusKey.current = key;
    setEditingKey(""); setRenamedValue("");
  }

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/wallet-providers?includeInactive=true", { cache: "no-store" });
      if (!response.ok) throw new Error("read");
      const payload = await response.json() as WalletProviderListResponse;
      if (!Array.isArray(payload.walletProviders)) throw new Error("shape");
      setProviders(payload.walletProviders);
    } catch {
      setError("تعذر قراءة قائمة المحافظ الرسمية.");
    } finally { setLoading(false); }
  }, []);
  useReadOnReturn(load, !busy && !loading && !editingKey);
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
    const name = renamedValue.trim();
    if (name === provider.displayNameAr) return;
    if (!validArabicName(name)) { setError("استخدم اسمًا عربيًا بين حرفين و80 حرفًا."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/wallet-providers/${encodeURIComponent(provider.key)}`, { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(provider.version) }, body: JSON.stringify({ displayNameAr: name, active: provider.active }) });
      if (!response.ok) throw new Error("rename");
      closeEdit(provider.key);
      setNotice("تم تحديث اسم المحفظة مع الحفاظ على مفتاحها." ); await load();
    } catch { setError("تعذر تحديث الاسم؛ ربما تغيّرت البيانات قبل الحفظ."); }
    finally { setBusy(false); }
  }

  function closeLogo(){
    setLogoKey("");setLogoFile(null);setLogoCreator("");setLogoSource("");setLogoRights(false);logoAttempt.current=null;
  }
  async function uploadLogo(provider:WalletProvider){
    if(!canEdit||!logoFile||!logoRights||logoCreator.trim().length<2||logoSource.trim().length<3||busy)return;
    if(!["image/png","image/jpeg"].includes(logoFile.type)||logoFile.size>10*1024*1024||logoFile.size===0){setError("اختر صورة PNG أو JPG لا تتجاوز 10 ميجابايت.");return;}
    if(!logoAttempt.current||logoAttempt.current.key!==provider.key||logoAttempt.current.version!==provider.version||logoAttempt.current.name!==logoFile.name){
      logoAttempt.current={key:provider.key,name:logoFile.name,version:provider.version,idem:crypto.randomUUID()};
    }
    setBusy(true);setError("");setNotice("");
    try{
      const form=new FormData();
      form.set("file",logoFile);form.set("creator",logoCreator.trim());form.set("sourceDescription",logoSource.trim());
      form.set("sourceUri","");form.set("rightsUri","");
      form.set("rightsStatement","أؤكد حصولي على حق استخدام هذا الشعار وعرضه داخل تطبيقات بثواني.");
      form.set("rightsAttested","true");
      const response=await fetch("/api/wallet-providers/"+encodeURIComponent(provider.key)+"/logo",{method:"POST",headers:{"Idempotency-Key":logoAttempt.current.idem,"X-Expected-Version":String(provider.version)},body:form});
      if(!response.ok)throw new Error("upload");
      closeLogo();await load();setNotice("تم حفظ شعار المزوّد ويظهر في التطبيقات بعد تحديث بياناتها.");
    }catch{setError("تعذّر رفع الشعار. تحقق من الصورة والحقوق والإصدار ثم أعد المحاولة.");}
    finally{setBusy(false);}
  }

  const visibleProviders = providers.filter((provider) => provider.key === editingKey || (provider.displayNameAr.includes(query.trim()) && (!status || provider.active === (status === "active"))));

  return <section className="work-stack" aria-label="إدارة مزودي المحافظ">
    {canEdit ? <details className="disclosure create-disclosure">
      <summary>إضافة محفظة</summary>
      <form className="form-section compact-form" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="field-label" htmlFor="wallet-provider-name">اسم المحفظة بالعربية<input id="wallet-provider-name" maxLength={80} disabled={busy || loading} value={displayNameAr} onChange={(event) => setDisplayNameAr(event.target.value)} /></label>
        <label className="checkbox-field" htmlFor="wallet-provider-active"><input id="wallet-provider-active" type="checkbox" disabled={busy || loading} checked={active} onChange={(event) => setActive(event.target.checked)} /> نشط عند الإضافة</label>
        <div className="action-row"><button type="submit" className="button button-primary" disabled={busy || loading}>إضافة محفظة</button></div>
      </form>
    </details> : null}
    {notice ? <p className="managed-status managed-status-success" role="status">{notice}</p> : null}
    {error ? <p className="identity-error" role="alert">{error} <button type="button" className="button button-secondary" disabled={loading || busy} onClick={() => void load()}>إعادة المحاولة</button></p> : null}
    {loading ? <p role="status">جارٍ قراءة المحافظ…</p> : null}
    {!loading && !error && !providers.length ? <p className="collection-state">لا توجد محافظ مسجلة.</p> : null}
    {providers.length > 0 ? <>
      <search className="registry-toolbar reference-registry-toolbar" aria-label="تصفية المحافظ">
        <label htmlFor="wallet-provider-search">بحث في المحافظ<input id="wallet-provider-search" type="search" maxLength={80} value={query} disabled={busy || loading || Boolean(editingKey)} onChange={(event) => setQuery(event.target.value)} /></label>
        <label htmlFor="wallet-provider-status">حالة المحفظة<select id="wallet-provider-status" value={status} disabled={busy || loading || Boolean(editingKey)} onChange={(event) => setStatus(event.target.value)}><option value="">كل الحالات</option><option value="active">نشطة</option><option value="inactive">متوقفة</option></select></label>
        {query || status ? <button type="button" className="button button-secondary" disabled={busy || loading || Boolean(editingKey)} onClick={() => { setQuery(""); setStatus(""); }}>مسح المرشحات</button> : null}
      </search>
      <span className="muted" role="status">{visibleProviders.length} من {providers.length} مزوّدًا{loading || error ? " · آخر قراءة" : ""}</span>
      <div className="table-wrap" aria-busy={loading}>
        <table className="reference-table"><caption className="visually-hidden">مزودو المحافظ الرسمية</caption>
          <thead><tr>
            <RegistryColumnHeader label="المزوّد" active={Boolean(query)}>
              <label>بحث في المحافظ<input type="search" maxLength={80} value={query} disabled={busy || loading || Boolean(editingKey)} onChange={e=>setQuery(e.target.value)} /></label>
            </RegistryColumnHeader>
            <RegistryColumnHeader label="الحالة" active={Boolean(status)}>
              <label>حالة المزوّد<select value={status} disabled={busy || loading || Boolean(editingKey)} onChange={e=>setStatus(e.target.value)}>
                <option value="">الجميع</option><option value="active">نشط</option><option value="inactive">متوقف</option>
              </select></label>
            </RegistryColumnHeader>
            <th scope="col">الإجراء</th>
          </tr></thead>
          <tbody>{visibleProviders.map((provider) => <Fragment key={provider.key}><tr>
            <th scope="row">{editingKey === provider.key ? <label className="field-label record-edit-field" htmlFor={`wallet-provider-name-${provider.key}`}>اسم المزوّد<input ref={renameInput} id={`wallet-provider-name-${provider.key}`} maxLength={80} value={renamedValue} disabled={busy || loading} onChange={(event) => setRenamedValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") closeEdit(provider.key); if (event.key === "Enter" && !busy && !loading) { event.preventDefault(); void rename(provider); } }} /></label> : <span style={{display:"inline-flex",alignItems:"center",gap:10}}>{provider.logoUri ? <img src={provider.logoUri} alt="" width={36} height={36} style={{objectFit:"contain",borderRadius:8}} /> : <span aria-hidden="true">▣</span>}{provider.displayNameAr}</span>}</th>
            <td className="indicator-column"><ActivityIndicator active={provider.active} activeLabel="نشطة" inactiveLabel="متوقفة" /></td>
            <td><div className="action-row">{canEdit ? editingKey === provider.key ? <>
              <button type="button" className="button button-primary" disabled={busy || loading || renamedValue.trim() === provider.displayNameAr} onClick={() => void rename(provider)}>حفظ الاسم</button>
              <button type="button" className="button button-secondary" disabled={busy} onClick={() => closeEdit(provider.key)}>إلغاء</button>
            </> : <>
              <button id={`wallet-provider-edit-${provider.key}`} type="button" className="button button-secondary" disabled={busy || loading || Boolean(editingKey)} onClick={() => { setEditingKey(provider.key); setRenamedValue(provider.displayNameAr); }}>تعديل</button>
              <button type="button" className="button button-secondary" disabled={busy || loading} onClick={() => void toggle(provider)}>{provider.active ? "تعطيل" : "تفعيل"}</button>
              <button type="button" className="button button-secondary" disabled={busy || loading} onClick={()=>{
                if(logoKey===provider.key){closeLogo();return;}
                closeLogo();setLogoKey(provider.key);
              }}>{logoKey===provider.key ? "إغلاق الشعار" : "إدارة الشعار"}</button>
            </> : null}</div></td>
          </tr>
          {canEdit && logoKey===provider.key ? <tr><td colSpan={3}>
            <form className="form-section compact-form" onSubmit={(event)=>{event.preventDefault();void uploadLogo(provider);}} aria-label={"شعار "+provider.displayNameAr}>
              <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                {(logoPreview||provider.logoUri) ? <img src={logoPreview||provider.logoUri} width={80} height={80} alt={"معاينة شعار "+provider.displayNameAr} style={{objectFit:"contain",borderRadius:12}} /> : null}
                <label className="field-label">شعار المزوّد (PNG أو JPG)
                  <input type="file" accept="image/png,image/jpeg" disabled={busy} required onChange={(e)=>{setLogoFile(e.target.files?.[0]??null);logoAttempt.current=null;}} />
                </label>
              </div>
              <label className="field-label">مالك الشعار أو الجهة المنتجة
                <input value={logoCreator} maxLength={200} required disabled={busy} onChange={(e)=>{setLogoCreator(e.target.value);logoAttempt.current=null;}} />
              </label>
              <label className="field-label">مصدر الشعار
                <input value={logoSource} maxLength={1000} required disabled={busy} placeholder="الموقع الرسمي أو المصدر المعتمد" onChange={(e)=>{setLogoSource(e.target.value);logoAttempt.current=null;}} />
              </label>
              <label className="checkbox-field">
                <input type="checkbox" checked={logoRights} disabled={busy} onChange={(e)=>{setLogoRights(e.target.checked);logoAttempt.current=null;}} />
                أقر أن لدي حق رفع هذا الشعار وعرضه في تطبيقات بثواني
              </label>
              <div className="action-row">
                <button type="submit" className="button button-primary" disabled={busy||!logoFile||!logoRights||logoCreator.trim().length<2||logoSource.trim().length<3}>{busy?"جارٍ رفع الشعار…":"حفظ الشعار"}</button>
                <button type="button" className="button button-secondary" disabled={busy} onClick={closeLogo}>إلغاء</button>
              </div>
            </form>
          </td></tr> : null}
          </Fragment>)}{!visibleProviders.length ? <tr><td colSpan={3} className="collection-state">لا توجد محافظ مطابقة.</td></tr> : null}</tbody>
        </table>
      </div>
      <ActivityLegend activeLabel="نشطة" inactiveLabel="متوقفة" />
    </> : null}
  </section>;
}
