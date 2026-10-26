"use client";

import {
  type BeneficiaryPayoutState, type CaptainAdmission, captainAdmissionStateLabel,
  captainAvailabilityStateLabel, formatMoney, orderStateLabel, payoutStatusLabel,
} from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { Tabs } from "antd";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { identityFetch, isRequestFailure } from "../../session/identity-fetch";
import { PageHeader } from "../../shell/page-header";
import { responseMessage } from "../access/identity-error-message";
import { ActorWalletStatement } from "../finance/actor-wallet-statement";
import { OfficialWalletDestinationManager } from "../finance/official-wallet-destination-manager";
import { useReadOnReturn } from "../shared/use-read-on-return";

type CaptainDetail = Readonly<{ captain: ActorRoleView; admission: CaptainAdmission | null }>;
type FinancialStatement = Readonly<{
  currency: "YER"; openingBalanceMinor: number; creditsMinor: number; debitsMinor: number;
  closingBalanceMinor: number; currentBalanceMinor: number; nextCursor?: string;
  entries: ReadonlyArray<Readonly<{
    transactionId: string; transactionType: string; sourceType: string; sourceId: string;
    direction: "CREDIT" | "DEBIT"; amountMinor: number; createdAt: string;
    order?: Readonly<{ orderId: string; storeName: string; state: string; totalAmountMinor: number }>;
  }>>;
}>;
type FinanceResult = Readonly<{ state: BeneficiaryPayoutState }>;
type FinanceVisibility = "loading" | "ready" | "restricted" | "error";
type CaptainTab = "overview" | "orders" | "performance" | "finance" | "account" | "history";
const captainTabs: ReadonlyArray<Readonly<{ id: CaptainTab; label: string }>> = [
  { id: "overview", label: "نظرة عامة" },
  { id: "orders", label: "الطلبات" },
  { id: "performance", label: "الأداء" },
  { id: "finance", label: "المالية" },
  { id: "account", label: "الحساب والأهلية" },
  { id: "history", label: "السجل" },
];
function validCaptainTab(value: string | null): CaptainTab {
  return captainTabs.find((tab) => tab.id === value)?.id ?? "overview";
}

const dateLabel = (value?: string | null) => {
  if (!value) return "لم يسجل بعد";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "غير متاح" : new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short" }).format(date);
};
const money = (value: number) => formatMoney(value, "YER");
const summaryLabel = (detail: CaptainDetail) => {
  if (!detail.captain.securityEnabled) return "الهوية موقوفة أمنيًا";
  if (!detail.captain.activatedAt) return "لم يكتمل التفعيل";
  if (!detail.captain.enabled || detail.admission?.state !== "eligible" || detail.admission.requiresProfileReview) return "غير مؤهل للتشغيل";
  return detail.admission.availabilityState === "available" ? "متاح من جهة الأهلية" : "غير متاح حاليًا";
};

function Card({ title, children, action }: Readonly<{ title: string; children: ReactNode; action?: ReactNode }>) {
  return <section className={"captain-profile-card"}><header className={"captain-profile-cardHeader"}><h2>{title}</h2>{action}</header>{children}</section>;
}
function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <div className={"captain-profile-fact"}><dt>{label}</dt><dd>{children}</dd></div>;
}

export function CaptainDetailWorkspace({ actorId, embedded = false }: Readonly<{ actorId: string; embedded?: boolean }>) {
  const [detail, setDetail] = useState<CaptainDetail | null>(null);
  const [activeTab, setActiveTab] = useState<CaptainTab>("overview");
  const switchTab = useCallback((next: CaptainTab) => {
    setActiveTab(next);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (next === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", next);
      window.history.pushState({}, "", url.pathname + url.search + url.hash);
    }
  }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [selectedAction, setSelectedAction] = useState<"activate" | "disable" | "availability" | "reenroll" | "approve" | "review-profile" | "provision" | null>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [payout, setPayout] = useState<BeneficiaryPayoutState | null>(null);
  const [statement, setStatement] = useState<FinancialStatement | null>(null);
  const [financeVisibility, setFinanceVisibility] = useState<FinanceVisibility>("loading");
  const [financeMessage, setFinanceMessage] = useState("");
  const loadRef = useRef(0);
  const financeRef = useRef(0);

  const loadDetail = useCallback(async (showLoading = true): Promise<CaptainDetail | null> => {
    const id = ++loadRef.current;
    if (showLoading) setLoading(true);
    setError("");
    try {
      const response = await identityFetch(`/api/captains/${encodeURIComponent(actorId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseMessage(response));
      const result = await response.json() as CaptainDetail;
      if (id !== loadRef.current) return null;
      setDetail(result);
      return result;
    } catch (cause) {
      if (id === loadRef.current) setError(isRequestFailure(cause) ? cause.message : cause instanceof Error ? cause.message : "تعذرت قراءة ملف الكابتن.");
      return null;
    } finally {
      if (showLoading && id === loadRef.current) setLoading(false);
    }
  }, [actorId]);

  const loadFinance = useCallback(async () => {
    const id = ++financeRef.current;
    setFinanceVisibility("loading");
    setFinanceMessage("");
    const today = new Date().toISOString().slice(0, 10);
    const fromDate = new Date();
    fromDate.setUTCDate(fromDate.getUTCDate() - 30);
    const query = new URLSearchParams({ from: fromDate.toISOString().slice(0, 10), to: today });
    try {
      const [payoutResponse, ledgerResponse] = await Promise.all([
        identityFetch(`/api/finance/actor-payout-state?actorType=captain&actorId=${encodeURIComponent(actorId)}`, { cache: "no-store" }),
        identityFetch(`/api/finance/beneficiaries/captain/${encodeURIComponent(actorId)}/financial-statement?${query}`, { cache: "no-store" }),
      ]);
      if (id !== financeRef.current) return;
      if (payoutResponse.status === 403 || ledgerResponse.status === 403) {
        setPayout(null); setStatement(null); setFinanceVisibility("restricted"); return;
      }
      if (!payoutResponse.ok || !ledgerResponse.ok) throw new Error("تعذرت قراءة المستحقات أو القيود المالية من مصدرها.");
      const state = await payoutResponse.json() as FinanceResult;
      const ledger = await ledgerResponse.json() as Readonly<{ statement: FinancialStatement }>;
      if (id !== financeRef.current) return;
      if (state.state.actorId !== actorId) throw new Error("اختلف معرّف الكابتن في القراءة المالية.");
      setPayout(state.state);
      setStatement(ledger.statement);
      setFinanceVisibility("ready");
    } catch (cause) {
      if (id === financeRef.current) {
        setPayout(null); setStatement(null);
        setFinanceVisibility("error");
        setFinanceMessage(cause instanceof Error ? cause.message : "تعذرت قراءة البيانات المالية.");
      }
    }
  }, [actorId]);

  useEffect(() => {
    const readTab = () => setActiveTab(validCaptainTab(new URLSearchParams(window.location.search).get("tab")));
    readTab();
    window.addEventListener("popstate", readTab);
    return () => window.removeEventListener("popstate", readTab);
  }, []);

  useEffect(() => {
    void loadDetail();
    void loadFinance();
    return () => { loadRef.current++; financeRef.current++; };
  }, [loadDetail, loadFinance]);

  useReadOnReturn(() => { void loadDetail(false); void loadFinance(); }, !loading && !busy && selectedAction === null && editName === null);

  async function mutate(action: "activate" | "disable" | "availability" | "reenroll") {
    if (!detail?.admission) return;
    const { captain, admission } = detail;
    const normalizedReason = reason.trim();
    if (Array.from(normalizedReason).length < 5 || Array.from(normalizedReason).length > 500) {
      setError("اكتب سببًا واضحًا من 5 إلى 500 حرف.");
      return;
    }
    const operational = captain.enabled && captain.securityEnabled && Boolean(captain.activatedAt) &&
      admission.state === "eligible" && !admission.requiresProfileReview;
    const mustDisable = captain.enabled || (admission.state === "eligible" && admission.requiresProfileReview);
    if (action === "activate" && (mustDisable || !captain.activatedAt || !captain.securityEnabled ||
      admission.state !== "eligible" || admission.requiresProfileReview)) {
      setError("لا يمكن التفعيل قبل اكتمال التسجيل ومراجعة الأهلية."); return;
    }
    if (action === "availability" && !operational) { setError("التوفر متاح للتحكم للكابتن المؤهل فقط."); return; }
    if (action === "reenroll" && !operational) { setError("إعادة التسجيل تتطلب دورًا نشطًا وأهلية مكتملة."); return; }
    if (action === "disable" && !mustDisable) { setError("الدور موقوف بالفعل."); return; }

    const available = admission.availabilityState !== "available";
    const expectedEnabled = action === "activate";
    const previous = detail;
    setBusy(action); setError(""); setNotice("");
    try {
      const body = action === "availability"
        ? { action, actorId, available, expectedVersion: admission.version, reason: normalizedReason }
        : action === "reenroll"
          ? { action, actorId, expectedAdmissionVersion: admission.version, expectedActorVersion: captain.actorVersion, expectedRoleVersion: captain.roleVersion, reason: normalizedReason }
          : { action, actorId, expectedVersion: captain.roleVersion, reason: normalizedReason };
      const response = await identityFetch("/api/captains", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(await responseMessage(response));
      const canonical = await loadDetail(false);
      if (!canonical) {
        setError("تم إرسال الإجراء لكن تعذرت إعادة قراءة النتيجة المعتمدة. حدّث الملف قبل إجراء آخر."); return;
      }
      const verified = action === "availability" ? canonical.admission?.availabilityState === (available ? "available" : "unavailable")
        : action === "reenroll" ? !canonical.captain.activatedAt && canonical.captain.roleVersion === previous.captain.roleVersion + 1
        : canonical.captain.enabled === expectedEnabled;
      if (!verified) { setError("لم تطابق الحالة المعتمدة النتيجة المتوقعة. راجع أحدث حالة قبل إجراء آخر."); return; }
      setReason("");
      setSelectedAction(null);
      setNotice(action === "availability" ? "تم تحديث حالة التوفر والتحقق منها." : action === "reenroll" ? "أجيزت إعادة التسجيل، ويجب أن يُكمل الكابتن التفعيل من التطبيق." : "تم تحديث أهلية الدور وإعادة قراءة النتيجة.");
    } catch (cause) {
      await loadDetail(false);
      setError(cause instanceof Error ? `تعذر تأكيد الإجراء؛ أُعيدت قراءة الملف. ${cause.message}` : "تعذر تأكيد الإجراء؛ تحقق من الحالة المعتمدة.");
    } finally { setBusy(""); }
  }

  async function saveName() {
    if (!detail?.admission || editName === null) return;
    const admission = detail.admission;
    const canEdit = admission.state === "pending_review" || (admission.state === "suspended" && admission.requiresProfileReview);
    const name = editName.trim();
    if (!canEdit || Array.from(name).length < 2 || Array.from(name).length > 120) {
      setError("تعديل الاسم متاح فقط قبل الاعتماد أو عند استكمال ملف موقوف، بطول 2 إلى 120 حرفًا."); return;
    }
    setBusy("name"); setError(""); setNotice("");
    try {
      const response = await identityFetch("/api/captains", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update-profile", admissionId: admission.id, fullNameAr: name, expectedVersion: admission.version }) });
      if (!response.ok) throw new Error(await responseMessage(response));
      const canonical = await loadDetail(false);
      if (!canonical || canonical.admission?.fullNameAr !== name) { setError("لم تؤكد إعادة القراءة الاسم الجديد. راجع الملف."); return; }
      setEditName(null); setNotice("حُفظ اسم الملف بعد إعادة القراءة المعتمدة.");
    } catch (cause) {
      await loadDetail(false);
      setError(cause instanceof Error ? cause.message : "تعذر تحديث الاسم.");
    } finally { setBusy(""); }
  }

  async function mutateAdmission(action: "approve" | "review-profile" | "provision") {
    if (!detail?.admission || busy) return;
    const profile = detail.admission;
    const allowed = action === "approve" ? profile.state === "pending_review"
      : action === "review-profile" ? profile.state === "suspended" && profile.requiresProfileReview
      : profile.state === "pending_identity";
    if (!allowed) return;
    setBusy(action); setError(""); setNotice("");
    try {
      const response = await identityFetch("/api/captains", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, admissionId: profile.id, expectedVersion: profile.version }),
      });
      if (!response.ok) throw new Error(await responseMessage(response));
      const canonical = await loadDetail(false);
      if (!canonical?.admission || canonical.admission.version <= profile.version) {
        setError("تعذر التحقق من تحديث القبول. أعد القراءة قبل اتخاذ إجراء آخر."); return;
      }
      const verified = action === "approve" ? canonical.admission.state === "pending_identity"
        : action === "review-profile" ? !canonical.admission.requiresProfileReview
        : Boolean(canonical.admission.actorId);
      if (!verified) { setError("نتيجة القبول لا تطابق الحالة المتوقعة؛ راجع الملف المعتمد."); return; }
      setSelectedAction(null);
      setNotice(action === "approve" ? "تم اعتماد الملف. يمكن متابعة تأسيس الحساب." :
        action === "review-profile" ? "اكتملت مراجعة الملف وتحققت الحالة." : "تم تأسيس الحساب والتحقق من الربط.");
    } catch (cause) {
      await loadDetail(false);
      setError(cause instanceof Error ? cause.message : "تعذر تنفيذ الإجراء.");
    } finally { setBusy(""); }
  }

  const captain = detail?.captain;
  const admission = detail?.admission;
  const ready = Boolean(captain?.enabled && captain.securityEnabled && captain.activatedAt && admission?.state === "eligible" && !admission.requiresProfileReview);
  const canDisable = Boolean(captain?.enabled || (admission?.state === "eligible" && admission.requiresProfileReview));
  const canActivate = !canDisable && Boolean(captain?.activatedAt && captain.securityEnabled && admission?.state === "eligible" && !admission.requiresProfileReview);
  const canEditName = admission?.state === "pending_review" || (admission?.state === "suspended" && admission.requiresProfileReview);
  const financeReady = financeVisibility === "ready" && payout !== null && statement !== null;
  // A ledger can contain multiple entries per order. This is NOT the complete order roster.
  const relatedOrders = Array.from(new Map(
    (statement?.entries ?? []).filter((entry) => Boolean(entry.order)).map((entry) => [entry.order!.orderId, entry] as const),
  ).values());
  const status = detail ? summaryLabel(detail) : "جارٍ القراءة";
  const actionOptions = [
    { id: canDisable ? "disable" : "activate", label: canDisable ? "إيقاف الكابتن" : "تفعيل الكابتن", enabled: canDisable || canActivate, kind: "role" },
    { id: "availability", label: admission?.availabilityState === "available" ? "إيقاف استقبال الطلبات" : "السماح باستقبال الطلبات", enabled: ready, kind: "availability" },
    { id: "reenroll", label: "إعادة تسجيل الدخول والتفعيل", enabled: ready, kind: "security" },
    ...(admission?.state === "pending_review" ? [{ id: "approve" as const, label: "اعتماد طلب الانضمام", enabled: true, kind: "admission" }] : []),
    ...(admission?.state === "pending_identity" ? [{ id: "provision" as const, label: "تأسيس حساب الكابتن", enabled: true, kind: "admission" }] : []),
    ...(admission?.state === "suspended" && admission.requiresProfileReview ? [{ id: "review-profile" as const, label: "استكمال مراجعة الملف", enabled: true, kind: "admission" }] : []),
  ] as const;
  const reasonRequired = selectedAction !== null && ["activate", "disable", "availability", "reenroll"].includes(selectedAction);
  const selectedOption = actionOptions.find((option) => option.id === selectedAction);

  const renderTabContent = (tab: CaptainTab) => {
    if (!detail || !captain) return null;
    return (
      <div className="captain-profile-layout captain-profile-single">
        <div className={tab === "orders" || tab === "history" ? "captain-profile-content captain-profile-contentWide" : "captain-profile-content"}>
          {tab === "overview" ? <>
          <ActorWalletStatement actorType="captain" actorId={actorId} />
            <section className="captain-profile-overviewMain" aria-labelledby="captain-overview-status">
              <div className="captain-profile-overviewHeading"><span className="captain-profile-eyebrow">حالة الكابتن الآن</span><h2 id="captain-overview-status">{ready ? "ملف معتمد ومفعّل" : "يتطلب متابعة تشغيلية"}</h2><p>{ready ? "تستطيع إدارة التوفر أو إيقاف الحساب مباشرة من شريط التحكم. لا تعني هذه الحالة اجتياز شرط رصيد المحفظة." : "راجع حالة الهوية والقبول والتفعيل قبل السماح بإسناد الطلبات."}</p></div>
              <div className="captain-profile-checklist">
                <div><span>01</span><strong>الهوية والدور</strong><b>{captain.enabled && captain.securityEnabled && captain.activatedAt ? "مكتمل" : "يتطلب متابعة"}</b></div>
                <div><span>02</span><strong>اعتماد ملف القبول</strong><b>{admission?.state === "eligible" && !admission.requiresProfileReview ? "مكتمل" : "يتطلب متابعة"}</b></div>
                <div><span>03</span><strong>التوفر التشغيلي</strong><b>{admission ? captainAvailabilityStateLabel(admission.availabilityState) : "غير محدد"}</b></div>
                <div><span>04</span><strong>شرط رصيد استقبال الطلبات</strong><b>يتحقق عند الإسناد</b></div>
              </div>
              <button type="button" className="button button-secondary" onClick={() => switchTab("account")}>عرض البيانات والأهلية</button>
            </section>
            <section className="captain-profile-activity" aria-labelledby="captain-activity-heading">
              <div className="captain-profile-sectionHead"><div><span className="captain-profile-eyebrow">قراءة موثقة</span><h2 id="captain-activity-heading">آخر النشاط</h2></div><button type="button" className="button button-secondary" onClick={() => switchTab("history")}>سجل الملف</button></div>
              <dl className="captain-profile-activityGrid">
                <div><dt>آخر فتح للتطبيق</dt><dd>{dateLabel(captain.lastAppOpenedAt)}</dd></div>
                <div><dt>آخر تسجيل دخول</dt><dd>{dateLabel(captain.lastAuthenticatedAt)}</dd></div>
                <div><dt>تفعيل الحساب</dt><dd>{dateLabel(captain.activatedAt)}</dd></div>
                <div><dt>آخر تحديث للأهلية</dt><dd>{dateLabel(admission?.updatedAt)}</dd></div>
              </dl>
            </section>
            <section className="captain-profile-snapshot" aria-label="تفاصيل التشغيل والمالية">
              <div><div><strong>الطلبات</strong><p>{financeReady ? `${relatedOrders.length} طلب مرتبط بقيد مالي` : "سجل الطلبات المالية غير متاح حاليًا"}</p><small>ليست جميع الطلبات المسندة</small></div><button type="button" className="button button-secondary" onClick={() => switchTab("orders")}>فتح الطلبات</button></div>
              <div><div><strong>المالية</strong><p>{financeReady ? `المتاح للصرف: ${money(payout.eligibleAvailableMinor)}` : financeVisibility === "restricted" ? "صلاحية المالية مطلوبة" : "بانتظار بيانات المستحقات"}</p><small>منفصلة عن رصيد المحفظة التشغيلي</small></div><button type="button" className="button button-secondary" onClick={() => switchTab("finance")}>إدارة المالية</button></div>
            </section>
          </> : null}
          {tab === "performance" ? <>
            <Card title="المؤشرات المتاحة من الأنظمة">
              <dl className={"captain-profile-facts"}>
                <Fact label="آخر فتح للتطبيق">{dateLabel(captain.lastAppOpenedAt)}</Fact>
                <Fact label="آخر تسجيل دخول">{dateLabel(captain.lastAuthenticatedAt)}</Fact>
                <Fact label="حالة الأهلية">{admission ? captainAdmissionStateLabel(admission.state) : "غير متاحة"}</Fact>
                <Fact label="طلبات لها قيود مالية">{financeReady ? `${relatedOrders.length}${statement.nextCursor ? " (الصفحة الحالية)" : ""}` : "غير متاح"}</Fact>
                <Fact label="إجمالي القيود الدائنة (30 يومًا)">{financeReady ? money(statement.creditsMinor) : "غير متاح"}</Fact>
                <Fact label="إجمالي القيود المدينة (30 يومًا)">{financeReady ? money(statement.debitsMinor) : "غير متاح"}</Fact>
              </dl>
              <p className={"captain-profile-hint"}>الحركات الدائنة ليست بالضرورة أرباح توصيل. وعدد الطلبات المرتبطة بكشف القيود لا يساوي إجمالي الطلبات المنفذة.</p>
            </Card>
            <Card title="مؤشرات جودة التوصيل">
              <dl className={"captain-profile-facts"}>
                <Fact label="معدل قبول العروض">غير قابل للحساب بعد</Fact>
                <Fact label="معدل التسليم الناجح">غير قابل للحساب بعد</Fact>
                <Fact label="نسبة الالتزام بالموعد">غير قابل للحساب بعد</Fact>
                <Fact label="متوسط زمن التوصيل">غير قابل للحساب بعد</Fact>
                <Fact label="تقييم العملاء">غير متاح من مصدر معتمد</Fact>
              </dl>
              <p className={"captain-profile-hint"}>يلزم سجل عروض مُرسلة ومقبولة، ومهام إسناد وتسليم بأوقات فعلية، ومواعيد التوصيل الموعودة، وتقييمات موثقة. تُحسب النسب على فترة محددة وبمقامات واضحة بعد توافر تلك البيانات؛ لا تُعرض قيمة صفر أو 100% عند غياب المصدر.</p>
            </Card>
          </> : null}
          {tab === "account" ? <Card title="البيانات والهوية" action={canEditName ? <button className="button button-secondary" type="button" onClick={() => setEditName(admission?.fullNameAr ?? "")}>تعديل اسم الملف</button> : null}>
            <dl className={"captain-profile-facts"}>
              <Fact label="الاسم">{admission?.fullNameAr || captain.fullNameAr || "غير مسجل"}</Fact>
              <Fact label="الهاتف"><bdi dir="ltr">{captain.phoneE164}</bdi></Fact>
              <Fact label="حالة الدور">{captain.enabled ? "مفعّل" : "موقوف"}</Fact>
              <Fact label="الهوية الأمنية">{captain.securityEnabled ? "نشطة" : "موقوفة"}</Fact>
              <Fact label="التفعيل">{captain.activatedAt ? dateLabel(captain.activatedAt) : "بانتظار التفعيل"}</Fact>
              <Fact label="إنشاء الحساب">{dateLabel(captain.createdAt)}</Fact>
              <Fact label="آخر فتح للتطبيق">{dateLabel(captain.lastAppOpenedAt)}</Fact>
              <Fact label="آخر تسجيل دخول">{dateLabel(captain.lastAuthenticatedAt)}</Fact>
            </dl>
            {editName !== null ? <div className={"captain-profile-form"}>
              <label htmlFor="captain-full-name">اسم الملف المعتمد<input id="captain-full-name" value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} disabled={Boolean(busy)} /></label>
              <div className={"captain-profile-actions"}><button className="button button-primary" type="button" disabled={Boolean(busy) || editName.trim() === (admission?.fullNameAr ?? "")} onClick={() => void saveName()}>حفظ الاسم</button><button className="button button-secondary" type="button" onClick={() => setEditName(null)} disabled={Boolean(busy)}>إلغاء</button></div>
            </div> : null}
          </Card> : null}

          {tab === "account" ? <Card title="الانضمام وأهلية التوصيل">
            <dl className={"captain-profile-facts"}>
              <Fact label="حالة القبول">{admission ? captainAdmissionStateLabel(admission.state) : "لا يوجد ملف أهلية مرتبط"}</Fact>
              <Fact label="مراجعة الملف">{admission ? admission.requiresProfileReview ? "يحتاج استكمالًا ومراجعة" : "لا توجد مراجعة معلقة" : "غير متاح"}</Fact>
              <Fact label="التوفر التشغيلي">{admission ? captainAvailabilityStateLabel(admission.availabilityState) : "غير متاح"}</Fact>
              <Fact label="إنشاء ملف القبول">{dateLabel(admission?.createdAt)}</Fact>
              <Fact label="آخر تحديث للأهلية">{dateLabel(admission?.updatedAt)}</Fact>
            </dl>
            {admission?.requiresProfileReview ? <p className={"captain-profile-hint"}>الملف يتطلب مراجعة قبل إعادة تفعيل الدور. إجراءات الاعتماد متاحة من سجل القبول حسب المرحلة.</p> : null}
          </Card> : null}

          {tab === "finance" ? <Card title="المستحقات والتسويات" action={<Link href={`/finance/beneficiary-settlement/captains?search=${encodeURIComponent(captain.phoneE164)}`} className="button button-secondary">فتح الإدارة المالية</Link>}>
            {financeVisibility === "loading" ? <p role="status" className={"captain-profile-hint"}>جارٍ قراءة البيانات المالية…</p> : null}
            {financeVisibility === "restricted" ? <p className={"captain-profile-hint"}>التفاصيل المالية لا تظهر دون صلاحية المالية. لا تُكشف بيانات التسويات عبر صلاحية العمليات وحدها.</p> : null}
            {financeVisibility === "error" ? <div className={"captain-profile-hint"}>{financeMessage} <button type="button" className="button button-secondary" onClick={() => void loadFinance()}>إعادة القراءة</button></div> : null}
            {financeReady ? <>
              <dl className={"captain-profile-facts"}>
                <Fact label="المستحق المتاح">{money(payout.eligibleAvailableMinor)}</Fact>
                <Fact label="المستحق المحجوز">{money(payout.heldMinor)}</Fact>
                <Fact label="قيد آخر صرف">{payout.latestPayout ? payoutStatusLabel(payout.latestPayout.status) : "لا يوجد طلب صرف معروض"}</Fact>
                <Fact label="مبلغ آخر طلب صرف">{payout.latestPayout ? money(payout.latestPayout.resolvedAmountMinor) : "—"}</Fact>
                <Fact label="تاريخ آخر طلب صرف">{dateLabel(payout.latestPayout?.createdAt)}</Fact>
                <Fact label="قيود دائنة خلال 30 يومًا">{money(statement.creditsMinor)}</Fact>
                <Fact label="قيود مدينة خلال 30 يومًا">{money(statement.debitsMinor)}</Fact>
              </dl>
              <h3 className={"captain-profile-subheading"}>آخر القيود المعروضة خلال 30 يومًا</h3>
              {statement.entries.length ? <div className={"captain-profile-tableWrap"}><table className="operations-table"><thead><tr><th>العملية</th><th>المبلغ</th><th>التاريخ</th></tr></thead><tbody>
                {statement.entries.slice(0, 12).map((entry) => <tr key={entry.transactionId}><td>{entry.order ? <Link href={`/operations/${encodeURIComponent(entry.order.orderId)}`}>{entry.order.storeName || "فتح الطلب"}</Link> : <bdi dir="ltr">{entry.transactionType}</bdi>}</td><td>{entry.direction === "CREDIT" ? "+" : "−"}{money(entry.amountMinor)}</td><td>{dateLabel(entry.createdAt)}</td></tr>)}
              </tbody></table></div> : <p className={"captain-profile-hint"}>لا توجد قيود خلال الفترة المعروضة.</p>}
              {statement.nextCursor ? <p className={"captain-profile-hint"}>توجد قيود إضافية؛ اعرض الكشف الكامل من الإدارة المالية.</p> : null}
            </> : null}
          </Card> : null}

          {tab === "orders" ? <Card title="الطلبات والتسليم" action={<Link href="/operations" className="button button-secondary">إدارة الطلبات</Link>}>
            <p className={"captain-profile-hint"}>هذه الطلبات مرتبطة بقيود مالية للكابتن خلال آخر 30 يومًا، وليست العدد الكلي للتوصيلات أو سجل الإسناد المباشر.</p>
            {financeReady && relatedOrders.length > 0 ? <div className={"captain-profile-tableWrap"}><table className="operations-table"><thead><tr><th>المتجر</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>
              {relatedOrders.slice(0, 25).map((entry) => <tr key={entry.transactionId}><td>{entry.order!.storeName}</td><td>{orderStateLabel(entry.order!.state as Parameters<typeof orderStateLabel>[0])}</td><td><Link href={`/operations/${encodeURIComponent(entry.order!.orderId)}`}>فتح الطلب</Link></td></tr>)}
            </tbody></table></div> : <p className={"captain-profile-hint"}>{financeVisibility === "restricted" ? "تتطلب الطلبات المالية صلاحية المالية." : financeVisibility === "loading" ? "جارٍ قراءة القيود المالية." : financeVisibility === "error" ? "تعذرت قراءة قيود الطلبات؛ لا يعني ذلك عدم وجود طلبات." : "لا توجد طلبات ذات قيود مالية ظاهرة خلال الفترة."}</p>}
            {financeReady && statement.nextCursor ? <p className={"captain-profile-hint"}>النتيجة جزئية: توجد صفحات أخرى في الكشف المالي. لا تُستخدم القائمة لإحصاء جميع التوصيلات.</p> : null}
          </Card> : null}

          {tab === "finance" ? <Card title="المحفظة ووجهة صرف المستحقات">
            <dl className={"captain-profile-facts"}>
              <Fact label="مزوّد المحفظة المُختار">{admission?.walletProviderKey || "غير محدد"}</Fact>
              <Fact label="وجهة الصرف الرسمية">{financeReady ? payout.destination?.beneficiaryName || "لم تُحدد وجهة صرف" : "—"}</Fact>
              <Fact label="المزوّد المالي المعتمد">{financeReady ? payout.destination?.providerKey || "غير محدد" : "—"}</Fact>
              <Fact label="رقم المحفظة المُقنّع">{financeReady ? payout.destination?.walletIdentifierMasked || "—" : "—"}</Fact>
              <Fact label="حالة وجهة الصرف">{financeReady ? payout.destination?.status || "لا توجد وجهة" : "—"}</Fact>
              <Fact label="حالة التحقق">{financeReady ? payout.destination?.verificationStatus || "—" : "—"}</Fact>
            </dl>
            <p className={"captain-profile-hint"}>مستحقات الصرف لا تمثل رصيد محفظة الكابتن التشغيلي. تعديل وجهة الصرف يخضع لصلاحية المالية والتحقق المستقل.</p>
            {financeReady ? <OfficialWalletDestinationManager actorType="captain" actorId={actorId} /> : null}
            <ActorWalletStatement actorType="captain" actorId={actorId} />
          </Card> : null}

          {tab === "history" ? <Card title="سجل الملف والمرجعيات">
            <details>
              <summary>مرجعيات الدعم والتدقيق</summary>
              <dl className={"captain-profile-facts"}>
                <Fact label="معرّف الكابتن"><bdi dir="ltr">{captain.actorId}</bdi></Fact>
                {admission ? <Fact label="معرّف ملف الأهلية"><bdi dir="ltr">{admission.id}</bdi></Fact> : null}
                <Fact label="نسخة الدور">{captain.roleVersion}</Fact>
                <Fact label="نسخة الهوية">{captain.actorVersion}</Fact>
                <Fact label="نسخة أهلية التشغيل">{admission?.version ?? "—"}</Fact>
                <Fact label="تاريخ إنشاء القبول">{dateLabel(admission?.createdAt)}</Fact>
                <Fact label="آخر تعديل للقبول">{dateLabel(admission?.updatedAt)}</Fact>
              </dl>
            </details>
            <p className={"captain-profile-hint"}>هذه محطات الحالة المثبتة وليست سجل تدقيق كاملًا للمشغلين أو سجل تقييمات الكابتن. لا تُستنتج التقييمات أو الشكاوى من غياب بياناتها.</p>
          </Card> : null}
        </div>


      </div>
    );
  };

  return <section className="workspace-page captain-profile-page" aria-label="ملف الكابتن">
    {!embedded ? <PageHeader id="captain-detail-title" title="ملف الكابتن" actions={<Link href="/captains" className="button button-secondary">كل الكباتن</Link>} /> : null}
    {error ? <div className={"captain-profile-error"} role="alert">{error} <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => void loadDetail()}>إعادة القراءة</button></div> : null}
    {notice ? <p role="status" className="success-inline">{notice}</p> : null}
    {loading && !detail ? <div className="collection-state" role="status">جارٍ قراءة الملف المعتمد…</div> : null}
    {!loading && !detail ? <div className="collection-state">تعذر إظهار ملف الكابتن. ارجع إلى السجل أو أعد القراءة.</div> : null}
    {detail && captain ? <>
      <header className={"captain-profile-hero"}>
        <div className={"captain-profile-avatar"} aria-hidden="true">{(admission?.fullNameAr || captain.fullNameAr || "ك").trim().slice(0, 1)}</div>
        <div className={"captain-profile-heroText"}>
          <h2>{admission?.fullNameAr || captain.fullNameAr || "الاسم غير مسجل"}</h2>
          <a href={`tel:${captain.phoneE164}`}><bdi dir="ltr">{captain.phoneE164}</bdi></a>
          <p>{status} · {admission ? captainAdmissionStateLabel(admission.state) : "ملف الأهلية غير متاح"}</p>
        </div>
        <div className={"captain-profile-heroActions"}>
          <Link className="button button-secondary" href="/operations">العمليات</Link>
        </div>
      </header>

      <Tabs aria-label="أقسام ملف الكابتن" className="captain-profile-tabs" activeKey={activeTab} onChange={(key) => switchTab(validCaptainTab(key))}
        destroyOnHidden={false} items={captainTabs.map(({ id, label }) => ({ key: id, label, children: renderTabContent(id) }))}
        tabBarExtraContent={<div className="captain-profile-toolbarActions">
          <details className="captain-profile-actionsMenu">
            <summary aria-label="إدارة الكابتن">إدارة الكابتن</summary>
            <fieldset className="captain-profile-actionsList">
              <legend className="visually-hidden">إجراءات إدارة الكابتن</legend>
              {actionOptions.map((option) => <button key={option.id} type="button"
                aria-pressed={selectedAction === option.id}
                disabled={Boolean(busy) || !option.enabled}
                title={!option.enabled ? "الإجراء غير مسموح في حالة الحساب الحالية" : option.label}
                onClick={(event) => {
                  setSelectedAction(option.id); setReason(""); setError(""); setNotice("");
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}>{option.label}</button>)}
            </fieldset>
          </details>

        </div>} />
        {selectedAction && selectedOption?.enabled ? <form className="captain-profile-confirm" noValidate onSubmit={(event) => {
          event.preventDefault();
          if (selectedAction === "approve" || selectedAction === "review-profile" || selectedAction === "provision") void mutateAdmission(selectedAction);
          else if (selectedAction) void mutate(selectedAction);
        }}>
          <div className="captain-profile-confirmIntro"><strong>تأكيد: {selectedOption.label}</strong><span>{selectedAction === "reenroll" ? "إعادة التسجيل تتطلب إكمال الكابتن التفعيل من تطبيقه." : "لن يُعلن النجاح حتى تتطابق القراءة التالية مع النتيجة المتوقعة."}</span></div>
          {reasonRequired ? <label htmlFor="captain-action-reason">سبب الإجراء (5 أحرف على الأقل)
            <input id="captain-action-reason" maxLength={500} value={reason} disabled={Boolean(busy)}
              onChange={(event) => setReason(event.target.value)} placeholder="دوّن سببًا واضحًا لتوثيق قرار المشغّل" />
          </label> : null}
          <div className="captain-profile-confirmButtons">
            <button type="submit" className="button button-primary" disabled={Boolean(busy) || (reasonRequired && (reason.trim().length < 5 || reason.trim().length > 500))}>تأكيد التنفيذ</button>
            <button type="button" className="button button-secondary" disabled={Boolean(busy)} onClick={() => { setSelectedAction(null); setReason(""); }}>إلغاء</button>
          </div>
        </form> : null}

    </> : null}
  </section>;
}
