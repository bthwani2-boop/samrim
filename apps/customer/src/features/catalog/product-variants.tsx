import type { PublicOffer } from "@bthwani/dsh";
import { useMobileAppearance } from "@bthwani/tamagui-config/appearance";
import { Text } from "react-native";
import { formatPublicPriceYer } from "./price-format";

/** Variant prices are display-only until DSH orderability and checkout are admitted. */
export default function ProductVariantPrice({ priceYer }: Readonly<{ priceYer: PublicOffer["priceYer"] }>) {
  const { theme } = useMobileAppearance();
  return <Text style={{ color: theme.colorSecondary }}>{formatPublicPriceYer(priceYer)}</Text>;
}
