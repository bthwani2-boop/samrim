import { type resolveTheme, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, type MobileIconName, useAppearanceTheme } from "@bthwani/design-system/native";
import { joiningCaseStateLabel } from "@bthwani/dsh";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { currentIdentityState } from "../../bootstrap/identity";
import { agreementReadinessMessage, ownStoreAgreementReadiness, type StoreAgreementReadback } from "../partner-onboarding/store-agreement-readiness";
import { readOwnStoreCommercialAgreements } from "../partner-onboarding/store-commercial-agreement-client";
import { usePartnerStoreScope } from "../partner-onboarding/partner-store-scope-context";
import { PartnerStoreScopeSelector } from "../partner-onboarding/partner-store-scope-selector";
import { readOwnJoiningCase } from "../partner-onboarding/store-readback-client";

type AccountReadback = Readonly<{
  scope: string;
  joining: string;
  agreement: StoreAgreementReadback;
  joiningError: boolean;
}>;

function AccountLink({ label, description, icon, href }: Readonly<{
  label: string;
  description: string;
  icon: MobileIconName;
  href: Href;
}>) {
  const router = useRouter();
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return <Pressable accessibilityRole="button" accessibilityLabel={label + "، " + description}
    style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]} onPress={() => router.push(href)}>
    <View style={styles.actionIcon}><BthwaniIcon name={icon} size={20} color={theme.brandAction} /></View>
    <View style={styles.actionText}>
      <Text style={styles.actionTitle}>{label}</Text>
      <Text style={styles.actionDescription}>{description}</Text>
    </View>
    <BthwaniIcon name="back" color={theme.colorMuted} size={17} />
  </Pressable>;
}

/** Existing DSH/WLT readbacks; no separate account, KYC or money state is created here. */
export function PartnerAccountEssentials({ showStoreSelector = false }: Readonly<{ showStoreSelector?: boolean }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const { selectedStore, stores, state } = usePartnerStoreScope();
  const identity = currentIdentityState();
  const actor = identity.kind === "authenticated" ? identity.identity.subject : "";
  const storeId = selectedStore?.id ?? "";
  const owner = Boolean(actor && selectedStore?.owned);
  const canFinance = Boolean(selectedStore && (selectedStore.owned ||
    selectedStore.permissions.includes("finance_read") || selectedStore.permissions.includes("payout_request")));
  const [readback, setReadback] = useState<AccountReadback | null>(null);
  const [retry, setRetry] = useState(0);
  const scope = actor + ":" + storeId + ":" + retry;

  useFocusEffect(useCallback(() => {
    let active = true;
    setReadback(null);
    if (!owner) return () => { active = false; };
    const isCurrent = () => {
      const next = currentIdentityState();
      return active && next.kind === "authenticated" && next.identity.subject === actor;
    };
    void Promise.allSettled([readOwnJoiningCase(), readOwnStoreCommercialAgreements(storeId)]).then(([joining, agreement]) => {
      if (!isCurrent()) return;
      const caseValue = joining.status === "fulfilled" ? joining.value.case : null;
      // The first-store joining case does not certify another Store owned by the same actor.
      const sameStore = caseValue?.store?.id === storeId;
      setReadback({
        scope,
        joining: sameStore ? joiningCaseStateLabel(caseValue.state) :
          caseValue ? "حالة هذا المتجر غير متاحة من ملف الانضمام الأول" : "تعذر قراءة حالة ملف الانضمام",
        joiningError: joining.status === "rejected",
        agreement: agreement.status === "fulfilled" ?
          ownStoreAgreementReadiness(agreement.value, storeId, actor) : "UNAVAILABLE",
      });
    });
    return () => { active = false; };
  }, [actor, owner, scope, storeId]));

  const current = readback?.scope === scope ? readback : null;
  const joiningDescription = !owner ? "هذه البيانات متاحة لمالك المتجر فقط" :
    current ? current.joining : "جارٍ التحقق من ملف الانضمام";
  const agreementDescription = current ? agreementReadinessMessage(current.agreement) : "جارٍ التحقق من الاتفاقية";

  return <View style={styles.section} accessibilityLabel="خدمات حساب الشريك">
    <Text accessibilityRole="header" style={styles.title}>حسابي · خدمات المتجر</Text>
    <Text style={styles.helper}>البيانات من ملف الانضمام والاتفاقية والمحفظة المعتمدة، وتختلف حسب المتجر وصلاحيات الحساب.</Text>
    {showStoreSelector && stores.length > 1 ? <PartnerStoreScopeSelector /> : null}
    {state.kind === "error" ? <Text accessibilityRole="alert" style={styles.notice}>تعذر تحميل المتاجر؛ أعد المحاولة من مساحة العمل.</Text> : null}
    {!selectedStore ? <AccountLink label="طلب انضمام متجر" icon="store"
      description="متابعة الانضمام وبيانات النشاط" href={"/onboarding" as Href} /> : null}
    {selectedStore ? <>
      <Text style={styles.storeLabel}>{selectedStore.name}</Text>
      {owner ? <>
        <AccountLink label="ملف الانضمام والمراجعة" icon="store" description={joiningDescription}
          href={"/onboarding" as Href} />
        <AccountLink label="الاتفاقية التجارية" icon="account" description={agreementDescription}
          href={{ pathname: "/store", params: { section: "settings", returnTo: "account" } } as Href} />
        {current?.joiningError || current?.agreement === "UNAVAILABLE" ? <View style={styles.noticePanel}>
          <Text accessibilityRole="alert" style={styles.notice}>تعذر التحقق من بعض حالات الحساب؛ لم تُفترض الموافقة أو التفعيل.</Text>
          <BthwaniButton label="إعادة قراءة الحالة" variant="secondary" onPress={() => setRetry(value => value + 1)} />
        </View> : null}
      </> : <Text style={styles.helper}>إدارة ملف الانضمام والاتفاقية التجارية محفوظة لمالك المتجر.</Text>}
      {canFinance ? <AccountLink label="المحفظة والتسويات" icon="wallet"
        description="الرصيد المستحق وسجل الحركات وفق الصلاحيات" href={"/wallet" as Href} /> : null}
    </> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    section: { gap: 10, paddingVertical: 12 },
    title: { ...typography.titleSm, color: theme.color, fontWeight: "800", textAlign: "right" },
    helper: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right", writingDirection: "rtl" },
    storeLabel: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    action: { minHeight: 70, borderRadius: 13, backgroundColor: theme.surface, borderWidth: 1,
      borderColor: theme.borderColor, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
    actionIcon: { height: 40, width: 40, borderRadius: 11, backgroundColor: theme.actionSoft,
      alignItems: "center", justifyContent: "center" },
    actionText: { flex: 1, minWidth: 0, gap: 4 },
    actionTitle: { ...typography.bodyStrong, color: theme.color, textAlign: "right" },
    actionDescription: { ...typography.caption, color: theme.colorMuted, textAlign: "right", writingDirection: "rtl" },
    noticePanel: { padding: 11, gap: 9, borderWidth: 1, borderRadius: 12,
      backgroundColor: theme.surface, borderColor: theme.warning },
    notice: { ...typography.bodySm, color: theme.warning, textAlign: "right" },
  });
}
