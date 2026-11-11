import { isDefinitiveDshMobileClientRejection, type IndependentCustomerPolicyDraft, type IndependentCustomerPolicyDraftInput } from "@bthwani/dsh";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, TextInput, View } from "react-native";

import { currentIdentityState, subscribeIdentitySession } from "../../bootstrap/identity";
import { createPartnerSurfaceStyles } from "./partner-surface-styles";
import { partnerSetupSessionKey } from "./partner-setup-session-scope";
import { readOwnIndependentCustomerPolicyDraft, saveOwnIndependentCustomerPolicyDraft } from "./store-readback-client";

type Terms = Pick<IndependentCustomerPolicyDraftInput, "cancellationTerms" | "returnsTerms" | "fulfillmentTerms" | "collectionTerms">;
type ReadState = { kind: "loading" } | { kind: "error" } | { kind: "ready"; policy: IndependentCustomerPolicyDraft };
type Pending = Readonly<{ input: IndependentCustomerPolicyDraftInput; key: string; correlation: string }>;

const blank: Terms = { cancellationTerms: "", returnsTerms: "", fulfillmentTerms: "", collectionTerms: "" };
const fromPolicy = (policy: IndependentCustomerPolicyDraft): Terms => ({
  cancellationTerms: policy.cancellationTerms, returnsTerms: policy.returnsTerms,
  fulfillmentTerms: policy.fulfillmentTerms, collectionTerms: policy.collectionTerms,
});
const sameTerms = (policy: IndependentCustomerPolicyDraft, input: IndependentCustomerPolicyDraftInput) =>
  policy.cancellationTerms === input.cancellationTerms && policy.returnsTerms === input.returnsTerms &&
  policy.fulfillmentTerms === input.fulfillmentTerms && policy.collectionTerms === input.collectionTerms;

export function PartnerIndependentCustomerPolicyDraftEditor({ storeID }: Readonly<{ storeID: string }>) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createPartnerSurfaceStyles(theme), [theme]);
  const [state, setState] = useState<ReadState>({ kind: "loading" });
  const [draft, setDraft] = useState<Terms>(blank);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [reload, setReload] = useState(0);
  const requestGeneration = useRef(0);
  // A synchronous guard is required: React busy state does not block two taps in one render.
  const savingGeneration = useRef<number | null>(null);
  const sessionScope = useRef(partnerSetupSessionKey(currentIdentityState()));

  useEffect(() => subscribeIdentitySession(next => {
    const scope = partnerSetupSessionKey(next);
    if (scope === sessionScope.current) return;
    sessionScope.current = scope;
    requestGeneration.current += 1;
    savingGeneration.current = null;
    setState({ kind: "loading" });
    setDraft(blank);
    setPending(null);
    setNotice("");
    setBusy(false);
    setReload(value => value + 1);
  }), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Manual reload and identity revision intentionally reread the same Store policy.
  useEffect(() => {
    const generation = ++requestGeneration.current;
    savingGeneration.current = null;
    setBusy(false);
    const scope = partnerSetupSessionKey(currentIdentityState());
    const stillCurrent = () => generation === requestGeneration.current &&
      scope !== "" && scope === partnerSetupSessionKey(currentIdentityState());
    setState({ kind: "loading" });
    setNotice("");
    void readOwnIndependentCustomerPolicyDraft(storeID).then(response => {
      if (!stillCurrent()) return;
      if (response.draftOnly !== true || response.policy.storeId !== storeID) {
        setState({ kind: "error" });
        return;
      }
      setDraft(fromPolicy(response.policy));
      setState({ kind: "ready", policy: response.policy });
      setPending(null);
    }).catch(() => { if (stillCurrent()) setState({ kind: "error" }); });
    return () => { requestGeneration.current += 1; };
  }, [storeID, reload]);

  function edit(key: keyof Terms, value: string) {
    setDraft(current => ({ ...current, [key]: value }));
    setPending(null);
    setNotice("");
  }

  async function save() {
    if (busy || savingGeneration.current !== null || state.kind !== "ready") return;
    const scope = partnerSetupSessionKey(currentIdentityState());
    if (!scope) return;
    const input: IndependentCustomerPolicyDraftInput = {
      expectedVersion: pending?.input.expectedVersion ?? state.policy.version,
      cancellationTerms: draft.cancellationTerms.trim(), returnsTerms: draft.returnsTerms.trim(),
      fulfillmentTerms: draft.fulfillmentTerms.trim(), collectionTerms: draft.collectionTerms.trim(),
    };
    if (Object.values(input).some(value => typeof value === "string" && (Array.from(value).length < 2 || Array.from(value).length > 4000))) {
      setNotice("كل سياسة تحتاج نصًا واضحًا لا يقل عن حرفين ولا يزيد على ٤٠٠٠ حرف.");
      return;
    }
    const attempt: Pending = pending ?? { input, key: Crypto.randomUUID(), correlation: Crypto.randomUUID() };
    const generation = ++requestGeneration.current;
    savingGeneration.current = generation;
    const stillCurrent = () => generation === requestGeneration.current &&
      scope === partnerSetupSessionKey(currentIdentityState());
    setBusy(true);
    setPending(attempt);
    setNotice("");
    let definitivelyRejected = false;
    try {
      await saveOwnIndependentCustomerPolicyDraft(storeID, attempt.input, attempt.key, attempt.correlation);
    } catch (cause) {
      // Network loss or a 5xx may follow a committed write; a definitive 4xx cannot be treated as saved.
      definitivelyRejected = isDefinitiveDshMobileClientRejection(cause);
    }
    if (definitivelyRejected) {
      if (stillCurrent()) {
        setPending(null);
        setNotice("رفض DSH حفظ مسودة السياسات. حدّث بيانات المتجر وراجع الصلاحية أو أي تعديل متزامن قبل المحاولة مجددًا.");
      }
      if (savingGeneration.current === generation) savingGeneration.current = null;
      if (stillCurrent()) setBusy(false);
      return;
    }
    // An Identity switch may happen while the PUT is in flight. Never read the
    // old Store using the newly authenticated Partner's bearer.
    if (!stillCurrent()) {
      if (savingGeneration.current === generation) savingGeneration.current = null;
      return;
    }
    try {
      const result = await readOwnIndependentCustomerPolicyDraft(storeID);
      if (!stillCurrent()) return;
      if (result.draftOnly !== true || result.policy.storeId !== storeID) throw new Error("POLICY_SCOPE_CHANGED");
      const policy = result.policy;
      setState({ kind: "ready", policy });
      if (policy.version >= attempt.input.expectedVersion + 1 &&
          policy.reviewState === "NOT_CHECKED" && sameTerms(policy, attempt.input)) {
        setDraft(fromPolicy(policy));
        setPending(null);
        setNotice("تم حفظ مسودة السياسات والتحقق منها. لم تُعتمد للنشر بعد.");
      } else {
        setPending(null);
        setDraft(fromPolicy(policy));
        setNotice("تغيّرت المسودة أو لم يُثبت الحفظ. راجع القيم الحالية قبل إعادة المحاولة.");
      }
    } catch {
      if (stillCurrent()) setNotice("تعذّر تأكيد الحفظ. أعد المحاولة دون تغيير الحقول لاستخدام المفتاح نفسه.");
    } finally {
      if (savingGeneration.current === generation) savingGeneration.current = null;
      if (stillCurrent()) setBusy(false);
    }
  }

  const valid = (Object.values(draft) as string[]).every(value => {
    const len = Array.from(value.trim()).length;
    return len >= 2 && len <= 4000;
  });
  const changed = state.kind === "ready" && !sameTerms(state.policy, {
    ...draft, expectedVersion: state.policy.version,
    cancellationTerms: draft.cancellationTerms.trim(), returnsTerms: draft.returnsTerms.trim(),
    fulfillmentTerms: draft.fulfillmentTerms.trim(), collectionTerms: draft.collectionTerms.trim(),
  });
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={styles.sectionTitle}>سياسات التعامل مع العميل</Text>
    <Text style={styles.muted}>هذه مسودة خاصة بمالك المتجر المستقل. حفظها لا يعني الموافقة أو نشر المتجر أو تفعيل الطلبات.</Text>
    {state.kind === "loading" ? <Text style={styles.muted}>جارٍ قراءة السياسات من المتجر...</Text> : null}
    {state.kind === "error" ? <>
      <Text accessibilityRole="alert" style={styles.error}>تعذرت قراءة السياسات. لم تُعرض بيانات مفترضة.</Text>
      <BthwaniButton label="إعادة القراءة" variant="secondary" onPress={() => setReload(value => value + 1)} />
    </> : null}
    {state.kind === "ready" ? <>
      <Text style={styles.muted}>إصدار المسودة: {state.policy.version} · حالة المراجعة: {state.policy.reviewState === "PASSED" ? "راجعتها الإدارة" : state.policy.reviewState === "REJECTED" ? "تحتاج تصحيحًا" : "بانتظار المراجعة"}</Text>
      {([
        ["cancellationTerms", "سياسة الإلغاء", "متى يمكن للعميل إلغاء الطلب وكيف يتم التعامل معه؟"],
        ["returnsTerms", "سياسة الإرجاع", "ما شروط الإرجاع أو الاستبدال؟"],
        ["fulfillmentTerms", "طريقة تجهيز وتسليم الطلب", "اشرح الاستلام من المتجر أو توصيل التاجر."],
        ["collectionTerms", "طريقة دفع العميل للتاجر", "اشرح متى وكيف يسدد العميل للتاجر مباشرة."],
      ] as const).map(([key, label, placeholder]) => (
        <View key={key} style={{ gap: 4 }}>
          <Text style={styles.metaLabel}>{label}</Text>
          <TextInput
            accessibilityLabel={label} value={draft[key]} editable={!busy} maxLength={4000}
            multiline numberOfLines={3} textAlign="right" textAlignVertical="top"
            placeholder={placeholder} placeholderTextColor={theme.colorMuted}
            style={[styles.formInput, { minHeight: 88 }]} onChangeText={value => edit(key, value)}
          />
        </View>
      ))}
      <BthwaniButton label={busy ? "جارٍ التحقق من الحفظ..." : pending ? "إعادة محاولة حفظ المسودة" : "حفظ مسودة السياسات"}
        disabled={busy || !valid || (!pending && !changed)} onPress={() => void save()} />
      <BthwaniButton label="تحديث من المتجر" disabled={busy || Boolean(pending)} variant="secondary" onPress={() => setReload(value => value + 1)} />
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.muted}>{notice}</Text> : null}
    </> : null}
  </View>;
}
