import { defineSamrimExpoApp } from "../../tools/mobile/define-samrim-expo-app.cjs";
import { withCanonicalAndroidDevelopmentClient } from "../../tools/mobile/with-android-development-client.cjs";

export default withCanonicalAndroidDevelopmentClient(
  defineSamrimExpoApp("app-field"),
  "app-field",
);
