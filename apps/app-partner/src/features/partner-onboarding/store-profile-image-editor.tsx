import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { isMediaProvenanceInputValid, type DshImageUploadInput, type JoiningCaseResponse, type MediaProvenanceInput } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import { Image, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { readOwnJoiningCase, uploadOwnJoiningCaseStoreImage } from "./store-readback-client";

type StoreImageDraft = Readonly<{ image: DshImageUploadInput; contentSha256: string; provenance: MediaProvenanceInput }>;

export function StoreProfileImageEditor({ value, onUpdated }: { value: JoiningCaseResponse; onUpdated: (next: JoiningCaseResponse) => void }) {
  const current = value.case;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);

  if (current.state !== "needs_correction" && !(current.state === "approved" && current.store?.id)) return null;

  async function chooseStoreImage() {
    if (busy) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError("يلزم السماح بالوصول إلى الصور لاختيار صورة المتجر."); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
    if (picked.canceled || !picked.assets[0]?.uri) return;
    try {
      const response = await fetch(picked.assets[0].uri);
      if (!response.ok) throw new Error("STORE_IMAGE_READ_FAILED");
      const blob = await response.blob();
      if (!blob.size || blob.size > 10 * 1024 * 1024) throw new Error("STORE_IMAGE_SIZE_INVALID");
      const digest = new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await blob.arrayBuffer()));
      const contentSha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      setStoreImage({ contentSha256, image: { uri: picked.assets[0].uri, name: picked.assets[0].fileName ?? "store-image.jpg", type: picked.assets[0].mimeType ?? "image/jpeg", blob }, provenance: { creator: "", sourceDescription: "", sourceUri: "", rightsStatement: "", rightsUri: "", rightsAttested: false } });
      setError("");
    } catch (cause) {
      console.error("DSH Partner store image preparation failed", cause);
      setError("تعذر تجهيز الصورة أو تجاوزت 10 ميغابايت. اختر صورة أخرى.");
    }
  }

  async function uploadStoreImage() {
    if (!storeImage || busy) return;
    if (!isMediaProvenanceInputValid(storeImage.provenance)) {
      setError("أكمل منشئ الصورة ومصدرها وبيان حق استخدامها، ثم أكّد صحة التصريح.");
      return;
    }
    if (current.storeProfileImage?.contentSha256 === storeImage.contentSha256 && current.storeProfileImage.provenance) {
      setStoreImage(null);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${current.id}:${current.version}:${storeImage.contentSha256}:${JSON.stringify(storeImage.provenance)}`);
      const updated = await uploadOwnJoiningCaseStoreImage(current.id, storeImage.image, storeImage.provenance, current.version, `partner_store_image_${identity}`, `partner_store_image_corr_${identity}`);
      onUpdated(updated);
      setStoreImage(null);
    } catch (cause) {
      console.error("DSH Partner store image upload failed", cause);
      try {
        const latest = await readOwnJoiningCase();
        onUpdated(latest);
        if (latest.case.storeProfileImage?.contentSha256 === storeImage.contentSha256 && latest.case.storeProfileImage.provenance) {
          setStoreImage(null);
          setError("");
          return;
        }
      } catch (readError) {
        console.error("DSH Partner store image readback failed", readError);
      }
      setError("تعذر تأكيد حفظ الصورة. أُعيدت قراءة الحالة؛ أعد المحاولة بالصورة نفسها لإتمام التسوية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container} accessibilityLabel="صورة المتجر وحقوق استخدامها">
      <Text style={styles.title}>صورة المتجر</Text>
      {current.storeProfileImage ? <Image accessibilityLabel={`صورة متجر ${current.firstStoreName}`} source={{ uri: current.storeProfileImage.uri }} resizeMode="cover" style={styles.storeImage} /> : <Text style={styles.muted}>لا توجد صورة موثقة للعرض حاليًا. ارفع صورة مع بيان مصدرها وحق استخدامها.</Text>}
      {storeImage ? <Image accessibilityLabel="معاينة الصورة الجديدة" source={{ uri: storeImage.image.uri }} resizeMode="cover" style={styles.storeImage} /> : null}
      {storeImage ? <View style={styles.imageBox}>
        <Text style={styles.label}>مصدر الصورة وحق استخدامها</Text>
        <TextInput accessibilityLabel="منشئ الصورة" editable={!busy} placeholder="منشئ الصورة أو المصور" onChangeText={(creator) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, creator } } : null)} value={storeImage.provenance.creator} style={styles.input} />
        <TextInput accessibilityLabel="مصدر الصورة" editable={!busy} placeholder="كيف حصلت على الصورة؟" onChangeText={(sourceDescription) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, sourceDescription } } : null)} value={storeImage.provenance.sourceDescription} style={styles.input} />
        <TextInput accessibilityLabel="رابط مصدر الصورة اختياري" editable={!busy} autoCapitalize="none" keyboardType="url" placeholder="رابط المصدر، اختياري" onChangeText={(sourceUri) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, sourceUri } } : null)} value={storeImage.provenance.sourceUri} style={styles.input} />
        <TextInput accessibilityLabel="بيان حق استخدام الصورة" editable={!busy} multiline placeholder="بيان الحق أو الترخيص الذي يسمح بعرض الصورة" onChangeText={(rightsStatement) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, rightsStatement } } : null)} value={storeImage.provenance.rightsStatement} style={[styles.input, styles.multiline]} />
        <TextInput accessibilityLabel="رابط شروط الترخيص اختياري" editable={!busy} autoCapitalize="none" keyboardType="url" placeholder="رابط شروط الترخيص، اختياري" onChangeText={(rightsUri) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, rightsUri } } : null)} value={storeImage.provenance.rightsUri} style={styles.input} />
        <View style={styles.attestation}><Switch disabled={busy} value={storeImage.provenance.rightsAttested} onValueChange={(rightsAttested) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, rightsAttested } } : null)} /><Text style={styles.muted}>أؤكد صحة بيانات المصدر وحق الاستخدام.</Text></View>
      </View> : null}
      <BthwaniButton disabled={busy} label={storeImage ? "اختيار صورة أخرى" : "اختيار صورة المتجر"} onPress={() => void chooseStoreImage()} variant="secondary" />
      {storeImage ? <BthwaniButton busy={busy} disabled={busy || !isMediaProvenanceInputValid(storeImage.provenance)} label="حفظ صورة المتجر" onPress={() => void uploadStoreImage()} variant="secondary" /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof resolveTheme>) {
  return StyleSheet.create({
    container: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.md, borderWidth: borders.hairline, gap: spacing[2], padding: spacing[3] },
    title: { ...typography.bodyStrong, color: theme.color },
    label: { ...typography.label, color: theme.color },
    input: { backgroundColor: theme.surface, borderColor: theme.borderColor, borderRadius: radius.sm, borderWidth: borders.hairline, color: theme.color, minHeight: sizing.controlMd, paddingHorizontal: spacing[2] },
    multiline: { minHeight: 80, paddingVertical: spacing[2], textAlignVertical: "top" },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.label, color: theme.danger },
    imageBox: { backgroundColor: theme.structureSoft, borderRadius: radius.sm, gap: spacing[2], padding: spacing[2] },
    attestation: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
    storeImage: { borderRadius: radius.sm, height: 180, width: "100%" },
  });
}
