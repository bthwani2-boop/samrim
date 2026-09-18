import { Host, Icon } from "@expo/ui/jetpack-compose";
import type { ColorValue, ImageSourcePropType } from "react-native";

import { sizing } from "../tokens/index";
import type { MobileIconName } from "./icon-types";

export type { MobileIconName } from "./icon-types";

const iconSources: Record<MobileIconName, ImageSourcePropType> = {
  home: require("@expo/material-symbols/home.xml"),
  orders: require("@expo/material-symbols/receipt_long.xml"),
  account: require("@expo/material-symbols/person.xml"),
  store: require("@expo/material-symbols/storefront.xml"),
  offers: require("@expo/material-symbols/sell.xml"),
  deliveries: require("@expo/material-symbols/local_shipping.xml"),
  cases: require("@expo/material-symbols/folder.xml"),
  cart: require("@expo/material-symbols/shopping_cart.xml"),
  back: require("@expo/material-symbols/arrow_back.xml"),
  forward: require("@expo/material-symbols/arrow_forward.xml"),
  add: require("@expo/material-symbols/add.xml"),
  edit: require("@expo/material-symbols/edit.xml"),
  location: require("@expo/material-symbols/location_on.xml"),
  appearance: require("@expo/material-symbols/brightness_6.xml"),
  refresh: require("@expo/material-symbols/refresh.xml"),
  warning: require("@expo/material-symbols/warning.xml"),
  success: require("@expo/material-symbols/check_circle.xml"),
  search: require("@expo/material-symbols/search.xml"),
  notifications: require("@expo/material-symbols/notifications_active.xml"),
  close: require("@expo/material-symbols/close.xml"),
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
  const iconProps = {
    source: iconSources[name],
    size,
    ...(color !== undefined ? { tint: color } : {}),
    ...(accessibilityLabel !== undefined ? { contentDescription: accessibilityLabel } : {}),
  };

  return (
    <Host matchContents style={{ width: size, height: size }}>
      <Icon {...iconProps} />
    </Host>
  );
}
