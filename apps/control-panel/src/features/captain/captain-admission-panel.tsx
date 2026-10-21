"use client";
import { type CaptainAdmission, captainAdmissionStateLabel, captainAvailabilityStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { useCallback, useEffect, useRef, useState } from "react";
import { CursorPagination, useCursorPage } from "../../navigation/cursor-page";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { responseMessage } from "../access/identity-error-message";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { RegistryColumnHeader } from "../shared/registry-column-header";
import { CaptainCandidatePanel } from "./captain-candidate-panel";
import { CaptainDetailWorkspace } from "./captain-detail-workspace";

type CaptainRecord = ActorRoleView & Readonly<{ admission: CaptainAdmission | null }>;
type CaptainPage = Readonly<{ items: ReadonlyArray<CaptainRecord>; nextCursor?: string }>;

const admissionLabel = (admission: CaptainAdmission | null) => admission ? captainAdmissionStateLabel(admission.state) : "لا توجد أهلية تشغيل ";

export function CaptainAdmissionPanel() {
  const [query, setQuery] = useState("");
  const [enabledFilter, setEnabledFilter] = useState("");
  const [sort, setSort] = useState<"phone_asc" | "phone_desc">("phone_asc");
  const [identityFilter, setIdentityFilter] = useState("all");
  const [admissionFilter, setAdmissionFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [items, setItems] = useState<ReadonlyArray<CaptainRecord>>([]);
  const [nextCursor, setNextCursor] = useState("");
  const visibleCaptains = items.filter((captain) =>
    (identityFilter === "all" || (identityFilter === "activated" ? Boolean(captain.activatedAt) : !captain.activatedAt))
    && (admissionFilter === "all" || (admissionFilter === "none" ? !captain.admission : captain.admission?.state === admissionFilter))
    && (availabilityFilter === "all" || captain.admission?.availabilityState === availabilityFilter)
  );
  const hasPageFilters = identityFilter !== "all" || admissionFilter !== "all" || availabilityFilter !== "all";
  const cursorPage = useCursorPage("captainCursor", JSON.stringify([query, enabledFilter, sort]), true, (key) => {
    try {
      const [savedQuery, enabled, savedSort] = JSON.parse(key);
      if (typeof savedQuery !== "string" || !["", "true", "false"].includes(enabled) || !["phone_asc", "phone_desc"].includes(savedSort)) return;
      setQuery(savedQuery); setEnabledFilter(enabled); setSort(savedSort);
    } catch { /* An unrelated history entry starts at the first page. */ }
  });
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedCaptain, setSelectedCaptain] = useState("");
  const loadRequestID = useRef(0);

  useEffect(() => {
    const sync = () => setSelectedCaptain(new URLSearchParams(window.location.search).get("captain")?.slice(0, 160) ?? "");
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const selectCaptain = (actorId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("captain", actorId);
    window.history.pushState({ ...window.history.state }, "", url.pathname + url.search + url.hash);
    setSelectedCaptain(actorId);
  };
  const closeCaptain = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("captain");
    url.searchParams.delete("tab");
    window.history.pushState({ ...window.history.state }, "", url.pathname + url.search + url.hash);
    setSelectedCaptain("");
  };
  const selectedIndex = items.findIndex((item) => item.actorId === selectedCaptain);
  const selectedItem = selectedIndex >= 0 ? items[selectedIndex] : undefined;
  const moveSelection = (offset: number) => {
    const nextItem = items[selectedIndex + offset];
    if (nextItem) selectCaptain(nextItem.actorId);
  };

  const load = useCallback(async (cursor = cursorPage.cursor): Promise<boolean> => {
    const requestID = ++loadRequestID.current;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "25", q: query.trim(), sort });
      if (cursor) params.set("cursor", cursor);
      if (enabledFilter) params.set("enabled", enabledFilter);
      const response = await identityFetch(`/api/captains?${params}`);
      if (!response.ok) throw new Error(await responseMessage(response));
      const page = await response.json() as CaptainPage;
      if (requestID !== loadRequestID.current) return false;
      setItems(page.items);
      setNextCursor(page.nextCursor ?? "");
      return true;
    } catch (cause) {
      if (requestID !== loadRequestID.current) return false;
      setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذر قراءة سجل الكباتن.");
      setItems([]);
      setNextCursor("");
      return false;
    } finally {
      if (requestID === loadRequestID.current) setLoading(false);

    }
  }, [enabledFilter, query, sort, cursorPage.cursor]);

  useEffect(() => { if (cursorPage.ready) void load(); }, [load, cursorPage.ready]);
  useReadOnReturn(() => load(), cursorPage.ready && !loading && !busy && !Object.values(reasons).some((value) => value.trim()));

  async function changeStatus(captain: CaptainRecord) {
    const reason = reasons[captain.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير أهلية التشغيل.");
      return;
    }
    if (!captain.admission || !captain.activatedAt) {
      setError("تتطلب إدارة أهلية التشغيل تسجيل الهوية ووجود أهلية كابتن .");
      return;
    }
    const mustDisable = captain.enabled || (captain.admission.requiresProfileReview && captain.admission.state === "eligible");
    if (!mustDisable && captain.admission.requiresProfileReview) {
      setError("ملف الكابتن معلّق حتى استكماله ومراجعته؛ لا يمكن إعادة تفعيل الدور الآن.");
      return;
    }
    const action = mustDisable ? "disable" : "activate";
    setBusy(captain.actorId);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actorId: captain.actorId, expectedVersion: captain.roleVersion, reason }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت حالة أهلية الكابتن قبل الحفظ. أُعيد تحميل الحالة المعتمدة: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: captain.phoneE164 });
      const readbackResponse = await identityFetch(`/api/captains?${readbackParams}`);
      if (!readbackResponse.ok) { setError("تم التغيير لكن تعذرت إعادة قراءة الحالة المعتمدة للكابتن. أعد القراءة قبل أي إجراء آخر."); return; }
      const readback = await readbackResponse.json() as CaptainPage;
      const canonical = readback.items.find((item) => item.actorId === captain.actorId);
      if (!canonical) { setError("تم التغيير لكن لم يظهر الكابتن في إعادة القراءة المعتمدة. أعد القراءة قبل أي إجراء آخر."); return; }
      setReasons((current) => ({ ...current, [captain.actorId]: "" }));
      setNotice(`تم تغيير الأهلية وإعادة القراءة: الحساب ${canonical.enabled ? "نشط" : "موقوف"} · ${admissionLabel(canonical.admission)}.`);
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تحديث أهلية الكابتن.");
    } finally {
      setBusy("");
    }
  }

  async function reenroll(captain: CaptainRecord) {
    const reason = reasons[captain.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل إجازة إعادة التسجيل.");
      return;
    }
    if (!captain.enabled || !captain.securityEnabled || !captain.activatedAt || captain.admission?.state !== "eligible" || captain.admission.requiresProfileReview) {
      setError("تتطلب إعادة التسجيل هوية نشطة وأهلية كابتن سارية ومراجعة مكتملة .");
      return;
    }
    setBusy(captain.actorId + ":reenroll");
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reenroll",
          actorId: captain.actorId,
          expectedAdmissionVersion: captain.admission.version,
          expectedActorVersion: captain.actorVersion,
          expectedRoleVersion: captain.roleVersion,
          reason,
        }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412 || response.status >= 500) {
          const reloaded = await load();
          if (reloaded) {
            let recoveryMessage: string;
            if (response.status >= 500) {
              recoveryMessage = "تعذر تأكيد نتيجة الطلب؛ أُعيد تحميل الحالة المعتمدة قبل أي محاولة أخرى. ";
            } else {
              recoveryMessage = "تغيرت أهلية النظام أو نسخة الهوية قبل إعادة التسجيل. أُعيد تحميل الحالة المعتمدة: ";
            }
            setError(recoveryMessage + message);
          } else {
            setError("تعذر تأكيد النتيجة أو إعادة قراءة سجل الكباتن. حدّث السجل قبل أي محاولة أخرى. " + message);
          }
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: captain.phoneE164 });
      const readbackResponse = await identityFetch("/api/captains?" + readbackParams);
      if (!readbackResponse.ok) {
        const reloaded = await load();
        setError(reloaded ? "تعذرت إعادة قراءة التفصيل لكن تم تحديث سجل الكباتن. تحقق من التفعيل قبل أي إجراء آخر." : "تم إرسال الإجازة لكن تعذرت إعادة قراءة هوية الكابتن وأهلية النظام. حدّث السجل قبل أي إجراء آخر.");
        return;
      }
      const readback = await readbackResponse.json() as CaptainPage;
      const canonical = readback.items.find((item) => item.actorId === captain.actorId);
      if (!canonical || canonical.activatedAt || canonical.actorVersion !== captain.actorVersion || canonical.roleVersion !== captain.roleVersion + 1 || canonical.admission?.state !== "eligible" || canonical.admission.requiresProfileReview) {
        const reloaded = await load();
        setError(reloaded ? "إعادة القراءة لم تطابق التفعيل المتوقع؛ عُرضت أحدث حالة في السجل. راجعها قبل أي إجراء آخر." : "إعادة القراءة لم تثبت النتيجة وتعذر تحديث السجل. حدّثه قبل أي إجراء آخر.");
        return;
      }
      setReasons((current) => ({ ...current, [captain.actorId]: "" }));
      setNotice("تمت إجازة إعادة تسجيل الكابتن بعد تحقق النظام؛ أُعيدت قراءة النسخة " + canonical.roleVersion + ".");
      await load();
    } catch (cause) {
      const reloaded = await load();
      if (reloaded) {
        let recoveryDetail = "تحقق من التفعيل المعروض.";
        if (isRequestFailure(cause)) recoveryDetail = cause.message;
        setError("تعذر تأكيد نتيجة الطلب؛ أُعيد تحميل الحالة المعتمدة قبل أي محاولة أخرى. " + recoveryDetail);
      } else {
        setError("تعذر تأكيد نتيجة الطلب أو إعادة قراءة سجل الكباتن. حدّث السجل قبل أي محاولة أخرى.");
      }
    } finally {
      setBusy("");
    }
  }

  async function changeAvailability(captain: CaptainRecord) {
    const reason = reasons[captain.actorId]?.trim() ?? "";
    if (Array.from(reason).length < 5 || Array.from(reason).length > 500) {
      setError("اكتب سببًا من 5 إلى 500 حرف قبل تغيير توفر الكابتن.");
      return;
    }
    if (!captain.enabled || !captain.securityEnabled || !captain.activatedAt || !captain.admission || captain.admission.state !== "eligible") {
      setError("يتطلب تغيير التوفر هوية نشطة وأهلية تشغيل فعالة .");
      return;
    }
    const available = captain.admission.availabilityState !== "available";
    setBusy(`${captain.actorId}:availability`);
    setError("");
    setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "availability", actorId: captain.actorId, available, expectedVersion: captain.admission.version, reason }),
      });
      if (!response.ok) {
        const message = await responseMessage(response);
        if (response.status === 409 || response.status === 412) {
          await load();
          setError(`تغيرت حالة توفر الكابتن قبل الحفظ. أُعيد تحميل الحالة المعتمدة: ${message}`);
        } else setError(message);
        return;
      }
      const readbackParams = new URLSearchParams({ limit: "10", q: captain.phoneE164 });
      const readbackResponse = await identityFetch(`/api/captains?${readbackParams}`);
      if (!readbackResponse.ok) { setError("تم الطلب لكن تعذرت إعادة قراءة حالة التوفر . أعد القراءة قبل أي إجراء آخر."); return; }
      const readback = await readbackResponse.json() as CaptainPage;
      const canonical = readback.items.find((item) => item.actorId === captain.actorId);
      if (!canonical?.admission) { setError("تم الطلب لكن لم تظهر أهلية الكابتن في إعادة القراءة. أعد القراءة قبل أي إجراء آخر."); return; }
      setReasons((current) => ({ ...current, [captain.actorId]: "" }));
      setNotice(`تم تحديث حالة التوفر: ${captainAvailabilityStateLabel(canonical.admission.availabilityState)}.`);
      await load();
    } catch (cause) {
      setError(isRequestFailure(cause) ? cause.message : "تعذر تحديث توفر الكابتن.");
    } finally {
      setBusy("");
    }
  }

  return (
    <AdaptiveRecordWorkspace preferenceKey="captains" open={Boolean(selectedCaptain)} onClose={closeCaptain}
      detail={<AdaptiveRecordPanel title="ملف الكابتن"
        onClose={closeCaptain} onPrevious={selectedIndex > 0 ? () => moveSelection(-1) : undefined}
        onNext={selectedIndex >= 0 && selectedIndex < items.length - 1 ? () => moveSelection(1) : undefined}>
        {selectedCaptain ? <CaptainDetailWorkspace key={selectedCaptain} actorId={selectedCaptain} embedded /> : null}
      </AdaptiveRecordPanel>}>
      <CaptainCandidatePanel />
      <section className="access-card" aria-labelledby="captain-roster-title">
        <div className="access-card-heading"><h2 id="captain-roster-title">قائمة الكباتن وأهليتهم وتوفرهم</h2><p className="muted">إيقاف التشغيل يوقف الأهلية فقط؛ الهوية تبقى محفوظة.</p></div>
        <div className="workspace-toolbar">
          <label className="field-label" htmlFor="captain-search">بحث برقم الهاتف<input id="captain-search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث في أرقام الكباتن" /></label>
          <label className="field-label" htmlFor="captain-status-filter">حالة الدور<select id="captain-status-filter" value={enabledFilter} onChange={(event) => setEnabledFilter(event.target.value)}><option value="">كل الحالات</option><option value="true">مفعّل</option><option value="false">موقوف</option></select></label>
          <label className="field-label" htmlFor="captain-sort">ترتيب رقم الهاتف<select id="captain-sort" value={sort} onChange={(event) => setSort(event.target.value as "phone_asc" | "phone_desc")}><option value="phone_asc">تصاعدي</option><option value="phone_desc">تنازلي</option></select></label>
          <button type="button" className="button button-secondary" disabled={loading || Boolean(busy)} onClick={() => void load()}>{loading ? "جارٍ القراءة…" : "إعادة القراءة"}</button>
        </div>
        {notice ? <p className="success-inline" role="status">{notice}</p> : null}
        {error ? <p className="identity-error" role="alert">{error}</p> : null}
        {loading && items.length === 0 ? <p role="status">جارٍ قراءة قائمة الكباتن…</p> : null}
        {!loading && !error && items.length === 0 ? <div className="collection-state"><strong>لا توجد نتائج</strong><p>جرّب إزالة المرشح أو البحث برقم آخر.</p></div> : null}
        {items.length > 0 && hasPageFilters ? <p className="access-center-scope">معروض من الصفحة: {visibleCaptains.length} من {items.length}. المرشحات الإضافية تخص الصفحة الحالية.</p> : null}
        {items.length > 0 ? <div className="operations-table-wrap"><table className="operations-table"><thead><tr>
          <RegistryColumnHeader label="الاسم والهاتف">
            <label>بحث برقم الهاتف<input type="search" inputMode="tel" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="رقم الكابتن" /></label>
            <label>الترتيب<select value={sort} onChange={(event) => setSort(event.target.value as "phone_asc" | "phone_desc")}>
              <option value="phone_asc">الهاتف تصاعديًا</option><option value="phone_desc">الهاتف تنازليًا</option>
            </select></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="تسجيل الهوية" scope="page" active={identityFilter !== "all"}>
            <label>حالة التسجيل<select value={identityFilter} onChange={(event) => setIdentityFilter(event.target.value)}>
              <option value="all">جميع الحالات</option><option value="activated">مسجل</option><option value="pending">بانتظار التسجيل</option>
            </select></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="أهلية النظام" scope="page" active={admissionFilter !== "all"}>
            <label>الأهلية<select value={admissionFilter} onChange={(event) => setAdmissionFilter(event.target.value)}>
              <option value="all">كل الحالات</option><option value="none">بلا أهلية</option><option value="pending_review">بانتظار المراجعة</option><option value="pending_identity">بانتظار الهوية</option><option value="eligible">مؤهل</option><option value="suspended">موقوف</option>
            </select></label>
          </RegistryColumnHeader>
          <RegistryColumnHeader label="التوفر" scope="page" active={availabilityFilter !== "all"}>
            <label>حالة التوفر<select value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}>
              <option value="all">الجميع</option><option value="available">متاح</option><option value="unavailable">غير متاح</option>
            </select></label>
          </RegistryColumnHeader>
          <th scope="col">إدارة الأهلية</th>
        </tr></thead><tbody>
          {visibleCaptains.map((captain, index) => {
            const requiresProfileReview = captain.admission?.requiresProfileReview === true;
            const operationallyEnabled = captain.enabled && captain.admission?.state === "eligible" && !requiresProfileReview;
            const mustDisableForProfileReview = requiresProfileReview && captain.admission?.state === "eligible";
            const shouldDisable = captain.enabled || mustDisableForProfileReview;
            const canChangeAvailability = operationallyEnabled && captain.securityEnabled && Boolean(captain.activatedAt);
            const canReenroll = operationallyEnabled && captain.securityEnabled && Boolean(captain.activatedAt);
            let identityStatusLabel: string;
            if (!captain.securityEnabled) {
              identityStatusLabel = "الهوية موقوفة أمنيًا";
            } else if (requiresProfileReview) {
              identityStatusLabel = captain.enabled ? "بانتظار إيقاف الوصول" : "الوصول موقوف";
            } else if (captain.activatedAt) {
              identityStatusLabel = captain.enabled ? "نشط" : "الدور موقوف";
            } else {
              identityStatusLabel = "بانتظار التفعيل";
            }

            const statusActionClass = shouldDisable ? "button button-secondary" : "button button-primary";
            let statusActionLabel = shouldDisable ? "إيقاف التشغيل" : "إعادة التفعيل";
            if (busy === captain.actorId) statusActionLabel = "جارٍ التحديث…";

            let availabilityActionLabel = captain.admission?.availabilityState === "available" ? "جعله غير متاح" : "جعله متاحًا";
            if (busy === `${captain.actorId}:availability`) availabilityActionLabel = "جارٍ التحديث…";

            return <tr key={captain.actorId}>
            <th scope="row"><button type="button" className="button button-secondary" aria-label={`فتح ملف ${captain.admission?.fullNameAr || captain.fullNameAr || captain.phoneE164}`}
              onClick={() => selectCaptain(captain.actorId)}>فتح الملف</button><br /><strong>{captain.admission?.fullNameAr || captain.fullNameAr || "—"}</strong><br /><bdi dir="ltr">{captain.phoneE164}</bdi></th>
            <td>{identityStatusLabel}</td>
            <td>{requiresProfileReview ? "الملف يحتاج استكمالًا ومراجعة" : admissionLabel(captain.admission)}</td>
            <td>{captain.admission ? captainAvailabilityStateLabel(captain.admission.availabilityState) : "—"}</td>
            <td>{captain.admission && (captain.activatedAt || shouldDisable) ? <details open={mustDisableForProfileReview}><summary>إدارة التشغيل</summary><div className="access-form">
              <label className="field-label" htmlFor={`captain-reason-${index}`}>سبب الإجراء<input id={`captain-reason-${index}`} maxLength={500} value={reasons[captain.actorId] ?? ""} onChange={(event) => setReasons((current) => ({ ...current, [captain.actorId]: event.target.value }))} disabled={Boolean(busy)} /></label>
              {shouldDisable || !requiresProfileReview ? <button type="button" className={statusActionClass} disabled={Boolean(busy) || (reasons[captain.actorId] ?? "").trim().length < 5} onClick={() => void changeStatus(captain)}>{statusActionLabel}</button> : <span className="muted">استكمل الملف واعتمده قبل إعادة التفعيل.</span>}
              {canReenroll ? <button type="button" className="button button-secondary" disabled={Boolean(busy) || (reasons[captain.actorId] ?? "").trim().length < 5} onClick={() => void reenroll(captain)}>{busy === captain.actorId + ":reenroll" ? "جارٍ التحقق وإجازة التسجيل…" : "إجازة إعادة التسجيل"}</button> : null}
              <button type="button" className="button button-secondary" disabled={Boolean(busy) || !canChangeAvailability || (reasons[captain.actorId] ?? "").trim().length < 5} onClick={() => void changeAvailability(captain)}>{availabilityActionLabel}</button>
            </div></details> : <span className="muted">بانتظار اكتمال التسجيل والأهلية.</span>}</td>
          </tr>;
          })}
          {visibleCaptains.length === 0 && !loading ? <tr><td colSpan={5}>لا توجد نتائج مطابقة في الصفحة الحالية. امسح مرشحات الأعمدة.</td></tr> : null}
        </tbody></table></div> : null}
    <CursorPagination page={cursorPage} nextCursor={nextCursor} disabled={loading || Boolean(busy)} label="صفحات الكباتن" />
      </section>
    </AdaptiveRecordWorkspace>
  );
}
