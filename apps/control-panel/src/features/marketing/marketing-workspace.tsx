"use client";

import { formatMoney, isMediaProvenanceInputValid, type CommerceVertical, type CreatePromotionRequest, type DiscoveryContentAnalytics, type DiscoveryContentView, type MediaProvenanceInput, type OperatorDiscoveryContentRegistryResponse, type OperatorPromotionRegistryResponse, type PromotionView, type ServiceCity } from "@bthwani/dsh";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { type MarketingResourceKey, workspaceMarketingResources } from "../../navigation/workspace-registry";
import { useSession } from "../../session/session-provider";
import { WorkspaceResourceIndex } from "../workspace/workspace-resource-index";
import { appendMediaProvenance, CatalogMediaProvenanceFields } from "../central-catalog/catalog-media-provenance-fields";
import styles from "./marketing-workspace.module.css";

type ApiError = { error?: { message?: string } };

function discoveryContentStateLabel(state: DiscoveryContentView["state"]): string {
  if (state === "DRAFT") return "مسودة";
  if (state === "PUBLISHED") return "منشور";
  return "موقوف";
}

function promotionStateLabel(state: PromotionView["state"]): string {
  if (state === "DRAFT") return "مسودة";
  if (state === "PUBLISHED") return "منشور";
  if (state === "PAUSED") return "موقوف";
  return "منتهٍ";
}

function promotionTargetSummary(item: PromotionView): string {
  const targets = item.targets ?? [];
  if (targets.length === 0) return "كل النطاق";
  return targets.map((target) => {
    const kind = target.targetKind === "PRODUCT" ? "منتج" : "فئة";
    return `${kind}: ${target.targetLabelAr?.trim() || "هدف كتالوج"}`;
  }).join("، ");
}

function apiMessage(value: unknown): string {
  return value && typeof value === "object" && "error" in value && (value as ApiError).error?.message ? String((value as ApiError).error?.message) : "تعذر تنفيذ العملية.";
}

function futureDateInput(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

function futureEndDateInput(): string {
  return new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function emptyMediaProvenance(): MediaProvenanceInput {
  return { creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false };
}

type PendingPromotionCreate = Readonly<{
  id: string;
  idempotencyKey: string;
  correlationId: string;
  body: string;
}>;

type PromotionTargetKind = "NONE" | "PRODUCT" | "CATEGORY";
type MarketingTargetOption = Readonly<{ id: string; label: string; detail?: string }>;
type PromotionFormState = Readonly<{
  code: string;
  nameAr: string;
  descriptionAr: string;
  kind: "PERCENTAGE" | "FIXED";
  valueMinor: string;
  maxDiscountMinor: string;
  redemptionLimit: string;
  minOrderSubtotalMinor: string;
  fundingSource: CreatePromotionRequest["fundingSource"];
  fundingSharePartnerPercent: string;
  requiresPartnerOptIn: boolean;
  storeId: string;
  serviceCityId: string;
  targetKind: PromotionTargetKind;
  targetId: string;
}>;

function emptyPromotionForm(): PromotionFormState {
  return {
    code: "",
    nameAr: "",
    descriptionAr: "",
    kind: "PERCENTAGE",
    valueMinor: "10",
    maxDiscountMinor: "",
    redemptionLimit: "",
    minOrderSubtotalMinor: "",
    fundingSource: "BTHWANI",
    fundingSharePartnerPercent: "50",
    requiresPartnerOptIn: false,
    storeId: "",
    serviceCityId: "",
    targetKind: "NONE",
    targetId: "",
  };
}

type PendingDiscoveryContentCreateInput = Readonly<{
  id: string;
  kind: "BANNER" | "CAROUSEL" | "SHORT_FORM";
  titleAr: string;
  bodyAr?: string;
  targetType: "STORE" | "PRODUCT" | "CATEGORY" | "PROMOTION" | "INFO";
  targetId?: string;
  serviceCityId?: string;
  startsAt: string;
  endsAt?: string;
  ordinal: number;
  provenance: MediaProvenanceInput;
  media: Readonly<{ name: string; size: number; type: string; lastModified: number; sha256: string }>;
}>;

type PendingDiscoveryContentCreate = Readonly<{
  idempotencyKey: string;
  correlationId: string;
  input: PendingDiscoveryContentCreateInput;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPendingPromotionCreate(raw: string | null): PendingPromotionCreate | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.id !== "string" || value.id.length < 8 || value.id.length > 128 || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationId !== "string" || value.correlationId.length < 8 || value.correlationId.length > 128 || typeof value.body !== "string" || value.body.length > 8192) return null;
    const body: unknown = JSON.parse(value.body);
    if (!isRecord(body) || body.id !== value.id || typeof body.code !== "string" || typeof body.nameAr !== "string" || !["PERCENTAGE", "FIXED"].includes(String(body.kind)) || !Number.isSafeInteger(body.valueMinor) || !["PARTNER", "BTHWANI", "SHARED"].includes(String(body.fundingSource)) || typeof body.startsAt !== "string") return null;
    if (body.fundingSource === "SHARED" && (!Number.isSafeInteger(body.fundingSharePartnerPercent) || Number(body.fundingSharePartnerPercent) < 1 || Number(body.fundingSharePartnerPercent) > 99)) return null;
    if (body.requiresPartnerOptIn !== undefined && typeof body.requiresPartnerOptIn !== "boolean") return null;
    if (body.targets !== undefined && (!Array.isArray(body.targets) || body.targets.some((target) => !isRecord(target) || !["PRODUCT", "CATEGORY"].includes(String(target.targetKind)) || typeof target.targetRef !== "string" || !target.targetRef.trim()))) return null;
    return { id: value.id, idempotencyKey: value.idempotencyKey, correlationId: value.correlationId, body: value.body };
  } catch {
    return null;
  }
}

function readPendingDiscoveryContentCreate(raw: string | null): PendingDiscoveryContentCreate | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || typeof value.idempotencyKey !== "string" || value.idempotencyKey.length < 8 || value.idempotencyKey.length > 128 || typeof value.correlationId !== "string" || value.correlationId.length < 8 || value.correlationId.length > 128 || !isRecord(value.input)) return null;
    const input = value.input;
    const provenance = input.provenance;
    const media = input.media;
    if (typeof input.id !== "string" || input.id.length < 8 || input.id.length > 128 || !["BANNER", "CAROUSEL", "SHORT_FORM"].includes(String(input.kind)) || typeof input.titleAr !== "string" || !input.titleAr.trim() || (input.bodyAr !== undefined && typeof input.bodyAr !== "string") || !["STORE", "PRODUCT", "CATEGORY", "PROMOTION", "INFO"].includes(String(input.targetType)) || (input.targetId !== undefined && typeof input.targetId !== "string") || (input.serviceCityId !== undefined && typeof input.serviceCityId !== "string") || typeof input.startsAt !== "string" || Number.isNaN(Date.parse(input.startsAt)) || (input.endsAt !== undefined && (typeof input.endsAt !== "string" || Number.isNaN(Date.parse(input.endsAt)))) || !Number.isSafeInteger(input.ordinal) || Number(input.ordinal) < 0 || !isRecord(provenance) || typeof provenance.creator !== "string" || typeof provenance.sourceDescription !== "string" || (provenance.sourceUri !== undefined && typeof provenance.sourceUri !== "string") || typeof provenance.rightsStatement !== "string" || (provenance.rightsUri !== undefined && typeof provenance.rightsUri !== "string") || typeof provenance.rightsAttested !== "boolean" || !isMediaProvenanceInputValid(provenance as unknown as MediaProvenanceInput) || !isRecord(media) || typeof media.name !== "string" || !media.name || !Number.isSafeInteger(media.size) || Number(media.size) < 1 || Number(media.size) > 10 * 1024 * 1024 || !["image/jpeg", "image/png"].includes(String(media.type).toLowerCase()) || !Number.isSafeInteger(media.lastModified) || Number(media.lastModified) < 0 || typeof media.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(media.sha256)) return null;
    return {
      idempotencyKey: value.idempotencyKey,
      correlationId: value.correlationId,
      input: {
        id: input.id,
        kind: input.kind as PendingDiscoveryContentCreateInput["kind"],
        titleAr: input.titleAr,
        ...(typeof input.bodyAr === "string" ? { bodyAr: input.bodyAr } : {}),
        targetType: input.targetType as PendingDiscoveryContentCreateInput["targetType"],
        ...(typeof input.targetId === "string" ? { targetId: input.targetId } : {}),
        ...(typeof input.serviceCityId === "string" ? { serviceCityId: input.serviceCityId } : {}),
        startsAt: input.startsAt,
        ...(typeof input.endsAt === "string" ? { endsAt: input.endsAt } : {}),
        ordinal: Number(input.ordinal),
        provenance: provenance as unknown as MediaProvenanceInput,
        media: {
          name: media.name,
          size: Number(media.size),
          type: String(media.type).toLowerCase(),
          lastModified: Number(media.lastModified),
          sha256: media.sha256,
        },
      },
    };
  } catch {
    return null;
  }
}

function clearPendingMarketingCreate(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // A retained key can only replay the same immutable request.
  }
}

function persistMarketingCreate(storageKey: string, value: PendingPromotionCreate | PendingDiscoveryContentCreate): boolean {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function readPromotionById(id: string): Promise<PromotionView | null> {
  const params = new URLSearchParams({ search: id, sort: "starts_desc", limit: "100" });
  const response = await fetch("/api/marketing/promotions?" + params, { cache: "no-store" });
  const body = await response.json().catch(() => null) as OperatorPromotionRegistryResponse | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر التحقق من نتيجة إنشاء العرض." : "تعذر التحقق من نتيجة إنشاء العرض.");
  if (!body || !("promotions" in body) || !Array.isArray(body.promotions)) throw new Error("تعذر التحقق من القراءة الكانونية للعرض.");
  return body.promotions.find((promotion) => promotion.id === id) ?? null;
}

async function readDiscoveryContentById(id: string): Promise<DiscoveryContentView | null> {
  const params = new URLSearchParams({ search: id, sort: "created_desc", limit: "100" });
  const response = await fetch("/api/marketing/content?" + params, { cache: "no-store" });
  const body = await response.json().catch(() => null) as OperatorDiscoveryContentRegistryResponse | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر التحقق من نتيجة إنشاء المحتوى." : "تعذر التحقق من نتيجة إنشاء المحتوى.");
  if (!body || !("items" in body) || !Array.isArray(body.items)) throw new Error("تعذر التحقق من القراءة الكانونية للمحتوى.");
  return body.items.find((item) => item.id === id) ?? null;
}

async function readActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
  const response = await fetch("/api/service-cities", { cache: "no-store" });
  if (!response.ok) throw new Error("SERVICE_CITIES_READ_FAILED");
  const body = await response.json() as { cities?: ReadonlyArray<ServiceCity> };
  return (body.cities ?? []).filter((city) => city.active);
}

function resourceForPath(pathname: string): MarketingResourceKey {
  if (pathname === "/marketing") return "overview";
  return workspaceMarketingResources.find((resource) => resource.href !== "/marketing" && (pathname === resource.href || pathname.startsWith(`${resource.href}/`)))?.key ?? "overview";
}

function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>التسويق للمشغلين فقط</h1>
        <p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج Identity.</p>
      </div>
    </section>
  );
}

export function MarketingWorkspace({ resource, children }: { resource: MarketingResourceKey; children: ReactNode }) {
  const { state } = useSession();
  const pathname = usePathname() ?? "/marketing";
  const activeResource = resource === "overview" ? resourceForPath(pathname) : resource;

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return accessDenied();

  const selected = workspaceMarketingResources.find((item) => item.key === activeResource) ?? workspaceMarketingResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="marketing-page-title">
      <div className="workspace-page-heading">
        <p className="eyebrow">إدارة النمو</p>
        <h1 id="marketing-page-title">{selected.key === "overview" ? "التسويق والمحتوى" : selected.label}</h1>
        <p className="lead">{selected.description}</p>
      </div>
      {children}
    </section>
  );
}

export function MarketingOverview() {
  return (
    <WorkspaceResourceIndex
      title="موارد التسويق والمحتوى"
      description="العروض ومحتوى الاكتشاف مساران مستقلان، ولكل منهما قراءة ونشر من مالكه القانوني."
      resources={workspaceMarketingResources.slice(1)}
    />
  );
}

export function MarketingPromotionsWorkspace() {
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" ? sessionState.identity.subject : "";
  const pendingStorageKey = operatorActorId ? "bthwani.control.marketing.promotion-create.v1." + encodeURIComponent(operatorActorId) : "";
  const [registry, setRegistry] = useState<OperatorPromotionRegistryResponse | null>(null);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [state, setState] = useState("");
  const [sort, setSort] = useState<"starts_desc" | "starts_asc">("starts_desc");
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
    setLoading(true);
    const params = new URLSearchParams({ limit: "25", sort: query.sort ?? sort });
    if (query.search ?? appliedSearch) params.set("search", query.search ?? appliedSearch);
    if (query.state ?? state) params.set("state", query.state ?? state);
    if (query.cursor ?? cursor) params.set("cursor", query.cursor ?? cursor);
    try {
      const response = await fetch(`/api/marketing/promotions?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as OperatorPromotionRegistryResponse | { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر قراءة سجل العروض." : "تعذر قراءة سجل العروض.");
      setRegistry(body as OperatorPromotionRegistryResponse);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, cursor, sort, state]);

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل العروض.")); }, [load]);
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
    setMessage("استعدت محاولة إنشاء العرض؛ أتحقق من سجل DSH قبل إعادة الإرسال.");
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
          setMessage("تمت قراءة العرض المنشأ من سجل DSH؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
        } else {
          setMessage("لم يظهر العرض في السجل بعد. أعد المحاولة للتحقق بالمفتاح والبيانات المحفوظة نفسيهما.");
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
      if (!attemptReady) throw new Error(storageError || "جارٍ استعادة محاولة سابقة؛ انتظر التحقق من سجل DSH.");
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
          setMessage("تمت قراءة العرض المنشأ من سجل DSH؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
          return;
        }
      } else {
        const starts = new Date(startsAt);
        const ends = endsAt ? new Date(endsAt) : null;
        const valueMinor = Number(promotionForm.valueMinor);
        const fundingShare = Number(promotionForm.fundingSharePartnerPercent);
        if (!promotionForm.code.trim() || !promotionForm.nameAr.trim() || !Number.isSafeInteger(valueMinor) || valueMinor <= 0 || (promotionForm.kind === "PERCENTAGE" && valueMinor > 100) || Number.isNaN(starts.getTime())) throw new Error("أكمل بيانات العرض الأساسية.");
        if (ends && (Number.isNaN(ends.getTime()) || ends.getTime() <= starts.getTime())) throw new Error("نهاية العرض يجب أن تكون بعد بدايته.");
        if (promotionForm.fundingSource === "SHARED" && (!Number.isSafeInteger(fundingShare) || fundingShare < 1 || fundingShare > 99)) throw new Error("حدد حصة الشريك من التمويل المشترك بين 1 و99.");
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
          requiresPartnerOptIn: !promotionForm.storeId && promotionForm.requiresPartnerOptIn,
          ...(promotionForm.fundingSource === "SHARED" ? { fundingSharePartnerPercent: fundingShare } : {}),
          ...(promotionForm.maxDiscountMinor ? { maxDiscountMinor: Number(promotionForm.maxDiscountMinor) } : {}),
          ...(promotionForm.redemptionLimit ? { redemptionLimit: Number(promotionForm.redemptionLimit) } : {}),
          ...(promotionForm.minOrderSubtotalMinor ? { minOrderSubtotalMinor: Number(promotionForm.minOrderSubtotalMinor) } : {}),
          ...(targets.length ? { targets } : {}),
          ...(promotionForm.storeId ? { storeId: promotionForm.storeId } : {}),
          ...(promotionForm.serviceCityId ? { serviceCityId: promotionForm.serviceCityId } : {}),
          ...(ends ? { endsAt: ends.toISOString() } : {}),
        };
        attempt = { id: input.id, idempotencyKey: crypto.randomUUID(), correlationId: "marketing_promotion_create_" + crypto.randomUUID(), body: JSON.stringify(input) };
        if (!persistMarketingCreate(pendingStorageKey, attempt)) throw new Error("تعذر حفظ مفتاح المحاولة؛ لم يُرسل طلب الإنشاء. أعد المحاولة بعد تفعيل تخزين الجلسة.");
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
      if (!created) throw new Error("تعذر تأكيد العرض من سجل DSH. بقيت المحاولة محفوظة لإعادة التحقق بالمفتاح نفسه.");
      clearPendingMarketingCreate(pendingStorageKey);
      setPendingCreate(null);
      setPromotionForm(emptyPromotionForm());
      setStartsAt(futureDateInput()); setEndsAt("");
      setStoreSearch(""); setStoreOptions([]); setTargetSearch(""); setTargetOptions([]);
      setSearch(""); setAppliedSearch(""); setState("DRAFT"); setSort("starts_desc"); setCursor(""); setCursorStack([]);
      await load({ search: "", state: "DRAFT", sort: "starts_desc", cursor: "" });
      setMessage("تم إنشاء العرض وقراءته كمسودة من سجل DSH. انشره من السجل عندما يصبح جاهزًا.");
    } catch (error) {
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
      if (!canonical || canonical.state !== nextState) {
        throw new Error("تم إرسال تغيير حالة العرض لكن لم تثبت القراءة الكانونية النتيجة المطلوبة. أعد قراءة السجل قبل أي إجراء آخر.");
      }
      await load();
      setMessage(nextState === "PUBLISHED" ? "نُشر العرض وأُكدت حالته من سجل DSH." : "أُوقف العرض وأُكدت حالته من سجل DSH.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر العرض.");
    } finally {
      setBusy(false);
    }
  }

  const formLocked = busy || Boolean(pendingCreate) || !attemptReady;
  const selectedStoreLabel = promotionForm.storeId ? storeOptions.find((item) => item.id === promotionForm.storeId)?.label ?? "متجر معتمد" : "";
  const selectedTargetLabel = promotionForm.targetId ? targetOptions.find((item) => item.id === promotionForm.targetId)?.label ?? "هدف معتمد" : "";

  return (
    <div className={styles.workspace} data-testid="marketing-promotions-workspace">
      {storageError ? <p className="managed-status managed-status-warning" role="alert">{storageError}</p> : null}
      {pendingCreate ? <p className="managed-status managed-status-warning" role="status">{attemptChecking ? "جارٍ التحقق من نتيجة المحاولة المحفوظة في DSH…" : "المحاولة لم تُحسم بعد. الحقول مقفلة وستعيد المحاولة بالبيانات والمفتاح نفسيهما."}</p> : null}
      <details className="access-card" open={Boolean(pendingCreate)}>
        <summary className={styles.createSummary}>إنشاء عرض أو حملة</summary>
        <div className="access-card-heading"><span className="step-chip">العروض</span><p className="eyebrow">تسويق مضبوط</p><h2>إنشاء عرض</h2><p className="muted">مصدر التمويل والنطاق والمشاركة حقائق صريحة؛ العرض يُنشأ كمسودة ثم يُنشر بعد المراجعة.</p></div>
        <div className="workspace-form-grid">
          <input aria-label="رمز العرض" placeholder="WELCOME10" disabled={formLocked} value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value }))} />
          <input aria-label="اسم العرض" placeholder="خصم العملاء الجدد" disabled={formLocked} value={promotionForm.nameAr} onChange={(event) => setPromotionForm((current) => ({ ...current, nameAr: event.target.value }))} />
          <input aria-label="وصف العرض" placeholder="خصم على الطلب" disabled={formLocked} value={promotionForm.descriptionAr} onChange={(event) => setPromotionForm((current) => ({ ...current, descriptionAr: event.target.value }))} />
          <select aria-label="نوع العرض" disabled={formLocked} value={promotionForm.kind} onChange={(event) => setPromotionForm((current) => ({ ...current, kind: event.target.value as PromotionFormState["kind"] }))}><option value="PERCENTAGE">نسبة مئوية</option><option value="FIXED">قيمة ثابتة</option></select>
          <input aria-label={promotionForm.kind === "PERCENTAGE" ? "نسبة الخصم" : "قيمة الخصم بالريال اليمني"} inputMode="numeric" type="number" min="1" disabled={formLocked} value={promotionForm.valueMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, valueMinor: event.target.value }))} />
          {promotionForm.kind === "PERCENTAGE" ? <input aria-label="الحد الأعلى للخصم بالريال اليمني" inputMode="numeric" type="number" min="1" placeholder="اختياري بالريال اليمني" disabled={formLocked} value={promotionForm.maxDiscountMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, maxDiscountMinor: event.target.value }))} /> : null}
          <label className="field-label" htmlFor="promotion-funding-source">مصدر التمويل<select id="promotion-funding-source" disabled={formLocked} value={promotionForm.fundingSource} onChange={(event) => setPromotionForm((current) => ({ ...current, fundingSource: event.target.value as CreatePromotionRequest["fundingSource"] }))}><option value="BTHWANI">بثواني</option><option value="SHARED">مشترك</option><option value="PARTNER">الشريك</option></select></label>
          {promotionForm.fundingSource === "SHARED" ? <input aria-label="حصة الشريك من التمويل" inputMode="numeric" type="number" min="1" max="99" disabled={formLocked} value={promotionForm.fundingSharePartnerPercent} onChange={(event) => setPromotionForm((current) => ({ ...current, fundingSharePartnerPercent: event.target.value }))} /> : null}
          <input aria-label="حد الطلب الأدنى" inputMode="numeric" type="number" min="1" placeholder="اختياري بالريال اليمني" disabled={formLocked} value={promotionForm.minOrderSubtotalMinor} onChange={(event) => setPromotionForm((current) => ({ ...current, minOrderSubtotalMinor: event.target.value }))} />
          <input aria-label="حد الاستخدام" inputMode="numeric" type="number" min="1" placeholder="اختياري" disabled={formLocked} value={promotionForm.redemptionLimit} onChange={(event) => setPromotionForm((current) => ({ ...current, redemptionLimit: event.target.value }))} />
          <label className="field-label" htmlFor="promotion-city">مدينة الخدمة<select id="promotion-city" disabled={formLocked} value={promotionForm.serviceCityId} onChange={(event) => { setStoreSearch(""); setStoreOptions([]); setPromotionForm((current) => ({ ...current, serviceCityId: event.target.value, storeId: "" })); }}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>

          <input aria-label="بحث متجر الحملة" maxLength={128} placeholder={promotionForm.serviceCityId ? "ابحث باسم المتجر لتقييد العرض (اختياري)" : "اختر مدينة للبحث عن متجر"} disabled={formLocked || !promotionForm.serviceCityId} value={storeSearch} onChange={(event) => { setStoreSearch(event.target.value); setPromotionForm((current) => ({ ...current, storeId: "", requiresPartnerOptIn: current.requiresPartnerOptIn })); }} />
          <label className="field-label" htmlFor="promotion-store">نطاق المتجر<select id="promotion-store" disabled={formLocked || storeLookupLoading || storeOptions.length === 0} value={promotionForm.storeId} onChange={(event) => setPromotionForm((current) => ({ ...current, storeId: event.target.value, requiresPartnerOptIn: event.target.value ? false : current.requiresPartnerOptIn }))}><option value="">حملة منصة / كل المتاجر المؤهلة</option>{storeOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
          {storeLookupMessage ? <p className="muted" role="status">{storeLookupMessage}</p> : null}
          {selectedStoreLabel ? <p className="muted">المتجر المختار: {selectedStoreLabel}</p> : null}

          <label className="field-label" htmlFor="promotion-target-kind">استهداف العرض<select id="promotion-target-kind" disabled={formLocked} value={promotionForm.targetKind} onChange={(event) => { const targetKind = event.target.value as PromotionTargetKind; setTargetSearch(""); setTargetOptions([]); setTargetVerticalId(""); setPromotionForm((current) => ({ ...current, targetKind, targetId: "" })); }}><option value="NONE">كل النطاق</option><option value="PRODUCT">منتج</option><option value="CATEGORY">فئة</option></select></label>
          {promotionForm.targetKind === "CATEGORY" ? <label className="field-label" htmlFor="promotion-target-vertical">المجال التجاري<select id="promotion-target-vertical" disabled={formLocked} value={targetVerticalId} onChange={(event) => { setTargetVerticalId(event.target.value); setTargetSearch(""); setTargetOptions([]); setPromotionForm((current) => ({ ...current, targetId: "" })); }}><option value="">اختر المجال</option>{targetVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label> : null}
          {promotionForm.targetKind !== "NONE" ? <>
            <input aria-label="بحث هدف العرض" maxLength={128} placeholder={promotionForm.targetKind === "PRODUCT" ? "ابحث باسم المنتج" : "ابحث باسم الفئة"} disabled={formLocked || (promotionForm.targetKind === "CATEGORY" && !targetVerticalId)} value={targetSearch} onChange={(event) => { setTargetSearch(event.target.value); setPromotionForm((current) => ({ ...current, targetId: "" })); }} />
            <label className="field-label" htmlFor="promotion-target">الهدف المعتمد<select id="promotion-target" disabled={formLocked || targetLoading || targetOptions.length === 0} value={promotionForm.targetId} onChange={(event) => setPromotionForm((current) => ({ ...current, targetId: event.target.value }))}><option value="">اختر من بيانات DSH</option>{targetOptions.map((option) => <option key={option.id} value={option.id}>{option.detail ? option.label + " · " + option.detail : option.label}</option>)}</select></label>
            {targetMessage ? <p className="muted" role="status">{targetMessage}</p> : null}
            {selectedTargetLabel ? <p className="muted">الهدف المختار: {selectedTargetLabel}</p> : null}
          </> : null}

          <label className="field-label"><input type="checkbox" disabled={formLocked || Boolean(promotionForm.storeId)} checked={!promotionForm.storeId && promotionForm.requiresPartnerOptIn} onChange={(event) => setPromotionForm((current) => ({ ...current, requiresPartnerOptIn: event.target.checked }))} /> تتطلب الحملة موافقة الشريك قبل المشاركة</label>
          <input aria-label="بداية العرض" type="datetime-local" disabled={formLocked} value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
          <input aria-label="نهاية العرض" type="datetime-local" disabled={formLocked} value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
          <button className="button" type="button" disabled={busy || attemptChecking || !attemptReady} onClick={() => void createPromotion()}>{pendingCreate ? "التحقق / إعادة محاولة الإنشاء" : "إنشاء مسودة العرض"}</button>
        </div>
      </details>

      <section className="access-card" aria-labelledby="marketing-promotions-title">
        <div className="access-card-heading"><h2 id="marketing-promotions-title">سجل العروض</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim().slice(0, 128)); setCursor(""); setCursorStack([]); }}>
          <label className="field-label" htmlFor="promotion-search">رمز العرض أو الاسم<input id="promotion-search" type="search" maxLength={128} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field-label" htmlFor="promotion-state">الحالة<select id="promotion-state" value={state} onChange={(event) => { setState(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="PUBLISHED">منشور</option><option value="PAUSED">موقوف</option><option value="ENDED">منتهٍ</option></select></label>
          <label className="field-label" htmlFor="promotion-sort">ترتيب البداية<select id="promotion-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setCursor(""); setCursorStack([]); }}><option value="starts_desc">الأحدث بداية</option><option value="starts_asc">الأقدم بداية</option></select></label>
          <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
          <button className="button button-quiet" type="button" onClick={() => void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل العروض."))} disabled={loading}>{loading ? "جارٍ القراءة…" : "تحديث"}</button>
        </form>
        {registry?.promotions.length ? <div className="finance-table-wrap"><table className="finance-table"><caption className="visually-hidden">سجل العروض</caption><thead><tr><th scope="col">العرض</th><th scope="col">الرمز</th><th scope="col">القيمة</th><th scope="col">التمويل والنطاق</th><th scope="col">الحالة</th><th scope="col">البداية</th><th scope="col">الإجراء</th></tr></thead><tbody>{registry.promotions.map((item) => <tr key={item.id}><th scope="row">{item.nameAr}</th><td><bdi dir="ltr">{item.code}</bdi></td><td>{item.kind === "PERCENTAGE" ? item.valueMinor + "%" : formatMoney(item.valueMinor, "YER")}</td><td>{item.fundingSource === "SHARED" ? "مشترك · حصة الشريك " + (item.fundingSharePartnerPercent ?? 0) + "%" : item.fundingSource === "BTHWANI" ? "بثواني" : "الشريك"}<br />{item.storeId ? "متجر محدد" : item.serviceCityId ? "حملة مدينة" : "حملة منصة"}{item.requiresPartnerOptIn ? " · تتطلب موافقة" : ""}<br />{promotionTargetSummary(item)}{item.minOrderSubtotalMinor ? <><br />حد الطلب {formatMoney(item.minOrderSubtotalMinor, "YER")}</> : null}</td><td>{promotionStateLabel(item.state)}</td><td><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td>{item.state === "ENDED" ? <span className="muted">لا إجراء</span> : <button className="button button-quiet" type="button" disabled={busy} onClick={() => void publishPromotion(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف العرض" : "نشر العرض"}</button>}</td></tr>)}</tbody></table></div> : null}
        {!registry?.promotions.length && loading ? <p role="status" className="collection-state">جارٍ قراءة صفحة العروض…</p> : null}
        {!registry?.promotions.length && !loading ? <p className="collection-state">لا توجد عروض مطابقة.</p> : null}
        <nav className={styles.pagination} aria-label="صفحات سجل العروض"><button className="button button-quiet" type="button" disabled={loading || cursorStack.length === 0} onClick={() => { const next = [...cursorStack]; const previous = next.pop() ?? ""; setCursorStack(next); setCursor(previous); }}>السابق</button><span>صفحة {cursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={loading || !registry?.nextCursor} onClick={() => { setCursorStack((items) => [...items, cursor]); setCursor(registry?.nextCursor ?? ""); }}>التالي</button></nav>
      </section>
    </div>
  );
}

export function MarketingContentWorkspace() {
  const { state: sessionState } = useSession();
  const operatorActorId = sessionState.kind === "authenticated" && sessionState.identity.role === "operator" ? sessionState.identity.subject : "";
  const pendingStorageKey = operatorActorId ? "bthwani.control.marketing.content-create.v1." + encodeURIComponent(operatorActorId) : "";
  const [registry, setRegistry] = useState<OperatorDiscoveryContentRegistryResponse | null>(null);
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
  const [categoryVerticals, setCategoryVerticals] = useState<ReadonlyArray<CommerceVertical>>([]);
  const [categoryVerticalId, setCategoryVerticalId] = useState("");
  const [targetCursor, setTargetCursor] = useState("");
  const [targetCursorStack, setTargetCursorStack] = useState<ReadonlyArray<string>>([]);
  const [targetNextCursor, setTargetNextCursor] = useState("");
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetMessage, setTargetMessage] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaProvenance, setMediaProvenance] = useState<MediaProvenanceInput>(emptyMediaProvenance());
  const attemptReady = Boolean(pendingStorageKey) && loadedStorageKey === pendingStorageKey && !storageError;
  const load = useCallback(async (query: { search?: string; state?: string; kind?: string; sort?: "priority" | "created_desc"; cursor?: string } = {}) => {
    setLoading(true);
    const params = new URLSearchParams({ limit: "25", sort: query.sort ?? sort });
    if (query.search ?? appliedSearch) params.set("search", query.search ?? appliedSearch);
    if (query.state ?? state) params.set("state", query.state ?? state);
    if (query.kind ?? kind) params.set("kind", query.kind ?? kind);
    if (query.cursor ?? cursor) params.set("cursor", query.cursor ?? cursor);
    try {
      const response = await fetch(`/api/marketing/content?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as OperatorDiscoveryContentRegistryResponse | { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر قراءة سجل محتوى الاكتشاف." : "تعذر قراءة سجل محتوى الاكتشاف.");
      setRegistry(body as OperatorDiscoveryContentRegistryResponse);
    } finally {
      setLoading(false);
    }
  }, [appliedSearch, cursor, kind, sort, state]);

  async function readAnalytics(contentId: string) {
    setAnalyticsContentId(contentId);
    setAnalytics(null);
    setAnalyticsLoading(true);
    try {
      const response = await fetch(`/api/marketing/analytics?contentId=${encodeURIComponent(contentId)}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as { items?: ReadonlyArray<DiscoveryContentAnalytics>; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? "تعذر قراءة تحليلات المحتوى المحدد.");
      setAnalytics(body?.items ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر قراءة تحليلات المحتوى المحدد.");
    } finally {
      setAnalyticsLoading(false);
    }
  }

  useEffect(() => { void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف.")); }, [load]);
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
        if (!response.ok) throw new Error(body?.error?.message ?? "تعذر تحميل الوجهات.");
        setTargetOptions((current) => targetCursor ? [...current.filter((item) => !(body?.options ?? []).some((next) => next.id === item.id)), ...(body?.options ?? [])] : body?.options ?? []);
        setTargetNextCursor(body?.nextCursor ?? "");
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
    setMessage("استعدت محاولة إنشاء المحتوى؛ أتحقق من سجل DSH قبل إعادة الإرسال.");
    void readDiscoveryContentById(restored.input.id)
      .then((item) => {
        if (!active) return;
        if (item) {
          clearPendingMarketingCreate(pendingStorageKey);
          setPendingCreate(null);
          setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
          setMediaProvenance(emptyMediaProvenance());
          setSearch(""); setAppliedSearch(""); setState("DRAFT"); setKind(""); setSort("priority"); setCursor(""); setCursorStack([]);
          setMessage("تمت قراءة المحتوى المنشأ من سجل DSH؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
        } else {
          setMessage("لم يظهر المحتوى في السجل بعد. أعد اختيار الصورة نفسها للتحقق ببصمتها ثم أعد المحاولة بالمفتاح المحفوظ.");
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
      if (!attemptReady) throw new Error(storageError || "جارٍ استعادة محاولة سابقة؛ انتظر التحقق من سجل DSH.");
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
          setMessage("تمت قراءة المحتوى المنشأ من سجل DSH؛ استعيدت نتيجته دون إنشاء نسخة أخرى.");
          return;
        }
        if (!mediaFile) throw new Error("لم يظهر المحتوى في السجل. أعد اختيار الصورة الأصلية أولًا لمطابقة بصمتها قبل إعادة المحاولة.");
        if (mediaFile.size !== attempt.input.media.size || mediaFile.type.toLowerCase() !== attempt.input.media.type) throw new Error("الصورة المختارة لا تطابق المحاولة المحفوظة. اختر الملف الأصلي نفسه دون تغيير بقية البيانات.");
        if (await sha256File(mediaFile) !== attempt.input.media.sha256) throw new Error("بصمة الصورة لا تطابق المحاولة المحفوظة. لم يُرسل طلب جديد؛ اختر الصورة الأصلية.");
      } else {
        const starts = new Date(contentStartsAt);
        const ends = contentEndsAt ? new Date(contentEndsAt) : null;
        if (!contentForm.titleAr.trim() || Number.isNaN(starts.getTime()) || !Number.isSafeInteger(Number(contentForm.ordinal)) || Number(contentForm.ordinal) < 0) throw new Error("أكمل عنوان المحتوى وتاريخه وترتيبه.");
        if (!mediaFile) throw new Error("اختر صورة JPEG أو PNG للمحتوى.");
        if (!isMediaProvenanceInputValid(mediaProvenance)) throw new Error("أكمل بيانات مصدر الصورة وبيان الحقوق وأكّد الإذن.");
        if (mediaFile.size > 10 * 1024 * 1024) throw new Error("حجم الصورة يجب ألا يتجاوز 10 ميجابايت.");
        if (!["image/jpeg", "image/png"].includes(mediaFile.type.toLowerCase())) throw new Error("الصورة يجب أن تكون JPEG أو PNG.");
        if (contentForm.targetType !== "INFO" && !targetOptions.some((option) => option.id === contentForm.targetId)) throw new Error("اختر وجهة من نتائج DSH الحالية قبل إنشاء المحتوى.");
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
        if (!persistMarketingCreate(pendingStorageKey, attempt)) throw new Error("تعذر حفظ مفتاح المحاولة؛ لم يُرسل طلب الإنشاء. أعد المحاولة بعد تفعيل تخزين الجلسة.");
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
      if (!created) throw new Error("تعذر تأكيد المحتوى من سجل DSH. بقيت المحاولة محفوظة لإعادة التحقق بالمفتاح نفسه.");
      clearPendingMarketingCreate(pendingStorageKey);
      setPendingCreate(null);
      setContentForm({ titleAr: "", bodyAr: "", kind: "BANNER", targetType: "INFO", targetId: "", serviceCityId: "", ordinal: "0" });
      setTargetSearch("");
      setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor("");
      setMediaFile(null);
      setMediaProvenance(emptyMediaProvenance());
      setSearch(""); setAppliedSearch(""); setState("DRAFT"); setKind(""); setSort("priority"); setCursor(""); setCursorStack([]);
      await load({ search: "", state: "DRAFT", kind: "", sort: "priority", cursor: "" });
      setMessage("تم إنشاء المحتوى وقراءته كمسودة من سجل DSH. انشره من السجل عندما يصبح جاهزًا.");
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
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "تعذر تحديث نشر المحتوى.");
    } finally {
      setBusy(false);
    }
  }

  let pendingCreateStatusMessage = "استعيدت المحاولة دون الملف؛ تحقّق من السجل أولًا ثم اختر الصورة الأصلية لمطابقة بصمتها وإعادة المحاولة.";
  if (attemptChecking) {
    pendingCreateStatusMessage = "جارٍ التحقق من نتيجة المحاولة المحفوظة في DSH…";
  } else if (mediaFile) {
    pendingCreateStatusMessage = "المحاولة لم تُحسم بعد. البيانات مقفلة وستعاد الصورة والطلب بالمفتاح نفسيهما.";
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
    } else if (analytics) {
      analyticsContent = <dl><div><dt>الظهور</dt><dd>{analytics.find((item) => item.eventType === "IMPRESSION")?.count ?? 0}</dd></div><div><dt>النقر</dt><dd>{analytics.find((item) => item.eventType === "CLICK")?.count ?? 0}</dd></div><div><dt>التحويل</dt><dd>{analytics.find((item) => item.eventType === "CONVERSION")?.count ?? 0}</dd></div></dl>;
    }
    analyticsPanel = <aside className={styles.analyticsPanel} aria-live="polite"><strong>تحليلات المحتوى <bdi dir="ltr">{analyticsContentId}</bdi></strong>{analyticsContent}<button className="button button-quiet" type="button" onClick={() => { setAnalyticsContentId(""); setAnalytics(null); }}>إغلاق التحليلات</button></aside>;
  }

  return (
    <div className={styles.workspace} data-testid="marketing-content-workspace">
      {storageError ? <p className="managed-status managed-status-warning" role="alert">{storageError}</p> : null}
      {pendingCreate ? <p className="managed-status managed-status-warning" role="status">{pendingCreateStatusMessage}</p> : null}
      <details className="access-card" open={Boolean(pendingCreate)}>
        <summary className={styles.createSummary}>إنشاء محتوى اكتشاف</summary>
        <div className="access-card-heading"><span className="step-chip">الاكتشاف</span><p className="eyebrow">محتوى منشور</p><h2>إنشاء بطاقة اكتشاف</h2><p className="muted">المحتوى العام لا يظهر إلا بعد نشره ومن خلال مسار DSH القانوني.</p></div>
        <div className="workspace-form-grid">
          <input aria-label="عنوان المحتوى" placeholder="مختارات الأسبوع" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.titleAr} onChange={(event) => setContentForm((current) => ({ ...current, titleAr: event.target.value }))} />
          <input aria-label="نص المحتوى" placeholder="اكتشف الجديد في مدينتك" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.bodyAr} onChange={(event) => setContentForm((current) => ({ ...current, bodyAr: event.target.value }))} />
          <label className="field-label" htmlFor="marketing-content-kind">نوع المحتوى<select id="marketing-content-kind" aria-label="نوع المحتوى" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.kind} onChange={(event) => setContentForm((current) => ({ ...current, kind: event.target.value as typeof current.kind }))}><option value="BANNER">بنر رئيسي</option><option value="CAROUSEL">شريحة كاروسيل</option><option value="SHORT_FORM">قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="marketing-content-media">صورة المحتوى<input id="marketing-content-media" aria-label="ملف صورة المحتوى" type="file" accept="image/jpeg,image/png" required disabled={busy || !attemptReady || Boolean(pendingCreate && mediaFile)} onChange={(event) => { setMediaFile(event.target.files?.[0] ?? null); if (!pendingCreate) setMediaProvenance(emptyMediaProvenance()); }} /></label><CatalogMediaProvenanceFields idPrefix="marketing-content-media" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={mediaProvenance} onChange={setMediaProvenance} />
          {mediaFile ? <p className="muted" data-testid="marketing-content-file">{mediaFile.name} · {(mediaFile.size / 1024).toFixed(0)} كيلوبايت</p> : <p className="muted">JPEG أو PNG، حتى 10 ميجابايت.</p>}
          <label className="field-label" htmlFor="marketing-content-target">نوع الوجهة<select id="marketing-content-target" aria-label="نوع وجهة المحتوى" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.targetType} onChange={(event) => { setTargetSearch(""); setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setCategoryVerticalId(""); setContentForm((current) => ({ ...current, targetType: event.target.value as typeof current.targetType, targetId: "" })); }}><option value="INFO">معلومات فقط</option><option value="STORE">متجر</option><option value="PRODUCT">منتج</option><option value="CATEGORY">فئة</option><option value="PROMOTION">عرض</option></select></label>
          {contentForm.targetType !== "INFO" ? <>
            {contentForm.targetType === "CATEGORY" ? <label className="field-label" htmlFor="marketing-content-category-vertical">المجال التجاري<select id="marketing-content-category-vertical" aria-label="المجال التجاري للفئة" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={categoryVerticalId} onChange={(event) => { setCategoryVerticalId(event.target.value); setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, targetId: "" })); }}><option value="">اختر المجال التجاري</option>{categoryVerticals.map((vertical) => <option key={vertical.id} value={vertical.id}>{vertical.nameAr}</option>)}</select></label> : null}
            <input aria-label="بحث في الوجهات" maxLength={128} placeholder={targetSearchPlaceholder} disabled={busy || Boolean(pendingCreate) || !attemptReady} value={targetSearch} onChange={(event) => { setTargetSearch(event.target.value); setTargetCursor(""); setTargetCursorStack([]); setTargetOptions([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, targetId: "" })); }} />
            <label className="field-label" htmlFor="marketing-content-target-option">الوجهة المعتمدة<select id="marketing-content-target-option" aria-label="الوجهة المعتمدة" value={contentForm.targetId} disabled={busy || Boolean(pendingCreate) || !attemptReady || targetLoading || targetOptions.length === 0} onChange={(event) => setContentForm((current) => ({ ...current, targetId: event.target.value }))}>
              <option value="">{targetLoading ? "جارٍ تحميل الوجهات…" : "اختر وجهة من بيانات DSH"}</option>
              {targetOptions.map((option) => <option key={option.id} value={option.id}>{option.detail ? `${option.label} · ${option.detail}` : option.label}</option>)}
            </select></label>
            {!["CATEGORY", "INFO"].includes(contentForm.targetType) ? <nav className={styles.pagination} aria-label="صفحات وجهات المحتوى"><button className="button button-quiet" type="button" disabled={targetLoading || targetCursorStack.length === 0} onClick={() => { const next = [...targetCursorStack]; setTargetCursor(next.pop() ?? ""); setTargetCursorStack(next); }}>السابق</button><span>{targetCursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={targetLoading || !targetNextCursor} onClick={() => { setTargetCursorStack((items) => [...items, targetCursor]); setTargetCursor(targetNextCursor); }}>تحميل المزيد</button></nav> : null}
            {contentForm.targetType === "CATEGORY" ? <nav className={styles.pagination} aria-label="صفحات فئات المحتوى"><button className="button button-quiet" type="button" disabled={targetLoading || targetCursorStack.length === 0} onClick={() => { const next = [...targetCursorStack]; setTargetCursor(next.pop() ?? ""); setTargetCursorStack(next); }}>السابق</button><span>{targetCursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={targetLoading || !targetNextCursor} onClick={() => { setTargetCursorStack((items) => [...items, targetCursor]); setTargetCursor(targetNextCursor); }}>تحميل المزيد</button></nav> : null}
            {targetMessage ? <p className="muted" role="status">{targetMessage}</p> : null}
            <p className="muted">تُختار الوجهة من السجلات المعتمدة، ويعيد DSH التحقق من صلاحيتها حسب المدينة ووقت العرض.</p>
          </> : null}
          <label className="field-label" htmlFor="marketing-content-city">مدينة الخدمة<select id="marketing-content-city" aria-label="مدينة خدمة المحتوى" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.serviceCityId} onChange={(event) => { setTargetOptions([]); setTargetCursor(""); setTargetCursorStack([]); setTargetNextCursor(""); setContentForm((current) => ({ ...current, serviceCityId: event.target.value, targetId: "" })); }}><option value="">كل المدن</option>{cities.map((city) => <option key={city.id} value={city.id}>{city.displayNameAr}</option>)}</select></label>
          <input aria-label="بداية المحتوى" type="datetime-local" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentStartsAt} onChange={(event) => setContentStartsAt(event.target.value)} />
          <input aria-label="نهاية المحتوى" type="datetime-local" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentEndsAt} onChange={(event) => setContentEndsAt(event.target.value)} />
          <input aria-label="ترتيب المحتوى" inputMode="numeric" type="number" min="0" disabled={busy || Boolean(pendingCreate) || !attemptReady} value={contentForm.ordinal} onChange={(event) => setContentForm((current) => ({ ...current, ordinal: event.target.value }))} />
          <button className="button" type="button" disabled={busy || attemptChecking || !attemptReady} onClick={() => void createContent()}>{pendingCreate ? "التحقق / إعادة محاولة الإنشاء" : "إنشاء مسودة المحتوى"}</button>
        </div>
      </details>
      <section className="access-card" aria-labelledby="marketing-content-title">
        <div className="access-card-heading"><h2 id="marketing-content-title">سجل محتوى الاكتشاف</h2>{message ? <p role="status" className="muted">{message}</p> : null}</div>
        <form className={styles.filters} onSubmit={(event) => { event.preventDefault(); setAppliedSearch(search.trim().slice(0, 128)); setCursor(""); setCursorStack([]); }}>
          <label className="field-label" htmlFor="content-search">عنوان المحتوى<input id="content-search" aria-label="البحث في سجل المحتوى" type="search" maxLength={128} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <label className="field-label" htmlFor="content-state">الحالة<select id="content-state" value={state} onChange={(event) => { setState(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الحالات</option><option value="DRAFT">مسودة</option><option value="PUBLISHED">منشور</option><option value="PAUSED">موقوف</option></select></label>
          <label className="field-label" htmlFor="content-kind-filter">النوع<select id="content-kind-filter" value={kind} onChange={(event) => { setKind(event.target.value); setCursor(""); setCursorStack([]); }}><option value="">كل الأنواع</option><option value="BANNER">بنر</option><option value="CAROUSEL">كاروسيل</option><option value="SHORT_FORM">قصة قصيرة</option></select></label>
          <label className="field-label" htmlFor="content-sort">الترتيب<select id="content-sort" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); setCursor(""); setCursorStack([]); }}><option value="priority">أولوية العرض</option><option value="created_desc">الأحدث إنشاءً</option></select></label>
          <button className="button button-secondary" type="submit" disabled={loading}>بحث</button>
          <button className="button button-quiet" type="button" onClick={() => void load().catch((error) => setMessage(error instanceof Error ? error.message : "تعذر قراءة سجل محتوى الاكتشاف."))} disabled={loading}>{loading ? "جارٍ القراءة…" : "تحديث"}</button>
        </form>
        {registry?.items.length ? <div className="finance-table-wrap"><table className="finance-table"><caption className="visually-hidden">سجل محتوى الاكتشاف</caption><thead><tr><th scope="col">المحتوى</th><th scope="col">النوع والوجهة</th><th scope="col">الحالة</th><th scope="col">الأولوية والبداية</th><th scope="col">الإجراءات</th></tr></thead><tbody>{registry.items.map((item) => <tr key={item.id}><th scope="row">{item.mediaUri ? <img className={styles.mediaPreview} src={item.mediaUri} alt="" loading="lazy" /> : null}{item.titleAr}<br /><bdi dir="ltr">{item.id}</bdi></th><td>{item.kind} · {item.targetType}<br />{item.targetId ? <bdi dir="ltr">{item.targetId}</bdi> : "معلومات عامة"}</td><td>{discoveryContentStateLabel(item.state)}</td><td>{item.ordinal}<br /><time dateTime={item.startsAt}>{new Date(item.startsAt).toLocaleString("ar-YE", { dateStyle: "medium", timeStyle: "short" })}</time></td><td><div className={styles.actions}><button className="button button-quiet" type="button" disabled={analyticsLoading} onClick={() => void readAnalytics(item.id)}>{analyticsLoading && analyticsContentId === item.id ? "جارٍ قراءة التحليلات…" : "قراءة التحليلات"}</button><button className="button button-quiet" type="button" disabled={busy} onClick={() => void publishContent(item, item.state === "PUBLISHED" ? "PAUSED" : "PUBLISHED")}>{item.state === "PUBLISHED" ? "إيقاف المحتوى" : "نشر المحتوى"}</button></div></td></tr>)}</tbody></table></div> : null}
        {!registry?.items.length && loading ? <p role="status" className="collection-state">جارٍ قراءة صفحة المحتوى…</p> : null}
        {!registry?.items.length && !loading ? <p className="collection-state">لا يوجد محتوى مطابق.</p> : null}
        <nav className={styles.pagination} aria-label="صفحات سجل محتوى الاكتشاف"><button className="button button-quiet" type="button" disabled={loading || cursorStack.length === 0} onClick={() => { const next = [...cursorStack]; const previous = next.pop() ?? ""; setCursorStack(next); setCursor(previous); }}>السابق</button><span>صفحة {cursorStack.length + 1}</span><button className="button button-quiet" type="button" disabled={loading || !registry?.nextCursor} onClick={() => { setCursorStack((items) => [...items, cursor]); setCursor(registry?.nextCursor ?? ""); }}>التالي</button></nav>
        {analyticsPanel}
      </section>
    </div>
  );
}
