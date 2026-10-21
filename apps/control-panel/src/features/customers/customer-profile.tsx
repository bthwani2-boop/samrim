"use client";


import { TextArea } from "@bthwani/design-system/web";
import { formatMoney, type OperatorCustomerDailyActivity, type OperatorCustomerOrder, type OperatorCustomerOrderSummary, type OperatorCustomerOrdersResponse, orderStateLabel, paymentMethodLabel, paymentStateLabel } from "@bthwani/dsh";
import type { ActorRoleView } from "@bthwani/identity";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { identityFetch } from "../../session/identity-fetch";
import { useSession } from "../../session/session-provider";
import { RecordTabs } from "../shared/record-tabs";

type CustomerOrder = OperatorCustomerOrder;
type DayActivity = OperatorCustomerDailyActivity;
type CustomerSummary = OperatorCustomerOrderSummary;
type OrdersPage = OperatorCustomerOrdersResponse;
type Tab = "overview" | "orders" | "performance" | "marketing" | "account" | "finance";
const tabs: ReadonlyArray<Readonly<{ id: Tab; label: string }>> = [
  { id: "overview", label: "نظرة عامة" },
  { id: "orders", label: "الطلبات" },
  { id: "performance", label: "الأداء والنشاط" },
  { id: "marketing", label: "التسويق" },
  { id: "account", label: "الحساب والوصول" },
  { id: "finance", label: "المالية" },
];
const arabicNumber = new Intl.NumberFormat("ar-YE");
function dateText(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "غير متوفر";
  return new Intl.DateTimeFormat("ar-YE", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Aden" }).format(new Date(value));
}
async function requestError(response: Response): Promise<string> {
  const value = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return value?.error?.message || `تعذر تنفيذ الطلب (${response.status}).`;
}
function Panel({ title, description, children, id }: Readonly<{ title: string; description?: string; id?: string; children: ReactNode }>) {
  return <section className="customer-profile-panel" id={id}>
    <header className="customer-profile-panel-header"><h3>{title}</h3>{description ? <p>{description}</p> : null}</header>
    {children}
  </section>;
}
function Fact({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return <div className="customer-profile-field"><dt>{label}</dt><dd>{children}</dd></div>;
}
function Metric({ label, value, note }: Readonly<{ label: string; value: string; note?: string }>) {
  return <div className="customer-metric"><span>{label}</span><strong>{value}</strong>{note ? <small>{note}</small> : null}</div>;
}
function statusLabel(customer: ActorRoleView) {
  return !customer.securityEnabled ? "مقيّد أمنيًا" : !customer.enabled ? "موقوف" : "نشط";
}
function formattedAmount(value: number, currency: string) {
  return currency === "YER" ? formatMoney(value, "YER") : `${arabicNumber.format(value / 100)} ${currency}`;
}
function summaryValid(value: unknown): value is CustomerSummary {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  const counts = ["totalOrders","deliveredOrders","cancelledOrders","rejectedOrders","failedOrders",
    "openOrders","last30Days","previous30Days","distinctStores"];
  return counts.every((key) => Number.isSafeInteger(result[key]) && Number(result[key]) >= 0)
    && typeof result.measuredAt === "string" && Array.isArray(result.dailyActivity)
    && result.dailyActivity.length === 7
    && result.dailyActivity.every((item: unknown) => {
      if (!item || typeof item !== "object") return false;
      const day = item as Record<string, unknown>;
      return typeof day.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day.day)
        && Number.isSafeInteger(day.orders) && Number(day.orders) >= 0;
    });
}
function OrderTable({ orders, canOpenOrder }: Readonly<{ orders: ReadonlyArray<CustomerOrder>; canOpenOrder: boolean }>) {
  return <div className="customer-orders-table-wrap"><table className="operations-table customer-orders-table">
    <thead><tr><th scope="col">الطلب / المتجر</th><th scope="col">الحالة</th><th scope="col">الدفع</th>
      <th scope="col">الإجمالي</th><th scope="col">التاريخ</th><th scope="col">إجراء</th></tr></thead>
    <tbody>{orders.map((order) => <tr key={order.id}>
      <th scope="row"><strong>{order.storeName}</strong></th>
      <td>{orderStateLabel(order.state as Parameters<typeof orderStateLabel>[0])}</td>
      <td>{paymentMethodLabel(order.paymentMethod as Parameters<typeof paymentMethodLabel>[0])}
        <small>{paymentStateLabel(order.paymentState as Parameters<typeof paymentStateLabel>[0])}</small></td>
      <td>{formattedAmount(order.totalAmountMinor, order.currency)}</td>
      <td>{dateText(order.createdAt)}</td>
      <td>{canOpenOrder ? <Link className="partner-row-action" href={`/operations/${encodeURIComponent(order.id)}`}>فتح الطلب ←</Link> : <span className="customer-section-note">للاطلاع فقط</span>}</td>
    </tr>)}</tbody>
  </table></div>;
}
function ActivityChart({ days }: Readonly<{ days: ReadonlyArray<DayActivity> }>) {
  const max = Math.max(1, ...days.map((item) => item.orders));
  const shortDay = (day: string) => new Intl.DateTimeFormat("ar-YE", { weekday: "short", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));
  return <div className="customer-chart">
    <svg role="img" aria-label="عدد الطلبات يوميًا خلال آخر سبعة أيام بتوقيت صنعاء" viewBox="0 0 720 188" preserveAspectRatio="xMidYMid meet">
      <line x1="15" y1="151" x2="708" y2="151" className="customer-chart-baseline" />
      {days.map((day, index) => {
        const height = day.orders ? Math.max(8, Math.round(day.orders / max * 105)) : 2;
        const x = 31 + index * 99;
        return <g key={day.day}>
          <rect className={day.orders ? "customer-chart-bar" : "customer-chart-empty-bar"}
            x={x} y={151 - height} width="50" height={height} rx="6" />
          <text x={x + 25} y={Math.max(14, 144 - height)} textAnchor="middle" className="customer-chart-value">{arabicNumber.format(day.orders)}</text>
          <text x={x + 25} y="173" textAnchor="middle" className="customer-chart-day">{shortDay(day.day)}</text>
        </g>;
      })}
    </svg>
  </div>;
}

export function CustomerProfile({ actorId, embedded = false }: Readonly<{ actorId: string; embedded?: boolean }>) {
  const { state: session } = useSession();
  const canFinance = session.kind === "authenticated" && Boolean(session.identity.permissions?.includes("finance"));
  const canMarketing = session.kind === "authenticated" && Boolean(session.identity.permissions?.includes("marketing"));
  const canOperations = session.kind === "authenticated" && Boolean(session.identity.permissions?.includes("operations"));
  const canReadOrders = canMarketing || canOperations;
  const visibleTabs = tabs.filter(({ id }) => (id !== "finance" || canFinance)
    && (id !== "marketing" || canMarketing)
    && (id !== "orders" && id !== "performance" || canReadOrders));
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [customer, setCustomer] = useState<ActorRoleView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [orders, setOrders] = useState<ReadonlyArray<CustomerOrder>>([]);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [cursor, setCursor] = useState("");
  const [stack, setStack] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState("");
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [ordersError, setOrdersError] = useState("");
  const [reload, setReload] = useState(0);
  const orderRequest = useRef(0);

  useEffect(() => {
    const syncTab = () => {
      const desired = new URLSearchParams(window.location.search).get("tab");
      setActiveTab(tabs.some((tab) => tab.id === desired) ? desired as Tab : "overview");
    };
    syncTab();
    window.addEventListener("popstate", syncTab);
    return () => window.removeEventListener("popstate", syncTab);
  }, []);
  function selectTab(tab: Tab) {
    if (!visibleTabs.some((item) => item.id === tab)) return;
    const params = new URLSearchParams(window.location.search);
    if (tab === "overview") params.delete("tab"); else params.set("tab", tab);
    window.history.pushState({}, "", window.location.pathname + (params.size ? `?${params}` : ""));
    setActiveTab(tab);
  }

  const loadCustomer = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const result = await identityFetch(`/api/customers/${encodeURIComponent(actorId)}`, { cache: "no-store" });
      if (!result.ok) throw new Error(await requestError(result));
      const body = await result.json() as { customer: ActorRoleView };
      if (body.customer.actorId !== actorId || body.customer.role !== "client") throw new Error("سجل العميل غير متطابق.");
      setCustomer(body.customer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذرت قراءة ملف العميل.");
    } finally { setLoading(false); }
  }, [actorId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload intentionally refreshes the canonical customer read after a write or retry.
  useEffect(() => { void loadCustomer(); }, [loadCustomer, reload]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload intentionally refreshes order history and summary after a write or retry.
  useEffect(() => {
    const seq = ++orderRequest.current;
    if (!canReadOrders) {
      setOrders([]); setSummary(null); setNextCursor(""); setOrdersLoading(session.kind !== "authenticated");
      return;
    }
    setOrdersLoading(true); setOrdersError("");
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    void (async () => {
      try {
        const response = await identityFetch(`/api/customers/${encodeURIComponent(actorId)}/orders?${params}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await requestError(response));
        const body = await response.json() as OrdersPage;
        if (!Array.isArray(body.orders) || typeof body.nextCursor !== "string" || !summaryValid(body.summary))
          throw new Error("استجابة سجل الطلبات ومؤشرات الأداء غير مكتملة.");
        if (seq !== orderRequest.current) return;
        setOrders(body.orders); setNextCursor(body.nextCursor); setSummary(body.summary);
      } catch (cause) {
        if (seq !== orderRequest.current) return;
        setOrders([]); setNextCursor(""); setSummary(null);
        setOrdersError(cause instanceof Error ? cause.message : "تعذرت قراءة طلبات العميل.");
      } finally { if (seq === orderRequest.current) setOrdersLoading(false); }
    })();
  }, [actorId, cursor, reload, canReadOrders, session.kind]);

  async function saveStatus() {
    if (!customer || saving) return;
    const message = reason.trim();
    if (Array.from(message).length < 5 || Array.from(message).length > 500) {
      setError("اكتب سببًا موثقًا من 5 إلى 500 حرف."); return;
    }
    setSaving(true); setError(""); setNotice("");
    const desired = !customer.enabled;
    try {
      const response = await identityFetch(`/api/customers/${encodeURIComponent(actorId)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: desired, expectedVersion: customer.roleVersion, reason: message }),
      });
      if (!response.ok) {
        if (response.status === 409 || response.status === 412) await loadCustomer();
        throw new Error(await requestError(response));
      }
      const body = await response.json() as { customer: ActorRoleView };
      if (body.customer.actorId !== actorId || body.customer.enabled !== desired)
        throw new Error("لم تتطابق حالة الدور المقروءة بعد الحفظ.");
      setCustomer(body.customer); setReason("");
      setNotice(desired ? "تم تفعيل حساب العميل وتأكيد حالته." : "تم إيقاف حساب العميل وتأكيد حالته.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "تعذر تحديث حالة العميل.");
    } finally { setSaving(false); }
  }

  const displayName = customer?.fullNameAr?.trim() || "عميل بثواني";
  const shownTab = visibleTabs.some(({ id }) => id === activeTab) ? activeTab : "overview";
  const daysSinceOrder = summary?.lastOrderAt
    ? Math.max(0, (Date.now() - new Date(summary.lastOrderAt).getTime()) / 86_400_000)
    : null;
  const purchaseSegment = !summary ? "غير متوفر" : summary.totalOrders === 0 ? "لم يطلب بعد"
    : daysSinceOrder !== null && daysSinceOrder <= 30 ? "نشط شرائيًا"
    : daysSinceOrder !== null && daysSinceOrder <= 60 ? "يحتاج إعادة تنشيط"
    : "خامل شرائيًا";
  const completed = summary ? summary.deliveredOrders + summary.cancelledOrders + summary.rejectedOrders + summary.failedOrders : 0;
  const successRate = summary && completed > 0 ? `${arabicNumber.format(Math.round(summary.deliveredOrders / completed * 100))}%` : "—";
  const growth = summary ? summary.previous30Days > 0
    ? `${summary.last30Days >= summary.previous30Days ? "+" : "−"}${arabicNumber.format(Math.abs(Math.round((summary.last30Days - summary.previous30Days) / summary.previous30Days * 100)))}%`
    : summary.last30Days > 0 ? "نشاط جديد" : "لا تغير" : "—";
  const recentOrders = orders.slice(0, 5);
  const emptyOrders = !ordersLoading && !ordersError && orders.length === 0;
  const unavailable = !summary && !ordersLoading;
  const reloadAll = () => { setReload((n) => n + 1); setCursor(""); setStack([]); };
  const renderOrders = (compact: boolean) => <>
    {ordersError ? <div className="managed-status managed-status-warning" role="alert">{ordersError}
      <button type="button" className="button button-secondary" onClick={reloadAll}>إعادة المحاولة</button></div> : null}
    {ordersLoading && !orders.length ? <p className="customer-empty" role="status">جارٍ قراءة الطلبات…</p> : null}
    {emptyOrders ? <p className="customer-empty">لا توجد طلبات لهذا العميل.</p> : null}
    {orders.length > 0 ? <OrderTable orders={compact ? recentOrders : orders} canOpenOrder={canOperations} /> : null}
    {!compact && (orders.length > 0 || stack.length > 0) ? <nav className="customer-directory-paging" aria-label="صفحات طلبات العميل">
      <button type="button" className="button button-secondary" disabled={ordersLoading || !stack.length}
        onClick={() => { setCursor(stack.at(-1) ?? ""); setStack((s) => s.slice(0, -1)); }}>السابق</button>
      <span>الصفحة {arabicNumber.format(stack.length + 1)}</span>
      <button type="button" className="button button-secondary" disabled={ordersLoading || !nextCursor}
        onClick={() => { setStack((s) => [...s, cursor]); setCursor(nextCursor); }}>التالي</button>
    </nav> : null}
  </>;

  return <div className="customer-profile">
    {!embedded ? <nav aria-label="مسار الملف" className="customer-profile-breadcrumb">
      <Link href={canMarketing ? "/marketing/customers" : "/operations"}>{canMarketing ? "التسويق / العملاء" : "العمليات"}</Link><span aria-hidden="true">/</span><span>ملف العميل</span>
    </nav> : null}
    {error ? <div className="managed-status managed-status-warning" role="alert">{error}
      <button type="button" className="button button-secondary" onClick={() => { setError(""); reloadAll(); }}>إعادة القراءة</button>
    </div> : null}
    {loading && !customer ? <div className="collection-state" role="status">جارٍ قراءة ملف العميل…</div> : null}
    {customer ? <>
      <header className="customer-profile-hero">
        <div className="customer-profile-identity">
          <div className="customer-profile-avatar" aria-hidden="true">{displayName.slice(0, 1)}</div>
          <div className="customer-profile-identity-copy">
            {!embedded ? <span className="customer-eyebrow">ملف العميل · نظام المشغلين</span> : null}
            <h1>{displayName}</h1>
            <div className="customer-hero-contact">
              <bdi dir="ltr">{customer.phoneE164}</bdi>
              <span className="customer-state-pill" data-state={customer.enabled && customer.securityEnabled ? "on" : "off"}>{statusLabel(customer)}</span>
            </div>
          </div>
        </div>
        <div className="customer-profile-hero-actions">

          <button type="button" className="button button-primary" onClick={() => selectTab("account")}>{canOperations ? "إدارة الحساب" : "بيانات الحساب"}</button>
        </div>
      </header>

      <RecordTabs id="customer" ariaLabel="أقسام ملف العميل" className="customer-tab-strip"
        tabs={visibleTabs.map(({ id: key, label }) => ({ key, label }))} active={shownTab} onSelect={selectTab}/>

      <section role="tabpanel" id="customer-panel-overview" aria-labelledby="customer-tab-overview"
        hidden={shownTab !== "overview"} className="customer-tab-panel bt-record-tabs-panel">
        <div className="customer-metric-grid">
          <Metric label="إجمالي الطلبات" value={summary ? arabicNumber.format(summary.totalOrders) : "—"} note="من بداية الحساب" />
          <Metric label="طلبات مكتملة" value={summary ? arabicNumber.format(summary.deliveredOrders) : "—"} note="تم التسليم فقط" />
          <Metric label="قيد التنفيذ" value={summary ? arabicNumber.format(summary.openOrders) : "—"} note="لم تصل إلى حالة نهائية" />
          <Metric label="آخر 30 يومًا" value={summary ? arabicNumber.format(summary.last30Days) : "—"} note="فترة متحركة" />
        </div>
        {unavailable ? <p className="customer-empty">تعذر تحميل المؤشرات من سجل الطلبات.</p> : null}
        <div className="customer-overview-grid">
          <Panel title="طلبات العميل" description="أحدث خمسة طلبات، مع الوصول المباشر لسجل الطلب."
            id="customer-orders">
            {renderOrders(true)}
            <button type="button" className="customer-panel-link" onClick={() => selectTab("orders")}>عرض جميع الطلبات ←</button>
          </Panel>
          <div className="customer-overview-side">
            <Panel title="ملخص الأداء" description="مقاييس مستقلة عن حجم الصفحة الحالية.">
              <dl className="customer-profile-fields">
                <Fact label="معدل التسليم من الطلبات المنتهية">{successRate}</Fact>
                <Fact label="متاجر مختلفة">{summary ? arabicNumber.format(summary.distinctStores) : "—"}</Fact>
                <Fact label="طلبات ملغاة">{summary ? arabicNumber.format(summary.cancelledOrders) : "—"}</Fact>
                <Fact label="آخر طلب">{dateText(summary?.lastOrderAt)}</Fact>
              </dl>
              <button type="button" className="customer-panel-link" onClick={() => selectTab("performance")}>تفاصيل الأداء والنشاط ←</button>
            </Panel>
            <Panel title="هوية العميل" description="حالة الحساب مباشرة من Identity.">
              <dl className="customer-profile-fields">
                <Fact label="تاريخ الانضمام">{dateText(customer.createdAt)}</Fact>
                <Fact label="آخر فتح للتطبيق">{dateText(customer.lastAppOpenedAt)}</Fact>
                <Fact label="آخر تسجيل دخول">{dateText(customer.lastAuthenticatedAt)}</Fact>
                <Fact label="حالة الهوية">{customer.securityEnabled ? "مسموحة" : "مقيّدة"}</Fact>
              </dl>
            </Panel>
          </div>
        </div>
      </section>

      <section role="tabpanel" id="customer-panel-orders" aria-labelledby="customer-tab-orders"
        hidden={shownTab !== "orders"} className="customer-tab-panel bt-record-tabs-panel">
        <Panel title="الطلبات" description="جميع طلبات هذا العميل عبر صفحات متتابعة، من الأحدث إلى الأقدم.">
          {renderOrders(false)}
        </Panel>
      </section>

      <section role="tabpanel" id="customer-panel-performance" aria-labelledby="customer-tab-performance"
        hidden={shownTab !== "performance"} className="customer-tab-panel bt-record-tabs-panel">
        {summary ? <>
          <div className="customer-metric-grid">
            <Metric label="إجمالي الطلبات" value={arabicNumber.format(summary.totalOrders)} note="تراكمي" />
            <Metric label="التسليم الناجح" value={successRate} note="المكتملة ÷ جميع الطلبات النهائية" />
            <Metric label="المتاجر المختلفة" value={arabicNumber.format(summary.distinctStores)} note="عدد المتاجر التي طُلب منها" />
            <Metric label="التغير خلال 30 يومًا" value={growth} note="مقارنةً بالثلاثين يومًا السابقة" />
          </div>
          <div className="customer-performance-grid">
            <Panel title="نشاط آخر سبعة أيام" description="عدد الطلبات المنشأة يوميًا، بتوقيت صنعاء.">
              <ActivityChart days={summary.dailyActivity} />
              <p className="customer-method-note">المصدر: طلبات DSH الفعلية. الصفر يعني عدم وجود طلبات في ذلك اليوم، وليس غياب البيانات.</p>
            </Panel>
            <Panel title="توزيع حالات الطلبات" description="تصنيف حصري لكل طلب وفق حالته الحالية.">
              <dl className="customer-profile-fields">
                <Fact label="مكتملة">{arabicNumber.format(summary.deliveredOrders)}</Fact>
                <Fact label="جارية">{arabicNumber.format(summary.openOrders)}</Fact>
                <Fact label="ملغاة">{arabicNumber.format(summary.cancelledOrders)}</Fact>
                <Fact label="مرفوضة">{arabicNumber.format(summary.rejectedOrders)}</Fact>
                <Fact label="تعثر التسليم">{arabicNumber.format(summary.failedOrders)}</Fact>
              </dl>
            </Panel>
          </div>
          <div className="customer-performance-grid">
            <Panel title="سلوك الشراء">
              <dl className="customer-profile-fields">
                <Fact label="آخر 30 يومًا">{arabicNumber.format(summary.last30Days)} طلب</Fact>
                <Fact label="30 يومًا السابقة">{arabicNumber.format(summary.previous30Days)} طلب</Fact>
                <Fact label="أول طلب">{dateText(summary.firstOrderAt)}</Fact>
                <Fact label="آخر طلب">{dateText(summary.lastOrderAt)}</Fact>
              </dl>
            </Panel>
            <Panel title="تعريف المؤشرات">
              <div className="customer-methodology">
                <p><strong>معدل التسليم:</strong> المكتملة مقسومة على الطلبات المنتهية (مكتملة، ملغاة، مرفوضة أو متعثرة). الطلبات الجارية مستبعدة من المقام.</p>
                <p><strong>النشاط:</strong> يشمل الطلبات التي أُنشئت خلال الفترة، مهما كانت حالتها لاحقًا.</p>
                <p><strong>المقارنة:</strong> آخر 30 يومًا مقابل الثلاثين يومًا التي سبقتها، من لحظة القياس.</p>
                <small>آخر قياس: {dateText(summary.measuredAt)}</small>
              </div>
            </Panel>
          </div>
        </> : <p className="customer-empty">{ordersLoading ? "جارٍ احتساب مؤشرات الأداء…" : ordersError || "لم تتوفر بيانات أداء معتمدة."}</p>}
      </section>

      {canMarketing ? <section role="tabpanel" id="customer-panel-marketing" aria-labelledby="customer-tab-marketing"
        hidden={shownTab !== "marketing"} className="customer-tab-panel bt-record-tabs-panel">
        <div className="customer-metric-grid">
          <Metric label="شريحة النشاط الشرائي" value={purchaseSegment} note="استنتاج من آخر طلب موثق" />
          <Metric label="طلبات آخر 30 يومًا" value={summary ? arabicNumber.format(summary.last30Days) : "—"} note="عدد الطلبات المنشأة" />
          <Metric label="طلبات الفترة السابقة" value={summary ? arabicNumber.format(summary.previous30Days) : "—"} note="قبل الفترة الحالية مباشرة" />
          <Metric label="آخر فتح للتطبيق" value={dateText(customer.lastAppOpenedAt)} note="بيانات الهوية الفعلية" />
        </div>
        <div className="customer-performance-grid">
          <Panel title="تصنيف العميل" description="معايير بسيطة قابلة للمراجعة دون تسجيل شريحة اصطناعية في قاعدة البيانات.">
            <dl className="customer-profile-fields">
              <Fact label="الشريحة الحالية">{purchaseSegment}</Fact>
              <Fact label="أول طلب">{dateText(summary?.firstOrderAt)}</Fact>
              <Fact label="آخر طلب">{dateText(summary?.lastOrderAt)}</Fact>
              <Fact label="عدد المتاجر المختلفة">{summary ? arabicNumber.format(summary.distinctStores) : "—"}</Fact>
            </dl>
            <p className="customer-method-note">نشط شرائيًا: آخر طلب خلال 30 يومًا؛ يحتاج إعادة تنشيط: من 31 إلى 60 يومًا؛ خامل: أكثر من 60 يومًا؛ لم يطلب بعد: لا توجد طلبات. هذا تصنيف قراءة فقط، وليس حملة استهداف منفذة.</p>
          </Panel>
          <Panel title="الإجراءات التسويقية" description="لا تنفيذ جماعي ولا رسائل تلقائية من ملف العميل.">
            <p className="customer-account-help">راجع نشاط العميل قبل إعداد عرض. لا تتوفر حاليًا بيانات موثوقة للسلال المتروكة أو الموافقة على الرسائل التسويقية، لذلك لا تُعرض كحقائق ولا تُستخدم للاستهداف.</p>
            <Link className="button button-secondary customer-finance-link" href="/marketing/promotions">إدارة العروض والحملات ←</Link>
            <p className="customer-method-note">الانتقال إلى الحملات لا يضيف هذا العميل تلقائيًا إلى جمهور أي حملة.</p>
          </Panel>
        </div>
      </section> : null}

      <section role="tabpanel" id="customer-panel-account" aria-labelledby="customer-tab-account"
        hidden={shownTab !== "account"} className="customer-tab-panel bt-record-tabs-panel">
        <div className="customer-account-grid">
          <Panel title="الهوية والوصول" description="الحقائق المعتمدة لدى نظام الهوية.">
            <dl className="customer-profile-fields">
              <Fact label="الاسم">{displayName}</Fact>
              <Fact label="رقم الهاتف"><bdi dir="ltr">{customer.phoneE164}</bdi></Fact>
              <Fact label="نوع الحساب">عميل</Fact>
              <Fact label="الدور">{customer.enabled ? "مفعّل" : "موقوف"}</Fact>
              <Fact label="حالة الهوية الأمنية">{customer.securityEnabled ? "مسموحة" : "معطّلة"}</Fact>
              <Fact label="تاريخ إنشاء الحساب">{dateText(customer.createdAt)}</Fact>
              <Fact label="آخر فتح للتطبيق">{dateText(customer.lastAppOpenedAt)}</Fact>
              <Fact label="آخر تسجيل دخول">{dateText(customer.lastAuthenticatedAt)}</Fact>
              <Fact label="نسخة الدور">{arabicNumber.format(customer.roleVersion)}</Fact>
            </dl>
          </Panel>
          {canOperations ? <Panel id="customer-account-management" title="إدارة حساب العميل"
            description="تغيير حالة دور العميل فقط، مع توثيق السبب وقراءة تأكيدية من Identity.">
            <form className="customer-account-control" noValidate onSubmit={(event) => { event.preventDefault(); void saveStatus(); }}>
              <span className="customer-state-pill" data-state={customer.enabled ? "on" : "off"}>{customer.enabled ? "الدور مفعّل" : "الدور موقوف"}</span>
              <label htmlFor="customer-action-reason">سبب {customer.enabled ? "الإيقاف" : "إعادة التفعيل"}
                <TextArea className="resize-none" id="customer-action-reason" value={reason} maxLength={500} rows={4} disabled={saving}
                  placeholder="اكتب سببًا واضحًا للإجراء ليُحفظ مع سجل التدقيق."
                  onChange={(event) => { setReason(event.target.value); setError(""); setNotice(""); }} />
              </label>
              <button type="submit" className={customer.enabled ? "button button-secondary" : "button button-primary"}
                disabled={saving || reason.trim().length < 5}>
                {saving ? "جارٍ الحفظ…" : customer.enabled ? "إيقاف حساب العميل" : "إعادة تفعيل الحساب"}</button>
              {notice ? <p className="success-inline" role="status">{notice}</p> : null}
              <p className="customer-account-help">لا يتغير رصيد المحفظة أو سجل الطلبات أو هوية الشخص المشتركة. لا يمكن تجاوز وسائل التحقق أو إعادة تعيين بيانات الدخول من هنا.</p>
            </form>
          </Panel> : null}
        </div>
      </section>

      {canFinance ? <section role="tabpanel" id="customer-panel-finance" aria-labelledby="customer-tab-finance"
        hidden={shownTab !== "finance"} className="customer-tab-panel bt-record-tabs-panel">
        <div className="customer-performance-grid">
          <Panel title="المحفظة والحركات المالية" description="الحقائق المالية لا تُشتق من مبلغ الطلب.">
            <p className="customer-account-help">لا توجد حتى الآن قراءة مالية مُصرّح بها لهذا الملف من مالك دفتر المحفظة WLT، لذلك لا يظهر رصيد أو كشف حساب تقديري. تبقى الأموال والتعويضات في سجلاتها المحاسبية الأصلية.</p>
          </Panel>
          <Panel title="عمليات السحب الاستثنائية" description="إجراءات مالية منفصلة خاضعة للصلاحية.">
            <Link className="button button-secondary customer-finance-link" href="/finance/customer-withdrawals">فتح سجل السحوبات الاستثنائية ←</Link>
          </Panel>
        </div>
      </section> : null}
    </> : null}
  </div>;
}
