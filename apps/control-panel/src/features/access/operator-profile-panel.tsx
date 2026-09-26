"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import type { OperatorProfile, OperatorProfileInvitationResponse, OperatorProfilePage } from "@bthwani/identity";
import { useCallback, useEffect, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "./identity-error-message";

type ProfileEdit = Readonly<{ fullNameAr: string; phoneE164: string }>;

function stateLabel(profile: OperatorProfile): string {
  if (profile.state === "pending_review") return "بانتظار مراجعة الملف";
  if (profile.state === "approved") return "مؤهل لمنح الدور";
  if (!profile.roleEnabled) return "الدور موقوف";
  if (!profile.securityEnabled) return "الهوية موقوفة";
  if (!profile.activatedAt) return "بانتظار التفعيل";
  return "نشط";
}

export function OperatorProfilePanel() {
  const [fullNameAr, setFullNameAr] = useState("");
  const [phoneE164, setPhoneE164] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const [sort, setSort] = useState<"created_asc" | "created_desc">("created_desc");
  const [items, setItems] = useState<ReadonlyArray<OperatorProfile>>([]);
  const [edits, setEdits] = useState<Record<string, ProfileEdit>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [invitation, setInvitation] = useState<OperatorProfileInvitationResponse | null>(null);

  const load = useCallback(async (cursor = "", append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ q: query.trim(), state, sort, limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch(`/api/access/operator-profiles?${params}`);
      if (!response.ok) { setError(await responseMessage(response)); return; }
      const page = await response.json() as OperatorProfilePage;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذرت قراءة ملفات المشغّلين.");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [query, sort, state]);

  useEffect(() => { void load(); }, [load]);

  async function createProfile() {
    const name = fullNameAr.trim();
    const phone = toAsciiDigits(phoneE164).replace(/\s+/g, "");
    if (Array.from(name).length < 2 || Array.from(name).length > 120 || !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError("أدخل الاسم الكامل ورقم الهاتف بصيغة دولية صحيحة قبل حفظ الملف.");
      return;
    }
    setBusy("create");
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const response = await identityFetch("/api/access/operator-profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullNameAr: name, phoneE164: phone }),
      });
      if (!response.ok) { setError(await responseMessage(response)); await load(); return; }
      setFullNameAr("");
      setPhoneE164("");
      setNotice("أُنشئ ملف المشغّل بانتظار المراجعة. لم يُنشأ actor أو دور أو دعوة.");
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر حفظ ملف المشغّل.");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function updateProfile(profile: OperatorProfile) {
    const edit = edits[profile.id] ?? { fullNameAr: profile.fullNameAr, phoneE164: profile.phoneE164 ?? "" };
    const phone = toAsciiDigits(edit.phoneE164).replace(/\s+/g, "");
    if (Array.from(edit.fullNameAr.trim()).length < 2 || !/^\+[1-9][0-9]{7,14}$/.test(phone)) {
      setError("أدخل الاسم الكامل ورقم الهاتف بصيغة دولية صحيحة.");
      return;
    }
    await mutate(profile, "update-profile", { fullNameAr: edit.fullNameAr.trim(), phoneE164: phone, expectedVersion: profile.version }, "حُدّث الملف قبل المراجعة.");
  }

  async function mutate(profile: OperatorProfile, action: "update-profile" | "approve" | "grant" | "invitation", extra: Record<string, unknown> = {}, successMessage = "") {
    setBusy(`${profile.id}:${action}`);
    setError("");
    setNotice("");
    setInvitation(null);
    try {
      const response = await identityFetch(`/api/access/operator-profiles/${encodeURIComponent(profile.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra, ...(action === "approve" || action === "grant" ? { expectedVersion: profile.version } : {}) }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        await load();
        setError(response.status === 409 || response.status === 412 ? `تغيرت حالة الملف بالتزامن؛ أُعيدت قراءته قبل إجراء جديد. ${message}` : message);
        return;
      }
      if (action === "invitation") setInvitation(await response.json() as OperatorProfileInvitationResponse);
      else await response.json();
      setNotice(successMessage || (action === "approve" ? "اعتُمد الملف. لم يُمنح دور المشغّل بعد." : action === "grant" ? "مُنح دور المشغّل بعد الاعتماد. إصدار الدعوة هو الخطوة التالية." : "تم تحديث الملف."));
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر إكمال الإجراء. أعد قراءة الملف قبل أي محاولة أخرى.");
      await load();
    } finally {
      setBusy("");
    }
  }

  return <>
    <section className="access-card" aria-labelledby="operator-profile-create-title">
      <div className="access-card-heading"><span className="step-chip">الخطوة الأولى · ملف بلا صلاحية</span><h2 id="operator-profile-create-title">إنشاء ملف مشغّل</h2><p className="muted">سجّل اسم العرض بالعربية ورقم الاتصال فقط؛ الاسم هنا ليس اسمًا قانونيًا موثّقًا. لا يُنشأ حساب أو دور حتى تكتمل مراجعة الملف ويُعتمد.</p></div>
      <div className="access-form">
        <label className="field-label" htmlFor="operator-profile-name">اسم العرض الكامل بالعربية<input id="operator-profile-name" autoComplete="name" maxLength={120} value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} disabled={Boolean(busy)} placeholder="مثال: سامي ناصر محمد العريقي" /></label>
        <label className="field-label" htmlFor="operator-profile-phone">رقم الهاتف<input id="operator-profile-phone" autoComplete="tel" inputMode="tel" value={phoneE164} onChange={(event) => setPhoneE164(toAsciiDigits(event.target.value))} disabled={Boolean(busy)} placeholder="+96777000100" /></label>
        <button type="button" className="button button-primary" disabled={Boolean(busy) || !fullNameAr.trim() || !phoneE164.trim()} onClick={() => void createProfile()}>{busy === "create" ? "جارٍ حفظ الملف…" : "حفظ الملف للمراجعة"}</button>
      </div>
    </section>

    <section className="access-card" aria-labelledby="operator-profile-registry-title">
      <div className="access-card-heading"><span className="step-chip">سجل Identity</span><h2 id="operator-profile-registry-title">ملفات المشغّلين ومراحل اعتمادها</h2><p className="muted">يُقرأ السجل من Identity ببحث وترتيب وصفحات خادمية. إنشاء الملف، المراجعة، منح الدور، ودعوة التفعيل مراحل منفصلة.</p></div>
      <div className="workspace-toolbar">
        <label className="field-label" htmlFor="operator-profile-search">بحث بالاسم أو الهاتف<input id="operator-profile-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن ملف مشغّل" /></label>
        <label className="field-label" htmlFor="operator-profile-state">مرحلة الملف<select id="operator-profile-state" value={state} onChange={(event) => setState(event.target.value)}><option value="all">كل المراحل</option><option value="pending_review">بانتظار المراجعة</option><option value="approved">معتمد للدور</option><option value="admitted">مُنح الدور</option></select></label>
        <label className="field-label" htmlFor="operator-profile-sort">ترتيب الإنشاء<select id="operator-profile-sort" value={sort} onChange={(event) => setSort(event.target.value as "created_asc" | "created_desc")}><option value="created_desc">الأحدث أولًا</option><option value="created_asc">الأقدم أولًا</option></select></label>
        <button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
      </div>
      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {error ? <div className="managed-status managed-status-warning" role="alert"><p>{error}</p><button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>إعادة قراءة الحالة</button></div> : null}
      {loading && items.length === 0 ? <p role="status">جارٍ قراءة ملفات المشغّلين…</p> : null}
      {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد ملفات</strong><p>أنشئ ملفًا جديدًا أو غيّر البحث والمرحلة.</p></div> : null}
      {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الاسم والهاتف</th><th scope="col">حالة الحساب</th><th scope="col">المرحلة</th><th scope="col">الإجراء التالي</th></tr></thead><tbody>
        {items.map((profile) => {
          const edit = edits[profile.id] ?? { fullNameAr: profile.fullNameAr, phoneE164: profile.phoneE164 ?? "" };
          const changed = edit.fullNameAr.trim() !== profile.fullNameAr || edit.phoneE164.replace(/\s+/g, "") !== profile.phoneE164;
          const active = profile.state === "admitted" && profile.roleEnabled === true && profile.securityEnabled === true && Boolean(profile.activatedAt);
          const canInvite = profile.state === "admitted" && profile.roleEnabled === true && profile.securityEnabled === true && !profile.activatedAt;
          return <tr key={profile.id}>
            <th scope="row"><div className="access-form"><label className="field-label" htmlFor={`operator-profile-name-${profile.id}`}>الاسم<input id={`operator-profile-name-${profile.id}`} value={edit.fullNameAr} maxLength={120} disabled={Boolean(busy) || profile.state !== "pending_review"} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: { ...edit, fullNameAr: event.target.value } }))} /></label><label className="field-label" htmlFor={`operator-profile-phone-${profile.id}`}>الهاتف<input id={`operator-profile-phone-${profile.id}`} inputMode="tel" value={edit.phoneE164} disabled={Boolean(busy) || profile.state !== "pending_review"} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: { ...edit, phoneE164: toAsciiDigits(event.target.value) } }))} /></label>{profile.state === "pending_review" ? <button type="button" className="button button-secondary" disabled={Boolean(busy) || !changed} onClick={() => void updateProfile(profile)}>حفظ الملف</button> : <bdi dir="ltr">{profile.phoneE164 || "—"}</bdi>}</div></th>
            <td>{active ? "مفعّل" : profile.state === "admitted" && !profile.activatedAt ? "بانتظار التفعيل" : profile.roleEnabled === false ? "الدور موقوف" : profile.securityEnabled === false ? "الهوية موقوفة" : "لا يوجد حساب بعد"}</td>
            <td>{stateLabel(profile)} · الإصدار {profile.version}</td>
            <td><div className="access-form">
              {profile.state === "pending_review" ? <button type="button" className="button button-primary" disabled={Boolean(busy) || changed} onClick={() => void mutate(profile, "approve")}>{busy === `${profile.id}:approve` ? "جارٍ الاعتماد…" : "اعتماد الملف"}</button> : null}
              {profile.state === "approved" ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void mutate(profile, "grant")}>{busy === `${profile.id}:grant` ? "جارٍ منح الدور…" : "منح دور المشغّل"}</button> : null}
              {canInvite ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void mutate(profile, "invitation")}>{busy === `${profile.id}:invitation` ? "جارٍ إصدار الدعوة…" : "إصدار دعوة التفعيل"}</button> : null}
              {profile.state === "admitted" && profile.activatedAt ? <span className="muted">اكتمل التفعيل من المشغّل.</span> : null}
            </div></td>
          </tr>;
        })}
      </tbody></table></div> : null}
      {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
    </section>
    {invitation ? <div className="code-output" role="status"><span className="summary-label">دعوة المشغّل · تظهر مرة واحدة</span><code>{invitation.enrollmentToken.code}</code><p>أُرسلت الدعوة إلى <bdi dir="ltr">{invitation.enrollmentToken.maskedPhone}</bdi>. يستخدم المشغّل الرمز لإثبات الهاتف وإكمال التفعيل. تنتهي في {new Date(invitation.enrollmentToken.expiresAt).toLocaleString("ar-YE-u-nu-latn", { dateStyle: "medium", timeStyle: "short" })}.</p></div> : null}
  </>;
}
