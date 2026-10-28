import type { DiscoveryContentView, OperatorDiscoveryContentRegistryResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState } from "react";
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
  // Preserve one server idempotency key across retries of the same draft.
  const attempt = useRef<{ fingerprint: string; contentId: string; idempotencyKey: string; correlationId: string; startsAt: string } | null>(null);

  const read = useCallback(async () => {
    try {
      const token = await getUsableIdentityAccessToken();
      const prefix = `${baseUrl()}/dsh/partner/stores/${encodeURIComponent(storeId)}`;
      const headers = { Authorization: `Bearer ${token}`, Accept: "application/json" };
      const [response, targetResponse] = await Promise.all([
        fetch(`${prefix}/discovery-content`, { headers }),
        fetch(`${prefix}/discovery-targets`, { headers }),
      ]);
      if (!response.ok || !targetResponse.ok) throw new Error("REELS_READ_FAILED");
      const [data, targetData] = await Promise.all([
        response.json() as Promise<OperatorDiscoveryContentRegistryResponse>,
        targetResponse.json() as Promise<{ targets: ReadonlyArray<ReelTarget> }>,
      ]);
      setItems(data.items);
      setTargets(targetData.targets);
      setMessage("");
    } catch {
      setMessage("تعذر تحميل حالة الفيديوهات.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    setTargetType("STORE");
    setTargetId(storeId);
    setTargetSearch("");
    attempt.current = null;
    setLoading(true);
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
        type: ["video/mp4", "image/jpeg", "image/png"], copyToCacheDirectory: true,
      });
      if (selected.canceled || !selected.assets[0]) return;
      const value = selected.assets[0];
      if (!value.size || value.size > 10 * 1024 * 1024) {
        setMessage("الحد الأقصى 10 ميجابايت. اختر فيديو مضغوطًا.");
        return;
      }
      if (!["video/mp4", "image/jpeg", "image/png"].includes(value.mimeType ?? "")) {
        setMessage("صيغة الفيديو MP4، ويمكن أيضًا استخدام صورة.");
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
    <Text style={styles.note}>يُعرض المقطع بعد مراجعة بثواني، ويقود إلى متجرك مباشرة.</Text>
    <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => { void choose(); }}>
      <Text style={styles.actionText}>{file ? file.name : "اختر فيديو أو صورة"}</Text>
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
    {loading ? <ActivityIndicator /> : items.map(item =>
      <View key={item.id} style={styles.item}>
        <Text style={styles.title}>{item.titleAr}</Text>
        <Text style={styles.note}>{statusLabel(item.state)}</Text>
      </View>
    )}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingVertical: 16, paddingHorizontal: 12, borderRadius: 16 },
  heading: { fontSize: 18, fontWeight: "700", textAlign: "right" },
  note: { fontSize: 13, textAlign: "right" },
  input: { minHeight: 48, borderWidth: 1, borderColor: "#999", paddingHorizontal: 12, borderRadius: 12, textAlign: "right" },
  action: { minHeight: 46, backgroundColor: "#4f46e5", borderRadius: 12, padding: 12, justifyContent: "center", alignItems: "center" },
  actionText: { color: "#fff", fontWeight: "700", textAlign: "center" },
  disabled: { opacity: .45 },
  rights: { minHeight: 44, justifyContent: "center" },
  kindRow: { flexDirection: "row", gap: 8 },
  kind: { flex: 1, padding: 10, minHeight: 44, backgroundColor: "#343b59", borderRadius: 10, alignItems: "center", justifyContent: "center" },
  kindSelected: { borderWidth: 2, borderColor: "#818cf8" },
  kindText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  target: { minHeight: 44, padding: 10, borderWidth: 1, borderColor: "#777", borderRadius: 10, justifyContent: "center" },
  item: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#888" },
  title: { fontSize: 15, fontWeight: "600", textAlign: "right" },
});
