import * as SecureStore from "expo-secure-store";

import { createMobileAppearanceController } from "@bthwani/design-system/native";

export const appearance = createMobileAppearanceController({
  key: "bthwani.client.appearance",
  storage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  },
});
