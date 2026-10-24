import { Host, Icon } from "@expo/ui";
import type * as React from "react";
import { View, type ColorValue } from "react-native";

import { sizing } from "../tokens/index";
import type { MobileIconName } from "./icon-types";

export type { MobileIconName } from "./icon-types";

const iconNames: Record<MobileIconName, ReturnType<typeof Icon.select>> = {
  home: Icon.select({ ios: "house.fill", android: require("@expo/material-symbols/home.xml") }),
  orders: Icon.select({ ios: "list.bullet.rectangle", android: require("@expo/material-symbols/receipt_long.xml") }),
  account: Icon.select({ ios: "person.fill", android: require("@expo/material-symbols/person.xml") }),
  wallet: Icon.select({ ios: "wallet.pass.fill", android: require("@expo/material-symbols/account_balance_wallet.xml") }),
  store: Icon.select({ ios: "storefront", android: require("@expo/material-symbols/storefront.xml") }),
  favorite: Icon.select({ ios: "heart.fill", android: require("@expo/material-symbols/favorite.xml") }),
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
  search: Icon.select({ ios: "magnifyingglass", android: require("@expo/material-symbols/search.xml") }),
  share: Icon.select({ ios: "square.and.arrow.up", android: require("@expo/material-symbols/share.xml") }),
  trending: Icon.select({ ios: "chart.line.uptrend.xyaxis", android: require("@expo/material-symbols/trending_up.xml") }),
  notifications: Icon.select({ ios: "bell.fill", android: require("@expo/material-symbols/notifications_active.xml") }),
  close: Icon.select({ ios: "xmark", android: require("@expo/material-symbols/close.xml") }),
  eye: Icon.select({ ios: "eye", android: require("@expo/material-symbols/visibility.xml") }),
  "eye-off": Icon.select({ ios: "eye.slash", android: require("@expo/material-symbols/visibility_off.xml") }),
  categories: Icon.select({ ios: "square.grid.3x3", android: require("@expo/material-symbols/grid_view.xml") }),
  restaurant: Icon.select({ ios: "fork.knife", android: require("@expo/material-symbols/restaurant.xml") }),
  grocery: Icon.select({ ios: "basket", android: require("@expo/material-symbols/shopping_basket.xml") }),
  desserts: Icon.select({ ios: "birthday.cake", android: require("@expo/material-symbols/cake.xml") }),
  beauty: Icon.select({ ios: "tshirt", android: require("@expo/material-symbols/checkroom.xml") }),
  electronics: Icon.select({ ios: "laptopcomputer.and.iphone", android: require("@expo/material-symbols/devices.xml") }),
  health: Icon.select({ ios: "cross.case", android: require("@expo/material-symbols/local_pharmacy.xml") }),
  gifts: Icon.select({ ios: "gift", android: require("@expo/material-symbols/redeem.xml") }),
  "home-projects": Icon.select({ ios: "house", android: require("@expo/material-symbols/home_work.xml") }),
  "auto-parts": Icon.select({ ios: "wrench.and.screwdriver", android: require("@expo/material-symbols/build.xml") }),
  honey: Icon.select({ ios: "leaf", android: require("@expo/material-symbols/hive.xml") }),
  mall: Icon.select({ ios: "bag", android: require("@expo/material-symbols/local_mall.xml") }),
  mic: Icon.select({ ios: "mic.fill", android: require("@expo/material-symbols/mic.xml") }),
  send: Icon.select({ ios: "paperplane.fill", android: require("@expo/material-symbols/send.xml") }),
  play: Icon.select({ ios: "play.fill", android: require("@expo/material-symbols/play_arrow.xml") }),
  pause: Icon.select({ ios: "pause.fill", android: require("@expo/material-symbols/pause.xml") }),
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
    <View pointerEvents="none" style={{ width: size, height: size }}>
      <Host matchContents style={{ width: size, height: size }}>
        <Icon {...props} />
      </Host>
    </View>
  );
}
