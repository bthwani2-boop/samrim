import React from "react";
import type { ImageStyle, StyleProp } from "react-native";
import { Image } from "expo-image";

type Props = {
  readonly uri: string;
  readonly style: StyleProp<ImageStyle>;
  readonly contentFit?: "cover" | "contain";
  readonly accessibilityLabel?: string;
  readonly onError?: () => void;
};

export function ClientRemoteImage({
  uri,
  style,
  contentFit = "cover",
  accessibilityLabel,
  onError,
}: Props) {
  return (
    <Image
      source={uri}
      style={style}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      transition={150}
      accessibilityLabel={accessibilityLabel ?? "صورة"}
      accessibilityIgnoresInvertColors
      {...(onError !== undefined ? { onError } : {})}
    />
  );
}
