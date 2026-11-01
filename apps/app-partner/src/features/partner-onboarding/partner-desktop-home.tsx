import { typography } from "@bthwani/design-system";
import { BthwaniIcon, type MobileIconName, useAppearanceTheme } from "@bthwani/design-system/native";
import {
  createDshMobileClient, formatMoney, type CatalogStoreOffer, type Order,
  type PartnerAccessibleStore, type PartnerOrderAttentionCounts, type PartnerScopedFinanceStore, type PartnerStoreOrderSummary,
} from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";
import { catalogPublishedAvailability, isOfferStockout } from "../store-offer/inventory-stockout";
import { agreementReadinessMessage, type StoreAgreementReadback } from "./store-agreement-readiness";
import { nextStoreSetupFocus, storeReadinessProgress } from "./partner-onboarding-next-step";
import { scopedPartnerPopularOffers } from "./partner-home-popularity";

type Data = Readonly<{
  attention: PartnerOrderAttentionCounts | null;
  recentOrders: ReadonlyArray<Order> | null;
  ordersPartial: boolean;
  weeklyOrderSummary: PartnerStoreOrderSummary | null;
  offers: ReadonlyArray<CatalogStoreOffer> | null;
  popularOffers: ReadonlyArray<CatalogStoreOffer> | null;
  offersPartial: boolean;
  finance: PartnerScopedFinanceStore | null;
}>;

const empty: Data = {
  attention: null, recentOrders: null, ordersPartial: false, weeklyOrderSummary: null,
  offers: null, popularOffers: null, offersPartial: false, finance: null,
};

type Props = Readonly<{
  store: PartnerAccessibleStore;
  operationalState: string;
  operationalKnown: boolean;
  canOperate: boolean;
  commercialAgreement: StoreAgreementReadback;
}>;

const statuses = [
  { key: "new", label: "جديدة", states: ["CREATED"] },
  { key: "preparing", label: "قيد التجهيز", states: ["PARTNER_ACCEPTED", "PREPARING"] },
  { key: "ready", label: "جاهزة", states: ["READY_FOR_DISPATCH", "READY_FOR_PICKUP"] },
  { key: "transit", label: "قيد التسليم", states: ["PICKED_UP", "CAPTAIN_ASSIGNED", "IN_CUSTODY"] },
  { key: "delivered", label: "مكتملة", states: ["DELIVERED"] },
  { key: "stopped", label: "متعذرة أو ملغاة", states: ["DELIVERY_FAILED", "REJECTED", "CANCELLED"] },
] as const;

export function groupOrders(orders: ReadonlyArray<Pick<Order, "state">>) {
  return statuses.map(group => ({
    key: group.key,
    label: group.label,
    count: orders.filter(order => (group.states as readonly string[]).includes(order.state)).length,
  }));
}

function adenDay(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Aden", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function recentOrderDays(orders: ReadonlyArray<Pick<Order, "createdAt">>, now: Date) {
  const dates = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now.getTime() - (6 - i) * 86400000);
    return { key: adenDay(date), count: 0 };
  });
  const lookup = new Map(dates.map((item, index) => [item.key, index]));
  for (const order of orders) {
    const date = new Date(order.createdAt);
    if (Number.isNaN(date.getTime())) continue;
    const index = lookup.get(adenDay(date));
    if (index !== undefined) dates[index]!.count++;
  }
  return dates;
}

function readableOrderState(state: Order["state"]) {
  switch (state) {
    case "CREATED": return "جديد";
    case "PARTNER_ACCEPTED": case "PREPARING": return "قيد التحضير";
    case "READY_FOR_PICKUP": return "جاهز للاستلام";
    case "READY_FOR_DISPATCH": return "جاهز للتسليم";
    case "CAPTAIN_ASSIGNED": case "PICKED_UP": case "IN_CUSTODY": return "في التوصيل";
    case "DELIVERED": return "مكتمل";
    case "REJECTED": case "CANCELLED": return "ملغى";
    case "DELIVERY_FAILED": return "تسليم متعثر";
  }
}

export function PartnerDesktopHome({ store, operationalState, operationalKnown, canOperate, commercialAgreement }: Props) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();
  const [data, setData] = useState<Data>(empty);
  const [loading, setLoading] = useState(true);
  const canOrders = store.owned || store.permissions.includes("orders");
  const canCatalog = store.owned || store.permissions.includes("catalog");
  const canPromotions = store.owned || store.permissions.includes("promotions");
  const canFinance = store.owned || store.permissions.includes("finance_read");

  useFocusEffect(useCallback(() => {
    let active = true;
    setData(empty);
    setLoading(true);
    const identity = currentIdentityState();
    const actor = identity.kind === "authenticated" ? identity.identity.subject : "";
    const base = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
    if (!actor || !base) {
      setLoading(false);
      return () => { active = false; };
    }
    const client = createDshMobileClient(base, { cryptoRandomUUID: () => Crypto.randomUUID() });
    void (async () => {
      const token = await getUsableIdentityAccessToken();
      const [orders, offers, financial, weekly, popular] = await Promise.allSettled([
        canOrders ? client.listPartnerOrders(token, { storeIds: [store.id], limit: 24 }) : Promise.resolve(null),
        canCatalog ? client.readOwnStoreOffers(token, store.id, 100) : Promise.resolve(null),
        store.owned ? client.readOwnPartnerFinancialSummary(token) : Promise.resolve(null),
        canOrders ? client.readPartnerStoreOrderSummary(token, store.id, "7d") : Promise.resolve(null),
        canCatalog && store.publicationState === "published"
          ? client.readPublicStoreCatalog(store.id, store.serviceCityId, "", "", 4, "", "", "MOST_ORDERED_30_DAYS")
          : Promise.resolve(null),
      ]);
      const current = currentIdentityState();
      if (!active || current.kind !== "authenticated" || current.identity.subject !== actor) return;
      const orderPage = orders.status === "fulfilled" ? orders.value : null;
      const offerPage = offers.status === "fulfilled" ? offers.value : null;
      const financePage = financial.status === "fulfilled" ? financial.value : null;
      const weeklyPage = weekly.status === "fulfilled" ? weekly.value : null;
      const popularPage = popular.status === "fulfilled" ? popular.value : null;
      const weeklySummary = weeklyPage?.summary;
      const verifiedWeekly = weeklySummary?.storeId === store.id && weeklySummary.period === "7d" &&
        Number.isSafeInteger(weeklySummary.totalOrders) && weeklySummary.totalOrders >= 0 ? weeklySummary : null;
      setData({
        attention: orderPage?.attention ?? null,
        recentOrders: orderPage?.orders ?? null,
        ordersPartial: Boolean(orderPage?.nextCursor),
        weeklyOrderSummary: verifiedWeekly,
        offers: offerPage?.offers ?? null,
        popularOffers: scopedPartnerPopularOffers(store.id, popularPage),
        offersPartial: Boolean(offerPage?.nextCursor),
        finance: financePage?.summary.stores.find(item => item.storeId === store.id) ?? null,
      });
      setLoading(false);
    })().catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store.id, store.owned, store.serviceCityId, store.publicationState, canCatalog, canOrders]));

  const stockout = data.offers?.filter(isOfferStockout) ?? [];
  const unavailable = data.offers?.filter(item => item.publicationState === "published" && !item.availability) ?? [];
  const available = data.offers?.filter(item => item.publicationState === "published" && item.availability).length;
  const catalogReady = catalogPublishedAvailability(data.offers, data.offersPartial);
  const financialReady = Boolean(data.finance?.attributionComplete);
  const orders = data.recentOrders ?? [];
  const groups = groupOrders(orders);
  const recentDays = recentOrderDays(orders, new Date());
  const maxDay = Math.max(1, ...recentDays.map(item => item.count));
  const readySteps = [
    ...(store.owned ? [store.publicationState === "published"] : []),
    ...(canCatalog ? [catalogReady] : []),
    ...(canOperate ? [operationalKnown ? operationalState === "مفتوح" : null] : []),
    ...(store.owned ? [commercialAgreement === null || commercialAgreement === "UNAVAILABLE" ? null : commercialAgreement === "ACTIVE"] : []),
  ];
  const progress = storeReadinessProgress(readySteps);
  const setupFocus = nextStoreSetupFocus({
    ownsStore: store.owned, canEditCatalog: canCatalog, canManageAvailability: canOperate,
    publicationState: store.publicationState, catalogReady, agreement: commercialAgreement,
    operationalKnown, operationalState,
  });

  const go = (href: Href) => {
    if (String(href).startsWith("/store")) router.push(href);
    else router.navigate(href);
  };
  const tile = (label: string, value: string, note: string, icon: MobileIconName, href?: Href) =>
    <Pressable key={label} disabled={!href} accessibilityRole={href ? "button" : undefined}
      accessibilityLabel={href ? label + "، فتح التفاصيل" : label} onPress={() => { if (href) go(href); }} style={styles.metric}>
      <View style={styles.metricTop}>
        <View style={styles.metricIcon}><BthwaniIcon name={icon} color={theme.brandAction} size={21} /></View>
        <Text style={styles.caption}>{label}</Text>
      </View>
      <Text style={styles.metricValue} numberOfLines={1}>{value}</Text>
      <Text style={styles.muted} numberOfLines={2}>{note}</Text>
      <View style={styles.metricAccent} />
    </Pressable>;
  const action = (label: string, detail: string, href: Href, icon: MobileIconName, done?: boolean | null) =>
    <Pressable accessibilityRole="button" accessibilityLabel={label} key={label} style={styles.setupAction}
      onPress={() => go(href)}>
      <View style={styles.setupIcon}><BthwaniIcon name={icon} color={theme.brandAction} size={18} /></View>
      <View style={styles.setupCopy}>
        <Text style={styles.setupLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.muted} numberOfLines={2}>{detail}</Text>
      </View>
      {done !== undefined && done !== null ? <BthwaniIcon name={done ? "success" : "warning"} color={done ? theme.success : theme.warning} size={16} /> : null}
    </Pressable>;
  const panelTitle = (label: string, href?: Href) =>
    <View style={styles.panelHeading}>
      <Text accessibilityRole="header" style={styles.panelTitle}>{label}</Text>
      {href ? <Pressable accessibilityRole="button" accessibilityLabel={"عرض كل " + label} onPress={() => go(href)} style={styles.panelLink}><Text style={styles.action}>عرض الكل</Text></Pressable> : null}
    </View>;

  return <View style={styles.root} accessibilityLabel="لوحة تحكم الشريك الرئيسية">
    <View style={styles.columns}>
      <View style={styles.mainColumn}>
        <View style={styles.metrics}>
          {canOrders ? tile("الطلبات الجديدة", data.attention?.newOrders.toLocaleString("ar-YE") ?? "—", data.attention ? "تحتاج قبولًا أو مراجعة" : "تعذر قراءة العدد", "orders", "/orders" as Href) : null}
          {canOrders ? tile("بانتظار التسليم", data.attention?.awaitingDispatch.toLocaleString("ar-YE") ?? "—", "طابور المتجر الحالي", "deliveries", "/orders" as Href) : null}
          {canOrders ? tile("طلبات ٧ أيام", data.weeklyOrderSummary?.totalOrders.toLocaleString("ar-YE") ?? "—", data.weeklyOrderSummary ? "جميع طلبات هذا المتجر المنشأة خلال الفترة، من DSH" : "تعذر قراءة ملخص المتجر الكامل", "orders", "/orders" as Href) : null}
          {canCatalog ? tile("المنتجات المتاحة", available?.toLocaleString("ar-YE") ?? "—", data.offersPartial ? "من أول 100 منتج" : "في كتالوج المتجر", "cart", "/products" as Href) : null}
          {store.owned ? tile("المستحقات المكتسبة", financialReady ? formatMoney(data.finance!.earnedMinor, "YER") : "—", financialReady ? "من ملخص التسوية الموثق" : "لم تكتمل قراءة المالية", "wallet", "/wallet" as Href) : null}
        </View>

        <View style={styles.panel}>
          <View style={styles.setupHeading}>
            <View style={styles.setupText}>
              <Text style={styles.panelTitle}>تجهيز المتجر وتشغيله</Text>
              <Text style={styles.muted}>تابع إعدادات المتجر من نفس لوحة العمل.</Text>
            </View>
            <View style={styles.progressPill}>
              <Text style={styles.progressNumber}>{progress.total ? `${progress.completed}/${progress.total}` : "—"}</Text>
              <Text style={styles.muted}>خطوات مكتملة</Text>
              {progress.unknown > 0 ? <Text style={styles.muted}>{`غير متحقق منها: ${progress.unknown}`}</Text> : null}
            </View>
          </View>
          {setupFocus ? <View style={styles.nextSetup} accessibilityLabel="توجيه إعداد المتجر">
            <View style={styles.nextSetupCopy}>
              <Text style={styles.nextSetupEyebrow}>المتابعة الآن</Text>
              <Text style={styles.nextSetupTitle}>{setupFocus.title}</Text>
              <Text style={styles.muted}>{setupFocus.detail}</Text>
            </View>
            {setupFocus.href ? <Pressable accessibilityRole="button" accessibilityLabel={"فتح: " + setupFocus.title}
              style={styles.nextSetupButton} onPress={() => { if (setupFocus.href) go(setupFocus.href as Href); }}>
              <Text style={styles.nextSetupButtonText}>متابعة</Text>
            </Pressable> : null}
          </View> : null}
          <View style={styles.setupGrid}>
            {store.owned ? action("هوية المتجر", store.publicationState === "published" ? "المتجر منشور للعملاء" : "مراجعة بيانات المتجر والنشر", "/store?section=settings" as Href, "store", store.publicationState === "published") : null}
            {canCatalog ? action("إعداد الكتالوج", data.offers === null ? "البيانات غير متاحة حاليًا" : catalogReady === null ? "لم تكتمل قراءة الكتالوج؛ راجع بقية المنتجات" : catalogReady ? "يوجد منتجات متاحة للطلب" : "راجع المنتجات والأسعار", "/products" as Href, "cart", catalogReady) : null}
            {canOperate ? action("إعدادات التشغيل", operationalKnown ? "استقبال الطلبات: " + operationalState : "تعذر قراءة حالة التشغيل", "/store?section=operations" as Href, "deliveries", operationalKnown ? operationalState === "مفتوح" : null) : null}
            {store.owned ? action("الاتفاقية التجارية", agreementReadinessMessage(commercialAgreement), "/store?section=settings" as Href, "wallet", commercialAgreement === null || commercialAgreement === "UNAVAILABLE" ? null : commercialAgreement === "ACTIVE") : null}
            {canPromotions ? action("العروض", "تحرير العروض المتاحة للمتجر", "/store?section=promotions" as Href, "offers") : null}
            {store.owned ? action("الموظفين", "دعوة الموظفين وإدارة صلاحياتهم", "/employees" as Href, "account") : null}
            {store.owned ? action("كباتن المتجر", "إدارة عضويات كباتن المتجر", "/store?section=team" as Href, "deliveries") : null}
            {canFinance ? action("المحفظة والتسويات", "ملخص وحركات الحساب المصرّح بها", "/wallet" as Href, "wallet") : null}
          </View>
        </View>

        <View style={styles.cardsRow}>
          <View style={styles.panelHalf}>
            {panelTitle("أحدث الطلبات", canOrders ? "/orders" as Href : undefined)}
            {data.recentOrders === null ? <Text style={styles.empty}>{canOrders ? "تعذر قراءة أحدث الطلبات." : "لا تملك صلاحية قراءة الطلبات."}</Text> : orders.length === 0 ? <Text style={styles.empty}>لا توجد طلبات حديثة لهذا المتجر.</Text> :
              <View style={styles.table}>
                <View style={styles.tableHeader}><Text style={styles.tableKey}>رقم الطلب</Text><Text style={styles.tableValue}>الحالة</Text><Text style={styles.tableValue}>المبلغ</Text></View>
                {orders.slice(0, 5).map(order => <Pressable accessibilityRole="button" accessibilityLabel={"فتح الطلب " + order.id} key={order.id}
                  style={styles.tableRow} onPress={() => go({ pathname: "/orders", params: { orderId: order.id } } as Href)}>
                  <Text numberOfLines={1} style={styles.tableKey}>{"#" + order.id.slice(-7)}</Text>
                  <Text numberOfLines={1} style={styles.tableValue}>{readableOrderState(order.state)}</Text>
                  <Text numberOfLines={1} style={styles.tableValue}>{formatMoney(order.totalAmountMinor, "YER")}</Text>
                </Pressable>)}
              </View>}
          </View>
          <View style={styles.panelHalf}>
            {panelTitle("المنتجات التي تحتاج متابعة", canCatalog ? "/products?filter=unavailable" as Href : undefined)}
            {data.offers === null ? <Text style={styles.empty}>{canCatalog ? "تعذر قراءة الكتالوج." : "لا تملك صلاحية قراءة الكتالوج."}</Text> : stockout.length === 0 && unavailable.length === 0 ?
              <Text style={styles.empty}>لا توجد مشاكل توفر في المنتجات التي تمت قراءتها.</Text> :
              <View style={styles.table}>
                {stockout.slice(0, 3).map(item => <Pressable key={item.offerId} accessibilityRole="button" style={styles.listItem}
                  onPress={() => go("/products?filter=stockout" as Href)}>
                  <View style={styles.productDot}><BthwaniIcon name="warning" size={18} color={theme.warning}/></View>
                  <Text style={styles.listTitle} numberOfLines={1}>{item.productName}</Text><Text style={styles.warningText}>نافد</Text>
                </Pressable>)}
                {unavailable.filter(item => !stockout.some(stock => stock.offerId === item.offerId)).slice(0, 3).map(item => <Pressable key={item.offerId}
                  accessibilityRole="button" style={styles.listItem} onPress={() => go("/products?filter=unavailable" as Href)}>
                  <View style={styles.productDot}><BthwaniIcon name="cart" size={18} color={theme.colorMuted}/></View>
                  <Text style={styles.listTitle} numberOfLines={1}>{item.productName}</Text><Text style={styles.muted}>غير متاح</Text>
                </Pressable>)}
              </View>}
          </View>
        </View>

        <View style={styles.cardsRow}>
          <View style={styles.panelHalf}>
            {panelTitle("الطلبات حسب الحالة", canOrders ? "/orders" as Href : undefined)}
            {data.recentOrders === null ? <Text style={styles.empty}>تعذر قراءة حالة الطلبات.</Text> :
              <View style={styles.statusChart}>
                <View style={styles.donut}>
                  <Text style={styles.donutCount}>{orders.length.toLocaleString("ar-YE")}</Text>
                  <Text style={styles.muted}>طلبًا في العينة</Text>
                </View>
                <View style={styles.statusLegend}>
                  {groups.map((group, i) => <View key={group.key} style={styles.legendRow}>
                    <View style={[styles.legendDot, { backgroundColor: i === 0 ? theme.brandAction : i === 1 ? theme.warning : i === 2 ? theme.info : i === 3 ? theme.actionBackground : i === 4 ? theme.success : theme.colorMuted }]} />
                    <Text style={styles.legendLabel}>{group.label}</Text>
                    <Text style={styles.legendCount}>{group.count.toLocaleString("ar-YE")}</Text>
                  </View>)}
                </View>
              </View>}
          </View>
          <View style={styles.panelHalf}>
            {panelTitle("اتجاه الطلبات الأخيرة", canOrders ? "/orders" as Href : undefined)}
            {data.recentOrders === null ? <Text style={styles.empty}>تعذر قراءة حركة الطلبات.</Text> : <View style={styles.trend}>
              <View style={styles.chartBars}>
                {recentDays.map((item, index) => <View key={item.key} style={styles.barSlot}>
                  <Text style={styles.chartCount}>{item.count > 0 ? item.count.toLocaleString("ar-YE") : ""}</Text>
                  <View style={[styles.bar, { height: Math.max(3, Math.round(item.count / maxDay * 100)), backgroundColor: index === 6 ? theme.brandAction : theme.info }]} />
                  <Text style={styles.chartDay}>{item.key.slice(-2)}</Text>
                </View>)}
              </View>
              <Text style={styles.muted}>آخر 7 أيام من الطلبات المحمّلة فقط؛ ليست إحصاءات المبيعات الشاملة.</Text>
            </View>}
          </View>
        </View>
      </View>

      <View style={styles.sideColumn}>
        <View style={styles.panel}>
          {panelTitle("يحتاج انتباهك", "/notifications" as Href)}
          {loading ? <Text style={styles.empty}>جارٍ فحص الطلبات والمخزون…</Text> : null}
          {canOrders && data.attention?.newOrders ? <Pressable style={styles.attentionItem} accessibilityRole="button" onPress={() => go("/orders" as Href)}>
            <BthwaniIcon name="notifications" color={theme.brandAction} size={19}/><View style={styles.attentionCopy}><Text style={styles.listTitle}>طلبات جديدة</Text><Text style={styles.muted}>{data.attention.newOrders.toLocaleString("ar-YE") + " تحتاج المتابعة"}</Text></View>
          </Pressable> : null}
          {canOrders && data.attention?.deliveryRecovery ? <Pressable style={styles.attentionItem} accessibilityRole="button" onPress={() => go("/orders" as Href)}>
            <BthwaniIcon name="warning" color={theme.warning} size={19}/><View style={styles.attentionCopy}><Text style={styles.listTitle}>تسليم متعثر</Text><Text style={styles.muted}>{data.attention.deliveryRecovery.toLocaleString("ar-YE") + " حالة تحتاج متابعة"}</Text></View>
          </Pressable> : null}
          {!loading && ((canOrders && data.attention === null) || (canCatalog && data.offers === null)) ? <Text style={styles.muted}>لم تُقرأ بعض البيانات؛ تحقق من الاتصال ثم افتح الصفحة مجددًا.</Text> : null}
          {!loading && data.attention && !data.attention.newOrders && !data.attention.deliveryRecovery && (!canCatalog || data.offers !== null) ? <Text style={styles.empty}>لا توجد تنبيهات طلبات عاجلة حاليًا.</Text> : null}
        </View>
        <View style={styles.panel}>
          {panelTitle("متابعة المخزون", canCatalog ? "/products?filter=stockout" as Href : undefined)}
          {data.offers === null ? <Text style={styles.empty}>لم تُقرأ بيانات المخزون.</Text> : stockout.length === 0 ?
            <Text style={styles.empty}>لا يوجد نفاد مؤكّد في المنتجات المحمّلة.</Text> :
            stockout.slice(0, 5).map(item => <Pressable key={item.offerId} accessibilityRole="button" style={styles.listItem}
              onPress={() => go("/products?filter=stockout" as Href)}>
              <View style={styles.productDot}><BthwaniIcon name="cart" color={theme.warning} size={18}/></View>
              <Text style={styles.listTitle} numberOfLines={2}>{item.productName}</Text>
              <Text style={styles.warningText}>نافد</Text>
            </Pressable>)}
          {data.offersPartial ? <Text style={styles.muted}>أول 100 منتج فقط؛ قد توجد أصناف أخرى.</Text> : null}
        </View>
        {canCatalog ? <View style={styles.panel}>
          {panelTitle("الأكثر طلبًا خلال 30 يومًا", "/products" as Href)}
          {store.publicationState !== "published" ? <Text style={styles.empty}>يظهر الترتيب بعد نشر المتجر.</Text> :
            loading ? <Text style={styles.empty}>جارٍ قراءة ترتيب المنتجات…</Text> :
            data.popularOffers === null ? <Text style={styles.empty}>تعذر قراءة الترتيب. أعد فتح الصفحة للمحاولة.</Text> :
            data.popularOffers.length === 0 ? <Text style={styles.empty}>لم تُسجل طلبات مكتملة لمنتجات متاحة خلال آخر 30 يومًا.</Text> :
            data.popularOffers.map((item, index) => <View key={item.offerId} style={styles.listItem}>
              <Text style={styles.popularRank}>{index + 1}</Text>
              <Text style={styles.listTitle} numberOfLines={2}>{item.productName}</Text>
            </View>)}
          <Text style={styles.muted}>ترتيب المنتجات المتاحة بحسب الطلبات المكتملة، وليس مبيعات مقدّرة.</Text>
        </View> : null}
        <View style={styles.panel}>
          {panelTitle("الاختصارات")}
          {canOrders ? action("إدارة الطلبات", "عرض الطلبات الحالية", "/orders" as Href, "orders") : null}
          {canCatalog ? action("تحديث المنتجات", "تعديل الأسعار والتوفر", "/products" as Href, "cart") : null}
          {canFinance ? action("عرض المحفظة", "الحركات والتسويات", "/wallet" as Href, "wallet") : null}
          {!canOrders && !canCatalog && !canFinance ? <Text style={styles.empty}>لا توجد اختصارات مصرح بها.</Text> : null}
        </View>
      </View>
    </View>
    {(data.ordersPartial || data.offersPartial) ? <Text style={styles.scopeNote}>بعض الجداول والرسوم تعرض صفحة محدودة من البيانات؛ افتح السجلات للاطلاع على بقية النتائج.</Text> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof useAppearanceTheme>) {
  return StyleSheet.create({
    root: { gap: 14 },
    columns: { flexDirection: "row", alignItems: "flex-start", gap: 16 },
    mainColumn: { flex: 1, minWidth: 0, gap: 16 },
    sideColumn: { width: 244, gap: 16 },
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
    metric: { flexGrow: 1, flexBasis: 143, minWidth: 130, minHeight: 151, padding: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 13, gap: 9, justifyContent: "space-between" },
    metricTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 7 },
    metricIcon: { width: 36, height: 36, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: theme.actionSoft },
    caption: { ...typography.caption, color: theme.colorMuted, flexShrink: 1 },
    metricValue: { ...typography.titleLg, color: theme.color, fontWeight: "800" },
    metricAccent: { height: 2, width: "100%", borderRadius: 2, backgroundColor: theme.actionSoft },
    muted: { ...typography.caption, color: theme.colorMuted },
    panel: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14, padding: 15, gap: 13 },
    panelHalf: { flex: 1, minWidth: 0, minHeight: 226, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 14, padding: 16, gap: 14 },
    panelHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 9 },
    panelTitle: { ...typography.bodyStrong, color: theme.color, fontWeight: "800" },
    action: { ...typography.caption, color: theme.brandAction, fontWeight: "800" },
    panelLink: { paddingHorizontal: 5, paddingVertical: 5 },
    empty: { ...typography.bodySm, color: theme.colorMuted, textAlign: "center", paddingVertical: 23 },
    setupHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
    setupText: { flex: 1, gap: 5 },
    progressPill: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 11, backgroundColor: theme.surfaceInset, alignItems: "center", gap: 3 },
    progressNumber: { ...typography.titleMd, color: theme.brandAction, fontWeight: "800" },
    nextSetup: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.actionSoft, borderRadius: 11, padding: 13 },
    nextSetupCopy: { flex: 1, minWidth: 210, gap: 4 },
    nextSetupEyebrow: { ...typography.caption, color: theme.interactiveText, fontWeight: "800" },
    nextSetupTitle: { ...typography.bodyStrong, color: theme.color, fontWeight: "800" },
    nextSetupButton: { minHeight: 44, paddingHorizontal: 16, justifyContent: "center", alignItems: "center", borderRadius: 9, backgroundColor: theme.actionBackground },
    nextSetupButtonText: { ...typography.bodySm, color: theme.onAction, fontWeight: "800" },
    setupGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
    setupAction: { flexGrow: 1, flexBasis: 178, minWidth: 160, minHeight: 66, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10, backgroundColor: theme.surfaceInset, flexDirection: "row", alignItems: "center", gap: 8 },
    setupIcon: { width: 32, height: 32, borderRadius: 9, backgroundColor: theme.actionSoft, alignItems: "center", justifyContent: "center" },
    setupCopy: { flex: 1, minWidth: 0, gap: 3 },
    setupLabel: { ...typography.bodySm, color: theme.color, fontWeight: "700" },
    cardsRow: { flexDirection: "row", gap: 13 },
    table: { gap: 2 },
    tableHeader: { flexDirection: "row", paddingVertical: 9, backgroundColor: theme.surfaceInset, borderRadius: 6 },
    tableRow: { flexDirection: "row", paddingVertical: 11, borderBottomWidth: 1, borderColor: theme.borderColor, alignItems: "center" },
    tableKey: { ...typography.caption, color: theme.color, flex: 1.1, minWidth: 0, paddingHorizontal: 5, fontWeight: "700" },
    tableValue: { ...typography.caption, color: theme.colorMuted, flex: 1, minWidth: 0, paddingHorizontal: 4 },
    listItem: { flexDirection: "row", gap: 8, alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderColor: theme.borderColor },
    popularRank: { ...typography.bodySm, color: theme.interactiveText, minWidth: 22, fontWeight: "800", textAlign: "center" },
    productDot: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: theme.surfaceInset },
    listTitle: { ...typography.bodySm, color: theme.color, fontWeight: "700", flex: 1, minWidth: 0 },
    warningText: { ...typography.caption, color: theme.warning, fontWeight: "800" },
    statusChart: { flexDirection: "row", alignItems: "center", gap: 10, justifyContent: "center", flex: 1 },
    donut: { width: 122, height: 122, borderWidth: 11, borderColor: theme.actionSoft, borderRadius: 80, justifyContent: "center", alignItems: "center", gap: 4 },
    donutCount: { ...typography.titleLg, fontWeight: "800", color: theme.color },
    statusLegend: { flex: 1, gap: 7 },
    legendRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendDot: { width: 8, height: 8, borderRadius: 4 },
    legendLabel: { ...typography.caption, color: theme.colorMuted, flex: 1 },
    legendCount: { ...typography.caption, color: theme.color, fontWeight: "800" },
    trend: { flex: 1, gap: 12, justifyContent: "flex-end" },
    chartBars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-around", minHeight: 152, borderBottomWidth: 1, borderColor: theme.borderColor, gap: 3 },
    barSlot: { flex: 1, maxWidth: 46, alignItems: "center", justifyContent: "flex-end", height: 145, gap: 5 },
    bar: { width: "50%", minWidth: 9, maxWidth: 28, borderTopLeftRadius: 5, borderTopRightRadius: 5 },
    chartCount: { ...typography.caption, color: theme.colorMuted, height: 15 },
    chartDay: { ...typography.caption, color: theme.colorMuted, fontSize: 10 },
    attentionItem: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderColor: theme.borderColor, backgroundColor: theme.surfaceInset, padding: 12, borderRadius: 9 },
    attentionCopy: { flex: 1, gap: 4 },
    scopeNote: { ...typography.caption, color: theme.colorMuted },
  });
}
