"use client";

import type { DiscoveryContentAnalytics, DiscoveryContentView, OperatorDiscoveryContentRegistryResponse, OperatorPromotionRegistryResponse, PromotionView } from "@bthwani/dsh";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "../../session/session-provider";
import { PageHeader } from "../../shell/page-header";
import { MarketingContentWorkspace } from "./marketing-content-workspace";
import { MarketingPromotionsWorkspace } from "./marketing-promotions-workspace";

type Section = "overview" | "campaigns" | "content" | "partners" | "analytics";
const sections: ReadonlyArray<Readonly<{ id: Section; label: string; description: string }>> = [
  { id: "overview", label: "نظرة عامة", description: "حالات العروض والمحتوى والتنبيهات" },
  { id: "campaigns", label: "الحملات والعروض", description: "الخصومات والقسائم والتمويل والنشر" },
  { id: "content", label: "المحتوى والظهور", description: "البنرات والصور والوجهات والمعاينات" },
  { id: "partners", label: "مشاركة الشركاء", description: "الموافقة والتمويل وحدود الصلاحية" },
  { id: "analytics", label: "الأداء والتحليلات", description: "الظهور والنقر والطلبات المنشأة المنسوبة" },
];

type RegistrySnapshot = Readonly<{
  promotions: ReadonlyArray<PromotionView>;
  content: ReadonlyArray<DiscoveryContentView>;
  promotionsPartial: boolean;
  contentPartial: boolean;
}>;

async function readMarketingRegistry(signal: AbortSignal): Promise<RegistrySnapshot> {
  const [promotionResponse, contentResponse] = await Promise.all([
    fetch("/api/marketing/promotions?limit=100&sort=starts_desc", { signal, cache: "no-store" }),
    fetch("/api/marketing/content?limit=100&sort=priority", { signal, cache: "no-store" }),
  ]);
  if (!promotionResponse.ok || !contentResponse.ok) throw new Error("تعذر قراءة سجلات التسويق. لا يمكن اعتماد الأرقام قبل إعادة المحاولة.");
  const promotions = await promotionResponse.json() as OperatorPromotionRegistryResponse;
  const content = await contentResponse.json() as OperatorDiscoveryContentRegistryResponse;
  if (!Array.isArray(promotions.promotions) || !Array.isArray(content.items)) throw new Error("استجابة سجلات التسويق غير صالحة.");
  return {
    promotions: promotions.promotions,
    content: content.items,
    promotionsPartial: Boolean(promotions.nextCursor),
    contentPartial: Boolean(content.nextCursor),
  };
}

function RegistrySummary({ snapshot }: Readonly<{ snapshot: RegistrySnapshot }>) {
  const now = Date.now();
  const active = snapshot.promotions.filter((item) => item.state === "PUBLISHED" && Date.parse(item.startsAt) <= now && (!item.endsAt || Date.parse(item.endsAt) > now)).length;
  const scheduled = snapshot.promotions.filter((item) => item.state === "PUBLISHED" && Date.parse(item.startsAt) > now).length;
  const ended = snapshot.promotions.filter((item) => item.state === "ENDED" || (item.state !== "DRAFT" && item.endsAt && Date.parse(item.endsAt) <= now)).length;
  const draft = snapshot.promotions.filter((item) => item.state === "DRAFT").length;
  const paused = snapshot.promotions.filter((item) => item.state === "PAUSED" && (!item.endsAt || Date.parse(item.endsAt) > now)).length;
  const liveContent = snapshot.content.filter((item) => item.state === "PUBLISHED" && Date.parse(item.startsAt) <= now && (!item.endsAt || Date.parse(item.endsAt) > now)).length;
  return <>
    <div className="ops-summary-grid">
      {[
        { name: "العروض الفعالة", value: active },
        { name: "العروض المجدولة", value: scheduled },
        { name: "العروض المنتهية", value: ended },
        { name: "المسودات", value: draft },
        { name: "العروض المتوقفة", value: paused },
        { name: "المحتوى المنشور الساري", value: liveContent },
      ].map(({ name, value }) => <div className="ops-summary" key={name}><span>{name}</span><strong>{value.toLocaleString("ar-YE")}</strong></div>)}
    </div>
    <p className="muted" role="note">{snapshot.promotionsPartial || snapshot.contentPartial ? "هذه أعداد جزئية من أول 100 سجل بكل قائمة، وليست إجماليات المنصة." : "الأعداد مستخرجة من السجلين الكاملين المقروءين حاليًا؛ حالة الوقت محسوبة عند القراءة."} حالات النشر لا تثبت أهلية الخصم أو موافقة الشريك أو توفر الميزانية.</p>
    <div className="access-card">
      <h2>تنبيهات تحتاج إجراءً</h2>
      <p>موافقات المتاجر المنتظرة ليست ضمن سجل المشغّل الحالي؛ حالتها الإجمالية غير متاحة ولا تُحسب صفرًا.</p>
      <p>حالة فشل النشر تُراجع من سجل كل محتوى أو عرض، ولا تُستنتج من عدد المسودات.</p>
    </div>
  </>;
}

function PartnerCampaignSummary({ snapshot }: Readonly<{ snapshot: RegistrySnapshot }>) {
  const offers = snapshot.promotions.filter((item) => item.requiresPartnerOptIn);
  return <div className="work-stack">
    <p className="muted">الموافقة تُسجّل من تطبيق الشريك للمتجر المخوّل. لا يستطيع المشغّل قبول مشاركة نيابة عن الشريك أو تحميل متجر تكلفةً بمجرد نشر حملة.</p>
    <div className="access-card">
      <h2>حملات تتطلب موافقة الشركاء</h2>
      {offers.length ? <ul>{offers.map((item) => <li key={item.id}>{item.nameAr} — {item.fundingSource === "SHARED" ? "تمويل مشترك" : item.fundingSource === "PARTNER" ? "تمويل الشريك" : "تمويل بثواني"} — {item.state}</li>)}</ul> : <p className="muted">لا تظهر حملات تتطلب الموافقة في السجلات المقروءة.</p>}
      {snapshot.promotionsPartial ? <p className="muted">القائمة جزئية؛ توجد سجلات أخرى لم تُقرأ.</p> : null}
      <p className="muted">حالة كل قبول أو رفض وعدد المتاجر المنتظرة: غير متاحين في قراءة المشغّل الحالية. يمكن للشريك مراجعتها داخل تطبيق الشريك.</p>
    </div>
  </div>;
}

function ContentAnalyticsSummary({ snapshot }: Readonly<{ snapshot: RegistrySnapshot }>) {
  const [selected, setSelected] = useState("");
  const [metrics, setMetrics] = useState<ReadonlyArray<DiscoveryContentAnalytics> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selected) { setMetrics(null); setError(""); return; }
    const controller = new AbortController();
    setMetrics(null);
    setLoading(true);
    setError("");
    void fetch("/api/marketing/analytics?contentId=" + encodeURIComponent(selected), { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("تعذر قراءة التحليلات الفعلية لهذا المحتوى.");
        const value = await response.json() as { items?: ReadonlyArray<DiscoveryContentAnalytics> };
        if (!Array.isArray(value.items)) throw new Error("النتائج غير صالحة.");
        if (!controller.signal.aborted) setMetrics(value.items);
      })
      .catch(() => { if (!controller.signal.aborted) setError("تعذرت قراءة النتائج؛ الأرقام غير متاحة."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selected]);
  const counts = (type: string) => metrics?.find((item) => item.eventType === type)?.count ?? 0;
  return <div className="work-stack">
    <p>التقارير الحالية خاصة بكل مادة تسويقية، ولا تخلط الطلب المنشأ المنسوب بالطلب المكتمل أو الربح.</p>
    <div className="access-card">
      <label className="field-label" htmlFor="marketing-analytics-content-select">اختر المحتوى لقراءة نتائجه
        <select id="marketing-analytics-content-select" value={selected} onChange={(event) => setSelected(event.target.value)}>
          <option value="">اختر بنرًا أو محتوى</option>
          {snapshot.content.map((item) => <option key={item.id} value={item.id}>{item.titleAr}</option>)}
        </select>
      </label>
      {snapshot.contentPartial ? <p className="muted">القائمة تعرض أول 100 عنصر فقط؛ استخدم سجل المحتوى لعرض المزيد.</p> : null}
      {loading ? <p role="status">جارٍ قراءة البيانات...</p> : error ? <p role="alert">{error}</p> : metrics ? <dl className="marketing-analytics-breakdown">
        {[
          { label: "أحداث الظهور", value: counts("IMPRESSION") },
          { label: "النقرات", value: counts("CLICK") },
          { label: "طلبات منشأة منسوبة", value: counts("CONVERSION") },
        ].map((item) => <div key={item.label}><dt>{item.label}</dt><dd><strong>{item.value.toLocaleString("ar-YE")}</strong></dd></div>)}
      </dl> : <p className="muted">اختر المحتوى لعرض أحداثه المسجلة.</p>}
    </div>
    <p className="muted">الطلبات المكتملة، وقيمة الخصم المسوّاة، ومصاريف WLT الفعلية: غير متاحة في تقرير المحتوى الحالي؛ لا تُعرض كأصفار أو كعائد استثمار.</p>
  </div>;
}

function MarketingAuthorizedCenter() {
  const [active, setActive] = useState<Section>("overview");
  const [visited, setVisited] = useState<ReadonlyArray<Section>>(["overview"]);
  const [snapshot, setSnapshot] = useState<RegistrySnapshot | null>(null);
  const [loadError, setLoadError] = useState("");
  const [readVersion, setReadVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  useEffect(() => {
    if (!["overview", "partners", "analytics"].includes(active)) return;
    const controller = new AbortController();
    if (readVersion > 0) setSnapshot(null);
    setIsLoading(true);
    setLoadError("");
    void readMarketingRegistry(controller.signal)
      .then((value) => { if (!controller.signal.aborted) setSnapshot(value); })
      .catch(() => { if (!controller.signal.aborted) { setSnapshot(null); setLoadError("تعذرت قراءة البيانات الحالية. أعد المحاولة."); } })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [active, readVersion]);

  return <section className="workspace-page marketing-center" aria-labelledby="marketing-center-title">
    <PageHeader id="marketing-center-title" title="التسويق والمحتوى" actions={<Link href="/marketing/customers" className="button button-primary">إدارة العملاء</Link>} />
    <nav aria-label="أقسام التسويق" className="action-row">
      {sections.map((section) => <button key={section.id} type="button" className={active === section.id ? "button button-primary" : "button button-secondary"}
        aria-current={active === section.id ? "page" : undefined} onClick={() => {
          setActive(section.id);
          setVisited((previous) => previous.includes(section.id) ? previous : [...previous, section.id]);
        }}>{section.label}</button>)}
    </nav>
    {sections.map((section) => <section key={section.id} hidden={active !== section.id} aria-label={section.label} className="work-stack">
      {visited.includes(section.id) ? <>
        <p className="muted">{section.description}</p>
        {section.id === "campaigns" ? <MarketingPromotionsWorkspace /> : section.id === "content" ? <MarketingContentWorkspace /> : null}
        {["overview", "partners", "analytics"].includes(section.id) && active === section.id ? <>
          {isLoading ? <p role="status">جارٍ تحديث سجلات التسويق...</p> : loadError ? <div role="alert" className="access-card"><p>{loadError}</p><button className="button button-secondary" type="button" onClick={() => setReadVersion((version) => version + 1)}>إعادة المحاولة</button></div> : snapshot ? section.id === "overview" ? <RegistrySummary snapshot={snapshot} /> : section.id === "partners" ? <PartnerCampaignSummary snapshot={snapshot} /> : <ContentAnalyticsSummary snapshot={snapshot} /> : null}
        </> : null}
      </> : null}
    </section>)}
  </section>;
}

export function MarketingCenterWorkspace() {
  const { state } = useSession();
  if (state.kind !== "authenticated") return null;
  if (state.identity.role !== "operator" || !state.identity.permissions?.includes("marketing")) {
    return <section className="state-content workspace-restricted" role="alert"><h1>التسويق للمشغلين فقط</h1><p>لا يمنح الدخول إلى هذا المركز صلاحيات إضافية.</p></section>;
  }
  return <MarketingAuthorizedCenter />;
}
