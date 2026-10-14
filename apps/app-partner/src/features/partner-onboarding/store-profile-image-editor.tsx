import { borders, radius, type resolveTheme, sizing, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type DshImageUploadInput, isMediaProvenanceInputValid, type JoiningCaseResponse, type StoreImagesResponse, type MediaProvenanceInput } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { Image, StyleSheet, Switch, Text, TextInput, View } from "react-native";

import { partnerStoreImageReadbackMatches } from "./store-profile-image-readback";
import { readOwnJoiningCase, uploadOwnJoiningCaseStoreImage, readOwnStoreImages, uploadOwnStoreImage } from "./store-readback-client";

type StoreImageRole = "primary" | "cover";
type StoreImageDraft = Readonly<{ role: StoreImageRole; image: DshImageUploadInput; contentSha256: string; provenance: MediaProvenanceInput }>;

export function StoreProfileImageEditor(props: { value: JoiningCaseResponse; onUpdated: (next: JoiningCaseResponse) => void } | { storeID: string; storeName: string }) {
  const [stored, setStored] = useState<StoreImagesResponse | null>(null);
  const storeID = "storeID" in props ? props.storeID : "";
  const current = "value" in props ? props.value.case : stored ? { ...stored, id: stored.storeId, firstStoreName: props.storeName, partnerActorId: "", state: "approved", store: { id: stored.storeId } } : null;
  const theme = useAppearanceTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storeImageRole, setStoreImageRole] = useState<StoreImageRole>("primary");
  const [storeImage, setStoreImage] = useState<StoreImageDraft | null>(null);

  useEffect(() => {
    if (!storeID) return;
    let active = true;
    setStored(null);
    void readOwnStoreImages(storeID).then((next) => { if(active) setStored(next); }).catch(() => { if(active) setError("تعذر قراءة صور المتجر. أعد المحاولة."); });
    return () => { active=false; };
  },[storeID]);
  if (!current) return <View style={styles.container}><Text style={styles.muted}>{error || "جارٍ قراءة صور المتجر…"}</Text>{error ? <BthwaniButton label="إعادة المحاولة" onPress={() => void readOwnStoreImages(storeID).then(setStored).catch(() => setError("تعذرت قراءة الصور. أعد المحاولة."))} /> : null}</View>;
  const activeCurrent = current;
  function matches(next: typeof activeCurrent) {
    if (!storeImage) return false;
    const asset = storeImage.role === "cover" ? next.storeCoverImage : next.storeProfileImage;
    return asset?.contentSha256 === storeImage.contentSha256 && asset.provenance.creator === storeImage.provenance.creator.trim() && asset.provenance.sourceDescription === storeImage.provenance.sourceDescription.trim() && asset.provenance.rightsStatement === storeImage.provenance.rightsStatement.trim() && (asset.provenance.sourceUri ?? "") === (storeImage.provenance.sourceUri ?? "").trim() && (asset.provenance.rightsUri ?? "") === (storeImage.provenance.rightsUri ?? "").trim() && Boolean(asset.provenance.attestedByActorId && asset.provenance.attestedAt);
  }
  if (current.state !== "needs_correction" && !(activeCurrent.state === "approved" && activeCurrent.store?.id)) return null;

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
      setStoreImage({ role: storeImageRole, contentSha256, image: { uri: picked.assets[0].uri, name: picked.assets[0].fileName ?? (storeImageRole === "cover" ? "store-cover.jpg" : "store-logo.jpg"), type: picked.assets[0].mimeType ?? "image/jpeg", blob }, provenance: { creator: "", sourceDescription: "", sourceUri: "", rightsStatement: "", rightsUri: "", rightsAttested: false } });
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
    const requested = {
      caseID: activeCurrent.id,
      partnerActorID: activeCurrent.partnerActorId ?? "",
      role: storeImage.role,
      contentSha256: storeImage.contentSha256,
      provenance: storeImage.provenance,
    };
    if (storeID ? matches(current) : partnerStoreImageReadbackMatches(current as JoiningCaseResponse["case"], requested)) {
      setStoreImage(null);
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const identity = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${activeCurrent.id}:${activeCurrent.version}:${storeImage.role}:${storeImage.contentSha256}:${JSON.stringify(storeImage.provenance)}`);
      if (storeID) {
        const updated = await uploadOwnStoreImage(storeID,storeImage.image,storeImage.provenance,activeCurrent.version,`partner_store_image_${identity}`,`partner_store_image_corr_${identity}`,storeImage.role);
        setStored(updated);
        if (!matches({ ...activeCurrent,...updated })) throw new Error("PARTNER_STORE_IMAGE_UPLOAD_READBACK_MISMATCH");
      } else if ("value" in props) {
        const updated = await uploadOwnJoiningCaseStoreImage(activeCurrent.id, storeImage.image, storeImage.provenance, activeCurrent.version, `partner_store_image_${identity}`, `partner_store_image_corr_${identity}`, storeImage.role);
        if (!partnerStoreImageReadbackMatches(updated.case, requested)) throw new Error("PARTNER_STORE_IMAGE_UPLOAD_READBACK_MISMATCH");
        props.onUpdated(updated);
      }
      setStoreImage(null);
    } catch (cause) {
      console.error("DSH Partner store image upload failed", cause);
      try {
        if(storeID) {
          const latest = await readOwnStoreImages(storeID); setStored(latest);
          if (matches({...activeCurrent,...latest})) { setStoreImage(null); setError(""); return; }
          throw new Error("STORE_IMAGE_NOT_CONFIRMED");
        }
        const latest = await readOwnJoiningCase();
        if (latest.case.id !== requested.caseID || latest.case.partnerActorId !== requested.partnerActorID) {
          throw new Error("PARTNER_STORE_IMAGE_WRONG_CASE_READBACK");
        }
        if ("value" in props) props.onUpdated(latest);
        if (partnerStoreImageReadbackMatches(latest.case, requested)) {
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

  const selectedAsset = storeImageRole === "cover" ? activeCurrent.storeCoverImage : activeCurrent.storeProfileImage;
  const selectedImageTitle = storeImageRole === "cover" ? "غلاف المتجر" : "شعار المتجر";
  return (
    <View style={styles.container} accessibilityLabel="شعار المتجر وغلافه ومصدر الصور">
      <Text style={styles.title}>صور واجهة المتجر</Text>
      <View style={styles.roleOptions}>
        <BthwaniButton disabled={busy} label="الشعار" onPress={() => { setStoreImageRole("primary"); setStoreImage(null); setError(""); }} variant={storeImageRole === "primary" ? "primary" : "secondary"} />
        <BthwaniButton disabled={busy} label="الغلاف" onPress={() => { setStoreImageRole("cover"); setStoreImage(null); setError(""); }} variant={storeImageRole === "cover" ? "primary" : "secondary"} />
      </View>
      {selectedAsset ? <Image accessibilityLabel={`${selectedImageTitle} ${activeCurrent.firstStoreName}`} source={{ uri: selectedAsset.uri }} resizeMode="cover" style={[styles.storeImage, storeImageRole === "cover" && styles.storeCover]} /> : <Text style={styles.muted}>{storeImageRole === "cover" ? "لا يوجد غلاف موثق بعد. الغلاف مطلوب قبل نشر المتجر للعملاء." : "لا يوجد شعار موثق بعد. الشعار مطلوب قبل نشر المتجر للعملاء."}</Text>}
      {storeImage ? <Image accessibilityLabel={`معاينة ${selectedImageTitle} الجديدة`} source={{ uri: storeImage.image.uri }} resizeMode="cover" style={[styles.storeImage, storeImageRole === "cover" && styles.storeCover]} /> : null}
      {storeImage ? <View style={styles.imageBox}>
        <Text style={styles.label}>مصدر الصورة وحق استخدامها</Text>
        <TextInput accessibilityLabel="منشئ الصورة" editable={!busy} placeholder="منشئ الصورة أو المصور" onChangeText={(creator) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, creator } } : null)} value={storeImage.provenance.creator} style={styles.input} />
        <TextInput accessibilityLabel="مصدر الصورة" editable={!busy} placeholder="كيف حصلت على الصورة؟" onChangeText={(sourceDescription) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, sourceDescription } } : null)} value={storeImage.provenance.sourceDescription} style={styles.input} />
        <TextInput accessibilityLabel="رابط مصدر الصورة اختياري" editable={!busy} autoCapitalize="none" keyboardType="url" placeholder="رابط المصدر، اختياري" onChangeText={(sourceUri) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, sourceUri } } : null)} value={storeImage.provenance.sourceUri} style={styles.input} />
        <TextInput accessibilityLabel="بيان حق استخدام الصورة" editable={!busy} multiline placeholder="بيان الحق أو الترخيص الذي يسمح بعرض الصورة" onChangeText={(rightsStatement) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, rightsStatement } } : null)} value={storeImage.provenance.rightsStatement} style={[styles.input, styles.multiline]} />
        <TextInput accessibilityLabel="رابط شروط الترخيص اختياري" editable={!busy} autoCapitalize="none" keyboardType="url" placeholder="رابط شروط الترخيص، اختياري" onChangeText={(rightsUri) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, rightsUri } } : null)} value={storeImage.provenance.rightsUri} style={styles.input} />
        <View style={styles.attestation}><Switch disabled={busy} value={storeImage.provenance.rightsAttested} onValueChange={(rightsAttested) => setStoreImage((image) => image ? { ...image, provenance: { ...image.provenance, rightsAttested } } : null)} /><Text style={styles.muted}>أؤكد صحة بيانات المصدر وحق الاستخدام.</Text></View>
      </View> : null}
      <BthwaniButton disabled={busy} label={storeImage ? "اختيار صورة أخرى" : `اختيار ${selectedImageTitle}`} onPress={() => void chooseStoreImage()} variant="secondary" />
      {storeImage ? <BthwaniButton busy={busy} disabled={busy || !isMediaProvenanceInputValid(storeImage.provenance)} label={`حفظ ${selectedImageTitle}`} onPress={() => void uploadStoreImage()} variant="secondary" /> : null}
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
    roleOptions: { flexDirection: "row", gap: spacing[2] },
    storeImage: { borderRadius: radius.sm, height: 180, width: "100%" },
    storeCover: { height: 144 },
  });
}
