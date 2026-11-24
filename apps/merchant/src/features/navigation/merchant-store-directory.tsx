import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { MerchantOwnedStore } from "../access/dsh-standing";
import MerchantPublicLink from "../stores/merchant-public-link";
import StoreAvailability from "../stores/store-availability";
import { filterMerchantStores, type MerchantPublicationFilter, type MerchantRelationFilter } from "./merchant-workspace-model";

const publicationOptions = [
  { id: "all", label: "الكل" },
  { id: "published", label: "منشورة" },
  { id: "unpublished", label: "غير منشورة" },
] as const;

const relationOptions = [
  { id: "all", label: "كل الأنواع" },
  { id: "MARKETPLACE", label: "سوق بثواني" },
  { id: "DIRECT", label: "مباشر" },
] as const;

function publicationLabel(store: MerchantOwnedStore) {
  return store.published ? "منشور" : "غير منشور";
}

function relationLabel(store: MerchantOwnedStore) {
  return store.relation === "MARKETPLACE" ? "ضمن سوق بثواني" : "متجر مباشر";
}

export default function MerchantStoreDirectory({ actorId, stores, initialPublication = "all", initialStoreId, onOpenCatalog }: Readonly<{
  actorId: string;
  stores: readonly MerchantOwnedStore[];
  initialPublication?: MerchantPublicationFilter;
  initialStoreId?: string | undefined;
  onOpenCatalog: (storeId: string) => void;
}>) {
  const { theme } = useMobileAppearance();
  const [query, setQuery] = useState("");
  const [publication, setPublication] = useState<MerchantPublicationFilter>(initialPublication);
  const [relation, setRelation] = useState<MerchantRelationFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialStoreId ?? null);
  const selected = stores.find(store => store.id === selectedId);

  const button = {
    minHeight: 44, paddingHorizontal: 12, paddingVertical: 8, justifyContent: "center" as const,
    borderRadius: 10, borderWidth: 1, borderColor: theme.borderColor,
  };
  const card = {
    borderColor: theme.borderColor, borderWidth: 1, borderRadius: 14,
    backgroundColor: theme.surface, gap: 10, padding: 16,
  };
  const text = { color: theme.color };
  const secondary = { color: theme.colorSecondary };

  if (selected) {
    return (
      <View testID="merchant-store-details" style={{ gap: 12 }}>
        <Pressable accessibilityRole="button" onPress={() => setSelectedId(null)}
          style={{ ...button, alignSelf: "flex-start" }}>
          <Text style={{ color: theme.interactiveText }}>العودة إلى المتاجر</Text>
        </Pressable>
        <View style={card}>
          <Text accessibilityRole="header" style={{ ...text, fontSize: 22, fontWeight: "700" }}>
            {selected.name}
          </Text>
          <Text style={text}>{publicationLabel(selected)}</Text>
          <Text style={secondary}>{relationLabel(selected)}</Text>
          <Text selectable accessibilityLabel={`معرّف المتجر ${selected.id}`} style={secondary}>{selected.id}</Text>
          <Pressable accessibilityRole="button" style={{ ...button, alignSelf: "flex-start" }}
            onPress={() => onOpenCatalog(selected.id)}>
            <Text style={{ color: theme.interactiveText }}>إدارة منتجات هذا المتجر</Text>
          </Pressable>
        </View>
        <MerchantPublicLink key={`${actorId}:${selected.id}:public`} actorId={actorId}
          storeId={selected.id} published={selected.published} />
        <StoreAvailability key={selected.id} storeId={selected.id} actorId={actorId} />
      </View>
    );
  }

  if (stores.length === 0) {
    return <View style={card}><Text style={text}>لا توجد متاجر مرتبطة بحسابك حاليًا.</Text></View>;
  }

  const visible = filterMerchantStores(stores, query, publication, relation);
  const hasFilter = query.trim() !== "" || publication !== "all" || relation !== "all";
  return (
    <View testID="merchant-store-directory" style={{ gap: 12 }}>
      <TextInput value={query} onChangeText={setQuery} maxLength={120}
        accessibilityLabel="البحث في متاجري" placeholder="ابحث باسم المتجر أو معرّفه"
        placeholderTextColor={theme.colorSecondary} returnKeyType="search"
        style={{ ...button, ...text, backgroundColor: theme.surface, fontSize: 16 }}
      />
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {publicationOptions.map(option => (
          <Pressable key={option.id} accessibilityRole="button"
            accessibilityState={{ selected: publication === option.id }}
            onPress={() => setPublication(option.id)}
            style={{ ...button, backgroundColor: publication === option.id ? theme.actionSoft : theme.surface }}
          >
            <Text style={{ color: publication === option.id ? theme.interactiveText : theme.color }}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {relationOptions.map(option => (
          <Pressable key={option.id} accessibilityRole="button"
            accessibilityState={{ selected: relation === option.id }}
            onPress={() => setRelation(option.id)}
            style={{ ...button, backgroundColor: relation === option.id ? theme.actionSoft : theme.surface }}>
            <Text style={{ color: relation === option.id ? theme.interactiveText : theme.color }}>{option.label}</Text>
          </Pressable>
        ))}
        {hasFilter ? (
          <Pressable accessibilityRole="button" style={button}
            onPress={() => { setQuery(""); setPublication("all"); setRelation("all"); }}>
            <Text style={{ color: theme.interactiveText }}>مسح التصفية</Text>
          </Pressable>
        ) : null}
      </View>
      <Text accessibilityLiveRegion="polite" style={secondary}>عدد المتاجر المعروضة: {visible.length}</Text>
      {visible.length === 0 ? (
        <View style={card}>
          <Text accessibilityLiveRegion="polite" style={text}>لا توجد متاجر مطابقة.</Text>
        </View>
      ) : visible.map(store => (
        <Pressable key={store.id} accessibilityRole="button" accessibilityLabel={`عرض ${store.name}`}
          onPress={() => setSelectedId(store.id)} style={card}>
          <Text style={{ ...text, fontSize: 18, fontWeight: "700" }}>{store.name}</Text>
          <Text style={secondary}>{relationLabel(store)} · {publicationLabel(store)}</Text>
        </Pressable>
      ))}
    </View>
  );
}
