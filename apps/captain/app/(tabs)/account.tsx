import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useCaptainWorkspace } from "../../src/features/access/protected-route";

const preferences = [["system", "حسب النظام"], ["light", "فاتح"], ["dark", "داكن"]] as const;

export default function CaptainAccountRoute() {
  const { theme, preference, setPreference, ready } = useMobileAppearance();
  const workspace = useCaptainWorkspace();
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function changePreference(next: typeof preference) {
    if (!workspace || !ready || saving.current) return;
    saving.current = true;
    setPending(true);
    setFailed(false);
    try {
      await setPreference(next);
    } catch {
      setFailed(true);
    } finally {
      saving.current = false;
      setPending(false);
    }
  }

  if (!workspace) return null;
  const approved = workspace.standing?.actorId === workspace.session.actorId &&
    workspace.standing.status === "APPROVED" &&
    Number.isSafeInteger(workspace.standing.version) && workspace.standing.version > 0;
  const disabled = pending || !ready;

  const expires = new Intl.DateTimeFormat("ar", { dateStyle: "medium", timeStyle: "short" })
    .format(new Date(workspace.session.sessionExpiresAt));
  return (
    <SafeAreaView edges={["top", "left", "right"]} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 28, fontWeight: "700" }}>حسابي</Text>
        <View style={{ gap: 10, padding: 16, borderRadius: 14, borderWidth: 1,
          backgroundColor: theme.surface, borderColor: theme.borderColor }}>
          {approved ? (
            <Text style={{ color: theme.successText, fontWeight: "700" }}>حساب الكابتن معتمد</Text>
          ) : (
            <Text accessibilityRole="alert" style={{ color: theme.warningText }}>تعذّر التحقق من اعتماد الكابتن.</Text>
          )}
          <Text style={{ color: theme.colorSecondary }}>تنتهي الجلسة الحالية في {expires}</Text>
        </View>
        <View style={{ gap: 10, padding: 16, borderRadius: 14, borderWidth: 1,
          backgroundColor: theme.surface, borderColor: theme.borderColor }}>
          <Text accessibilityRole="header" style={{ color: theme.color, fontSize: 18, fontWeight: "700" }}>مظهر التطبيق</Text>
          <Text style={{ color: theme.colorSecondary }}>تفضيل المظهر على هذا الجهاز</Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="مظهر التطبيق"
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {preferences.map(([value, label]) => {
              const selected = value === preference;
              return (
                <Pressable key={value} accessibilityRole="radio" accessibilityLabel={label}
                  accessibilityState={{ checked: selected, disabled }} disabled={disabled}
                  onPress={() => changePreference(value)}
                  style={{ backgroundColor: selected ? theme.actionSoft : theme.surface,
                    borderWidth: 1, borderColor: selected ? theme.interactiveText : theme.borderColor,
                    borderRadius: 10, minHeight: 48, paddingHorizontal: 14, justifyContent: "center",
                    opacity: disabled ? 0.55 : 1 }}>
                  <Text style={{ color: selected ? theme.interactiveText : theme.color, fontWeight: "600" }}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          {pending ? <Text accessibilityLiveRegion="polite" style={{ color: theme.colorSecondary }}>جارٍ حفظ المظهر…</Text> : null}
          {failed ? <Text accessibilityRole="alert" style={{ color: theme.dangerText }}>تعذّر حفظ المظهر. حاول مجددًا.</Text> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={workspace.signOut}
          style={{ minHeight: 48, paddingHorizontal: 14, justifyContent: "center", alignSelf: "flex-start",
            borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor }}>
          <Text style={{ color: theme.dangerText, fontWeight: "700" }}>تسجيل الخروج</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
