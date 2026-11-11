import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import { type DiscoveryContentAnalyticsListResponse, type DiscoveryContentView, type OperatorDiscoveryContentRegistryResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { createPartnerDshClient } from "../../bootstrap/dsh-client";
import { currentIdentityState, getUsableIdentityAccessToken, subscribeIdentitySession } from "../../bootstrap/identity";
import { partnerSetupSessionKey } from "../partner-onboarding/partner-setup-session-scope";

type Reel = DiscoveryContentView;
type ReelTargetType = "STORE" | "PRODUCT" | "PROMOTION";
type ReelTarget = Readonly<{ targetType: "PRODUCT" | "PROMOTION"; targetId: string; label: string }>;
const targetLabels: Record<ReelTargetType, string> = { STORE: "المتجر", PRODUCT: "منتج", PROMOTION: "عرض" };
const currentPartnerSessionKey = () => partnerSetupSessionKey(currentIdentityState());
const baseUrl = () => {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return url;
};
function statusLabel(value: Reel["state"]): string {
  return value === "DRAFT" ? "بانتظار مراجعة بثواني" :
    value === "PUBLISHED" ? "منشور" : value === "PAUSED" ? "موقوف" : "غير نشط";
}

export function PartnerStoreReels({ storeId, storeName }: { storeId: string; storeName: string }) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const sessionKey = useSyncExternalStore(subscribeIdentitySession, currentPartnerSessionKey, () => "");
  const scopeKey = JSON.stringify([sessionKey, storeId]);
  const activeScope = useRef(scopeKey);
  activeScope.current = scopeKey;
  const scopeCurrent = () => Boolean(sessionKey) && activeScope.current === scopeKey && currentPartnerSessionKey() === sessionKey;
  const [items, setItems] = useState<ReadonlyArray<Reel>>([]);
  const [targets, setTargets] = useState<ReadonlyArray<ReelTarget>>([]);
  const [targetType, setTargetType] = useState<ReelTargetType>("STORE");
  const [targetId, setTargetId] = useState(storeId);
  const [targetSearch, setTargetSearch] = useState("");
  const [file, setFile] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [caption, setCaption] = useState("");
  const [rights, setRights] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [listError, setListError] = useState("");
  const [targetsError, setTargetsError] = useState("");
  const [analyticsID, setAnalyticsID] = useState("");
  const [analytics, setAnalytics] = useState<DiscoveryContentAnalyticsListResponse | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [readScope, setReadScope] = useState("");
  const [analyticsScope, setAnalyticsScope] = useState("");
  const [feedbackScope, setFeedbackScope] = useState("");
  const [draftScope, setDraftScope] = useState(scopeKey);
  const [busyScope, setBusyScope] = useState("");
  const readRequest = useRef(0);
  const analyticsRequest = useRef(0);
  const uploadRequest = useRef(0);
  const uploadBusyScope = useRef("");
  // Preserve one server idempotency key across retries of the same draft.
  const attempt = useRef<{ fingerprint: string; contentId: string; idempotencyKey: string; correlationId: string; startsAt: string } | null>(null);

  const read = useCallback(async () => {
    const request = ++readRequest.current;
    const valid = () => Boolean(sessionKey) && activeScope.current === scopeKey &&
      currentPartnerSessionKey() === sessionKey && readRequest.current === request;
    if (!valid()) return;
    setLoading(true);
    try {
      const token = await getUsableIdentityAccessToken();
      if (!valid()) return;
      const prefix = `${baseUrl()}/dsh/partner/stores/${encodeURIComponent(storeId)}`;
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      const [list, destinations] = await Promise.allSettled([
        (async () => {
          const response = await fetch(`${prefix}/discovery-content`, { headers });
          if (!response.ok) throw new Error("REELS_LIST_READ_FAILED");
          return response.json() as Promise<OperatorDiscoveryContentRegistryResponse>;
        })(),
        (async () => {
          const response = await fetch(`${prefix}/discovery-targets`, { headers });
          if (!response.ok) throw new Error("REELS_TARGETS_READ_FAILED");
          return response.json() as Promise<{ targets: ReadonlyArray<ReelTarget> }>;
        })(),
      ]);
      if (!valid()) return;
      setItems(list.status === "fulfilled" ? list.value.items : []);
      setTargets(destinations.status === "fulfilled" ? destinations.value.targets : []);
      setReadScope(scopeKey);
      setListError(list.status === "fulfilled" ? "" : "تعذر قراءة مقاطع المتجر. أعد المحاولة.");
      setTargetsError(destinations.status === "fulfilled" ? "" : "تعذر قراءة وجهات المقاطع. يمكن متابعة المقاطع الحالية.");
    } catch {
      if (!valid()) return;
      setItems([]);
      setTargets([]);
      setReadScope(scopeKey);
      setListError("تعذر قراءة مقاطع المتجر. تحقق من الاتصال.");
      setTargetsError("تعذر قراءة وجهات المقاطع. تحقق من الاتصال.");
    } finally {
      if (valid()) setLoading(false);
    }
  }, [scopeKey, sessionKey, storeId]);

  const loadAnalytics = async (contentID: string) => {
    if (!scopeCurrent()) return;
    const request = ++analyticsRequest.current;
    const valid = () => scopeCurrent() && analyticsRequest.current === request;
    setAnalyticsScope(scopeKey);
    setAnalyticsID(contentID);
    setAnalytics(null);
    setAnalyticsError("");
    setAnalyticsLoading(true);
    try {
      const token = await getUsableIdentityAccessToken();
      if (!valid()) return;
      const result = await createPartnerDshClient()
        .listPartnerStoreContentAnalytics(token, storeId, contentID);
      if (valid()) setAnalytics(result);
    } catch {
      if (valid()) setAnalyticsError("تعذر قراءة نتائج هذا المقطع؛ أعد المحاولة.");
    } finally {
      if (valid()) setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    setTargetType("STORE");
    setTargetId(storeId);
    setTargetSearch("");
    setFile(null);
    setCaption("");
    setRights(false);
    setDraftScope(scopeKey);
    setFeedbackScope("");
    setBusyScope("");
    uploadBusyScope.current = "";
    setBusy(false);
    setMessage("");
    setItems([]);
    setTargets([]);
    setReadScope("");
    setAnalyticsID("");
    setAnalytics(null);
    setAnalyticsScope("");
    setListError("");
    setTargetsError("");
    setLoading(Boolean(sessionKey));
    analyticsRequest.current++;
    attempt.current = null;
    void read();
    return () => {
      readRequest.current++;
      analyticsRequest.current++;
      uploadRequest.current++;
    };
  }, [read, scopeKey, sessionKey, storeId]);
  const selectKind = (kind: ReelTargetType) => {
    setTargetType(kind);
    setTargetId(kind === "STORE" ? storeId : "");
    setTargetSearch("");
    attempt.current = null;
  };
  const visibleItems = readScope === scopeKey && scopeCurrent() ? items : [];
  const visibleTargets = (readScope === scopeKey && scopeCurrent() ? targets : [])
    .filter(item => item.targetType === targetType)
    .filter(item => !targetSearch.trim() || item.label.toLocaleLowerCase().includes(targetSearch.trim().toLocaleLowerCase())).slice(0, 8);
  const visibleFile = draftScope === scopeKey && scopeCurrent() ? file : null;
  const visibleBusy = busyScope === scopeKey && scopeCurrent() && busy;
  const visibleMessage = feedbackScope === scopeKey && scopeCurrent() ? message : "";
  const visibleListError = readScope === scopeKey && scopeCurrent() ? listError : "";
  const visibleTargetsError = readScope === scopeKey && scopeCurrent() ? targetsError : "";
  const visibleLoading = scopeCurrent() && (loading || readScope !== scopeKey);
  const showingAnalytics = analyticsScope === scopeKey && scopeCurrent();

  const choose = async () => {
    if (visibleBusy || !scopeCurrent()) return;
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ["video/mp4"], copyToCacheDirectory: true,
      });
      if (!scopeCurrent() || selected.canceled || !selected.assets[0]) return;
      const value = selected.assets[0];
      setFeedbackScope(scopeKey);
      if (!value.size || value.size > 10 * 1024 * 1024) {
        setMessage("الحد الأقصى 10 ميجابايت. اختر فيديو مضغوطًا.");
        return;
      }
      if (value.mimeType !== "video/mp4") {
        setMessage("يدعم هذا القسم مقاطع MP4 فقط.");
        return;
      }
      setFile(value);
      setDraftScope(scopeKey);
      attempt.current = null;
      setMessage("");
    } catch {
      if (scopeCurrent()) {
        setFeedbackScope(scopeKey);
        setMessage("تعذر اختيار الوسيط.");
      }
    }
  };

  const submit = async () => {
    const selectedFile = visibleFile;
    if (!scopeCurrent() || uploadBusyScope.current === scopeKey || !selectedFile ||
      !caption.trim() || !rights || !targetId) return;
    const request = ++uploadRequest.current;
    const valid = () => scopeCurrent() && uploadRequest.current === request;
    uploadBusyScope.current = scopeKey;
    setBusyScope(scopeKey);
    setFeedbackScope(scopeKey);
    setBusy(true);
    setMessage("");
    try {
      const token = await getUsableIdentityAccessToken();
      if (!valid()) return;
      const mime = selectedFile.mimeType ?? "video/mp4";
      const fingerprint = [storeId, targetType, targetId, selectedFile.uri, selectedFile.size, caption.trim()].join(":");
      if (!attempt.current || attempt.current.fingerprint !== fingerprint) {
        attempt.current = {
          fingerprint,
          contentId: `content-${Crypto.randomUUID()}`,
          idempotencyKey: Crypto.randomUUID(),
          correlationId: Crypto.randomUUID(),
          startsAt: new Date().toISOString(),
        };
      }
      const input = new FormData();
      input.append("id", attempt.current.contentId);
      input.append("kind", "SHORT_FORM");
      input.append("titleAr", caption.trim());
      input.append("targetType", targetType);
      input.append("targetId", targetId);
      input.append("startsAt", attempt.current.startsAt);
      input.append("ordinal", "0");
      input.append("creator", storeName);
      input.append("sourceDescription", "محتوى أصلي مقدم من المتجر");
      input.append("rightsStatement", "أؤكد امتلاك المتجر حقوق نشر هذا الفيديو وعرضه في بثواني.");
      input.append("rightsAttested", "true");
      input.append("file", { uri: selectedFile.uri, name: selectedFile.name, type: mime } as unknown as Blob);
      const response = await fetch(`${baseUrl()}/dsh/partner/stores/${encodeURIComponent(storeId)}/discovery-content`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": attempt.current.idempotencyKey,
          "X-Correlation-ID": attempt.current.correlationId,
        },
        body: input,
      });
      if (!valid()) return;
      if (!response.ok) throw new Error("REELS_UPLOAD_FAILED");
      attempt.current = null;
      setFile(null);
      setCaption("");
      setRights(false);
      selectKind("STORE");
      await read();
      if (valid()) setMessage("تم إرسال الفيديو للمراجعة. يظهر للعملاء بعد موافقة بثواني.");
    } catch {
      if (valid()) setMessage("تعذر إرسال الفيديو؛ تحقق من الاتصال والملف ثم أعد المحاولة.");
    } finally {
      if (uploadRequest.current === request && uploadBusyScope.current === scopeKey) {
        uploadBusyScope.current = "";
        setBusy(false);
      }
    }
  };

  return <View style={styles.root} accessibilityLabel="فيديوهات المتجر">
    <Text style={styles.heading}>فيديوهات المتجر</Text>
    <Text style={styles.note}>مقطع MP4 حتى 30 ثانية و10 ميجابايت. يُنشر بعد موافقة بثواني، ويقود إلى المتجر أو منتج أو عرض مصرح به.</Text>
    {!sessionKey ? <Text accessibilityRole="alert" style={styles.note}>يلزم تسجيل الدخول لإدارة مقاطع المتجر.</Text> : null}
    <Pressable accessibilityRole="button" disabled={visibleBusy || !sessionKey} style={styles.action} onPress={() => { void choose(); }}>
      <Text style={styles.actionText}>{visibleFile ? visibleFile.name : "اختر مقطع MP4"}</Text>
    </Pressable>
    {visibleFile ? <>
      <TextInput accessibilityLabel="وصف الفيديو" placeholder="عنوان قصير للمقطع" value={caption} onChangeText={setCaption} maxLength={160} style={styles.input} />
      <Text style={styles.note}>إلى أين ينتقل العميل من الفيديو؟</Text>
      <View style={styles.kindRow}>
        {(["STORE", "PRODUCT", "PROMOTION"] as const).map(kind =>
          <Pressable key={kind} accessibilityRole="radio" accessibilityState={{ checked: targetType === kind }} onPress={() => selectKind(kind)} style={[styles.kind, targetType === kind && styles.kindSelected]}>
            <Text style={styles.kindText}>{targetLabels[kind]}</Text>
          </Pressable>
        )}
      </View>
      {targetType !== "STORE" ? <>
        <TextInput accessibilityLabel="البحث عن وجهة الفيديو" placeholder={targetType === "PRODUCT" ? "ابحث عن منتج متجرك" : "ابحث عن عرض متجرك"} value={targetSearch} onChangeText={setTargetSearch} style={styles.input} />
        {visibleTargets.map(target =>
          <Pressable key={target.targetType + target.targetId} accessibilityRole="radio" accessibilityState={{ checked: targetId === target.targetId }} style={[styles.target, targetId === target.targetId && styles.kindSelected]} onPress={() => { setTargetId(target.targetId); attempt.current = null; }}>
            <Text style={styles.title} numberOfLines={1}>{target.label}</Text>
          </Pressable>
        )}
        {visibleTargets.length === 0 ? <Text style={styles.note}>لا توجد وجهة متاحة لهذا المتجر.</Text> : null}
      </> : null}
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rights }} onPress={() => setRights(value => !value)} style={styles.rights}>
        <Text style={styles.note}>{rights ? "☑" : "☐"} أؤكد امتلاك حقوق نشر هذا المحتوى.</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={visibleBusy || !rights || !targetId || caption.trim().length < 2} style={[styles.action, (visibleBusy || !rights || !targetId || caption.trim().length < 2) && styles.disabled]} onPress={() => { void submit(); }}>
        <Text style={styles.actionText}>{visibleBusy ? "جارٍ الإرسال…" : "إرسال للمراجعة"}</Text>
      </Pressable>
    </> : null}
    {visibleMessage ? <Text accessibilityRole="alert" style={styles.note}>{visibleMessage}</Text> : null}
    {visibleListError || visibleTargetsError ? <View style={styles.item}>
      {visibleListError ? <Text accessibilityRole="alert" style={styles.note}>{visibleListError}</Text> : null}
      {visibleTargetsError ? <Text accessibilityRole="alert" style={styles.note}>{visibleTargetsError}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل المقاطع والوجهات"
        style={styles.target} onPress={() => { void read(); }}><Text style={styles.kindText}>إعادة تحميل</Text></Pressable>
    </View> : null}
    {visibleLoading ? <ActivityIndicator /> : visibleItems.map(item =>
      <View key={item.id} style={styles.item}>
        <Text style={styles.title}>{item.titleAr}</Text>
        <Text style={styles.note}>{statusLabel(item.state)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`عرض أداء المقطع ${item.titleAr}`}
          style={styles.target} onPress={() => { void loadAnalytics(item.id); }}>
          <Text style={styles.kindText}>عرض النتائج</Text>
        </Pressable>
        {showingAnalytics && analyticsID === item.id ? <View style={styles.analyticsBox}>
          {analyticsLoading ? <ActivityIndicator accessibilityLabel="جارٍ قراءة نتائج المقطع"/> : null}
          {analyticsError ? <Text accessibilityRole="alert" style={styles.note}>{analyticsError}</Text> : null}
          {analytics ? ([
            ["أحداث الظهور", "IMPRESSION"], ["النقرات", "CLICK"], ["طلبات منشأة منسوبة", "CONVERSION"],
          ] as const).map(([label, kind]) => <View key={kind} style={styles.metricRow}>
            <Text style={styles.note}>{label}</Text>
            <Text style={styles.title}>{(analytics.items.find(event => event.eventType === kind)?.count ?? 0).toLocaleString("ar-YE")}</Text>
          </View>) : null}
          {analytics ? <Text style={styles.note}>الطلبات المنسوبة تعني إنشاء الطلب بعد النقر، وليس إتمامه أو تحقيق أرباح.</Text> : null}
        </View> : null}
      </View>
    )}
  </View>;
}


function createStyles(theme: ReturnType<typeof useAppearanceTheme>) {
  return StyleSheet.create({
    root: { gap: 13, padding: 18, borderRadius: 16, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderColor },
    heading: { ...typography.titleMd, color: theme.color, fontWeight: "800", textAlign: "right" },
    note: { ...typography.bodySm, color: theme.colorMuted, textAlign: "right" },
    input: { ...typography.bodySm, minHeight: 48, color: theme.color, borderWidth: 1, borderColor: theme.borderColor, paddingHorizontal: 12, borderRadius: 10, textAlign: "right" },
    action: { minHeight: 45, backgroundColor: theme.brandAction, borderRadius: 10, padding: 12, justifyContent: "center", alignItems: "center" },
    actionText: { color: theme.onAction, fontWeight: "700", textAlign: "center" },
    disabled: { opacity: .45 },
    rights: { minHeight: 44, justifyContent: "center" },
    kindRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    kind: { flex: 1, minWidth: 85, padding: 10, minHeight: 44, backgroundColor: theme.surfaceInset, borderRadius: 10, alignItems: "center", justifyContent: "center" },
    kindSelected: { borderWidth: 2, borderColor: theme.brandAction },
    kindText: { ...typography.bodySm, color: theme.color, fontWeight: "700" },
    target: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: theme.borderColor, borderRadius: 10, justifyContent: "center" },
    item: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: theme.borderColor, gap: 8 },
    analyticsBox: { backgroundColor: theme.surfaceInset, borderRadius: 10, padding: 12, gap: 8 },
    metricRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
    title: { ...typography.bodyStrong, color: theme.color, fontWeight: "700", textAlign: "right" },
  });
}
