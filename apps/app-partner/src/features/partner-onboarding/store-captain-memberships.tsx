import { BthwaniButton, BthwaniConfirmDialog, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCaptainMembership } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { createOwnStoreCaptainInvitation, listOwnStoreCaptainMemberships, transitionOwnStoreCaptainMembership } from "./store-readback-client";

type MembershipState = { kind: "loading" } | { kind: "ready"; memberships: ReadonlyArray<StoreCaptainMembership> } | { kind: "error" };

function storeCaptainMembershipStatusLabel(state: StoreCaptainMembership["state"]): string {
  switch (state) {
    case "pending": return "بانتظار قبول الدعوة";
    case "expired": return "انتهت الدعوة";
    case "active": return "عضوية مفعّلة";
    case "suspended": return "عضوية موقوفة";
    default: return "عضوية ملغاة";
  }
}

function storeCaptainMembershipExpiryLabel(membership: StoreCaptainMembership): string {
  switch (membership.state) {
    case "pending": return ` · تنتهي الدعوة في ${new Date(membership.expiresAt).toLocaleDateString("ar-YE")}`;
    case "expired": return ` · انتهت في ${new Date(membership.expiresAt).toLocaleDateString("ar-YE")}`;
    default: return "";
  }
}

export function StoreCaptainMembershipManagement({ storeID, showForm = true }: { storeID: string; showForm?: boolean }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [state, setState] = useState<MembershipState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRevoke, setPendingRevoke] = useState<StoreCaptainMembership | null>(null);

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    setError("");
    try {
      const result = await listOwnStoreCaptainMemberships(storeID);
      setState({ kind: "ready", memberships: result.memberships });
    } catch {
      setState({ kind: "error" });
      setError("تعذر قراءة عضويات كباتن المتجر.");
    }
  }, [storeID]);

  useEffect(() => { void reload(); }, [reload]);

  async function createInvitation() {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await createOwnStoreCaptainInvitation(storeID, { phoneE164: phone.trim(), displayNameAr: displayName.trim() });
      const latest = await listOwnStoreCaptainMemberships(storeID);
      setState({ kind: "ready", memberships: latest.memberships });
      if (!latest.memberships.some((member) => member.id === result.membership.id && member.state === "pending")) {
        setError("لم تتأكد الدعوة بعد. راجع قائمة الفريق قبل إعادة المحاولة.");
      } else {
        setDisplayName("");
        setPhone("");
        setNotice("تم إنشاء حساب الكابتن ودعوته. ينتظر تأكيد رقم الهاتف وقبول الارتباط.");
      }
    } catch {
      await reload();
      setError("تعذر إنشاء الدعوة. أعد قراءة القائمة قبل المحاولة مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function transition(membership: StoreCaptainMembership, nextState: "active" | "suspended" | "revoked") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await transitionOwnStoreCaptainMembership(storeID, membership.id, nextState, membership.version);
      await reload();
    } catch {
      await reload();
      setError("تغيرت حالة العضوية أو تعذر تأكيدها. أعد قراءة القائمة ثم حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  const archivedCount = state.kind === "ready" ? state.memberships.filter((item) => item.state === "revoked" || item.state === "expired").length : 0;
  const visibleMembers = state.kind === "ready" ? state.memberships.filter((item) => showHistory || (item.state !== "revoked" && item.state !== "expired")) : [];
  return (
    <View style={styles.card}>
      <Text style={styles.value}>كباتن المتجر</Text>
      {showForm ? <View style={{ gap: 8 }}>
        <TextInput accessibilityLabel="اسم الكابتن" placeholder="اسم الكابتن" value={displayName} onChangeText={setDisplayName} editable={!busy} placeholderTextColor={theme.colorMuted} style={styles.formInput} />
        <TextInput accessibilityLabel="هاتف الكابتن" placeholder="رقم الهاتف" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!busy} placeholderTextColor={theme.colorMuted} style={[styles.formInput, { textAlign: "left", writingDirection: "ltr" }]} />
        <BthwaniButton busy={busy} disabled={busy || !displayName.trim() || !phone.trim()} label="إنشاء الكابتن" onPress={() => void createInvitation()} />
      </View> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة العضويات…</Text></View> : null}
      {state.kind === "error" ? <BthwaniButton disabled={busy} label="إعادة قراءة العضويات" onPress={() => void reload()} variant="secondary" /> : null}
      {state.kind === "ready" && state.memberships.length === 0 ? <Text style={styles.muted}>لا توجد دعوات أو عضويات لهذا المتجر.</Text> : null}
      {state.kind === "ready" ? visibleMembers.map((membership) => {
        const statusLabel = storeCaptainMembershipStatusLabel(membership.state);
        const expiryLabel = storeCaptainMembershipExpiryLabel(membership);
        return <View key={membership.id} style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
          <Text style={styles.value}>{membership.captainActorId ? [membership.displayNameAr?.trim() || membership.captainNameAr?.trim() || "كابتن المتجر", membership.captainPhoneMasked?.trim()].filter(Boolean).join(" · ") : membership.displayNameAr?.trim() || (membership.state === "pending" ? "بانتظار قبول الكابتن" : "كابتن المتجر")}</Text>
          <Text style={styles.muted}>{statusLabel}{expiryLabel}</Text>
          {membership.state === "active" ? <>
            <BthwaniButton disabled={busy} label="إيقاف العضوية" onPress={() => void transition(membership, "suspended")} variant="secondary" />
            <BthwaniButton disabled={busy} label="إلغاء العضوية" onPress={() => setPendingRevoke(membership)} variant="secondary" />
          </> : null}
          {membership.state === "suspended" ? <>
            <BthwaniButton disabled={busy} label="إعادة تفعيل العضوية" onPress={() => void transition(membership, "active")} />
            <BthwaniButton disabled={busy} label="إلغاء العضوية" onPress={() => setPendingRevoke(membership)} variant="secondary" />
          </> : null}
          {membership.state === "pending" || membership.state === "expired" ? <BthwaniButton disabled={busy} label="إلغاء الدعوة" onPress={() => setPendingRevoke(membership)} variant="secondary" /> : null}
        </View>;
      }) : null}
      {archivedCount > 0 ? <Pressable accessibilityRole="button" accessibilityState={{ expanded: showHistory }} onPress={() => setShowHistory((value) => !value)}>
        <Text style={styles.muted}>{showHistory ? "إخفاء السجل" : "سجل العضويات السابقة (" + archivedCount + ")"}</Text>
      </Pressable> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniConfirmDialog
        busy={busy}
        confirmLabel={pendingRevoke?.state === "pending" || pendingRevoke?.state === "expired" ? "إلغاء الدعوة" : "إلغاء العضوية"}
        description={pendingRevoke
          ? pendingRevoke.state === "pending" || pendingRevoke.state === "expired"
            ? "ستُلغى دعوة كابتن المتجر ولن يمكن قبولها بعد ذلك."
            : `ستُلغى عضوية ${pendingRevoke.captainNameAr?.trim() || pendingRevoke.captainPhoneMasked?.trim() || "كابتن المتجر"} نهائيًا من هذا المتجر، وسيلزم إنشاء دعوة جديدة لإعادته.`
          : ""}
        intent="danger"
        onCancel={() => setPendingRevoke(null)}
        onConfirm={() => {
          const membership = pendingRevoke;
          setPendingRevoke(null);
          if (membership) void transition(membership, "revoked");
        }}
        title={pendingRevoke?.state === "pending" || pendingRevoke?.state === "expired" ? "تأكيد إلغاء الدعوة" : "تأكيد إلغاء العضوية"}
        visible={Boolean(pendingRevoke)}
      />
    </View>
  );
}
