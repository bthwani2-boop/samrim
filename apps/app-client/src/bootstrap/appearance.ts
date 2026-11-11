import * as SecureStore from "@bthwani/identity/secure-storage";

import { createMobileAppearanceController } from "@bthwani/design-system/native";

export const appearance = createMobileAppearanceController({
  key: "bthwani.client.appearance",
  storage: {
    getItem: (key) => SecureStore.getItemAsync(key),
    setItem: (key, value) => SecureStore.setItemAsync(key, value),
  },
});
