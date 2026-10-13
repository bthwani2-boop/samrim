import { fulfillmentModeLabel, type FulfillmentMode, type PublicationState, publicationStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import { RecordIndicator } from "../shared/record-indicator";

export function AccountIndicator({ role }: Readonly<{ role: ActorRoleView | null }>) {
  const state = !role ? "unknown" : !role.enabled || !role.securityEnabled ? "paused" : !role.activatedAt ? "pending" : "active";
  const label = { unknown: "حالة الحساب غير متاحة", paused: "الحساب موقوف", pending: "الحساب بانتظار التفعيل", active: "الحساب نشط" }[state];
  return <RecordIndicator icon={state} label={label} tone={state === "active" ? "success" : state === "paused" || state === "pending" ? "warning" : "neutral"} />;
}

export function PublicationIndicator({ state }: Readonly<{ state: PublicationState }>) {
  return <RecordIndicator icon={state} label={`النشر: ${publicationStateLabel(state)}`} tone={state === "published" ? "success" : "neutral"} />;
}

const modeIcons = { BTHWANI_CAPTAIN: "rider", PARTNER_CAPTAIN: "storeDelivery", CUSTOMER_PICKUP: "pickup" } as const;
export function FulfillmentIndicators({ modes }: Readonly<{ modes: ReadonlyArray<FulfillmentMode> }>) {
  return <span className="fulfillment-indicators">{modes.length ? modes.map((mode) => <RecordIndicator key={mode} icon={modeIcons[mode]} label={fulfillmentModeLabel(mode)} />) : <RecordIndicator icon="unknown" label="أوضاع التوصيل غير محددة" />}</span>;
}

export function StoreIndicatorLegend() {
  return <aside className="record-legend" aria-label="دليل رموز الحساب والنشر والتوصيل">
    <div><strong>الحساب</strong><RecordIndicator legend icon="active" label="نشط" tone="success" /><RecordIndicator legend icon="pending" label="بانتظار التفعيل" tone="warning" /><RecordIndicator legend icon="paused" label="موقوف" tone="warning" /><RecordIndicator legend icon="unknown" label="غير متاح" /></div>
    <div><strong>النشر</strong><RecordIndicator legend icon="published" label="منشور" tone="success" /><RecordIndicator legend icon="unpublished" label="غير منشور" /><RecordIndicator legend icon="hidden" label="مخفي" /></div>
    <div><strong>التوصيل</strong><RecordIndicator legend icon="rider" label="بثواني" /><RecordIndicator legend icon="storeDelivery" label="المتجر" /><RecordIndicator legend icon="pickup" label="استلام ذاتي" /></div>
  </aside>;
}
