import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { isDefinitiveDshMobileClientRejection, type StorePublicContact, type StorePublicContactInput } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch, Text, TextInput, View } from "react-native";
import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { readPartnerStoreContact, savePartnerStoreContact } from "./store-readback-client";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; contact: StorePublicContact };
type Draft = Pick<StorePublicContactInput, "phoneE164" | "email" | "whatsappPhoneE164" | "whatsappEnabled">;
type Pending = Readonly<{ input: StorePublicContactInput; key: string; correlation: string }>;

const empty: Draft = { phoneE164: "", email: "", whatsappPhoneE164: "", whatsappEnabled: false };
const fromContact = (value: StorePublicContact): Draft => ({
  phoneE164: value.phoneE164, email: value.email,
  whatsappPhoneE164: value.whatsappPhoneE164, whatsappEnabled: value.whatsappEnabled,
});
const same = (contact: StorePublicContact, input: StorePublicContactInput) =>
  contact.phoneE164 === input.phoneE164 && contact.email === input.email &&
  contact.whatsappPhoneE164 === input.whatsappPhoneE164 && contact.whatsappEnabled === input.whatsappEnabled;

export function PartnerStorePublicContact({ storeID }: Readonly<{ storeID: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [draft, setDraft] = useState<Draft>(empty);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const requestGeneration = useRef(0);
  const savingGeneration = useRef<number | null>(null);
  const sessionScope = useRef(partnerSetupSessionKey(currentIdentityState()));

  useEffect(() => subscribeIdentitySession(next => {
    const scope = partnerSetupSessionKey(next);
    if (scope === sessionScope.current) return;
    sessionScope.current = scope;
    requestGeneration.current += 1;
    savingGeneration.current = null;
    setState({ kind: "loading" });
    setDraft(empty);
    setPending(null);
    setMessage("");
    setBusy(false);
    setReloadToken(value => value + 1);
  }), []);

  useFocusEffect(useCallback(() => {
    // Re-run the canonical read when the user explicitly retries.
    void reloadToken;
    let active = true;
    const generation = ++requestGeneration.current;
    const scope = partnerSetupSessionKey(currentIdentityState());
    const stillCurrent = () => active && generation === requestGeneration.current &&
      scope !== "" && scope === partnerSetupSessionKey(currentIdentityState());
    setState({ kind: "loading" });
    setMessage("");
    setPending(null);
    if (scope) {
      void readPartnerStoreContact(storeID).then(({ contact }) => {
        if (!stillCurrent()) return;
        if (contact.storeId !== storeID) { setState({ kind: "error" }); return; }
        setState({ kind: "ready", contact });
        setDraft(fromContact(contact));
      }).catch(() => { if (stillCurrent()) setState({ kind: "error" }); });
    } else setState({ kind: "error" });
    return () => { active = false; requestGeneration.current += 1; };
  }, [storeID, reloadToken]));

  const edit = (patch: Partial<Draft>) => {
    setDraft(value => ({ ...value, ...patch }));
    setPending(null);
    setMessage("");
  };

  const save = async () => {
    if (busy || savingGeneration.current !== null || state.kind !== "ready" || state.contact.storeId !== storeID) return;
    const scope = partnerSetupSessionKey(currentIdentityState());
    if (!scope) return;
    const input: StorePublicContactInput = {
      phoneE164: draft.phoneE164.trim(), email: draft.email.trim(),
      whatsappPhoneE164: draft.whatsappPhoneE164.trim(), whatsappEnabled: draft.whatsappEnabled,
      expectedVersion: pending?.input.expectedVersion ?? state.contact.version,
    };
    const phoneValid = (value: string) => !value || /^\+[1-9][0-9]{7,14}$/.test(value);
    if (!phoneValid(input.phoneE164) || !phoneValid(input.whatsappPhoneE164) ||
        (input.whatsappEnabled && !input.whatsappPhoneE164) ||
        (input.email && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email))) {
      setMessage("تحقق من أرقام التواصل الدولية والبريد الإلكتروني، ورقم واتساب عند تفعيله.");
      return;
    }
    const attempt = pending ?? { input, key: Crypto.randomUUID(), correlation: Crypto.randomUUID() };
    const generation = ++requestGeneration.current;
    savingGeneration.current = generation;
    const stillCurrent = () => generation === requestGeneration.current &&
      scope === partnerSetupSessionKey(currentIdentityState());
    setBusy(true);
    setPending(attempt);
    setMessage("");
    let definitivelyRejected = false;
    try {
      await savePartnerStoreContact(storeID, attempt.input, attempt.key, attempt.correlation);
    } catch (cause) {
      // Network loss or a 5xx may follow a committed write; a definitive 4xx cannot be treated as saved.
      definitivelyRejected = isDefinitiveDshMobileClientRejection(cause);
    }
    if (definitivelyRejected) {
      if (stillCurrent()) {
        setPending(null);
        setMessage("رفضت الخدمة التغيير. حدّث بيانات المتجر وراجع الصلاحية أو أي تعديل متزامن قبل المحاولة مجددًا.");
      }
      if (savingGeneration.current === generation) savingGeneration.current = null;
      if (stillCurrent()) setBusy(false);
      return;
    }
    // Never fetch the previous Store with a newly switched actor's credentials.
    if (!stillCurrent()) {
      if (savingGeneration.current === generation) savingGeneration.current = null;
      return;
    }
    try {
      const { contact } = await readPartnerStoreContact(storeID);
      if (!stillCurrent()) return;
      if (contact.storeId !== storeID) throw new Error("STORE_CONTACT_SCOPE_CHANGED");
      setState({ kind: "ready", contact });
      if (same(contact, attempt.input) && contact.version >= attempt.input.expectedVersion + 1) {
        setDraft(fromContact(contact));
        setPending(null);
        setMessage("تم حفظ بيانات التواصل والتحقق من حالتها في المتجر.");
      } else {
        setMessage("تغيّرت بيانات المتجر أو لم يُثبت الحفظ. راجع القيم قبل إعادة المحاولة.");
        setPending(null);
      }
    } catch {
      if (stillCurrent()) setMessage("لم يمكن تأكيد نتيجة الحفظ. استخدم إعادة المحاولة بنفس التغيير دون تغيير الحقول.");
    } finally {
      if (savingGeneration.current === generation) savingGeneration.current = null;
      if (stillCurrent()) setBusy(false);
    }
  };

  return <View style={styles.card}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>بيانات التواصل العامة</Text>
    <Text style={styles.muted}>هذه بيانات المتجر التي تختار إظهارها للعملاء، وليست رقم صاحب الحساب أو بيانات الانضمام الخاصة.</Text>
    {state.kind === "loading" ? <Text style={styles.muted}>جارٍ قراءة بيانات التواصل...</Text> : null}
    {state.kind === "error" ? <>
      <Text accessibilityRole="alert" style={styles.error}>تعذرت قراءة إعدادات التواصل. لم تُعرض بيانات مفترضة.</Text>
      <BthwaniButton label="إعادة المحاولة" variant="secondary" onPress={() => setReloadToken(value => value + 1)} />
    </> : null}
    {state.kind === "ready" ? <>
      <Text style={styles.metaLabel}>رقم المتجر العام (اختياري)</Text>
      <TextInput accessibilityLabel="رقم المتجر العام" style={styles.formInput} value={draft.phoneE164}
        editable={!busy} keyboardType="phone-pad" autoCapitalize="none" placeholder="+967..." onChangeText={phoneE164 => edit({ phoneE164 })}/>
      <Text style={styles.metaLabel}>البريد الإلكتروني العام (اختياري)</Text>
      <TextInput accessibilityLabel="بريد المتجر العام" style={styles.formInput} value={draft.email}
        editable={!busy} keyboardType="email-address" autoCapitalize="none" placeholder="store@example.com" onChangeText={email => edit({ email })}/>
      <Text style={styles.metaLabel}>رقم واتساب للأعمال (اختياري)</Text>
      <TextInput accessibilityLabel="واتساب المتجر" style={styles.formInput} value={draft.whatsappPhoneE164}
        editable={!busy} keyboardType="phone-pad" autoCapitalize="none" placeholder="+967..." onChangeText={whatsappPhoneE164 => edit({ whatsappPhoneE164 })}/>
      <View style={styles.headerRow}>
        <Text style={styles.value}>إظهار زر التواصل عبر واتساب للعملاء</Text>
        <Switch accessibilityLabel="إظهار واتساب للمتجر" disabled={busy} value={draft.whatsappEnabled}
          onValueChange={whatsappEnabled => edit({ whatsappEnabled })}/>
      </View>
      <BthwaniButton label={busy ? "جارٍ حفظ البيانات..." : pending ? "إعادة محاولة الحفظ" : "حفظ بيانات التواصل"}
        disabled={busy} onPress={() => void save()}/>
      <BthwaniButton label="تحديث بيانات التواصل من المتجر" variant="secondary" disabled={busy}
        onPress={() => setReloadToken(value => value + 1)} />
      {message ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{message}</Text> : null}
    </> : null}
  </View>;
}
