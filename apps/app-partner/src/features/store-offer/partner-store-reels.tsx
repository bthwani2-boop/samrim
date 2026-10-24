import type { DiscoveryContentView, OperatorDiscoveryContentRegistryResponse } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { currentIdentityState, getUsableIdentityAccessToken } from "../../bootstrap/identity";

type Reel = DiscoveryContentView;
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
      const response = await fetch(`${baseUrl()}/dsh/partner/stores/${encodeURIComponent(storeId)}/discovery-content`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!response.ok) throw new Error("REELS_READ_FAILED");
      const data = await response.json() as OperatorDiscoveryContentRegistryResponse;
      setItems(data.items);
      setMessage("");
    } catch {
      setMessage("تعذر تحميل حالة الفيديوهات.");
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { setLoading(true); void read(); }, [read]);

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
    if (busy || !file || !caption.trim() || !rights) return;
    if (currentIdentityState().kind !== "authenticated") {
      setMessage("سجل الدخول لإضافة الفيديو.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const token = await getUsableIdentityAccessToken();
      const mime = file.mimeType ?? "video/mp4";
      const fingerprint = [storeId, file.uri, file.size, caption.trim()].join(":");
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
      input.append("targetType", "STORE");
      input.append("targetId", storeId);
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
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rights }} onPress={() => setRights(value => !value)} style={styles.rights}>
        <Text style={styles.note}>{rights ? "☑" : "☐"} أؤكد امتلاك حقوق نشر هذا المحتوى.</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={busy || !rights || caption.trim().length < 2} style={[styles.action, (busy || !rights || caption.trim().length < 2) && styles.disabled]} onPress={() => { void submit(); }}>
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
  item: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#888" },
  title: { fontSize: 15, fontWeight: "600", textAlign: "right" },
});
