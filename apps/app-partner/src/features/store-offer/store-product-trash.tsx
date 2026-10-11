import { borders, radius, spacing, typography } from "@bthwani/design-system";
import { BthwaniButton, useAppearanceTheme } from "@bthwani/design-system/native";
import { type CatalogProduct, createDshMobileClient, type StoreDeletedCatalogProduct } from "@bthwani/dsh";
import * as Crypto from "expo-crypto";
import { useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { getUsableIdentityAccessToken } from "../../bootstrap/identity";

type Props = Readonly<{
  storeId: string;
  selectedProduct: CatalogProduct | null;
  onTrashed: (productId: string) => void;
  onRestored: () => void;
}>;

function client() {
  const url = process.env.EXPO_PUBLIC_DSH_API_URL?.trim();
  if (!url) throw new Error("DSH_BASE_URL_REQUIRED");
  return createDshMobileClient(url, { cryptoRandomUUID: () => Crypto.randomUUID() });
}

function message(error: unknown): string {
  if (error && typeof error === "object" && "status" in error) {
    if (error.status === 409) return "تغيرت البيانات. حدّث القائمة وأعد المحاولة.";
    if (error.status === 401 || error.status === 403) return "لا تتوفر صلاحية لهذه العملية على المتجر.";
  }
  return "تعذرت العملية. تحقق من الاتصال ثم أعد المحاولة.";
}

export function StoreProductTrash({ storeId, selectedProduct, onTrashed, onRestored }: Props) {
  const theme = useAppearanceTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: { backgroundColor: theme.surfaceRaised, borderColor: theme.borderColor, borderWidth: borders.hairline, borderRadius: radius.md, padding: spacing[3], gap: spacing[2] },
    row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing[2] },
    item: { borderTopWidth: borders.hairline, borderColor: theme.borderColor, paddingTop: spacing[2], gap: spacing[2] },
    title: { ...typography.bodyStrong, color: theme.color },
    muted: { ...typography.bodySm, color: theme.colorMuted },
    error: { ...typography.bodySm, color: theme.danger },
    input: { borderWidth: borders.hairline, borderColor: theme.borderColor, borderRadius: radius.sm, color: theme.color, backgroundColor: theme.surface, padding: spacing[2], minHeight: 44 },
  }), [theme]);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ReadonlyArray<StoreDeletedCatalogProduct>>([]);
  const [cursor, setCursor] = useState("");
  const [back, setBack] = useState<ReadonlyArray<string>>([]);
  const [next, setNext] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [restoreId, setRestoreId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function readTrash(nextCursor: string, nextBack = back) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const token = await getUsableIdentityAccessToken();
      const page = await client().listStoreDeletedProducts(token, storeId, 25, nextCursor);
      setItems(page.products); setNext(page.nextCursor); setCursor(nextCursor); setBack(nextBack);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }

  async function trashProduct() {
    if (selectedProduct?.scope !== "STORE_SCOPED" || selectedProduct.storeId !== storeId || Array.from(deleteReason.trim()).length < 5 || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().mutateStoreProductTrash(token, storeId, selectedProduct.id, "trash", selectedProduct.version, deleteReason.trim());
      setConfirmDelete(false); setDeleteReason("");
      onTrashed(selectedProduct.id);
      setNotice("نُقل المنتج إلى السلة، ويمكن استعادته في أي وقت.");
      if (open) {
        const page = await client().listStoreDeletedProducts(token, storeId, 25);
        setItems(page.products); setNext(page.nextCursor); setCursor(""); setBack([]);
      }
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  async function restoreProduct(item: StoreDeletedCatalogProduct) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const token = await getUsableIdentityAccessToken();
      await client().mutateStoreProductTrash(token, storeId, item.id, "restore", item.version, "");
      const page = await client().listStoreDeletedProducts(token, storeId, 25);
      setItems(page.products); setNext(page.nextCursor); setCursor(""); setBack([]); setRestoreId("");
      setNotice(`تمت استعادة «${item.canonicalName}». ابحث عنه في المنتجات لإدارته.`);
      onRestored();
    } catch (cause) { setError(message(cause)); }
    finally { setBusy(false); }
  }

  const ownSelected = selectedProduct?.scope === "STORE_SCOPED" && selectedProduct.storeId === storeId;
  return <View style={styles.card}>
    <Text style={styles.title}>سلة منتجات المتجر</Text>
    <Text style={styles.muted}>المنتج المحذوف لا يظهر للعميل، وتبقى صوره وعروضه وطلباته السابقة محفوظة. يمكن استعادته من هنا.</Text>
    {ownSelected && !confirmDelete ? <View style={styles.row}><BthwaniButton label="نقل المنتج المحدد إلى السلة" variant="secondary" disabled={busy} onPress={() => { setConfirmDelete(true); setDeleteReason(""); }} /></View> : null}
    {ownSelected && confirmDelete ? <View style={styles.item}>
      <Text style={styles.title}>تأكيد نقل «{selectedProduct.canonicalName}» إلى السلة</Text>
      <TextInput accessibilityLabel="سبب حذف المنتج" style={styles.input} editable={!busy} maxLength={500} value={deleteReason} onChangeText={setDeleteReason} placeholder="سبب الحذف (5 أحرف على الأقل)" />
      <View style={styles.row}>
        <BthwaniButton label="تأكيد النقل" variant="danger" disabled={busy || Array.from(deleteReason.trim()).length < 5} busy={busy} onPress={() => void trashProduct()} />
        <BthwaniButton label="إلغاء" variant="quiet" disabled={busy} onPress={() => { setConfirmDelete(false); setDeleteReason(""); }} />
      </View>
    </View> : null}
    <View style={styles.row}><BthwaniButton label={open ? "إخفاء السلة" : "عرض المنتجات المحذوفة"} variant="secondary" disabled={busy} onPress={() => {
      if (open) { setOpen(false); setRestoreId(""); } else { setOpen(true); void readTrash(""); }
    }} /></View>
    {notice ? <Text style={styles.muted} accessibilityLiveRegion="polite">{notice}</Text> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    {open ? <>
      {busy ? <ActivityIndicator accessibilityLabel="جارٍ معالجة السلة" /> : null}
      {!busy && items.length === 0 && !error ? <Text style={styles.muted}>السلة فارغة.</Text> : null}
      {items.map((item) => <View style={styles.item} key={item.id}>
        <Text style={styles.title}>{item.canonicalName}</Text>
        <Text style={styles.muted}>{item.deletedAt ? new Date(item.deletedAt).toLocaleDateString("ar-YE") : ""} · {item.deletionReason ?? ""}</Text>
        <View style={styles.row}>{restoreId === item.id ? <>
          <Text style={styles.muted}>هل تريد استعادة هذا المنتج؟</Text>
          <BthwaniButton label="تأكيد الاستعادة" variant="secondary" disabled={busy} busy={busy} onPress={() => void restoreProduct(item)} />
          <BthwaniButton label="إلغاء" variant="quiet" disabled={busy} onPress={() => setRestoreId("")} />
        </> : <BthwaniButton label="استعادة" variant="secondary" disabled={busy} onPress={() => setRestoreId(item.id)} />}</View>
      </View>)}
      <View style={styles.row}>
        <BthwaniButton label="السابق" variant="quiet" disabled={busy || back.length === 0} onPress={() => void readTrash(back[back.length - 1] ?? "", back.slice(0, -1))} />
        <BthwaniButton label="التالي" variant="quiet" disabled={busy || !next} onPress={() => void readTrash(next, [...back, cursor])} />
      </View>
    </> : null}
  </View>;
}
