"use client";

import { type CommerceVertical, type DiscoveryContentAnalytics, type DiscoveryContentView, isMediaProvenanceInputValid, type MediaProvenanceInput, type OperatorDiscoveryContentRegistryResponse, type ServiceCity } from "@bthwani/dsh";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../session/session-provider";
import { AdaptiveRecordPanel, AdaptiveRecordWorkspace } from "../../shell/adaptive-record-workspace";
import { appendMediaProvenance, CatalogMediaProvenanceFields } from "../central-catalog/catalog-media-provenance-fields";
import { useReadOnReturn } from "../shared/use-read-on-return";
import { MarketingStateIndicator } from "./marketing-state-indicator";
import { MarketingBannerPresentation } from "./marketing-banner-presentation";
import { apiMessage, clearPendingMarketingCreate, dateTimeLocalValue, emptyMediaProvenance, futureDateInput, futureEndDateInput, type PendingDiscoveryContentCreate, persistMarketingCreate, readActiveServiceCities, readDiscoveryContentById, readPendingDiscoveryContentCreate, readPromotionById, sha256File } from "./marketing-workspace";

export function MarketingContentWorkspace() {
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" ? sessionState.identity.subject : "";
  const pendingStorageKey = operatorActorId ? "bthwani.control.marketing.content-create.v1." + encodeURIComponent(operatorActorId) : "";
  const [registry, setRegistry] = useState<OperatorDiscoveryContentRegistryResponse | null>(null);
  const [registryError, setRegistryError] = useState("");
  const registrySequence = useRef(0);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<"priority" | "created_desc">("priority");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<ReadonlyArray<string>>([]);
  const [loading, setLoading] = useState(false);
  const [analyticsContentId, setAnalyticsContentId] = useState("");
  const [analytics, setAnalytics] = useState<ReadonlyArray<DiscoveryContentAnalytics> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");
  const analyticsSequence = useRef(0);
  const [contentStartsAt, setContentStartsAt] = useState(futureDateInput);
  const [contentEndsAt, setContentEndsAt] = useState(futureEndDateInput);
  const [cities, setCities] = useState<ReadonlyArray<ServiceCity>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingCreate, setPendingCreate] = useState<PendingDiscoveryContentCreate | null>(null);
  const [loadedStorageKey, setLoadedStorageKey] = useState("");
  const [storageError, setStorageError] = useState("");
  const [attemptChecking, setAttemptChecking] = useState(false);
  const [contentForm, setContentForm] = useState({ titleAr: "", bodyAr: "", kind: "BANNER" as "BANNER" | "CAROUSEL" | "SHORT_FORM", targetType: "INFO" as "STORE" | "PRODUCT" | "CATEGORY" | "PROMOTION" | "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
  const [targetOptions, setTargetOptions] = useState<ReadonlyArray<{ id: string; label: string; detail?: string }>>([]);
  const [targetSearch, setTargetSearch] = useState("");
  const linkedPromotionRef = useRef("");
  const linkedPromotionAttemptRef = useRef("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [categoryVerticals, setCategoryVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categoryVerticalId, setCategoryVerticalId] = useState("");
  const [targetCursor, setTargetCursor] = useState("");
  const [targetCursorStack, setTargetCursorStack] = useState<ReadonlyArray<string>>([]);
  const [targetNextCursor, setTargetNextCursor] = useState("");
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetMessage, setTargetMessage] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const mediaPreviewCanvasRef = useRef<HTMLCanvasElement>(null);
  const [mediaPreviewError, setMediaPreviewError] = useState("");
  const [mediaProvenance, setMediaProvenance] = useState<MediaProvenanceInput>(emptyMediaProvenance());
  const canPreviewMedia = Boolean(mediaFile && ["image/jpeg", "image/png"].includes(mediaFile.type.toLowerCase()));
  useEffect(() => {
    setMediaPreviewError("");
    if (!mediaFile || !["image/jpeg", "image/png"].includes(mediaFile.type.toLowerCase())) return;
    let cancelled = false;
    // Decode raster data into a canvas without placing a user-derived URL in the DOM.
    void createImageBitmap(mediaFile).then((bitmap) => {
      try {
        const canvas = mediaPreviewCanvasRef.current;
        if (cancelled || !canvas) return;
        canvas.width = contentForm.kind === "SHORT_FORM" ? 240 : 600;
        canvas.height = contentForm.kind === "SHORT_FORM" ? 280 : 240;
        const context = canvas.getContext("2d");
        if (!context) { setMediaPreviewError("تعذر عرض معاينة الصورة على هذا الجهاز."); return; }
        const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      } finally {
        bitmap.close();
      }
    }).catch(() => {
      if (!cancelled) setMediaPreviewError("تعذر معاينة الملف؛ اختر صورة JPEG أو PNG صالحة.");
    });
    return () => { cancelled = true; };
  }, [mediaFile, contentForm.kind]);
  const attemptReady = Boolean(pendingStorageKey) && loadedStorageKey === pendingStorageKey && !storageError;

  // A linked banner uses the existing canonical promotion and discovery target
  // owners. Never trust an identifier from a URL as proof of publication.
  useEffect(() => {
    if (!attemptReady || pendingCreate) return;
    const promotionID = new URLSearchParams(window.location.search).get("promotionId")?.trim() ?? "";
    if (!promotionID || linkedPromotionAttemptRef.current === promotionID) return;
    linkedPromotionAttemptRef.current = promotionID;
    let active = true;
    void readPromotionById(promotionID).then((promotion) => {
      if (!active) return;
      if (!promotion || promotion.state !== "PUBLISHED") {
        setMessage("العرض المحدد غير منشور أو غير متاح. اختر عرضًا منشورًا من سجل العروض.");
        return;
      }
      linkedPromotionRef.current = promotion.id;
      setContentForm((current) => ({ ...current, targetType: "PROMOTION", targetId: "", serviceCityId: promotion.serviceCityId ?? "" }));
      setTargetSearch(promotion.code);
      setEditorOpen(true);
    }).catch(() => {
      if (active) setMessage("تعذر التحقق من العرض المرتبط. أعد فتحه من سجل العروض.");
    });
    return () => { active = false; };
  }, [attemptReady, pendingCreate]);
  const load = useCallback(async (query: { search?: string; state?: string; kind?: string; sort?: "priority" | "created_desc"; cursor?: string } = {}) => {
    const sequence = ++registrySequence.current;
    setLoading(true);
    setRegistryError("");
    const params = new URLSearchParams({ limit: "25", sort: query.sort ?? sort });
    if (query.search ?? appliedSearch) params.set("search", query.search ?? appliedSearch);
    if (query.state ?? state) params.set("state", query.state ?? state);
    if (query.kind ?? kind) params.set("kind", query.kind ?? kind);
    if (query.cursor ?? cursor) params.set("cursor", query.cursor ?? cursor);
    try {
      const response = await fetch(`/api/marketing/content?${params}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const body = await response.json().catch(() => null) as OperatorDiscoveryContentRegistryResponse | { error?: { message?: string } } | null;
      if (sequence !== registrySequence.current) return;
      if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر قراءة سجل محتوى الاكتشاف." : "تعذر قراءة سجل محتوى الاكتشاف.");
      if (!body || !("items" in body) || !Array.isArray(body.items) || (body.nextCursor !== undefined && typeof body.nextCursor !== "string")) throw new Error("استجابة سجل المحتوى غير صالحة. أعد المحاولة.");
      setRegistry(body as OperatorDiscoveryContentRegistryResponse);
    } catch (error) {
      if (sequence !== registrySequence.current) return;
      setRegistry(null);
      setRegistryError(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف.");
    } finally {
      if (sequence === registrySequence.current) setLoading(false);
    }
  }, [appliedSearch, cursor, kind, sort, state]);

  async function readAnalytics(contentId: string) {
    const sequence = ++analyticsSequence.current;
    setAnalyticsContentId(contentId);
    setAnalytics(null);
    setAnalyticsError("");
    setAnalyticsLoading(true);
    try {
      const response = await fetch(`/api/marketing/analytics?contentId=${encodeURIComponent(contentId)}`, { cache: "no-store", signal: AbortSignal.timeout(12_000) });
      const body = await response.json().catch(() => null) as { items?: ReadonlyArray<DiscoveryContentAnalytics>; error?: { message?: string } } | null;
      if (sequence !== analyticsSequence.current) return;
      if (!response.ok) throw new Error(body?.error?.message ?? "تعذر قراءة تحليلات المحتوى المحدد.");
      if (!body || !Array.isArray(body.items)) throw new Error("استجابة التحليلات غير صالحة؛ لا يمكن اعتماد أرقامها.");
      setAnalytics(body.items);
    } catch (error) {
      if (sequence !== analyticsSequence.current) return;
      setAnalyticsError(error instanceof Error ? error.message : "تعذر قراءة تحليلات المحتوى المحدد.");
    } finally {
      if (sequence === analyticsSequence.current) setAnalyticsLoading(false);
    }
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف.")); }, [load]);
  useReadOnReturn(() => load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف.")), !loading && !busy && !pendingCreate && !attemptChecking);
  useEffect(() => { void readActiveServiceCities().then(setCities).catch(() => setMessage("تعذر قراءة مدن الخدمة؛ يمكنك نشر المحتوى على كل المدن.")); }, []);
  useEffect(() => {
    if (contentForm.targetType !== "CATEGORY") return;
    const controller = new AbortController();
    void fetch("/api/catalog/verticals", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { verticals?: ReadonlyArray<CommerceVertical> } | null;
        if (!response.ok) throw new Error("تعذر قراءة المجالات التجارية.");
        if (!controller.signal.aborted) setCategoryVerticals((body?.verticals ?? []).filter((item) => item.active));
      })
      .catch((error) => { if (!controller.signal.aborted) setTargetMessage(error instanceof Error ? error.message : "تعذر قراءة المجالات التجارية."); });
    return () => controller.abort();
  }, [contentForm.targetType]);
  useEffect(() => {
    if (contentForm.targetType === "INFO") {
      setTargetOptions([]);
      setTargetMessage("");
      setTargetLoading(false);
      return;
    }
    if (contentForm.targetType === "STORE" && !contentForm.serviceCityId) {
      setTargetOptions([]);
      setTargetMessage("اختر مدينة الخدمة أولًا لعرض المتاجر المنشورة فيها.");
      setTargetLoading(false);
      return;
    }
    if (contentForm.targetType === "CATEGORY" && !categoryVerticalId) {
      setTargetOptions([]); setTargetNextCursor(""); setTargetMessage("اختر المجال التجاري أولًا لعرض فئاته."); setTargetLoading(false); return;
    }
    if (["STORE", "PRODUCT", "PROMOTION", "CATEGORY"].includes(contentForm.targetType) && targetSearch.trim().length < 2) {
      setTargetOptions([]);
      setTargetNextCursor("");
      setTargetMessage("اكتب حرفين على الأقل للبحث في الوجهات المتاحة.");
      setTargetLoading(false);
      return;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({ targetType: contentForm.targetType });
    if (contentForm.serviceCityId) params.set("serviceCityId", contentForm.serviceCityId);
    if (["STORE", "PRODUCT", "PROMOTION", "CATEGORY"].includes(contentForm.targetType)) params.set("query", targetSearch.trim());
    if (contentForm.targetType === "CATEGORY") params.set("verticalId", categoryVerticalId);
    if (targetCursor) params.set("cursor", targetCursor);
    setTargetLoading(true);
    setTargetMessage("");
    void fetch(`/api/marketing/content/targets?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { options?: ReadonlyArray<{ id: string; label: string; detail?: string }>; nextCursor?: string; error?: { message?: string } } | null;
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body?.error?.message ?? "تعذر تحميل الوجهات.");
        const options = body?.options ?? [];
        setTargetOptions((current) => targetCursor ? [...current.filter((item) => !options.some((next) => next.id === item.id)), ...options] : options);
        setTargetNextCursor(body?.nextCursor ?? "");
        if (contentForm.targetType === "PROMOTION" && linkedPromotionRef.current && !targetCursor) {
          const selected = options.find((option) => option.id === linkedPromotionRef.current);
          if (selected) {
            linkedPromotionRef.current = "";
            setContentForm((current) => current.targetType === "PROMOTION" ? { ...current, targetId: selected.id } : current);
            setMessage("تم ربط البنر بالعرض المنشور. اختر الصورة وراجع التفاصيل قبل إنشاء المسودة.");
          } else {
            setTargetMessage("العرض المرتبط غير مؤهل للظهور الآن. اختر عرضًا منشورًا من النتائج.");
          }
        }
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setTargetOptions([]);
        setTargetMessage(error instanceof Error ? error.message : "تعذر تحميل الوجهات.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setTargetLoading(false);
      });
    return () => controller.abort();
  }, [categoryVerticalId, contentForm.serviceCityId, contentForm.targetType, targetCursor, targetSearch]);

  useEffect(() => {
    let active = true;
    setPendingCreate(null);
    setMediaFile(null);
    setLoadedStorageKey("");
    setStorageError("");
    if (!pendingStorageKey) return () => { active = false; };
    let raw: string | null;
    try {
      raw = window.sessionStorage.getItem(pendingStorageKey);
    } catch {
      setStorageError("تعذر قراءة محاولة إنشاء المحتوى المحفوظة؛ لن يُرسل طلب جديد قبل استعادة نتيجتها.");
      setLoadedStorageKey(pendingStorageKey);
      return () => { active = false; };
    }
    if (!raw) {
      setLoadedStorageKey(pendingStorageKey);
      return () => { active = false; };
    }
    const restored = readPendingDiscoveryContentCreate(raw);
    if (!restored) {
      setStorageError("تعذر التحقق من محاولة إنشاء المحتوى المحفوظة. افحص سجل المحتوى قبل بدء محاولة جديدة.");
      setLoadedStorageKey(pendingStorageKey);
      return () => { active = false; };
    }
    setPendingCreate(restored);
    setContentForm({
      titleAr: restored.input.titleAr,
      bodyAr: restored.input.bodyAr ?? "",
      kind: restored.input.kind,
      targetType: restored.input.targetType,
      targetId: restored.input.targetId ?? "",
      serviceCityId: restored.input.serviceCityId ?? "",
      ordinal: String(restored.input.ordinal),
    });
    setContentStartsAt(dateTimeLocalValue(restored.input.startsAt));
    setContentEndsAt(restored.input.endsAt ? dateTimeLocalValue(restored.input.endsAt) : "");
    setMediaProvenance(restored.input.provenance);
    setAttemptChecking(true);
    setMessage("استعدت محاولة إنشاء المحتوى؛ أتحقق من السجل قبل إعادة الإرسال.");
    void readDiscoveryContentById(restored.input.id)
      .then((item) => {
        if (!active) return;
        if (item) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
          setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
          setMediaProvenance(emptyMediaProvenance());
          setSearch(""); setAppliedSearch(""); setState("DRAFT"); setKind(""); setSort("priority"); setCursor(""); setCursorStack([]);
          setMessage("تمت قراءة المحتوى المنشأ من السجل؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
        } else {
          setMessage("لم يظهر المحتوى في السجل بعد. أعد اختيار الصورة نفسها للتحقق منها ثم أعد المحاولة.");
        }
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "تعذر التحقق من نتيجة إنشاء المحتوى.");
      })
      .finally(() => {
        if (active) {
          setAttemptChecking(false);
          setLoadedStorageKey(pendingStorageKey);
        }
      });
    return () => { active = false; };
  }, [pendingStorageKey]);

  async function createContent() {
    setBusy(true);
    setMessage("");
    try {
      if (!attemptReady) throw new Error(storageError || "جارٍ استعادة محاولة سابقة؛ انتظر التحقق من السجل.");
      let attempt: PendingDiscoveryContentCreate;
      if (pendingCreate) {
        attempt = pendingCreate;
        const existing = await readDiscoveryContentById(attempt.input.id);
        if (existing) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
          setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
          setMediaFile(null);
          setMediaProvenance(emptyMediaProvenance());
          setSearch(""); setAppliedSearch(""); setState("DRAFT"); setKind(""); setSort("priority"); setCursor(""); setCursorStack([]);
          await load({ search: "", state: "DRAFT", kind: "", sort: "priority", cursor: "" });
          setMessage("تمت قراءة المحتوى المنشأ من السجل؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
          return;
        }
        if (!mediaFile) throw new Error("لم يظهر المحتوى في السجل. أعد اختيار الصورة الأصلية أولًا لمطابقة بصمتها قبل إعادة المحاولة.");
        if (mediaFile.size !== attempt.input.media.size || mediaFile.type.toLowerCase() !== attempt.input.media.type) throw new Error("الصورة المختارة لا تطابق المحاولة المحفوظة. اختر الملف الأصلي نفسه دون تغيير بقية البيانات.");
        if (await sha256File(mediaFile) !== attempt.input.media.sha256) throw new Error("الصورة المختارة لا تطابق الملف المحفوظ. لم يُرسل طلب جديد؛ اختر الصورة الأصلية.");
      } else {
        const starts = new Date(contentStartsAt);
        const ends = contentEndsAt ? new Date(contentEndsAt) : null;
        if (!contentForm.titleAr.trim() || Number.isNaN(starts.getTime()) || !Number.isSafeInteger(Number(contentForm.ordinal)) || Number(contentForm.ordinal) < 0) throw new Error("أكمل عنوان المحتوى وتاريخه وترتيبه.");
        if (!mediaFile) throw new Error("اختر صورة أو فيديو للمحتوى.");
        if (!isMediaProvenanceInputValid(mediaProvenance)) throw new Error("أكمل بيانات مصدر الصورة وبيان الحقوق وأكّد الإذن.");
        if (mediaFile.size > 10 * 1024 * 1024) throw new Error("حجم الوسيط يجب ألا يتجاوز 10 ميجابايت.");
        if (!["image/jpeg", "image/png", ...(contentForm.kind === "SHORT_FORM" ? ["video/mp4"] : [])].includes(mediaFile.type.toLowerCase())) throw new Error("اختر صورة JPEG/PNG أو فيديو MP4 للريلز فقط.");
        if (contentForm.targetType !== "INFO" && !targetOptions.some((option) => option.id === contentForm.targetId)) throw new Error("اختر وجهة من نتائج النظام الحالية قبل إنشاء المحتوى.");
        if (ends && (Number.isNaN(ends.getTime()) || ends <= starts)) throw new Error("نهاية المحتوى يجب أن تكون بعد بدايته.");
        const media = { name: mediaFile.name, size: mediaFile.size, type: mediaFile.type.toLowerCase(), lastModified: mediaFile.lastModified, sha256: await sha256File(mediaFile) };
        attempt = {
          idempotencyKey: crypto.randomUUID(),
          correlationId: "marketing_content_create_" + crypto.randomUUID(),
          input: {
            id: "content-" + crypto.randomUUID(),
            kind: contentForm.kind,
            titleAr: contentForm.titleAr.trim(),
            ...(contentForm.bodyAr.trim() ? { bodyAr: contentForm.bodyAr.trim() } : {}),
            targetType: contentForm.targetType,
            ...(contentForm.targetId.trim() ? { targetId: contentForm.targetId.trim() } : {}),
            ...(contentForm.serviceCityId ? { serviceCityId: contentForm.serviceCityId } : {}),
            startsAt: starts.toISOString(),
            ...(ends ? { endsAt: ends.toISOString() } : {}),
            ordinal: Number(contentForm.ordinal),
            provenance: mediaProvenance,
            media,
          },
        };
        if (!persistMarketingCreate(pendingStorageKey, attempt)) throw new Error("تعذر حفظ محاولة الإنشاء؛ لم يُرسل الطلب. أعد المحاولة بعد تفعيل تخزين الجلسة.");
        setPendingCreate(attempt);
      }
      const input = attempt.input;
      const form = new FormData();
      form.append("id", input.id);
      form.append("kind", input.kind);
      form.append("titleAr", input.titleAr);
      if (input.bodyAr) form.append("bodyAr", input.bodyAr);
      form.append("targetType", input.targetType);
      if (input.targetId) form.append("targetId", input.targetId);
      if (input.serviceCityId) form.append("serviceCityId", input.serviceCityId);
      form.append("startsAt", input.startsAt);
      if (input.endsAt) form.append("endsAt", input.endsAt);
      form.append("ordinal", String(input.ordinal));
      form.append("file", mediaFile!, mediaFile!.name);
      appendMediaProvenance(form, input.provenance);
      const response = await fetch("/api/marketing/content", { method: "POST", headers: { "Idempotency-Key": attempt.idempotencyKey, "X-Correlation-ID": attempt.correlationId }, body: form });
      const responseBody = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 408) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
        }
        throw new Error(apiMessage(responseBody));
      }
      const created = await readDiscoveryContentById(input.id);
      if (!created) throw new Error("تعذر تأكيد المحتوى من السجل. بقيت المحاولة محفوظة لإعادة التحقق دون تكرار العملية.");
      clearPendingMarketingCreate(pendingStorageKey);
      setPendingCreate(null);
      setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
      setTargetSearch("");
      setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor("");
      setMediaFile(null);
      setMediaProvenance(emptyMediaProvenance());
      setSearch(""); setAppliedSearch(""); setState("DRAFT"); setKind(""); setSort("priority"); setCursor(""); setCursorStack([]);
      await load({ search: "", state: "DRAFT", kind: "", sort: "priority", cursor: "" });
      setMessage("تم إنشاء المحتوى وقراءته كمسودة من السجل. انشره من السجل عندما يصبح جاهزًا.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر إنشاء المحتوى.");
    } finally {
      setBusy(false);
    }
  }

  async function publishContent(item: DiscoveryContentView, state: "PUBLISHED" | "PAUSED") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/marketing/content/${encodeURIComponent(item.id)}/publication`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID(), "X-Expected-Version": String(item.version) }, body: JSON.stringify({ state }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(apiMessage(body));
      const canonical = await readDiscoveryContentById(item.id);
      if (!canonical || canonical.state !== state || canonical.version <= item.version) {
        throw new Error("أُرسل تغيير النشر لكن لم تؤكد القراءة المعتمدة الحالة والإصدار الجديدين. أعد قراءة السجل قبل إعادة الإجراء.");
      }
      await load();
      setMessage(state === "PUBLISHED" ? "نُشر المحتوى وأُكدت حالته من السجل." : "أُوقف المحتوى وأُكدت حالته من السجل.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر المحتوى.");
    } finally {
      setBusy(false);
    }
  }

  let pendingCreateStatusMessage = "استعيدت المحاولة دون الملف؛ تحقّق من السجل أولًا ثم اختر الصورة الأصلية لمطابقة بصمتها وإعادة المحاولة.";
  if (attemptChecking) {
    pendingCreateStatusMessage = "جارٍ التحقق من نتيجة المحاولة المحفوظة …";
  } else if (mediaFile) {
    pendingCreateStatusMessage = "المحاولة لم تُحسم بعد. البيانات مقفلة وستعاد الصورة والطلب دون تكرار العملية.";
  }

  let targetSearchDescription = "عن فئة";
  if (contentForm.targetType === "STORE") targetSearchDescription = "عن متجر";
  else if (contentForm.targetType === "PRODUCT") targetSearchDescription = "عن منتج";
  else if (contentForm.targetType === "PROMOTION") targetSearchDescription = "عن عرض";
  const targetSearchPlaceholder = `ابحث ${targetSearchDescription}`;

  let analyticsPanel: ReactNode = null;
  if (analyticsContentId) {
    let analyticsContent: ReactNode = null;
    if (analyticsLoading) {
      analyticsContent = <p role="status">جارٍ قراءة النتائج…</p>;
    } else if (analyticsError) {
      analyticsContent = <p role="alert">{analyticsError}</p>;
    } else if (analytics) {
      const measures = [
        { type: "IMPRESSION", label: "أحداث الظهور" },
        { type: "CLICK", label: "أحداث النقر" },
        { type: "CONVERSION", label: "طلبات منشأة منسوبة" },
      ] as const;
      const counts = measures.map(({ type, label }) => ({ label, count: analytics.find((item) => item.eventType === type)?.count ?? 0 }));
      const scale = Math.max(1, ...counts.map(({ count }) => count));
      analyticsContent = <>
        <dl className="marketing-analytics-breakdown">
          {counts.map(({ label, count }) => <div key={label}>
            <dt>{label}</dt>
            <dd>
              <strong>{count.toLocaleString("ar-YE")}</strong>
              <progress max={scale} value={count} aria-label={`${label}: ${count}`} />
            </dd>
          </div>)}
        </dl>
        <p className="muted">الأشرطة تعرض مقارنة عدد الأحداث فقط، ولا تعبر عن معدل تحويل أو أرباح. الطلبات هنا منشأة منسوبة، وليست تسليمات مكتملة. لا يشمل القياس تكلفة تمويل الخصومات.</p>
      </>;
    }
    analyticsPanel = <aside className="panel" aria-live="polite"><strong>تحليلات المحتوى</strong>{analyticsContent}<button className="button button-quiet" type="button" onClick={() => { analyticsSequence.current++; setAnalyticsContentId(""); setAnalytics(null); setAnalyticsError(""); }}>إغلاق التحليلات</button></aside>;
  }

  return (
    <AdaptiveRecordWorkspace preferenceKey="marketing-content" open={Boolean(analyticsContentId) && !editorOpen && !pendingCreate}
      onClose={() => { analyticsSequence.current++; setAnalyticsContentId(""); setAnalytics(null); setAnalyticsError(""); }}
      detail={analyticsContentId && !editorOpen && !pendingCreate ? <AdaptiveRecordPanel title="تحليلات المحتوى"
        onClose={() => { analyticsSequence.current++; setAnalyticsContentId(""); setAnalytics(null); setAnalyticsError(""); }}>
        {analyticsPanel}
      </AdaptiveRecordPanel> : null}>
    <div className="work-stack" data-testid="marketing-content-workspace">
      <MarketingBannerPresentation images={(registry?.items ?? []).filter(item => item.kind === "BANNER" && item.state === "PUBLISHED" && Boolean(item.mediaUri)).slice(0, 8).map(item => ({ id: item.id, titleAr: item.titleAr, mediaUri: item.mediaUri }))} />
      {storageError ? <p className="managed-status managed-status-warning" role="alert">{storageError}</p> : null}
      {pendingCreate ? <p className="managed-status managed-status-warning" role="status">{pendingCreateStatusMessage}</p> : null}
      {editorOpen || pendingCreate ? <section className="marketing-editor-mode" aria-label="إنشاء محتوى اكتشاف">
        <div className="action-row"><button type="button" className="button button-secondary"
          disabled={busy || Boolean(pendingCreate)} onClick={() => setEditorOpen(false)}>العودة إلى سجل المحتوى</button></div>
      <details className="access-card marketing-create-disclosure" open={Boolean(pendingCreate) || editorOpen} onToggle={(event) => setEditorOpen(event.currentTarget.open)}>
        <summary className="section-heading marketing-create-summary">إنشاء محتوى اكتشاف</summary>
        <div className="access-card-heading"><h2>إنشاء بطاقة اكتشاف</h2></div>
        <p className="muted">المحتوى المنشور المرتبط بمتجر أو منتج من كتالوجه أو عرض مرتبط به يظهر في شريط واجهة ذلك المتجر. اختر الوجهة الصحيحة؛ لا يُعرض محتوى متجر داخل متجر آخر.</p>
        <div className="workspace-form-grid">
          <label className="field-label">عنوان المحتوى<input aria-label="عنوان المحتوى" placeholder="مختارات الأسبوع" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.titleAr} onChange={(event) => setContentForm((current) => ({ ...current, titleAr: event.target.value }))} /></label>
          <label className="field-label">نص المحتوى<input aria-label="نص المحتوى" placeholder="اكتشف الجديد في مدينتك" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.bodyAr} onChange={(event) => setContentForm((current) => ({ ...current, bodyAr: event.target.value }))} /></label>
          <label className="field-label" htmlFor="marketing-content-kind">نوع المحتوى<select id="marketing-content-kind" aria-label="نوع المحتوى" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.kind} onChange={(event) => setContentForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="BANNER">بنر رئيسي</option><option value="CAROUSEL">شريحة كاروسيل</option><option value="SHORT_FORM">ريلز / قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="marketing-content-media">وسائط المحتوى<input id="marketing-content-media" aria-label="ملف وسائط المحتوى" type="file" accept={contentForm.kind === "SHORT_FORM" ? "image/jpeg,image/png,video/mp4" : "image/jpeg,image/png"} required disabled={busy || !attemptReady || Boolean(pendingCreate && mediaFile)} onChange={(event) => { setMediaFile(event.target.files?.[0] ?? null); if (!pendingCreate) setMediaProvenance(emptyMediaProvenance()); }} /></label><CatalogMediaProvenanceFields idPrefix="marketing-content-media" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={mediaProvenance} onChange={setMediaProvenance} />
          {mediaFile ? <p className="muted" data-testid="marketing-content-file">{mediaFile.name} · {(mediaFile.size / 1024).toFixed(0)} كيلوبايت</p> : <p className="muted">JPEG أو PNG، وللريلز MP4، حتى 10 ميجابايت.</p>}
          {canPreviewMedia ? <figure aria-label="معاينة صورة المحتوى قبل النشر" data-testid="marketing-content-preview" className={contentForm.kind === "SHORT_FORM" ? "marketing-local-preview is-story" : "marketing-local-preview"}>
            <div className="marketing-local-preview-visual">
              <canvas ref={mediaPreviewCanvasRef} role="img" aria-label="معاينة الصورة المختارة" width={contentForm.kind === "SHORT_FORM" ? 240 : 600} height={contentForm.kind === "SHORT_FORM" ? 280 : 240} className="marketing-local-preview-canvas" />
              <div className="marketing-local-preview-overlay">
                <strong>{contentForm.titleAr.trim() || "عنوان المحتوى"}</strong>
                {contentForm.bodyAr.trim() ? <div>{contentForm.bodyAr.trim()}</div> : null}
              </div>
            </div>
            <figcaption className="muted">معاينة تقريبية على الهاتف · لا تُنشر حتى تعتمد المسودة</figcaption>
            {mediaPreviewError ? <p className="managed-status managed-status-warning" role="alert">{mediaPreviewError}</p> : null}
          </figure> : null}
          <label className="field-label" htmlFor="marketing-content-target">نوع الوجهة<select id="marketing-content-target" aria-label="نوع وجهة المحتوى" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.targetType} onChange={(event) => { linkedPromotionRef.current = ""; setTargetSearch(""); setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setCategoryVerticalId(""); setContentForm((current) => ({ ...current, targetType: event.target.value as typeof current.targetType, targetId: "" })); }}><option value="INFO">معلومات فقط</option><option value="STORE">متجر</option><option value="PRODUCT">منتج</option><option value="CATEGORY">فئة</option><option value="PROMOTION">عرض</option></select></label>
          {contentForm.targetType !== "INFO" ? <>
            {contentForm.targetType === "CATEGORY" ? <label className="field-label" htmlFor="marketing-content-category-vertical">المجال التجاري<select id="marketing-content-category-vertical" aria-label="المجال التجاري للفئة" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={categoryVerticalId} onChange={(event) => { setCategoryVerticalId(event.target.value); setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, targetId: "" })); }}><option value="">اختر المجال التجاري</option>{categoryVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label> : null}
            <label className="field-label">بحث في الوجهات<input aria-label="بحث في الوجهات" maxLength={128} placeholder={targetSearchPlaceholder} disabled={busy || Boolean(pendingCreate) || !attemptReady} value={targetSearch} onChange={(event) => { linkedPromotionRef.current = ""; setTargetSearch(event.target.value); setTargetCursor(""); setTargetCursorStack([]); setTargetOptions([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, targetId: "" })); }} /></label>
            <label className="field-label" htmlFor="marketing-content-target-option">الوجهة المعتمدة<select id="marketing-content-target-option" aria-label="الوجهة المعتمدة" value={contentForm.targetId} disabled={busy || Boolean(pendingCreate) || !attemptReady || targetLoading || targetOptions.length === 0} onChange={(event) => setContentForm((current) => ({ ...current, targetId: event.target.value }))}>
              <option value="">{targetLoading ? "جارٍ تحميل الوجهات…" : "اختر وجهة من السجلات"}</option>
              {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.detail ? `${option.label} · ${option.detail}` : option.label}</option>)}
            </select></label>
            {!["CATEGORY", "INFO"].includes(contentForm.targetType) ? <nav className="pagination" aria-label="صفحات وجهات المحتوى"><button className="button button-quiet" type="button" disabled={targetLoading || targetCursorStack.length === 0} onClick={() => { const next = [...targetCursorStack]; setTargetCursor(next.pop() ?? ""); setTargetCursorStack(next); }}>السابق</button><span>{targetCursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={targetLoading || !targetNextCursor} onClick={() => { setTargetCursorStack((items) => [...items, targetCursor]); setTargetCursor(targetNextCursor); }}>تحميل المزيد</button></nav> : null}
            {contentForm.targetType === "CATEGORY" ? <nav className="pagination" aria-label="صفحات فئات المحتوى"><button className="button button-quiet" type="button" disabled={targetLoading || targetCursorStack.length === 0} onClick={() => { const next = [...targetCursorStack]; setTargetCursor(next.pop() ?? ""); setTargetCursorStack(next); }}>السابق</button><span>{targetCursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={targetLoading || !targetNextCursor} onClick={() => { setTargetCursorStack((items) => [...items, targetCursor]); setTargetCursor(targetNextCursor); }}>تحميل المزيد</button></nav> : null}
            {targetMessage ? <p className="muted" role="status">{targetMessage}</p> : null}

          </> : null}
          <label className="field-label" htmlFor="marketing-content-city">مدينة الخدمة<select id="marketing-content-city" aria-label="مدينة خدمة المحتوى" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.serviceCityId} onChange={(event) => { linkedPromotionRef.current = ""; setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, serviceCityId: event.target.value, targetId: "" })); }}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <label className="field-label">بداية النشر<input aria-label="بداية المحتوى" type="datetime-local" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentStartsAt} onChange={(event) => setContentStartsAt(event.target.value)} /></label>
          <label className="field-label">نهاية النشر<input aria-label="نهاية المحتوى" type="datetime-local" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentEndsAt} onChange={(event) => setContentEndsAt(event.target.value)} /></label>
          <label className="field-label">ترتيب العرض<input aria-label="ترتيب المحتوى" inputMode="numeric" type="number" min="0" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.ordinal} onChange={(event) => setContentForm((current) => ({ ...current, ordinal: event.target.value }))} /></label>
          <button className="button" type="button" disabled={busy || attemptChecking || !attemptReady} onClick={() => void createContent()}>{pendingCreate ? "التحقق / إعادة محاولة الإنشاء" : "إنشاء مسودة المحتوى"}</button>
        </div>
      </details>
      </section> : null}
      {!editorOpen && !pendingCreate ? <section className="access-card" aria-labelledby="marketing-content-title">
        <div className="action-row"><button type="button" className="button button-primary" onClick={() => { setEditorOpen(true); analyticsSequence.current++; setAnalyticsContentId(""); setAnalytics(null); setAnalyticsError(""); }}>إنشاء محتوى</button></div>
        <div className="access-card-heading"><h2 id="marketing-content-title">سجل محتوى الاكتشاف</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        <form className="registry-toolbar" noValidate onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim().slice(0, 128)); setCursor(""); setCursorStack([]); }}>
          <label className="field-label" htmlFor="content-search">عنوان المحتوى<input id="content-search" aria-label="البحث في سجل المحتوى" type="search" maxLength={128} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field-label" htmlFor="content-state">الحالة<select id="content-state" value={state} onChange={(event) => { setState(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="PUBLISHED">منشور</option><option value="PAUSED">موقوف</option></select></label>
          <label className="field-label" htmlFor="content-kind-filter">النوع<select id="content-kind-filter" value={kind} onChange={(event) => { setKind(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الأنواع</option><option value="BANNER">بنر</option><option value="CAROUSEL">كاروسيل</option><option value="SHORT_FORM">ريلز / قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="content-sort">الترتيب<select id="content-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setCursor(""); setCursorStack([]); }}><option value="priority">أولوية العرض</option><option value="created_desc">الأحدث إنشاءً</option></select></label>
          <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
        </form>
        {registry?.items.length ? <><div className="table-wrap marketing-content-table-wrap"><table className="data-table"><caption className="visually-hidden">سجل محتوى الاكتشاف</caption><thead><tr>
          <th scope="col">المحتوى</th>
          <th scope="col">النوع والوجهة</th>
          <th scope="col">الحالة</th>
          <th scope="col">الأولوية والبداية</th>
          <th scope="col">الإجراءات</th>
        </tr></thead><tbody>{registry.items.map((item) => <tr key={item.id}><th scope="row">{item.mediaUri ? (item.mediaKind === "video" ? <span className="media-preview" aria-label="فيديو" role="img">▶</span> : <img className="media-preview" src={item.mediaUri} alt="" loading="lazy" />) : null}{item.titleAr}</th><td>{({ BANNER: "صورة رئيسية", CAROUSEL: "شريحة صور", SHORT_FORM: "قصة قصيرة" } as const)[item.kind]} · {({ STORE: "متجر", PRODUCT: "منتج", CATEGORY: "فئة", PROMOTION: "عرض", INFO: "معلومات عامة" } as const)[item.targetType]}</td><td><MarketingStateIndicator state={item.state} /></td><td>{item.ordinal}<br /><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td><div className="action-row"><button className="button button-quiet" type="button" disabled={analyticsLoading} onClick={() => void readAnalytics(item.id)}>{analyticsLoading && analyticsContentId === item.id ? "جارٍ قراءة التحليلات…" : "قراءة التحليلات"}</button><button className="button button-quiet" type="button" disabled={busy} onClick={() => void publishContent(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف المحتوى" : "نشر المحتوى"}</button></div></td></tr>)}</tbody></table></div>
        <ul className="marketing-content-mobile-list" aria-label="محتوى الاكتشاف">
          {registry.items.map((item) => <li key={item.id} className="marketing-content-mobile-item">
            <div className="marketing-content-mobile-main">
              {item.mediaUri ? (item.mediaKind === "video" ? <span className="media-preview" aria-label="فيديو" role="img">▶</span> : <img className="media-preview" src={item.mediaUri} alt="" loading="lazy" />) : null}
              <div className="marketing-content-mobile-description">
                <strong>{item.titleAr}</strong>
                <span>{({ BANNER: "صورة رئيسية", CAROUSEL: "شريحة صور", SHORT_FORM: "قصة قصيرة" } as const)[item.kind]}
                  {" · "}{({ STORE: "متجر", PRODUCT: "منتج", CATEGORY: "فئة", PROMOTION: "عرض", INFO: "معلومات عامة" } as const)[item.targetType]}</span>
              </div>
              <MarketingStateIndicator state={item.state} />
            </div>
            <div className="marketing-content-mobile-bottom">
              <time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time>
              <div className="marketing-content-mobile-actions">
                <button className="button button-quiet" type="button" disabled={analyticsLoading}
                  onClick={() => void readAnalytics(item.id)}>{analyticsLoading && analyticsContentId === item.id ? "جارٍ قراءة التحليلات…" : "التحليلات"}</button>
                <button className="button button-secondary" type="button" disabled={busy}
                  onClick={() => void publishContent(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف النشر" : "نشر المحتوى"}</button>
              </div>
            </div>
          </li>)}
        </ul></> : null}
        {!registry?.items.length && loading ? <p role="status" className="collection-state">جارٍ قراءة صفحة المحتوى…</p> : null}
        {registryError ? <div role="alert" className="managed-status managed-status-warning"><p>{registryError}</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void load()}>إعادة المحاولة</button></div> : null}
        {registry && !registry.items.length && !loading && !registryError ? <p className="collection-state">لا يوجد محتوى مطابق.</p> : null}
        <nav className="pagination" aria-label="صفحات سجل محتوى الاكتشاف"><button className="button button-quiet" type="button" disabled={loading || cursorStack.length === 0} onClick={() => { const next = [...cursorStack]; const previous = next.pop() ?? ""; setCursorStack(next); setCursor(previous); }}>السابق</button><span>صفحة {cursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={loading || !registry?.nextCursor} onClick={() => { setCursorStack((items) => [...items, cursor]); setCursor(registry?.nextCursor ?? ""); }}>التالي</button></nav>
      </section> : null}
    </div>
    </AdaptiveRecordWorkspace>
  );
}
