import type { PublicOffer } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Text, View } from "react-native";
import ProductVariantPrice from "./product-variants";

export default function ProductDetail({ offer }: Readonly<{ offer: PublicOffer }>) {
  const { theme } = useMobileAppearance();
  return <View testID={`offer-${offer.id}`} style={{
    backgroundColor: theme.surface, padding: 16, borderWidth: 1,
    borderColor: theme.borderColor, borderRadius: 12, gap: 6,
  }}>
    <Text style={{ color: theme.color, fontWeight: "600", fontSize: 17 }}>{offer.name}</Text>
    <ProductVariantPrice priceYer={offer.priceYer} />
  </View>;
}
