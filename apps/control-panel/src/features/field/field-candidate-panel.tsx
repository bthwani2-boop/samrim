"use client";

import { toAsciiDigits } from "@bthwani/design-system";
import { type FieldAdmission, fieldAdmissionStateLabel } from "@bthwani/dsh";
import { useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { responseMessage } from "../access/identity-error-message";

type CandidatePage = Readonly<{ items: ReadonlyArray<FieldAdmission>; nextCursor?: string }>;

export function FieldCandidatePanel() {
  const [fullNameAr, setFullNameAr] = useState("");
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("review_required");
  const [sort, setSort] = useState<"created_asc" | "created_desc">("created_desc");
  const [items, setItems] = useState<ReadonlyArray<FieldAdmission>>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [nextCursor, setNextCursor] = useState("");
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loadRequestID = useRef(0);

  const load = useCallback(async (cursor = "", append = false) => {
    const requestID = ++loadRequestID.current;
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ scope: "candidates", state, candidateSort: sort, q: query.trim(), limit: "25" });
      if (cursor) params.set("cursor", cursor);
      const response = await identityFetch("/api/fields?" + params);
      if (!response.ok) { const message = await responseMessage(response); if (loadRequestID.current === requestID) setError(message); return; }
      const page = await response.json() as CandidatePage;
      if (loadRequestID.current !== requestID) return;
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setNextCursor(page.nextCursor ?? "");
    } catch (cause) {
      if (loadRequestID.current === requestID) setError(isRequestFailure(cause) ? cause.message : "تعذرت قراءة ملفات الميدانيين.");
    } finally {
      if (loadRequestID.current === requestID) { setLoading(false); setLoadingMore(false); }
    }
  }, [query, sort, state]);

  useEffect(() => { void load(); }, [load]);

  async function createProfile() {
    const name = fullNameAr.trim();
    const contactPhoneE164 = toAsciiDigits(phone).replace(/\s+/g, "");
    if (Array.from(name).length < 2 || Array.from(name).length > 120 || !/^\+[1-9][0-9]{7,14}$/.test(contactPhoneE164)) {
      setError("أدخل الاسم الكامل ورقم الهاتف بصيغة دولية صحيحة قبل حفظ الملف.");
      return;
    }
    setBusy("create");
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/fields", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "admit", fullNameAr: name, contactPhoneE164 }) });
      if (!response.ok) { setError(await responseMessage(response)); await load(); return; }
      setFullNameAr("");
      setPhone("");
      setState("pending_review");
      setNotice("أُنشئ ملف الميداني بانتظار المراجعة. لم يُمنح دور التطبيق بعد.");
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر حفظ ملف الميداني.");
      await load();
    } finally {
      setBusy("");
    }
  }

  async function mutate(profile: FieldAdmission, action: "update-profile" | "approve" | "provision" | "review-profile") {
    const nextName = (edits[profile.id] ?? profile.fullNameAr ?? "").trim();
    if (action === "update-profile" && (Array.from(nextName).length < 2 || Array.from(nextName).length > 120)) {
      setError("أدخل الاسم الكامل قبل حفظ الملف.");
      return;
    }
    setBusy(profile.id + ":" + action);
    setError("");
    setNotice("");
    try {
      const body: { action: typeof action; admissionId: string; fullNameAr?: string; expectedVersion?: number } = {
        action,
        admissionId: profile.id,
      };
      if (action === "update-profile") {
        body.fullNameAr = nextName;
        body.expectedVersion = profile.version;
      } else if (action === "review-profile" || action === "approve") {
        body.expectedVersion = profile.version;
      }
      const response = await identityFetch("/api/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        await load();
        setError(response.status === 409 || response.status === 412 ? "تغيرت حالة الملف بالتزامن؛ أُعيدت قراءته. " + message : message);
        return;
      }
      await response.json();
      setNotice(fieldMutationSuccessMessage(action));
      setEdits((current) => { const next = { ...current }; delete next[profile.id]; return next; });
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر إكمال الإجراء؛ أعد قراءة الحالة قبل المحاولة.");
      await load();
    } finally {
      setBusy("");
    }
  }

  return <>
    <section className="access-card" aria-labelledby="field-candidate-create-title">
      <div className="access-card-heading"><span className="step-chip">الخطوة الأولى · ملف بلا دور</span><h2 id="field-candidate-create-title">ملف ميداني جديد</h2><p className="muted">سجّل اسم العرض بالعربية ورقم الاتصال؛ الاسم خاص بملف الميداني وليس اسمًا قانونيًا موثّقًا. بعد المراجعة والاعتماد فقط يُمنح الدور في التطبيق.</p></div>
      <div className="access-form">
        <label className="field-label" htmlFor="field-candidate-name">اسم العرض الكامل بالعربية<input id="field-candidate-name" autoComplete="name" maxLength={120} value={fullNameAr} onChange={(event) => setFullNameAr(event.target.value)} disabled={Boolean(busy)} placeholder="مثال: سامي ناصر محمد العريقي" /></label>
        <label className="field-label" htmlFor="field-candidate-phone">رقم الهاتف<input id="field-candidate-phone" autoComplete="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(toAsciiDigits(event.target.value))} disabled={Boolean(busy)} placeholder="+96777000100" /></label>
        <button type="button" className="button button-primary" disabled={Boolean(busy) || !fullNameAr.trim() || !phone.trim()} onClick={() => void createProfile()}>{busy === "create" ? "جارٍ حفظ الملف…" : "حفظ الملف للمراجعة"}</button>
      </div>
    </section>
    <section className="access-card" aria-labelledby="field-candidate-registry-title">
      <div className="access-card-heading"><span className="step-chip">سجل ملفات DSH</span><h2 id="field-candidate-registry-title">ملفات الميدانيين قبل منح الدور</h2><p className="muted">بحث وترتيب وصفحات خادمية؛ المراجعة تسبق إنشاء دور Identity، والتفعيل الذاتي يأتي بعد منح الدور.</p></div>
      <div className="workspace-toolbar">
        <label className="field-label" htmlFor="field-candidate-search">بحث بالاسم أو الهاتف<input id="field-candidate-search" value={query} disabled={Boolean(busy)} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في ملفات الميدانيين" /></label>
        <label className="field-label" htmlFor="field-candidate-state">مرحلة الملف<select id="field-candidate-state" value={state} disabled={Boolean(busy)} onChange={(event) => setState(event.target.value)}><option value="review_required">يحتاج استكمالًا ومراجعة</option><option value="pending_review">ملف جديد بانتظار المراجعة</option><option value="pending_identity">معتمد وينتظر منح الدور</option><option value="eligible">مؤهل</option><option value="suspended">موقوف</option><option value="all">كل المراحل</option></select></label>
        <label className="field-label" htmlFor="field-candidate-sort">ترتيب الإنشاء<select id="field-candidate-sort" value={sort} disabled={Boolean(busy)} onChange={(event) => setSort(event.target.value as "created_asc" | "created_desc")}><option value="created_desc">الأحدث أولًا</option><option value="created_asc">الأقدم أولًا</option></select></label>
        <button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
      </div>
      {notice ? <p className="success-inline" role="status">{notice}</p> : null}
      {error ? <p className="identity-error" role="alert">{error}</p> : null}
      {loading && items.length === 0 ? <p role="status">جارٍ قراءة ملفات الميدانيين…</p> : null}
      {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد ملفات بهذه المرحلة</strong><p>أنشئ ملفًا جديدًا أو غيّر البحث والمرحلة.</p></div> : null}
      {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th scope="col">الاسم والهاتف</th><th scope="col">مرحلة الملف</th><th scope="col">الخطوة التالية</th></tr></thead><tbody>
        {items.map((profile) => {
          const name = edits[profile.id] ?? profile.fullNameAr ?? "";
          const changed = name.trim() !== (profile.fullNameAr ?? "");
          const canCompleteLegacy = profile.state === "suspended" && profile.requiresProfileReview;
          const canEdit = profile.state === "pending_review" || canCompleteLegacy;
          return <tr key={profile.id}>
            <th scope="row"><div className="access-form"><label className="field-label" htmlFor={"field-candidate-name-" + profile.id}>الاسم<input id={"field-candidate-name-" + profile.id} value={name} maxLength={120} disabled={Boolean(busy) || !canEdit} onChange={(event) => setEdits((current) => ({ ...current, [profile.id]: event.target.value }))} /></label><bdi dir="ltr">{profile.contactPhoneE164 || "—"}</bdi></div></th>
            <td>{profile.requiresProfileReview ? "موقوف حتى استكمال الملف ومراجعته" : fieldAdmissionStateLabel(profile.state)} · الإصدار {profile.version}</td>
            <td><div className="access-form">
              {canEdit ? <>
                <button type="button" className="button button-secondary" disabled={Boolean(busy) || !changed} onClick={() => void mutate(profile, "update-profile")}>{busy === profile.id + ":update-profile" ? "جارٍ الحفظ…" : "حفظ الملف"}</button>
                {profile.state === "pending_review" ? <button type="button" className="button button-primary" disabled={Boolean(busy) || changed} onClick={() => void mutate(profile, "approve")}>{busy === profile.id + ":approve" ? "جارٍ الاعتماد…" : "اعتماد الملف"}</button> : null}
                {canCompleteLegacy ? <button type="button" className="button button-primary" disabled={Boolean(busy) || changed || !name.trim()} onClick={() => void mutate(profile, "review-profile")}>{busy === profile.id + ":review-profile" ? "جارٍ اعتماد المراجعة…" : "اعتماد الملف بعد المراجعة"}</button> : null}
              </> : null}
              {profile.state === "eligible" && profile.requiresProfileReview ? <span className="muted">أوقف الدور من قائمة الحسابات قبل استكمال الملف ومراجعته.</span> : null}
              {profile.state === "pending_identity" ? <button type="button" className="button button-primary" disabled={Boolean(busy)} onClick={() => void mutate(profile, "provision")}>{busy === profile.id + ":provision" ? "جارٍ منح الدور…" : "منح دور الميداني"}</button> : null}
              {profile.state === "eligible" && !profile.requiresProfileReview ? <span className="muted">اكتمل منح الدور؛ ينتظر تفعيل الحساب من الميداني.</span> : null}
              {profile.state === "suspended" ? <span className="muted">الأهلية موقوفة في DSH.</span> : null}
            </div></td>
          </tr>;
        })}
      </tbody></table></div> : null}
      {nextCursor ? <div className="workspace-toolbar"><button type="button" className="button button-secondary" disabled={loadingMore || Boolean(busy)} onClick={() => void load(nextCursor, true)}>{loadingMore ? "جارٍ تحميل المزيد…" : "تحميل المزيد"}</button></div> : null}
    </section>
  </>;
}

function fieldMutationSuccessMessage(action: "update-profile" | "approve" | "provision" | "review-profile"): string {
  if (action === "approve") return "اعتُمد ملف الميداني. أصبح منح الدور متاحًا بعد المراجعة.";
  if (action === "provision") return "مُنح دور الميداني بعد اعتماد الملف.";
  if (action === "review-profile") return "اعتُمد الملف بعد مراجعته. يبقى الدور موقوفًا حتى إعادة التفعيل.";
  return "حُدّث ملف الميداني.";
}
