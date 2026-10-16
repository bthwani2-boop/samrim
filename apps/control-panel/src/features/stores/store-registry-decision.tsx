"use client";

import { type JoiningCaseSummary, joiningCaseStateLabel, type OperatorStoreSummary, type StoreAccessGrant } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";

export function StoreOperationalDecision({ store, role, onInspect }: Readonly<{ store: OperatorStoreSummary; role: ActorRoleView | null; onInspect: () => void }>) {
  const paused = role && (!role.enabled || !role.securityEnabled);
  const pending = role && !role.activatedAt && !paused;
  const attentionReason = !role ? "حالة الحساب غير متاحة" : paused ? "حساب الشريك موقوف" : pending ? "الحساب يحتاج تفعيلًا" : null;
  const next = paused ? "مراجعة حساب الشريك" : pending ? "متابعة تفعيل الشريك" :
    store.publicationState === "published" ? "إدارة المتجر" :
    store.publicationState === "hidden" ? "مراجعة الإخفاء" : "فحص جاهزية النشر";
  return <div className="partner-decision">
    {attentionReason ? <small>{attentionReason}</small> : null}
    <button type="button" className="partner-row-action partner-next-action" data-adaptive-record-trigger={`partner-store-${store.id}`} onClick={onInspect}>
      {next} <span aria-hidden="true">←</span>
    </button>
  </div>;
}

export type PartnerAttention =
  | Readonly<{ kind: "joining"; case: JoiningCaseSummary }>
  | Readonly<{ kind: "access"; grant: StoreAccessGrant }>;

function attentionDisplay(entry: PartnerAttention) {
  return entry.kind === "joining"
    ? { title: entry.case.firstStoreName || entry.case.businessName, kind: "طلب انضمام", state: joiningCaseStateLabel(entry.case.state), href: `/partners?kind=joining&case=${encodeURIComponent(entry.case.id)}`, updatedAt: entry.case.updatedAt }
    : { title: entry.grant.storeName, kind: "تفويض الوصول", state: "بانتظار اعتماد الدور", href: `/partners?kind=access&grant=${encodeURIComponent(entry.grant.id)}`, updatedAt: null };
}

export function PartnerAttentionRow({ entry }: Readonly<{ entry: PartnerAttention }>) {
  const item = attentionDisplay(entry);
  return <tr data-kind={entry.kind}>
    <td aria-label="حالة تحتاج مراجعة">—</td>
    <th scope="row"><strong>{item.title}</strong><small className="store-registry-secondary">{item.kind}</small></th>
    <td>—</td><td>{item.kind}</td><td>—</td>
    <td>{item.state}</td><td>—</td>
    <td><Link className="partner-row-action" href={item.href}>مراجعة السجل ←</Link></td>
    <td>{item.updatedAt ? <time dateTime={item.updatedAt}>{new Intl.DateTimeFormat("ar-YE", { dateStyle: "short" }).format(new Date(item.updatedAt))}</time> : "—"}</td>
  </tr>;
}

export function PartnerAttentionMobile({ entry }: Readonly<{ entry: PartnerAttention }>) {
  const item = attentionDisplay(entry);
  return <li className="partner-attention-mobile" data-kind={entry.kind}>
    <div className="store-mobile-heading"><strong>{item.title}</strong><span>{item.kind}</span></div>
    <div className="store-mobile-status"><span>{item.state}</span></div>
    <Link className="partner-row-action" href={item.href}>مراجعة السجل ←</Link>
  </li>;
}
