import { createDshMobileClient, type DiscoveryContentAnalyticsListResponse, type DiscoveryContentView, type OperatorDiscoveryContentRegistryResponse } from "@bthwani/dsh";
import { typography } from "@bthwani/design-system";
import { useAppearanceTheme } from "@bthwani/design-system/native";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

type Reel = DiscoveryContentView;
type ReelTargetType = "STORE" | "PRODUCT" | "PROMOTION";
type ReelTarget = Readonly<{ targetType: "PRODUCT" | "PROMOTION"; targetId: string; label: string }>;
const targetLabels: Record<ReelTargetType, string> = { STORE: "المتجر", PRODUCT: "منتج", PROMOTION: "عرض" };
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
  const analyticsRequest = useRef(0);
  // Preserve one server idempotency key across retries of the same draft.
  const attempt = useRef<{ fingerprint: string; contentId: string; idempotencyKey: string; correlationId: string; startsAt: string } | null>(null);

  const read = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getUsableIdentityAccessToken();
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
      if (list.status === "fulfilled") setItems(list.value.items);
      setListError(list.status === "fulfilled" ? "" : "تعذر قراءة مقاطع المتجر. أعد المحاولة.");
      if (destinations.status === "fulfilled") setTargets(destinations.value.targets);
      setTargetsError(destinations.status === "fulfilled" ? "" : "تعذر قراءة وجهات المقاطع. يمكن متابعة المقاطع الحالية.");
    } catch {
      setListError("تعذر قراءة مقاطع المتجر. تحقق من الاتصال.");
      setTargetsError("تعذر قراءة وجهات المقاطع. تحقق من الاتصال.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  const loadAnalytics = async (contentID: string) => {
    const request = analyticsRequest.current + 1;
    analyticsRequest.current = request;
    setAnalyticsID(contentID);
    setAnalytics(null);
    setAnalyticsError("");
    setAnalyticsLoading(true);
    try {
      const token = await getUsableIdentityAccessToken();
      const result = await createDshMobileClient(baseUrl(), { cryptoRandomUUID: () => Crypto.randomUUID() })
        .listPartnerStoreContentAnalytics(token, storeId, contentID);
      if (analyticsRequest.current === request) setAnalytics(result);
    } catch {
      if (analyticsRequest.current === request) setAnalyticsError("تعذر قراءة نتائج هذا المقطع؛ أعد المحاولة.");
    } finally {
      if (analyticsRequest.current === request) setAnalyticsLoading(false);
    }
  };

  useEffect(() => {
    setTargetType("STORE");
    setTargetId(storeId);
    setTargetSearch("");
    setItems([]);
    setTargets([]);
    setAnalyticsID("");
    setAnalytics(null);
    setListError("");
    setTargetsError("");
    analyticsRequest.current++;
    attempt.current = null;
    void read();
  }, [read, storeId]);
  const selectKind = (kind: ReelTargetType) => {
    setTargetType(kind);
    setTargetId(kind === "STORE" ? storeId : "");
    setTargetSearch("");
    attempt.current = null;
  };
  const visibleTargets = targets.filter(item => item.targetType === targetType)
    .filter(item => !targetSearch.trim() || item.label.toLocaleLowerCase().includes(targetSearch.trim().toLocaleLowerCase())).slice(0, 8);

  const choose = async () => {
    if (busy) return;
    try {
      const selected = await DocumentPicker.getDocumentAsync({
        type: ["video/mp4"], copyToCacheDirectory: true,
      });
      if (selected.canceled || !selected.assets[0]) return;
      const value = selected.assets[0];
      if (!value.size || value.size > 10 * 1024 * 1024) {
        setMessage("الحد الأقصى 10 ميجابايت. اختر فيديو مضغوطًا.");
        return;
      }
      if (value.mimeType !== "video/mp4") {
        setMessage("يدعم هذا القسم مقاطع MP4 فقط.");
        return;
      }
      setFile(value);
      attempt.current = null;
      setMessage("");
    } catch {
      setMessage("تعذر اختيار الوسيط.");
    }
  };

  const submit = async () => {
    if (busy || !file || !caption.trim() || !rights || !targetId) return;
    if (currentIdentityState().kind !== "authenticated") {
      setMessage("سجل الدخول لإضافة الفيديو.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const token = await getUsableIdentityAccessToken();
      const mime = file.mimeType ?? "video/mp4";
      const fingerprint = [storeId, targetType, targetId, file.uri, file.size, caption.trim()].join(":");
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
      input.append("file", { uri: file.uri, name: file.name, type: mime } as unknown as Blob);
      const response = await fetch(`${baseUrl()}/dsh/partner/stores/${encodeURIComponent(storeId)}/discovery-content`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": attempt.current.idempotencyKey,
          "X-Correlation-ID": attempt.current.correlationId,
        },
        body: input,
      });
      if (!response.ok) throw new Error("REELS_UPLOAD_FAILED");
      attempt.current = null;
      setFile(null);
      setCaption("");
      setRights(false);
      selectKind("STORE");
      await read();
      setMessage("تم إرسال الفيديو للمراجعة. يظهر للعملاء بعد موافقة بثواني.");
    } catch {
      setMessage("تعذر إرسال الفيديو؛ تحقق من الاتصال والملف ثم أعد المحاولة.");
    } finally {
      setBusy(false);
    }
  };

  return <View style={styles.root} accessibilityLabel="فيديوهات المتجر">
    <Text style={styles.heading}>فيديوهات المتجر</Text>
    <Text style={styles.note}>مقطع MP4 حتى 30 ثانية و10 ميجابايت. يُنشر بعد موافقة بثواني، ويقود إلى المتجر أو منتج أو عرض مصرح به.</Text>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => { void choose(); }}>
      <Text style={styles.actionText}>{file ? file.name : "اختر مقطع MP4"}</Text>
    </Pressable>
    {file ? <>
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
      <Pressable accessibilityRole="button" disabled={busy || !rights || !targetId || caption.trim().length < 2} style={[styles.action, (busy || !rights || !targetId || caption.trim().length < 2) && styles.disabled]} onPress={() => { void submit(); }}>
        <Text style={styles.actionText}>{busy ? "جارٍ الإرسال…" : "إرسال للمراجعة"}</Text>
      </Pressable>
    </> : null}
    {message ? <Text accessibilityRole="alert" style={styles.note}>{message}</Text> : null}
    {listError || targetsError ? <View style={styles.item}>
      {listError ? <Text accessibilityRole="alert" style={styles.note}>{listError}</Text> : null}
      {targetsError ? <Text accessibilityRole="alert" style={styles.note}>{targetsError}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="إعادة تحميل المقاطع والوجهات"
        style={styles.target} onPress={() => { void read(); }}><Text style={styles.kindText}>إعادة تحميل</Text></Pressable>
    </View> : null}
    {loading ? <ActivityIndicator /> : items.map(item =>
      <View key={item.id} style={styles.item}>
        <Text style={styles.title}>{item.titleAr}</Text>
        <Text style={styles.note}>{statusLabel(item.state)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={"عرض أداء المقطع " + item.titleAr}
          style={styles.target} onPress={() => { void loadAnalytics(item.id); }}>
          <Text style={styles.kindText}>عرض النتائج</Text>
        </Pressable>
        {analyticsID === item.id ? <View style={styles.analyticsBox}>
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
