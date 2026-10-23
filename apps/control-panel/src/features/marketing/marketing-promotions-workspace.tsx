"use client";

import { type CommerceVertical, type CreatePromotionRequest, formatMoney, type OperatorPromotionRegistryResponse, type PromotionView, type ServiceCity } from "@bthwani/dsh";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { useReadOnReturn } from "../shared/use-read-on-return";

import { MarketingPromotionSettlementReadback } from "./marketing-promotion-settlement-readback";
import { MarketingStateIndicator } from "./marketing-state-indicator";
import { apiMessage, clearPendingMarketingCreate, dateTimeLocalValue, emptyPromotionForm, futureDateInput, type MarketingTargetOption, type PendingPromotionCreate, type PromotionFormState, type PromotionTargetKind, persistMarketingCreate, promotionTargetSummary, readActiveServiceCities, readPendingPromotionCreate, readPromotionById } from "./marketing-workspace";

export function MarketingPromotionsWorkspace() {
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" ? sessionState.identity.subject : "";
  const canReadFinance = sessionState.kind === "authenticated" && sessionState.identity.permissions?.includes("finance");
  const pendingStorageKey = operatorActorId ? "bthwani.control.marketing.promotion-create.v1." + encodeURIComponent(operatorActorId) : "";
  const [registry, setRegistry] = useState<OperatorPromotionRegistryResponse | null>(null);
  const [registryError, setRegistryError] = useState("");
  const registrySequence = useRef(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<"starts_desc" | "starts_asc">("starts_desc");
  const [discountKind, setDiscountKind] = useState("all");
  const [fundingFilter, setFundingFilter] = useState("all");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [loading, setLoading] = useState(false);
  const [startsAt, setStartsAt] = useState(futureDateInput);
  const [endsAt, setEndsAt] = useState("");
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingCreate, setPendingCreate] = useState<PendingPromotionCreate | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState("");
  const [storageError, setStorageError] = useState("");
  const [attemptChecking, setAttemptChecking] = useState(false);
  const [promotionForm, setPromotionForm] = useState<PromotionFormState>(emptyPromotionForm);
  const [editorOpen, setEditorOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<"basics" | "scope" | "limits" | "review">("basics");
  const [wizardError, setWizardError] = useState("");
  useEffect(() => {
    if (pendingCreate) { setEditorOpen(true); setWizardStep("review"); }
  }, [pendingCreate]);
  const [storeSearch, setStoreSearch] = useState("");
  const [storeOptions, setStoreOptions] = useState<ReadonlyArray<MarketingTargetOption>>([]);
  const [storeLookupLoading, setStoreLookupLoading] = useState(false);
  const [storeLookupMessage, setStoreLookupMessage] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [targetOptions, setTargetOptions] = useState<ReadonlyArray<MarketingTargetOption>>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetMessage, setTargetMessage] = useState("");
  const [targetVerticals, setTargetVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [targetVerticalId, setTargetVerticalId] = useState("");
  const attemptReady = Boolean(pendingStorageKey) && loadedStorageKey === pendingStorageKey && !storageError;

  const load = useCallback(async (query: { search?: string; state?: string; sort?: "starts_desc" | "starts_asc"; cursor?: string } = {}) => {
    const sequence = ++registrySequence.current;
    setLoading(true);
    setRegistryError("");
    const params = new URLSearchParams({ limit: "25", sort: query.sort ?? sort });
    if (query.search ?? appliedSearch) params.set("search", query.search ?? appliedSearch);
    if (query.state ?? state) params.set("state", query.state ?? state);
    if (discountKind !== "all") params.set("discountKind", discountKind);
    if (fundingFilter !== "all") params.set("fundingSource", fundingFilter);
    if (query.cursor ?? cursor) params.set("cursor", query.cursor ?? cursor);
    try {
      const response = await fetch(`/api/marketing/promotions?${params}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const body = await response.json().catch(() => null) as OperatorPromotionRegistryResponse | { error?: { message?: string } } | null;
      if (sequence !== registrySequence.current) return;
      if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر قراءة سجل العروض." : "تعذر قراءة سجل العروض.");
      if (!body || !("promotions" in body) || !Array.isArray(body.promotions) || (body.nextCursor !== undefined && typeof body.nextCursor !== "string")) throw new Error("استجابة سجل العروض غير صالحة. أعد المحاولة.");
      setRegistry(body as OperatorPromotionRegistryResponse);
    } catch (error) {
      if (sequence !== registrySequence.current) return;
      setRegistry(null);
      setRegistryError(error instanceof Error ? error.message : "تعذر قراءة سجل العروض.");
    } finally {
      if (sequence === registrySequence.current) setLoading(false);
    }
  }, [appliedSearch, cursor, sort, state, discountKind, fundingFilter]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل العروض.")); }, [load]);
  useReadOnReturn(() => load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل العروض.")), !loading && !busy && !pendingCreate && !attemptChecking);
  useEffect(() => { void readActiveServiceCities().then(setCities).catch(() => setMessage("تعذر قراءة مدن الخدمة؛ يمكنك إنشاء حملة على كل المدن.")); }, []);

  useEffect(() => {
    if (promotionForm.targetKind !== "CATEGORY") {
      setTargetVerticals([]);
      setTargetVerticalId("");
      return;
    }
    const controller = new AbortController();
    void fetch("/api/catalog/verticals", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { verticals?: ReadonlyArray<CommerceVertical> } | null;
        if (!response.ok) throw new Error("تعذر قراءة المجالات التجارية.");
        if (!controller.signal.aborted) setTargetVerticals((body?.verticals ?? []).filter((item) => item.active));
      })
      .catch((error) => { if (!controller.signal.aborted) setTargetMessage(error instanceof Error ? error.message : "تعذر قراءة المجالات التجارية."); });
    return () => controller.abort();
  }, [promotionForm.targetKind]);

  useEffect(() => {
    if (!promotionForm.serviceCityId || storeSearch.trim().length < 2) {
      setStoreOptions([]);
      setStoreLookupLoading(false);
      setStoreLookupMessage(storeSearch.trim() && !promotionForm.serviceCityId ? "اختر مدينة الخدمة أولًا للبحث عن متجر." : "");
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ targetType: "STORE", serviceCityId: promotionForm.serviceCityId, query: storeSearch.trim() });
    setStoreLookupLoading(true);
    setStoreLookupMessage("");
    void fetch(`/api/marketing/content/targets?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { options?: ReadonlyArray<MarketingTargetOption>; error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message ?? "تعذر قراءة المتاجر.");
        setStoreOptions(body?.options ?? []);
        if (!(body?.options ?? []).length) setStoreLookupMessage("لا توجد متاجر مطابقة.");
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setStoreOptions([]);
          setStoreLookupMessage(error instanceof Error ? error.message : "تعذر قراءة المتاجر.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setStoreLookupLoading(false); });
    return () => controller.abort();
  }, [promotionForm.serviceCityId, storeSearch]);

  useEffect(() => {
    if (promotionForm.targetKind === "NONE") {
      setTargetOptions([]);
      setTargetLoading(false);
      setTargetMessage("");
      return;
    }
    if (promotionForm.targetKind === "CATEGORY" && !targetVerticalId) {
      setTargetOptions([]);
      setTargetLoading(false);
      setTargetMessage("اختر المجال التجاري أولًا.");
      return;
    }
    if (targetSearch.trim().length < 2) {
      setTargetOptions([]);
      setTargetLoading(false);
      setTargetMessage(targetSearch.trim() ? "اكتب حرفين على الأقل للبحث." : "");
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ targetType: promotionForm.targetKind, query: targetSearch.trim() });
    if (promotionForm.targetKind === "CATEGORY") params.set("verticalId", targetVerticalId);
    setTargetLoading(true);
    setTargetMessage("");
    void fetch(`/api/marketing/content/targets?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { options?: ReadonlyArray<MarketingTargetOption>; error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message ?? "تعذر قراءة أهداف العرض.");
        setTargetOptions(body?.options ?? []);
        if (!(body?.options ?? []).length) setTargetMessage("لا توجد نتائج مطابقة.");
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setTargetOptions([]);
          setTargetMessage(error instanceof Error ? error.message : "تعذر قراءة أهداف العرض.");
        }
      })
      .finally(() => { if (!controller.signal.aborted) setTargetLoading(false); });
    return () => controller.abort();
  }, [promotionForm.targetKind, targetSearch, targetVerticalId]);

  useEffect(() => {
    let active = true;
    setPendingCreate(null);
    setLoadedStorageKey("");
    setStorageError("");
    if (!pendingStorageKey) return () => { active = false; };
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(pendingStorageKey);
    } catch {
      setStorageError("تعذر قراءة محاولة إنشاء العرض المحفوظة؛ لن يُرسل طلب جديد قبل استعادة نتيجتها.");
      setLoadedStorageKey(pendingStorageKey);
      return () => { active = false; };
    }
    if (!raw) {
      setLoadedStorageKey(pendingStorageKey);
      return () => { active = false; };
    }
    const restored = readPendingPromotionCreate(raw);
    if (!restored) {
      setStorageError("تعذر التحقق من محاولة إنشاء العرض المحفوظة. افحص سجل العروض قبل بدء محاولة جديدة.");
      setLoadedStorageKey(pendingStorageKey);
      return () => { active = false; };
    }
    setPendingCreate(restored);
    const input = JSON.parse(restored.body) as CreatePromotionRequest;
    const restoredTarget = input.targets?.[0];
    setPromotionForm({
      code: input.code,
      nameAr: input.nameAr,
      descriptionAr: input.descriptionAr ?? "",
      kind: input.kind,
      valueMinor: String(input.valueMinor),
      maxDiscountMinor: input.maxDiscountMinor ? String(input.maxDiscountMinor) : "",
      redemptionLimit: input.redemptionLimit ? String(input.redemptionLimit) : "",
      discountBudgetLimitMinor: input.discountBudgetLimitMinor ? String(input.discountBudgetLimitMinor) : "",
      minOrderSubtotalMinor: input.minOrderSubtotalMinor ? String(input.minOrderSubtotalMinor) : "",
      fundingSource: input.fundingSource,
      fundingSharePartnerPercent: input.fundingSharePartnerPercent ? String(input.fundingSharePartnerPercent) : "50",
      requiresPartnerOptIn: Boolean(input.requiresPartnerOptIn),
      storeId: input.storeId ?? "",
      serviceCityId: input.serviceCityId ?? "",
      targetKind: restoredTarget?.targetKind ?? "NONE",
      targetId: restoredTarget?.targetRef ?? "",
    });
    if (input.storeId) setStoreOptions([{ id: input.storeId, label: "المتجر المحفوظ في المحاولة السابقة" }]);
    if (restoredTarget) setTargetOptions([{ id: restoredTarget.targetRef, label: "الهدف المحفوظ في المحاولة السابقة" }]);
    setStartsAt(dateTimeLocalValue(input.startsAt));
    setEndsAt(input.endsAt ? dateTimeLocalValue(input.endsAt) : "");
    setAttemptChecking(true);
    setMessage("استعدت محاولة إنشاء العرض؛ أتحقق من السجل قبل إعادة الإرسال.");
    void readPromotionById(restored.id)
      .then((item) => {
        if (!active) return;
        if (item) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
          setPromotionForm(emptyPromotionForm());
          setStartsAt(futureDateInput());
          setEndsAt("");
          setStoreSearch(""); setStoreOptions([]); setTargetSearch(""); setTargetOptions([]);
          setSearch(""); setAppliedSearch(""); setState("DRAFT"); setSort("starts_desc"); setCursor(""); setCursorStack([]);
          setMessage("تمت قراءة العرض المنشأ من السجل؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
        } else {
          setMessage("لم يظهر العرض في السجل بعد. أعد المحاولة بالبيانات المحفوظة نفسها.");
        }
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "تعذر التحقق من نتيجة إنشاء العرض.");
      })
      .finally(() => {
        if (active) {
          setAttemptChecking(false);
          setLoadedStorageKey(pendingStorageKey);
        }
      });
    return () => { active = false; };
  }, [pendingStorageKey]);

  async function createPromotion() {
    setBusy(true);
    setMessage("");
    try {
      if (!attemptReady) throw new Error(storageError || "جارٍ استعادة محاولة سابقة؛ انتظر التحقق من السجل.");
      let attempt: PendingPromotionCreate;
      if (pendingCreate) {
        attempt = pendingCreate;
        const existing = await readPromotionById(attempt.id);
        if (existing) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
          setPromotionForm(emptyPromotionForm());
          setStartsAt(futureDateInput()); setEndsAt("");
          setStoreSearch(""); setStoreOptions([]); setTargetSearch(""); setTargetOptions([]);
          setSearch(""); setAppliedSearch(""); setState("DRAFT"); setSort("starts_desc"); setCursor(""); setCursorStack([]);
          await load({ search: "", state: "DRAFT", sort: "starts_desc", cursor: "" });
          setMessage("تمت قراءة العرض المنشأ من السجل؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
          return;
        }
      } else {
        const starts = new Date(startsAt);
        const ends = endsAt ? new Date(endsAt) : null;
        const valueMinor = Number(promotionForm.valueMinor);
        const fundingShare = Number(promotionForm.fundingSharePartnerPercent);
        const budgetLimit = promotionForm.discountBudgetLimitMinor ? Number(promotionForm.discountBudgetLimitMinor) : null;
        if (!promotionForm.code.trim() || !promotionForm.nameAr.trim() || !Number.isSafeInteger(valueMinor) || valueMinor <= 0 || (promotionForm.kind === "PERCENTAGE" && valueMinor > 100) || Number.isNaN(starts.getTime())) throw new Error("أكمل بيانات العرض الأساسية.");
        if (ends && (Number.isNaN(ends.getTime()) || ends.getTime() <= starts.getTime())) throw new Error("نهاية العرض يجب أن تكون بعد بدايته.");
        if (promotionForm.fundingSource === "SHARED" && (!Number.isSafeInteger(fundingShare) || fundingShare < 1 || fundingShare > 99)) throw new Error("حدد حصة الشريك من التمويل المشترك بين 1 و99.");
        if (promotionForm.storeId && promotionForm.fundingSource !== "BTHWANI") throw new Error("لا يمكن تحميل متجر محدد تكلفة عرض ينشئه المشغل. أنشئ حملة عامة بموافقة الشركاء أو دع الشريك ينشئ عرض متجره.");
        if (budgetLimit !== null && (!Number.isSafeInteger(budgetLimit) || budgetLimit <= 0)) throw new Error("سقف مجموع الخصومات يجب أن يكون مبلغًا صحيحًا موجبًا.");
        if (promotionForm.targetKind !== "NONE" && !promotionForm.targetId) throw new Error("اختر هدف العرض من السجل المعتمد.");
        const targets: NonNullable<CreatePromotionRequest["targets"]> = promotionForm.targetKind === "NONE" ? [] : [{ targetKind: promotionForm.targetKind, targetRef: promotionForm.targetId }];
        const input: CreatePromotionRequest = {
          id: "promotion-" + crypto.randomUUID(),
          code: promotionForm.code,
          nameAr: promotionForm.nameAr,
          descriptionAr: promotionForm.descriptionAr,
          kind: promotionForm.kind,
          valueMinor,
          fundingSource: promotionForm.fundingSource,
          startsAt: starts.toISOString(),
          requiresPartnerOptIn: !promotionForm.storeId && (promotionForm.requiresPartnerOptIn || promotionForm.fundingSource !== "BTHWANI"),
          ...(promotionForm.fundingSource === "SHARED" ? { fundingSharePartnerPercent: fundingShare } : {}),
          ...(promotionForm.kind === "PERCENTAGE" && promotionForm.maxDiscountMinor ? { maxDiscountMinor: Number(promotionForm.maxDiscountMinor) } : {}),
          ...(promotionForm.redemptionLimit ? { redemptionLimit: Number(promotionForm.redemptionLimit) } : {}),
          ...(budgetLimit !== null ? { discountBudgetLimitMinor: budgetLimit } : {}),
          ...(promotionForm.minOrderSubtotalMinor ? { minOrderSubtotalMinor: Number(promotionForm.minOrderSubtotalMinor) } : {}),
          ...(targets.length ? { targets } : {}),
          ...(promotionForm.storeId ? { storeId: promotionForm.storeId } : {}),
          ...(promotionForm.serviceCityId ? { serviceCityId: promotionForm.serviceCityId } : {}),
          ...(ends ? { endsAt: ends.toISOString() } : {}),
        };
        attempt = { id: input.id, idempotencyKey: crypto.randomUUID(), correlationId: "marketing_promotion_create_" + crypto.randomUUID(), body: JSON.stringify(input) };
        if (!persistMarketingCreate(pendingStorageKey, attempt)) throw new Error("تعذر حفظ محاولة الإنشاء؛ لم يُرسل الطلب. أعد المحاولة بعد تفعيل تخزين الجلسة.");
        setPendingCreate(attempt);
      }
      const response = await fetch("/api/marketing/promotions", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId }, body: attempt.body });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
        }
        throw new Error(apiMessage(responseBody));
      }
      const created = await readPromotionById(attempt.id);
      if (!created) throw new Error("تعذر تأكيد العرض من السجل. بقيت المحاولة محفوظة لإعادة التحقق دون تكرار العملية.");
      clearPendingMarketingCreate(pendingStorageKey);
      setPendingCreate(null);
      setPromotionForm(emptyPromotionForm());
      setStartsAt(futureDateInput()); setEndsAt("");
      setStoreSearch(""); setStoreOptions([]); setTargetSearch(""); setTargetOptions([]);
      setSearch(""); setAppliedSearch(""); setState("DRAFT"); setSort("starts_desc"); setCursor(""); setCursorStack([]);
      await load({ search: "", state: "DRAFT", sort: "starts_desc", cursor: "" });
      setMessage("تم إنشاء العرض وقراءته كمسودة من السجل. انشره من السجل عندما يصبح جاهزًا.");
      setEditorOpen(false);
      setWizardStep("basics");
      setWizardError("");
    } catch (error) {
      setWizardError(error instanceof Error ? error.message : "تعذر إنشاء العرض.");
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء العرض.");
    } finally {
      setBusy(false);
    }
  }

  async function publishPromotion(item: PromotionView, nextState: "PUBLISHED" | "PAUSED") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/marketing/promotions/${encodeURIComponent(item.id)}/publication`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) }, body: JSON.stringify({ state: nextState }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      const canonical = await readPromotionById(item.id);
      if (!canonical || canonical.state !== nextState || canonical.version <= item.version) {
        throw new Error("تم إرسال تغيير حالة العرض لكن لم تثبت القراءة المعتمدة الحالة والإصدار الجديدين. أعد قراءة السجل قبل أي إجراء آخر.");
      }
      await load();
      setMessage(nextState === "PUBLISHED" ? "نُشر العرض وأُكدت حالته من السجل." : "أُوقف العرض وأُكدت حالته من السجل.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر العرض.");
    } finally {
      setBusy(false);
    }
  }

  const formLocked = busy || Boolean(pendingCreate) || !attemptReady;
  const wizardSteps = [
    { id: "basics", label: "الخصم" },
    { id: "scope", label: "النطاق والموعد" },
    { id: "limits", label: "التمويل والضوابط" },
    { id: "review", label: "المراجعة" },
  ] as const;
  const wizardIndex = wizardSteps.findIndex((item) => item.id === wizardStep);

  function advanceWizard() {
    setWizardError("");
    if (wizardStep === "basics") {
      const amount = Number(promotionForm.valueMinor);
      if (!promotionForm.nameAr.trim() || !promotionForm.code.trim() ||
          !Number.isSafeInteger(amount) || amount <= 0 ||
          (promotionForm.kind === "PERCENTAGE" && amount > 100)) {
        setWizardError("أدخل اسم العرض وقيمة خصم صحيحة قبل المتابعة.");
        return;
      }
    }
    if (wizardStep === "scope") {
      const start = new Date(startsAt);
      const end = endsAt ? new Date(endsAt) : null;
      if (!Number.isFinite(start.getTime()) || (end && (!Number.isFinite(end.getTime()) || end <= start)) ||
          (promotionForm.targetKind !== "NONE" && !promotionForm.targetId)) {
        setWizardError("تحقق من مدة العرض وحدد المنتج أو الفئة المطلوبة من السجلات المعتمدة.");
        return;
      }
    }
    if (wizardStep === "limits") {
      const share = Number(promotionForm.fundingSharePartnerPercent);
      const positiveOrBlank = [promotionForm.kind === "PERCENTAGE" ? promotionForm.maxDiscountMinor : "", promotionForm.minOrderSubtotalMinor,
        promotionForm.redemptionLimit, promotionForm.discountBudgetLimitMinor]
        .every((v) => v === "" || (Number.isSafeInteger(Number(v)) && Number(v) > 0));
      if (!positiveOrBlank || (promotionForm.fundingSource === "SHARED" && (!Number.isSafeInteger(share) || share < 1 || share > 99))) {
        setWizardError("راجع حدود الخصم والميزانية وحصة التمويل؛ يجب أن تكون قيمًا صحيحة موجبة.");
        return;
      }
    }
    const nextStep = wizardSteps[wizardIndex + 1];
    if (nextStep) setWizardStep(nextStep.id);
  }

  function startPromotionEditor() {
    if (!promotionForm.code.trim() && !pendingCreate) {
      setPromotionForm((current) => ({ ...current, code: "BT-" + crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase() }));
    }
    setWizardStep(pendingCreate ? "review" : "basics");
    setWizardError("");
    setEditorOpen(true);
  }
  const selectedStoreLabel = promotionForm.storeId ? storeOptions.find((item) => item.id === promotionForm.storeId)?.label ?? "متجر معتمد" : "";
  const selectedTargetLabel = promotionForm.targetId ? targetOptions.find((item) => item.id === promotionForm.targetId)?.label ?? "هدف معتمد" : "";

  return (
    <div className="work-stack" data-testid="marketing-promotions-workspace">
      {storageError ? <p className="managed-status managed-status-warning" role="alert">{storageError}</p> : null}
      {pendingCreate ? <p className="managed-status managed-status-warning" role="status">{attemptChecking ? "جارٍ التحقق من نتيجة المحاولة المحفوظة …" : "المحاولة لم تُحسم بعد. الحقول مقفلة وستعيد المحاولة بالبيانات والمفتاح نفسيهما."}</p> : null}
      {!(editorOpen || pendingCreate) ? <section className="marketing-entry-choices" aria-label="نوع النشاط التسويقي">
        <Link className="marketing-entry-choice" href="/marketing/content">
          <strong>إعلان دون خصم</strong><span>بنر أو صورة تقود إلى متجر أو منتج، دون تغيير السعر.</span>
        </Link>
        <button className="marketing-entry-choice" type="button" onClick={startPromotionEditor}>
          <strong>خصم أو قسيمة</strong><span>حدد القيمة والجمهور والممول، ثم راجع المسودة قبل نشرها.</span>
        </button>
      </section> : null}
      {(editorOpen || pendingCreate) ? <section className="marketing-editor-mode" aria-label="إعداد خصم جديد">
        <div className="action-row"><button type="button" className="button button-secondary"
          disabled={busy || Boolean(pendingCreate)} onClick={() => setEditorOpen(false)}>العودة إلى سجل العروض</button></div>
      <details className="access-card marketing-create-disclosure" open={Boolean(pendingCreate) || editorOpen} onToggle={(event) => {
        if (pendingCreate) return;
        if (event.currentTarget.open && !editorOpen) startPromotionEditor();
        if (!event.currentTarget.open && editorOpen) setEditorOpen(false);
      }}>
        <summary className="section-heading marketing-create-summary">إعداد خصم أو قسيمة</summary>
        <div className="access-card-heading"><h2>إعداد خصم جديد</h2><p className="muted">أربع مراحل قصيرة. يُحفظ العرض أولًا كمسودة؛ لا يُنشر أو يخصم من أي عميل بمجرد إنشاء المسودة.</p></div>
        <nav className="marketing-flow-steps" aria-label="مراحل إعداد الخصم">
          {wizardSteps.map((step, index) => <span key={step.id} aria-current={wizardStep === step.id ? "step" : undefined} data-done={index < wizardIndex ? "true" : undefined}>{index + 1}. {step.label}</span>)}
        </nav>
        {wizardStep === "basics" ? <div className="workspace-form-grid marketing-flow-fields">
          <label className="field-label">رمز العرض<input aria-label="رمز العرض" placeholder="WELCOME10" disabled={formLocked} value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value }))} /></label>
          <label className="field-label">اسم العرض<input aria-label="اسم العرض" placeholder="خصم العملاء الجدد" disabled={formLocked} value={promotionForm.nameAr} onChange={(event) => setPromotionForm((current) => ({ ...current, nameAr: event.target.value }))} /></label>
          <label className="field-label">وصف العرض<input aria-label="وصف العرض" placeholder="خصم على الطلب" disabled={formLocked} value={promotionForm.descriptionAr} onChange={(event) => setPromotionForm((current) => ({ ...current, descriptionAr: event.target.value }))} /></label>
          <label className="field-label">آلية الخصم<select aria-label="نوع العرض" disabled={formLocked} value={promotionForm.kind} onChange={(event) => setPromotionForm((current) => ({ ...current, kind: event.target.value as PromotionFormState["kind"] }))}><option value="PERCENTAGE">نسبة مئوية</option><option value="FIXED">قيمة ثابتة</option></select></label>
          <label className="field-label">{promotionForm.kind === "PERCENTAGE" ? "نسبة الخصم" : "قيمة الخصم بالريال اليمني"}<input aria-label={promotionForm.kind === "PERCENTAGE" ? "نسبة الخصم" : "قيمة الخصم بالريال اليمني"} inputMode="numeric" type="number" min="1" disabled={formLocked} value={promotionForm.valueMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, valueMinor: event.target.value }))} /></label>
          {promotionForm.kind === "PERCENTAGE" ? <label className="field-label">الحد الأعلى للخصم (اختياري)<input aria-label="الحد الأعلى للخصم بالريال اليمني" inputMode="numeric" type="number" min="1" placeholder="بالريال اليمني" disabled={formLocked} value={promotionForm.maxDiscountMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, maxDiscountMinor: event.target.value }))} /></label> : null}
          <p className="marketing-flow-note">الرمز يُنشأ تلقائيًا للتعريف بالعرض ويمكن تغييره. الرمز وحده لا يثبت أن الخصم سيُطبّق تلقائيًا؛ الأهلية يحددها الخادم.</p>
        </div> : null}
        {wizardStep === "scope" ? <div className="workspace-form-grid marketing-flow-fields">
          <label className="field-label" htmlFor="promotion-city">مدينة الخدمة<select id="promotion-city" disabled={formLocked} value={promotionForm.serviceCityId} onChange={(event) => { setStoreSearch(""); setStoreOptions([]); setPromotionForm((current) => ({ ...current, serviceCityId: event.target.value, storeId: "" })); }}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>

          <label className="field-label">بحث عن متجر (اختياري)<input aria-label="بحث متجر الحملة" maxLength={128} placeholder={promotionForm.serviceCityId ? "اسم المتجر" : "اختر مدينة أولًا"} disabled={formLocked || !promotionForm.serviceCityId} value={storeSearch} onChange={(event) => { setStoreSearch(event.target.value); setPromotionForm((current) => ({ ...current, storeId: "", requiresPartnerOptIn: current.requiresPartnerOptIn })); }} /></label>
          <label className="field-label" htmlFor="promotion-store">نطاق المتجر<select id="promotion-store" disabled={formLocked || storeLookupLoading || storeOptions.length === 0} value={promotionForm.storeId} onChange={(event) => setPromotionForm((current) => ({ ...current, storeId: event.target.value, requiresPartnerOptIn: event.target.value ? false : current.requiresPartnerOptIn, fundingSource: event.target.value ? "BTHWANI" : current.fundingSource, fundingSharePartnerPercent: event.target.value ? "" : current.fundingSharePartnerPercent }))}><option value="">حملة منصة / كل المتاجر المؤهلة</option>{storeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          {storeLookupMessage ? <p className="muted" role="status">{storeLookupMessage}</p> : null}
          {selectedStoreLabel ? <p className="muted">المتجر المختار: {selectedStoreLabel}</p> : null}

          <label className="field-label" htmlFor="promotion-target-kind">استهداف العرض<select id="promotion-target-kind" disabled={formLocked} value={promotionForm.targetKind} onChange={(event) => { const targetKind = event.target.value as PromotionTargetKind; setTargetSearch(""); setTargetOptions([]); setTargetVerticalId(""); setPromotionForm((current) => ({ ...current, targetKind, targetId: "" })); }}><option value="NONE">كل النطاق</option><option value="PRODUCT">منتج</option><option value="CATEGORY">فئة</option></select></label>
          {promotionForm.targetKind === "CATEGORY" ? <label className="field-label" htmlFor="promotion-target-vertical">المجال التجاري<select id="promotion-target-vertical" disabled={formLocked} value={targetVerticalId} onChange={(event) => { setTargetVerticalId(event.target.value); setTargetSearch(""); setTargetOptions([]); setPromotionForm((current) => ({ ...current, targetId: "" })); }}><option value="">اختر المجال</option>{targetVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label> : null}
          {promotionForm.targetKind !== "NONE" ? <>
            <label className="field-label">بحث في الأهداف<input aria-label="بحث هدف العرض" maxLength={128} placeholder={promotionForm.targetKind === "PRODUCT" ? "اسم المنتج" : "اسم الفئة"} disabled={formLocked || (promotionForm.targetKind === "CATEGORY" && !targetVerticalId)} value={targetSearch} onChange={(event) => { setTargetSearch(event.target.value); setPromotionForm((current) => ({ ...current, targetId: "" })); }} /></label>
            <label className="field-label" htmlFor="promotion-target">الهدف المعتمد<select id="promotion-target" disabled={formLocked || targetLoading || targetOptions.length === 0} value={promotionForm.targetId} onChange={(event) => setPromotionForm((current) => ({ ...current, targetId: event.target.value }))}><option value="">اختر من السجلات</option>{targetOptions.map((option) => <option key={option.id} value={option.id}>{option.detail ? option.label + " · " + option.detail : option.label}</option>)}</select></label>
            {targetMessage ? <p className="muted" role="status">{targetMessage}</p> : null}
            {selectedTargetLabel ? <p className="muted">الهدف المختار: {selectedTargetLabel}</p> : null}
          </> : null}
          <label className="field-label">بداية العرض<input aria-label="بداية العرض" type="datetime-local" disabled={formLocked} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
          <label className="field-label">نهاية العرض<input aria-label="نهاية العرض" type="datetime-local" disabled={formLocked} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
        </div> : null}
        {wizardStep === "limits" ? <div className="workspace-form-grid marketing-flow-fields">
          <label className="field-label" htmlFor="promotion-funding-source">مصدر التمويل<select id="promotion-funding-source" disabled={formLocked} value={promotionForm.fundingSource} onChange={(event) => setPromotionForm((current) => ({ ...current, fundingSource: event.target.value as CreatePromotionRequest["fundingSource"] }))}><option value="BTHWANI">بثواني</option><option value="SHARED" disabled={Boolean(promotionForm.storeId)}>مشترك</option><option value="PARTNER" disabled={Boolean(promotionForm.storeId)}>الشريك</option></select></label>
          {promotionForm.storeId ? <p className="muted" role="status">المتجر المحدد يموله بثواني فقط. لتمويل الشركاء استخدم حملة منصة بموافقتهم، أو دع الشريك ينشئ عرضه.</p> : null}
          {promotionForm.fundingSource === "SHARED" ? <label className="field-label">حصة الشريك من التمويل (%)<input aria-label="حصة الشريك من التمويل" inputMode="numeric" type="number" min="1" max="99" disabled={formLocked} value={promotionForm.fundingSharePartnerPercent} onChange={(event) => setPromotionForm((current) => ({ ...current, fundingSharePartnerPercent: event.target.value }))} /></label> : null}
          <label className="field-label">الحد الأدنى للطلب (اختياري)<input aria-label="حد الطلب الأدنى" inputMode="numeric" type="number" min="1" placeholder="بالريال اليمني" disabled={formLocked} value={promotionForm.minOrderSubtotalMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, minOrderSubtotalMinor: event.target.value }))} /></label>
          <label className="field-label">عدد مرات الاستخدام (اختياري)<input aria-label="حد الاستخدام" inputMode="numeric" type="number" min="1" placeholder="اتركه بلا حد" disabled={formLocked} value={promotionForm.redemptionLimit} onChange={(event) => setPromotionForm((current) => ({ ...current, redemptionLimit: event.target.value }))} /></label>
          <label className="field-label">سقف مجموع الخصومات (اختياري، ر.ي)<input aria-label="سقف مجموع خصومات الحملة" inputMode="numeric" type="number" min="1" placeholder="يتحقق الخادم من المبلغ عند الدفع" disabled={formLocked} value={promotionForm.discountBudgetLimitMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, discountBudgetLimitMinor: event.target.value }))} /></label>
          <label className="field-label"><input type="checkbox" disabled={formLocked || Boolean(promotionForm.storeId) || promotionForm.fundingSource !== "BTHWANI"} checked={!promotionForm.storeId && (promotionForm.requiresPartnerOptIn || promotionForm.fundingSource !== "BTHWANI")} onChange={(event) => setPromotionForm((current) => ({ ...current, requiresPartnerOptIn: event.target.checked }))} /> {promotionForm.fundingSource !== "BTHWANI" && !promotionForm.storeId ? "موافقة كل شريك على تمويل الخصم إلزامية قبل المشاركة" : "تتطلب الحملة موافقة الشريك قبل المشاركة"}</label>
          <p className="marketing-flow-note">تمويل الشريك أو التمويل المشترك يحتاج موافقته الصريحة قبل مشاركته. لا يؤثر الخصم في مستحق الكابتن.</p>
        </div> : null}
        {wizardStep === "review" ? <section className="marketing-flow-review" aria-label="مراجعة العرض قبل الحفظ">
          <h3>راجع ما سيُحفظ كمسودة</h3>
          <dl className="marketing-flow-facts">
            <div><dt>العرض</dt><dd>{promotionForm.nameAr || "لم يُسمَّ بعد"}</dd></div>
            <div><dt>الخصم</dt><dd>{promotionForm.kind === "PERCENTAGE" ? promotionForm.valueMinor + "%" : formatMoney(Number(promotionForm.valueMinor || 0), "YER")}</dd></div>
            <div><dt>النطاق</dt><dd>{selectedStoreLabel || (promotionForm.serviceCityId ? cities.find((item) => item.id === promotionForm.serviceCityId)?.displayNameAr || "المدينة المختارة" : "كل المدن والمتاجر المؤهلة")}{selectedTargetLabel ? " · " + selectedTargetLabel : ""}</dd></div>
            <div><dt>التمويل</dt><dd>{promotionForm.fundingSource === "SHARED" ? "مشترك: الشريك " + promotionForm.fundingSharePartnerPercent + "%، بثواني " + (100 - Number(promotionForm.fundingSharePartnerPercent)) + "%" : promotionForm.fundingSource === "PARTNER" ? "الشريك بالكامل" : "بثواني بالكامل"}</dd></div>
            <div><dt>سقف الخصومات</dt><dd>{promotionForm.discountBudgetLimitMinor ? formatMoney(Number(promotionForm.discountBudgetLimitMinor), "YER") : "لا يوجد سقف إجمالي محدد"}</dd></div>
            <div><dt>موافقة الشريك</dt><dd>{!promotionForm.storeId && (promotionForm.requiresPartnerOptIn || promotionForm.fundingSource !== "BTHWANI") ? "مطلوبة قبل المشاركة" : "غير مطلوبة لهذه الإعدادات"}</dd></div>
            <div><dt>الفترة</dt><dd>{startsAt || "غير محددة"} — {endsAt || "دون نهاية محددة"}</dd></div>
          </dl>
          {!promotionForm.discountBudgetLimitMinor ? <p className="managed-status managed-status-warning" role="note">لم تحدد سقفًا إجماليًا للخصومات. راجع هذا القرار قبل إنشاء المسودة.</p> : null}
          <p className="muted">المراجعة تلخص إدخالاتك فقط، وليست تحققًا ماليًا أو إثبات أهلية. يعيد الخادم فحص الشروط عند الحفظ والطلب.</p>
        </section> : null}
        {wizardError ? <p className="managed-status managed-status-warning" role="alert">{wizardError}</p> : null}
        <div className="action-row marketing-flow-actions">
          {wizardIndex > 0 && !pendingCreate ? <button className="button button-secondary" type="button" onClick={() => { setWizardError(""); setWizardStep(wizardSteps[wizardIndex - 1]?.id ?? "basics"); }}>السابق</button> : null}
          {wizardStep !== "review" ? <button className="button" type="button" disabled={formLocked} onClick={advanceWizard}>التالي: {wizardSteps[wizardIndex + 1]?.label}</button>
            : <button className="button" type="button" disabled={busy || attemptChecking || !attemptReady} onClick={() => void createPromotion()}>{pendingCreate ? "التحقق / إعادة محاولة الإنشاء" : "حفظ مسودة العرض"}</button>}
        </div>
      </details>
      </section> : null}

      {!(editorOpen || pendingCreate) ? <section className="access-card" aria-labelledby="marketing-promotions-title">
        <div className="access-card-heading"><h2 id="marketing-promotions-title">سجل العروض</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        {registryError ? <div role="alert" className="managed-status managed-status-warning"><p>{registryError}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
        <form className="registry-toolbar" noValidate onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim().slice(0, 128)); setCursor(""); setCursorStack([]); }}>
          <label className="field-label" htmlFor="promotion-search">رمز العرض أو الاسم<input id="promotion-search" type="search" maxLength={128} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field-label" htmlFor="promotion-state">الحالة<select id="promotion-state" value={state} onChange={(event) => { setState(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="PUBLISHED">منشور</option><option value="PAUSED">موقوف</option><option value="ENDED">منتهٍ</option></select></label>
          <label className="field-label" htmlFor="promotion-sort">ترتيب البداية<select id="promotion-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setCursor(""); setCursorStack([]); }}><option value="starts_desc">الأحدث بداية</option><option value="starts_asc">الأقدم بداية</option></select></label>
          <details className="marketing-registry-extra-filters">
            <summary>تصفية إضافية لجميع العروض</summary>
            <div className="marketing-registry-extra-controls">
              <label className="field-label">نوع الخصم
                <select value={discountKind} onChange={(event) => { setDiscountKind(event.target.value); setCursor(""); setCursorStack([]); }}>
                  <option value="all">كل الأنواع</option><option value="PERCENTAGE">نسبة مئوية</option><option value="FIXED">مبلغ ثابت</option>
                </select>
              </label>
              <label className="field-label">مصدر التمويل
                <select value={fundingFilter} onChange={(event) => { setFundingFilter(event.target.value); setCursor(""); setCursorStack([]); }}>
                  <option value="all">الجميع</option><option value="SHARED">مشترك</option><option value="BTHWANI">بثواني</option><option value="PARTNER">الشريك</option>
                </select>
              </label>
            </div>
          </details>
          <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
        </form>
        {registry?.promotions.length ? <div className="table-wrap"><table className="data-table"><caption className="visually-hidden">سجل العروض</caption><thead><tr>
          <th scope="col">العرض</th>
          <th scope="col">الرمز</th>
          <th scope="col">القيمة</th>
          <th scope="col">التمويل والنطاق</th>
          <th scope="col">الحالة</th>
          <th scope="col">البداية</th>
          <th scope="col">الإجراء</th>
        </tr></thead><tbody>{registry.promotions.map((item) => <tr key={item.id}><th scope="row">{item.nameAr}</th><td><bdi dir="ltr">{item.code}</bdi></td><td>{item.kind === "PERCENTAGE" ? item.valueMinor + "%" : formatMoney(item.valueMinor, "YER")}</td><td>{item.fundingSource === "SHARED" ? "مشترك · حصة الشريك " + (item.fundingSharePartnerPercent ?? 0) + "%" : item.fundingSource === "BTHWANI" ? "بثواني" : "الشريك"}<br />{item.storeId ? "متجر محدد" : item.serviceCityId ? "حملة مدينة" : "حملة منصة"}{item.requiresPartnerOptIn ? " · تتطلب موافقة" : ""}<br />{promotionTargetSummary(item)}{item.minOrderSubtotalMinor ? <><br />حد الطلب {formatMoney(item.minOrderSubtotalMinor, "YER")}</> : null}{item.discountBudgetLimitMinor ? <><br />سقف الخصومات: {formatMoney(item.discountBudgetLimitMinor, "YER")} · مستخدم: {formatMoney(item.discountSpentMinor ?? 0, "YER")}</> : null}</td><td><MarketingStateIndicator state={item.state} /></td><td><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td><div className="action-row">{item.state === "ENDED" ? <span className="muted">لا إجراء</span> : <button className="button button-quiet" type="button" disabled={busy} onClick={() => void publishPromotion(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف العرض" : "نشر العرض"}</button>}{item.state === "PUBLISHED" ? <Link className="button button-quiet" href={`/marketing/content?promotionId=${encodeURIComponent(item.id)}`}>إنشاء بنر للعرض</Link> : null}{canReadFinance ? <MarketingPromotionSettlementReadback promotionId={item.id} /> : null}</div></td></tr>)}{registry.promotions.length === 0 ? <tr><td colSpan={7}>لا توجد عروض مطابقة في الصفحة الحالية.</td></tr> : null}</tbody></table></div> : null}
        {!registry?.promotions.length && loading ? <p role="status" className="collection-state">جارٍ قراءة صفحة العروض…</p> : null}
        {registry && !registry.promotions.length && !loading && !registryError ? <p className="collection-state">لا توجد عروض مطابقة.</p> : null}
        <nav className="pagination" aria-label="صفحات سجل العروض"><button className="button button-quiet" type="button" disabled={loading || cursorStack.length === 0} onClick={() => { const next = [...cursorStack]; const previous = next.pop() ?? ""; setCursorStack(next); setCursor(previous); }}>السابق</button><span>صفحة {cursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={loading || !registry?.nextCursor} onClick={() => { setCursorStack((items) => [...items, cursor]); setCursor(registry?.nextCursor ?? ""); }}>التالي</button></nav>
      </section> : null}
    </div>
  );
}