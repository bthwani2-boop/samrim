# Order alerts — remote Android build and acceptance proof

This directory is a **prepared test kit**, not proof that a remote APK or FCM delivery has passed.

## Before submitting the remote build

1. Obtain **separate Firebase Android app configurations** for:
   - `com.bthwani.client`
   - `com.bthwani.partner`
   - `com.bthwani.captain`
2. Save each `google-services.json` under the external vault:
   `C:\BTHWANI-Secrets\samrim\expo\app-<role>\google-services.json`.
   Never add Firebase service-account **private keys** to the repo or APK.
3. Configure Android **FCM v1 credentials** for each corresponding EAS project.
   The server push dispatcher uses Expo Push Service (which uses FCM on Android).
4. Ensure the existing Android signing vault has each app's
   `credentials.json` and `development.jks` for the app-owned EAS profile.
5. Run `pwsh tools/mobile/order-alerts/preflight.ps1 -RequireFirebase` after
   secrets are provisioned. This does **not** submit an EAS build.
6. Run `pnpm mobile:build -App app-client` (then partner and captain).
   Only later, when explicitly ready, append `-Submit` to submit a new remote build.
7. After installing built APKs, configure backend `DSH_EXPO_PUSH_ENABLED=true`
   only when the service can reach `https://exp.host` and Push credentials are correct.
8. Never claim delivery merely from a successful Expo ticket; verify device reception.

## Device matrix to prove after installing APKs

| Test | Expected proof |
| --- | --- |
| Partner receives order, app in foreground | one sound and vibration, opens correct order |
| Captain receives active offer, app in foreground | one sound and vibration, opens Offers |
| Captain loses competing offer | no stale/late ring; offer cannot be accepted |
| Captain confirms **arrived at recipient** | one canonical event, only proper customer alerted |
| Duplicate arrival press/retry | same timestamp, one alert, no duplicated audit |
| Customer background / screen locked / app terminated | OS notification from FCM via Expo and actionable order open |
| Partner/captain background/locked | OS notification and correct channel sound |
| Airline mode, delayed network, reconnect | no false success, no leaked actor data, no duplicate charge or offer |
| Account A logout, then B login | old device binding removed/replaced; no A order deep link in B |
| Two concurrent orders | no ringtone stacking, links map to correct orders |
| Sound tone classic/soft/urgent | actual media matches settings (rebuild not required for selection) |
| Android silent/DND/permission denied | OS preference respected, no forced bypass |
| Operator browser tab foreground | owner-scoped unresolved cases visible; sound after user enables |
| Two different operator accounts | one operator's cases must not leak or ring for the other |
| Operator case escalation and recovery | alert only on new owned/changed priority; no repeat after resolved |
| Android long-run | 30+ minutes, locked/unlocked, app resume and power-saving states |

For each run record: APK build ID and source SHA, target device Android version,
account role (not secrets), order/offer IDs, timestamps, FCM/Expo delivery receipt,
screenshot, sound-vibration observations, and any failures. Validate DSH notifications,
outbox status and ledger separately. Never store access tokens in test logs.

## Before release

Pending real-device test execution, EAS FCM credentials, live backend environment,
and receipts validation. Do not mark the notification system 100% until those pass.
