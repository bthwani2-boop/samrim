import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import type { StoreCaptainMembership } from "@bthwani/dsh";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
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

export function StoreCaptainMembershipManagement({ storeID }: { storeID: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [state, setState] = useState<MembershipState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invitationCode, setInvitationCode] = useState("");

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
    setInvitationCode("");
    try {
      const result = await createOwnStoreCaptainInvitation(storeID);
      setInvitationCode(result.invitationCode ?? "");
      await reload();
      if (!result.invitationCode) setError("تعذر استعادة رمز الدعوة السابق. ألغِ الدعوة المعلّقة وأنشئ رمزًا جديدًا.");
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

  return (
    <View style={styles.card}>
      <Text style={styles.value}>كباتن المتجر</Text>
      <Text style={styles.muted}>أرسل الدعوة إلى كابتن لديه حساب مُفعّل. هذه العضوية مرتبطة بهذا المتجر ولا تضيفه إلى إسناد كباتن بثواني.</Text>
      <BthwaniButton busy={busy} disabled={busy} label="إنشاء رمز دعوة" onPress={() => void createInvitation()} />
      {invitationCode ? <View style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 6, padding: 12 }}>
        <Text style={styles.metaLabel}>رمز لمرة واحدة — أرسله للكابتن المقصود</Text>
        <Text selectable style={{ ...styles.value, textAlign: "center", writingDirection: "ltr" }}>{invitationCode}</Text>
      </View> : null}
      {state.kind === "loading" ? <View style={styles.state}><ActivityIndicator color={theme.actionBackground} /><Text style={styles.muted}>جارٍ قراءة العضويات…</Text></View> : null}
      {state.kind === "error" ? <BthwaniButton disabled={busy} label="إعادة قراءة العضويات" onPress={() => void reload()} variant="secondary" /> : null}
      {state.kind === "ready" && state.memberships.length === 0 ? <Text style={styles.muted}>لا توجد دعوات أو عضويات لهذا المتجر.</Text> : null}
      {state.kind === "ready" ? state.memberships.map((membership) => {
        const statusLabel = storeCaptainMembershipStatusLabel(membership.state);
        const expiryLabel = storeCaptainMembershipExpiryLabel(membership);
        return <View key={membership.id} style={{ borderColor: theme.borderColor, borderRadius: 12, borderWidth: 1, gap: 8, padding: 12 }}>
          <Text style={styles.value}>{membership.captainActorId ? "ارتبط بحساب كابتن" : "لم تُقبل الدعوة بعد"}</Text>
          <Text style={styles.muted}>{statusLabel}{expiryLabel}</Text>
          {membership.state === "active" ? <>
            <BthwaniButton disabled={busy} label="إيقاف العضوية" onPress={() => void transition(membership, "suspended")} variant="secondary" />
            <BthwaniButton disabled={busy} label="إلغاء العضوية" onPress={() => void transition(membership, "revoked")} variant="secondary" />
          </> : null}
          {membership.state === "suspended" ? <>
            <BthwaniButton disabled={busy} label="إعادة تفعيل العضوية" onPress={() => void transition(membership, "active")} />
            <BthwaniButton disabled={busy} label="إلغاء العضوية" onPress={() => void transition(membership, "revoked")} variant="secondary" />
          </> : null}
          {membership.state === "pending" || membership.state === "expired" ? <BthwaniButton disabled={busy} label="إلغاء الدعوة" onPress={() => void transition(membership, "revoked")} variant="secondary" /> : null}
        </View>;
      }) : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <BthwaniButton disabled={busy} label="تحديث القائمة" onPress={() => void reload()} variant="secondary" />
    </View>
  );
}
