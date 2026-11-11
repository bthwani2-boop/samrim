import type { StorePublicContact } from "@bthwani/dsh";
import { spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, BthwaniIcon, useAppearanceTheme } from "@bthwani/design-system/native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { buildPublicContactActions } from "./store-public-contact-actions";
import { readStorePublicContact } from "./store-discovery-client";
import { storeReadFailureKind } from "./store-read-state";

type ContactRead =
  | { scopeKey: string; kind: "ready"; contact: StorePublicContact }
  | { scopeKey: string; kind: "error" | "unavailable" };

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
    message: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
  }), [theme]);
  const [retry, setRetry] = useState(0);
  const scopeKey = JSON.stringify([storeID, retry]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const [read, setRead] = useState<ContactRead | null>(null);
  const [openError, setOpenError] = useState("");

  useEffect(() => {
    let active = true;
    setRead(null);
    setOpenError("");
    void readStorePublicContact(storeID).then(result => {
      if (!active || activeScope.current !== scopeKey) return;
      if (result.contact.storeId === storeID) setRead({ scopeKey, kind: "ready", contact: result.contact });
      else setRead({ scopeKey, kind: "error" });
    }).catch((cause) => {
      if (active && activeScope.current === scopeKey) setRead({ scopeKey, kind: storeReadFailureKind(cause) === "unavailable" ? "unavailable" : "error" });
    });
    return () => { active = false; };
  }, [scopeKey, storeID]);

  // Never render another Store's contact during a route or retry transition.
  const current = read?.scopeKey === scopeKey ? read : null;
  if (!current || current.kind === "unavailable") return null;
  const actions = current.kind === "ready" ? buildPublicContactActions(current.contact) : [];
  if (current.kind === "ready" && !actions.length) return null;

  return <View style={styles.card} accessibilityLabel="قنوات التواصل الرسمية للمتجر">
    <Text style={styles.title}>التواصل مع المتجر</Text>
    {current.kind === "error" ? <>
      <Text accessibilityRole="alert" style={styles.message}>تعذر قراءة وسائل التواصل. تحقق من الاتصال وأعد المحاولة.</Text>
      <BthwaniButton label="إعادة قراءة وسائل التواصل" variant="secondary" onPress={() => setRetry(value => value + 1)} />
    </> : <View style={styles.actions}>
      {actions.map(action => <Pressable key={action.label} accessibilityRole="link" accessibilityLabel={action.label}
        style={({ pressed }) => [styles.action, pressed && { opacity: 0.75 }]}
        onPress={() => {
          setOpenError("");
          void Linking.openURL(action.href).catch(() => {
            if (activeScope.current === scopeKey) setOpenError(scopeKey);
          });
        }}>
        <BthwaniIcon name={action.icon} color={theme.interactiveText} size={17}/>
        <Text style={styles.label}>{action.label}</Text>
      </Pressable>)}
    </View>}
    {openError === scopeKey ? <Text accessibilityRole="alert" style={styles.message}>
      تعذر فتح وسيلة التواصل. أعد المحاولة أو استخدم وسيلة أخرى.
    </Text> : null}
  </View>;
}
