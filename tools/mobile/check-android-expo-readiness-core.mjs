export const ANDROID_EXPO_APPS = {
  client: { packageName: "com.bthwani.client", requiredForProof: ["POST_NOTIFICATIONS", "ACCESS_FINE_LOCATION"] },
  partner: { packageName: "com.bthwani.partner", requiredForProof: ["POST_NOTIFICATIONS", "CAMERA"] },
  captain: { packageName: "com.bthwani.captain", requiredForProof: ["POST_NOTIFICATIONS", "ACCESS_FINE_LOCATION", "ACCESS_BACKGROUND_LOCATION"] },
  field: { packageName: "com.bthwani.field", requiredForProof: ["CAMERA", "ACCESS_FINE_LOCATION"] },
};

/** An OS permission is missing, denied or granted. Never infer consent from a manifest. */
export function androidPermissionStatus(dump, shortName) {
  const name = `android.permission.${shortName}`;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}: granted=(true|false)`).exec(dump);
  if (match) return match[1] === "true" ? "granted" : "denied";
  return "not-granted-or-not-declared";
}

export function androidAppReadiness(dump, expected) {
  const version = /versionName=([^\s]+)/.exec(dump)?.[1] ?? null;
  if (!version) return { installed: false, version: null, permissions: {}, readyForProof: false };
  const permissions = Object.fromEntries(expected.map((name) => [name, androidPermissionStatus(dump, name)]));
  return { installed: true, version, permissions, readyForProof: Object.values(permissions).every((state) => state === "granted") };
}
