import { Host, Icon } from "@expo/ui";
import type * as React from "react";
import type { ColorValue } from "react-native";

import { sizing } from "../tokens/index";

export type MobileIconName =
  | "home"
  | "orders"
  | "account"
  | "store"
  | "offers"
  | "deliveries"
  | "cases"
  | "cart"
  | "back"
  | "forward"
  | "add"
  | "edit"
  | "location"
  | "appearance"
  | "refresh"
  | "warning"
  | "success";

const iconNames: Record<MobileIconName, ReturnType<typeof Icon.select>> = {
  home: Icon.select({ ios: "house.fill", android: require("@expo/material-symbols/home.xml") }),
  orders: Icon.select({ ios: "list.bullet.rectangle", android: require("@expo/material-symbols/receipt_long.xml") }),
  account: Icon.select({ ios: "person.fill", android: require("@expo/material-symbols/person.xml") }),
  store: Icon.select({ ios: "storefront", android: require("@expo/material-symbols/storefront.xml") }),
  offers: Icon.select({ ios: "tag.fill", android: require("@expo/material-symbols/sell.xml") }),
  deliveries: Icon.select({ ios: "truck.box.fill", android: require("@expo/material-symbols/local_shipping.xml") }),
  cases: Icon.select({ ios: "folder.fill", android: require("@expo/material-symbols/folder.xml") }),
  cart: Icon.select({ ios: "cart.fill", android: require("@expo/material-symbols/shopping_cart.xml") }),
  back: Icon.select({ ios: "chevron.backward", android: require("@expo/material-symbols/arrow_back.xml") }),
  forward: Icon.select({ ios: "chevron.forward", android: require("@expo/material-symbols/arrow_forward.xml") }),
  add: Icon.select({ ios: "plus", android: require("@expo/material-symbols/add.xml") }),
  edit: Icon.select({ ios: "pencil", android: require("@expo/material-symbols/edit.xml") }),
  location: Icon.select({ ios: "mappin.and.ellipse", android: require("@expo/material-symbols/location_on.xml") }),
  appearance: Icon.select({ ios: "circle.lefthalf.filled", android: require("@expo/material-symbols/brightness_6.xml") }),
  refresh: Icon.select({ ios: "arrow.clockwise", android: require("@expo/material-symbols/refresh.xml") }),
  warning: Icon.select({ ios: "exclamationmark.triangle", android: require("@expo/material-symbols/warning.xml") }),
  success: Icon.select({ ios: "checkmark.circle", android: require("@expo/material-symbols/check_circle.xml") }),
};

export function BthwaniIcon({
  name,
  color,
  size = sizing.iconLg,
  accessibilityLabel,
}: {
  name: MobileIconName;
  color?: ColorValue;
  size?: number;
  accessibilityLabel?: string;
}) {
  const props: React.ComponentProps<typeof Icon> = { name: iconNames[name], size };
  if (color !== undefined) props.color = color;
  if (accessibilityLabel !== undefined) props.accessibilityLabel = accessibilityLabel;
  return (
    <Host matchContents style={{ width: size, height: size }}>
      <Icon {...props} />
    </Host>
  );
}
