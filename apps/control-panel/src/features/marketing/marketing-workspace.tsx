"use client";

import { type CreatePromotionRequest, type DiscoveryContentView, isMediaProvenanceInputValid, type MediaProvenanceInput, type OperatorDiscoveryContentRegistryResponse, type OperatorPromotionRegistryResponse, type PromotionView, type ServiceCity } from "@bthwani/dsh";
import { type ReactNode } from "react";
import { type MarketingResourceKey, workspaceMarketingResources } from "../../navigation/workspace-registry";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";

export type ApiError = { error?: { message?: string } };

export function promotionTargetSummary(item: PromotionView): string {
  const targets = item.targets ?? [];
  if (targets.length === 0) return "كل النطاق";
  return targets.map((target) => {
    const kind = target.targetKind === "PRODUCT" ? "منتج" : "فئة";
    return `${kind}: ${target.targetLabelAr?.trim() || "هدف كتالوج"}`;
  }).join("، ");
}

export function apiMessage(value: unknown): string {
  return value && typeof value === "object" && "error" in value && (value as ApiError).error?.message ? String((value as ApiError).error?.message) : "تعذر تنفيذ العملية.";
}

export function futureDateInput(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function futureEndDateInput(): string {
  return new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function emptyMediaProvenance(): MediaProvenanceInput {
  return { creator: "", sourceDescription: "", rightsStatement: "", rightsAttested: false };
}

export type PendingPromotionCreate = Readonly<{
  id: string;
  idempotencyKey: string;
  correlationId: string;
  body: string;
}>;

export type PromotionTargetKind = "NONE" | "PRODUCT" | "CATEGORY";
export type MarketingTargetOption = Readonly<{ id: string; label: string; detail?: string }>;
export type PromotionFormState = Readonly<{
  code: string;
  nameAr: string;
  descriptionAr: string;
  kind: "PERCENTAGE" | "FIXED";
  valueMinor: string;
  maxDiscountMinor: string;
  redemptionLimit: string;
  discountBudgetLimitMinor: string;
  minOrderSubtotalMinor: string;
  fundingSource: CreatePromotionRequest["fundingSource"];
  fundingSharePartnerPercent: string;
  requiresPartnerOptIn: boolean;
  storeId: string;
  serviceCityId: string;
  targetKind: PromotionTargetKind;
  targetId: string;
}>;

export function emptyPromotionForm(): PromotionFormState {
  return {
    code: "",
    nameAr: "",
    descriptionAr: "",
    kind: "PERCENTAGE",
    valueMinor: "10",
    maxDiscountMinor: "",
    redemptionLimit: "",
    discountBudgetLimitMinor: "",
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

export type PendingDiscoveryContentCreateInput = Readonly<{
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

export type PendingDiscoveryContentCreate = Readonly<{
  idempotencyKey: string;
  correlationId: string;
  input: PendingDiscoveryContentCreateInput;
}>;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPendingPromotionCreate(raw: string | null): PendingPromotionCreate | null {
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

export function readPendingDiscoveryContentCreate(raw: string | null): PendingDiscoveryContentCreate | null {
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

export function clearPendingMarketingCreate(storageKey: string): void {
  try {
    window.sessionStorage.removeItem(storageKey);
  } catch {
    // A retained key can only replay the same immutable request.
  }
}

export function persistMarketingCreate(storageKey: string, value: PendingPromotionCreate | PendingDiscoveryContentCreate): boolean {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function dateTimeLocalValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export async function readPromotionById(id: string): Promise<PromotionView | null> {
  const params = new URLSearchParams({ search: id, sort: "starts_desc", limit: "100" });
  const response = await fetch("/api/marketing/promotions?" + params, { cache: "no-store" });
  const body = await response.json().catch(() => null) as OperatorPromotionRegistryResponse | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر التحقق من نتيجة إنشاء العرض." : "تعذر التحقق من نتيجة إنشاء العرض.");
  if (!body || !("promotions" in body) || !Array.isArray(body.promotions)) throw new Error("تعذر التحقق من القراءة المعتمدة للعرض.");
  return body.promotions.find((promotion) => promotion.id === id) ?? null;
}

export async function readDiscoveryContentById(id: string): Promise<DiscoveryContentView | null> {
  const params = new URLSearchParams({ search: id, sort: "created_desc", limit: "100" });
  const response = await fetch("/api/marketing/content?" + params, { cache: "no-store" });
  const body = await response.json().catch(() => null) as OperatorDiscoveryContentRegistryResponse | { error?: { message?: string } } | null;
  if (!response.ok) throw new Error(body && "error" in body ? body.error?.message ?? "تعذر التحقق من نتيجة إنشاء المحتوى." : "تعذر التحقق من نتيجة إنشاء المحتوى.");
  if (!body || !("items" in body) || !Array.isArray(body.items)) throw new Error("تعذر التحقق من القراءة المعتمدة للمحتوى.");
  return body.items.find((item) => item.id === id) ?? null;
}

export async function readActiveServiceCities(): Promise<ReadonlyArray<ServiceCity>> {
  const response = await fetch("/api/service-cities", { cache: "no-store" });
  if (!response.ok) throw new Error("SERVICE_CITIES_READ_FAILED");
  const body = await response.json() as { cities?: ReadonlyArray<ServiceCity> };
  return (body.cities ?? []).filter((city) => city.active);
}


function accessDenied() {
  return (
    <section className="state-content workspace-restricted">
      <div className="state-card" role="alert">
        <p className="eyebrow">صلاحية غير متاحة</p>
        <h1>التسويق للمشغلين فقط</h1>
        <p className="muted">لا تمنح هذه الصفحة صلاحيات إضافية خارج الحسابات.</p>
      </div>
    </section>
  );
}

export function MarketingWorkspace({ resource, children }: { resource: MarketingResourceKey; children: ReactNode }) {
  const { state } = useSession();

  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator") return accessDenied();

  const selected = workspaceMarketingResources.find((item) => item.key === resource) ?? workspaceMarketingResources[0]!;
  return (
    <section className="workspace-page" aria-labelledby="marketing-page-title">
      <PageHeader id="marketing-page-title" title={selected.label} />
      {children}
    </section>
  );
}
