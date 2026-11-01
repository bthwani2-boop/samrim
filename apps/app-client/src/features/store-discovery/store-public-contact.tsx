import type { StorePublicContact } from "@bthwani/dsh";
import { spacing, typography } from "@bthwani/design-system";
import { BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { readStorePublicContact } from "./store-discovery-client";

export function StorePublicContactCard({ storeID }: Readonly<{ storeID: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.surface, borderRadius: 12, borderColor: theme.borderColor,
      borderWidth: 1, padding: spacing[3], gap: spacing[2] },
    title: { ...typography.bodyStrong, color: theme.color },
    actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
    action: { borderColor: theme.borderColor, borderWidth: 1, borderRadius: 9,
      paddingHorizontal: spacing[3], minHeight: 44, alignItems: "center", flexDirection: "row", gap: spacing[2] },
    label: { ...typography.bodySm, color: theme.interactiveText },
  }), [theme]);
  const [contact, setContact] = useState<StorePublicContact | null>(null);

  useEffect(() => {
    let active = true;
    setContact(null);
    void readStorePublicContact(storeID).then(result => {
      if (active && result.contact.storeId === storeID) setContact(result.contact);
    }).catch(() => { if (active) setContact(null); });
    return () => { active = false; };
  }, [storeID]);

  if (!contact) return null;
  const actions = [
    ...(contact.phoneE164 ? [{ label: "اتصال بالمتجر", href: "tel:" + contact.phoneE164, icon: "account" as const }] : []),
    ...(contact.email ? [{ label: "مراسلة المتجر", href: "mailto:" + encodeURIComponent(contact.email), icon: "notifications" as const }] : []),
    ...(contact.whatsappEnabled && /^\+[1-9][0-9]{7,14}$/.test(contact.whatsappPhoneE164)
      ? [{ label: "واتساب المتجر", href: "https://wa.me/" + contact.whatsappPhoneE164.slice(1), icon: "account" as const }] : []),
  ];
  if (!actions.length) return null;
  return <View style={styles.card} accessibilityLabel="قنوات التواصل الرسمية للمتجر">
    <Text style={styles.title}>التواصل مع المتجر</Text>
    <View style={styles.actions}>
      {actions.map(action => <Pressable key={action.label} accessibilityRole="link" accessibilityLabel={action.label}
        style={({ pressed }) => [styles.action, pressed && { opacity: 0.75 }]}
        onPress={() => void Linking.openURL(action.href).catch(() => {})}>
        <BthwaniIcon name={action.icon} color={theme.interactiveText} size={17}/>
        <Text style={styles.label}>{action.label}</Text>
      </Pressable>)}
    </View>
  </View>;
}
