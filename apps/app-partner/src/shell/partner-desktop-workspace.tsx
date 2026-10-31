import { brandRoots, brandScale, spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, type MobileIconName, useAppearanceTheme } from "@bthwani/design-system/native";
import { type Href, useGlobalSearchParams, usePathname, useRouter } from "expo-router";
import { type PropsWithChildren, useEffect, useMemo, useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";

import { usePartnerStoreScope } from "../features/partner-onboarding/partner-store-scope-context";
import { buildPartnerStorefrontURL } from "../features/partner-onboarding/partner-storefront-url";
import { PartnerNotificationsHeaderAction } from "../features/notifications/partner-notifications-header-action";

type WorkspaceLink = Readonly<{
  label: string;
  href: Href;
  icon: MobileIconName;
  section?: string;
  marketingView?: "overview" | "offers" | "campaigns" | "content";
  performanceView?: "overview" | "orders" | "catalog";
}>;

const SIDEBAR_WIDTH = 256;

/** Desktop workspace only. Mobile retains its native tab navigation. */
export function PartnerDesktopWorkspace({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  if (Platform.OS !== "web" || width < 1024) return <>{children}</>;
  return <DesktopWorkspace>{children}</DesktopWorkspace>;
}

function DesktopWorkspace({ children }: PropsWithChildren) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useGlobalSearchParams<{ section?: string | string[]; panel?: string | string[]; filter?: string | string[]; view?: string | string[] }>();
  const theme = useAppearanceTheme();
  const { authority, selectedStore, state } = usePartnerStoreScope();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const activeSection = Array.isArray(query.section) ? query.section[0] : query.section;
  const activePanel = Array.isArray(query.panel) ? query.panel[0] : query.panel;
  const activeFilter = Array.isArray(query.filter) ? query.filter[0] : query.filter;
  const activeMarketingView = Array.isArray(query.view) ? query.view[0] : query.view;
  const [expandedGroups, setExpandedGroups] = useState({ catalog: true, marketing: true, performance: true, management: true });
  const [copyMessage, setCopyMessage] = useState("");
  const storefrontLink = selectedStore ? buildPartnerStorefrontURL(selectedStore, process.env.EXPO_PUBLIC_CLIENT_WEB_ORIGIN, __DEV__) : null;
  useEffect(() => { if (selectedStore?.id) setCopyMessage(""); }, [selectedStore?.id]);
  const permissions = selectedStore?.permissions ?? [];
  const isOwner = Boolean(selectedStore?.owned);
  const can = (permission: string) => isOwner || permissions.includes(permission as typeof permissions[number]);

  const mainLinks: WorkspaceLink[] = [{ label: "الرئيسية", href: "/more" as Href, icon: "home" }];
  if (authority.canUse("orders")) mainLinks.push({ label: "الطلبات", href: "/orders", icon: "orders" });
  if (authority.canUse("employees")) mainLinks.push({ label: "الموظفين", href: "/employees" as Href, icon: "account" });

  const catalogLinks: WorkspaceLink[] = [];
  if (authority.canUse("products")) {
    catalogLinks.push({ label: "جميع المنتجات", href: "/products" as Href, icon: "cart" });
    catalogLinks.push({ label: "نفاد المخزون", href: "/products?filter=stockout" as Href, icon: "warning", section: "stockout" });
    catalogLinks.push({ label: "المنتجات غير المتاحة", href: "/products?filter=unavailable" as Href, icon: "store", section: "unavailable" });
    catalogLinks.push({ label: "الاستيراد والتصدير والأسعار", href: "/products?panel=tools" as Href, icon: "categories", section: "tools" });
  }

  const marketingLinks: WorkspaceLink[] = can("promotions") ? [
    { label: "نظرة تسويقية", href: "/store?section=promotions&view=overview" as Href, icon: "trending", section: "promotions", marketingView: "overview" },
    { label: "العروض والقسائم", href: "/store?section=promotions&view=offers" as Href, icon: "offers", section: "promotions", marketingView: "offers" },
    { label: "حملات المنصة", href: "/store?section=promotions&view=campaigns" as Href, icon: "success", section: "promotions", marketingView: "campaigns" },
    { label: "مقاطع المتجر", href: "/store?section=promotions&view=content" as Href, icon: "play", section: "promotions", marketingView: "content" },
  ] : [];
  const performanceLinks: WorkspaceLink[] = [
    { label: "نظرة عامة", href: "/insights?view=overview" as Href, icon: "trending", performanceView: "overview" },
    ...(can("orders") ? [{ label: "تقرير الطلبات", href: "/insights?view=orders" as Href, icon: "orders" as const, performanceView: "orders" as const }] : []),
    ...(can("catalog") ? [{ label: "تقرير المنتجات والمخزون", href: "/insights?view=catalog" as Href, icon: "cart" as const, performanceView: "catalog" as const }] : []),
    ...(authority.canUse("wallet") ? [{ label: can("finance_read") ? "الكشف المالي والتسويات" : can("payout_request") ? "طلبات صرف المستحقات" : "المحفظة والتسويات", href: "/wallet" as Href, icon: "wallet" as const }] : []),
  ];
  const utilityLinks: WorkspaceLink[] = [{ label: "الإشعارات", href: "/notifications" as Href, icon: "notifications" }];

  const management: WorkspaceLink[] = [];
  if (authority.canUse("store")) {
    if (can("store_operations")) management.push({ label: "التشغيل", href: "/store?section=operations" as Href, icon: "store", section: "operations" });
    if (isOwner) management.push({ label: "ملف المتجر والاتفاقيات", href: "/store?section=settings" as Href, icon: "edit", section: "settings" });
    if (isOwner) management.push({ label: "كباتن المتجر", href: "/store?section=team" as Href, icon: "deliveries", section: "team" });
  }
  if (state.kind === "ready" && !selectedStore) management.push({ label: "تجهيز المتجر", href: "/onboarding" as Href, icon: "store" });

  const renderLink = (item: WorkspaceLink, nested = false) => {
    const href = String(item.href);
    const path = href.split("?")[0];
    const selected = pathname === path && (
      path === "/store" ? activeSection === item.section && (!item.marketingView || (activeMarketingView ?? "overview") === item.marketingView) :
      path === "/insights" ? (activeMarketingView ?? "overview") === (item.performanceView ?? "overview") :
      path === "/products" ? (item.section === "tools" ? activePanel === "tools"
        : item.section === "stockout" || item.section === "unavailable"
          ? activePanel !== "tools" && activeFilter === item.section
          : activePanel !== "tools" && activeFilter !== "stockout" && activeFilter !== "unavailable") : true
    );
    return <Pressable
      key={href}
      accessibilityRole="link"
      accessibilityLabel={item.label}
      accessibilityState={{ selected }}
      onPress={() => {
        // Stack detail destinations must be pushed; tabs remain single-instance navigation.
        if (path === "/insights" && pathname === "/insights") router.setParams({ view: item.performanceView ?? "overview" });
        else if (path === "/store" || path === "/account" || path === "/employees" || path === "/insights" || path === "/onboarding" || path === "/notifications") router.push(item.href);
        else router.navigate(item.href);
      }}
      style={({ pressed }) => [styles.navItem, nested && styles.navChild, selected && styles.navActive, pressed && styles.navPressed]}
    >
      <BthwaniIcon name={item.icon} size={20} color={selected ? brandRoots.brandTurquoise : brandScale.structure[200]} />
      <Text style={[styles.navText, selected && styles.navTextActive]}>{item.label}</Text>
    </Pressable>;
  };

  const renderGroup = (group: "catalog" | "marketing" | "performance" | "management", label: string, icon: MobileIconName, links: WorkspaceLink[]) => {
    const expanded = expandedGroups[group];
    const hasActiveChild = links.some((item) => {
      const route = String(item.href).split("?")[0];
      return route === pathname && (route === "/insights" ? (activeMarketingView ?? "overview") === (item.performanceView ?? "overview") : route !== "/store" || (activeSection === item.section && (!item.marketingView || (activeMarketingView ?? "overview") === item.marketingView)));
    });
    return <View key={group} style={styles.navGroupContainer}>
      <Pressable accessibilityRole="button" accessibilityLabel={label} aria-expanded={expanded}
        accessibilityState={{ expanded }} onPress={() => setExpandedGroups(current => ({ ...current, [group]: !current[group] }))}
        style={({ pressed }) => [styles.groupButton, hasActiveChild && styles.groupActive, pressed && styles.navPressed]}>
        <BthwaniIcon name={icon} size={20} color={brandScale.structure[100]} />
        <Text style={styles.groupTitle}>{label}</Text>
        <Text style={styles.groupArrow}>{expanded ? "⌄" : "‹"}</Text>
      </Pressable>
      {expanded ? <View style={styles.subnav}>{links.map(item => renderLink(item, true))}</View> : null}
    </View>;
  };

  return <View style={styles.workspace}>
    <View style={styles.main}>
      <View style={styles.topbar}>
        <View style={styles.topbarIdentity}>
          <Text accessibilityRole="header" style={styles.topbarTitle}>مساحة الشريك</Text>
          <Text style={styles.topbarSubtitle} numberOfLines={1}>{selectedStore?.name ?? "إدارة حساب الشريك"}</Text>
        </View>
        <View style={styles.topbarActions}>
          {authority.canUse("products") ? <Pressable accessibilityRole="button" accessibilityLabel="البحث في المنتجات" style={styles.topbarButton}
            onPress={() => router.navigate("/products?focus=search" as Href)}>
            <BthwaniIcon name="search" color={theme.color} size={20}/>
          </Pressable> : null}
          <PartnerNotificationsHeaderAction/>
          <Pressable accessibilityRole="button" accessibilityLabel="فتح الحساب والإعدادات" style={styles.topbarButton}
            onPress={() => router.push("/account" as Href)}>
            <BthwaniIcon name="account" color={theme.color} size={21}/>
          </Pressable>
        </View>
      </View>
      {children}
    </View>
    <View style={styles.sidebar} accessibilityLabel="التنقل الرئيسي للشريك">
      <View style={styles.brand}>
        <View style={styles.brandIcon}><BthwaniIcon name="store" size={24} color={brandRoots.surfaceBase} /></View>
        <View style={styles.brandText}>
          <Text style={styles.brandTitle}>بثواني</Text>
          <Text style={styles.brandSubtitle}>مساحة الشريك</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.navigation} showsVerticalScrollIndicator={false}>
        <Text style={styles.navGroup}>مساحة العمل</Text>
        {mainLinks.map(item => renderLink(item))}
        {catalogLinks.length > 0 ? renderGroup("catalog", "الكتالوج", "categories", catalogLinks) : null}
        {marketingLinks.length > 0 ? renderGroup("marketing", "التسويق", "offers", marketingLinks) : null}
        {renderGroup("performance", "الأداء والتقارير", "trending", performanceLinks)}
        {utilityLinks.map(item => renderLink(item))}
        {management.length > 0 ? <>
          <View style={styles.divider} />
          {renderGroup("management", "إدارة المتجر", "store", management)}
        </> : null}
      </ScrollView>
      <View style={styles.footer}>
        <View style={styles.divider} />
        {selectedStore ? <Pressable accessibilityRole="button"
          accessibilityLabel={storefrontLink ? (storefrontLink.previewOnly ? "نسخ رابط معاينة المتجر" : "نسخ رابط المتجر") : "رابط المتجر غير متاح"}
          accessibilityState={{ disabled: !storefrontLink }}
          disabled={!storefrontLink}
          onPress={() => {
            if (!storefrontLink) return;
            void Clipboard.setStringAsync(storefrontLink.url)
              .then(() => setCopyMessage(storefrontLink.previewOnly ? "تم نسخ رابط المعاينة المحلية." : "تم نسخ رابط المتجر."))
              .catch(() => setCopyMessage("تعذر نسخ الرابط؛ حاول مجددًا."));
          }}
          style={({pressed}) => [styles.storefrontCopy, !storefrontLink && styles.storefrontUnavailable, pressed && styles.navPressed]}>
          <BthwaniIcon name="store" size={18} color={brandRoots.brandStructure} />
          <Text style={styles.storefrontCopyText}>{storefrontLink ? (storefrontLink.previewOnly ? "نسخ رابط المعاينة" : "نسخ رابط المتجر") : "رابط المتجر غير متاح"}</Text>
        </Pressable> : null}
        {copyMessage ? <Text accessibilityLiveRegion="polite" style={styles.storefrontFeedback}>{copyMessage}</Text> : null}
        {renderLink({ label: "الحساب والإعدادات", href: "/account", icon: "account" })}
      </View>
    </View>
  </View>;
}

function createStyles(theme: ReturnType<typeof useAppearanceTheme>) {
  return StyleSheet.create({
    workspace: { flex: 1, backgroundColor: theme.background },
    topbar: { backgroundColor: theme.surface, borderBottomColor: theme.borderColor, borderBottomWidth: 1, minHeight: 62, paddingHorizontal: spacing[5], flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
    topbarIdentity: { flex: 1, minWidth: 0, gap: 3 },
    topbarTitle: { ...typography.bodyStrong, color: theme.color, fontWeight: "800" },
    topbarSubtitle: { ...typography.caption, color: theme.colorMuted },
    topbarActions: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
    topbarButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, backgroundColor: theme.surfaceInset },
    main: { flex: 1, paddingRight: SIDEBAR_WIDTH, minWidth: 0 },
    sidebar: { position: "absolute", top: 0, bottom: 0, right: 0, width: SIDEBAR_WIDTH, backgroundColor: brandRoots.brandStructure, borderLeftColor: brandScale.structure[700], borderLeftWidth: 1 },
    brand: { minHeight: 92, paddingHorizontal: spacing[4], flexDirection: "row", alignItems: "center", gap: spacing[3] },
    brandIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: theme.brandAction, alignItems: "center", justifyContent: "center" },
    brandText: { flex: 1, gap: 3 },
    brandTitle: { ...typography.titleMd, color: brandRoots.surfaceBase, fontWeight: "800" },
    brandSubtitle: { ...typography.caption, color: brandScale.structure[200] },
    navigation: { paddingHorizontal: spacing[3], paddingBottom: spacing[4], gap: 4 },
    navGroup: { ...typography.caption, color: brandScale.structure[200], fontWeight: "700", paddingVertical: spacing[3], paddingHorizontal: spacing[2] },
    navItem: { minHeight: 46, paddingHorizontal: spacing[3], flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: 12 },
    navActive: { backgroundColor: brandScale.structure[500] },
    navChild: { minHeight: 40, paddingHorizontal: spacing[2] },
    navGroupContainer: { gap: 3 },
    groupButton: { minHeight: 46, paddingHorizontal: spacing[3], flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: 12 },
    groupActive: { backgroundColor: brandScale.structure[600] },
    groupTitle: { ...typography.bodySm, color: brandRoots.surfaceBase, fontWeight: "800", flex: 1 },
    groupArrow: { ...typography.bodyStrong, color: brandScale.structure[200] },
    subnav: { paddingRight: spacing[4], gap: 2 },
    navPressed: { opacity: 0.75 },
    navText: { ...typography.bodySm, color: brandScale.structure[100], fontWeight: "600", flex: 1 },
    navTextActive: { color: brandRoots.surfaceBase, fontWeight: "800" },
    divider: { height: 1, backgroundColor: brandScale.structure[500], marginVertical: spacing[2] },
    footer: { paddingHorizontal: spacing[3], paddingBottom: spacing[4], gap: spacing[2] },
    storefrontCopy: { minHeight: 44, backgroundColor: theme.surface, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing[2], paddingHorizontal: 9 },
    storefrontUnavailable: { opacity: 0.65 },
    storefrontCopyText: { ...typography.bodySm, color: brandRoots.brandStructure, fontWeight: "800" },
    storefrontFeedback: { ...typography.caption, color: brandRoots.surfaceBase, textAlign: "center" },
  });
}
