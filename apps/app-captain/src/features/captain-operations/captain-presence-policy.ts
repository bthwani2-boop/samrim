export const captainPresenceIntervalMs = 5 * 60 * 1000;
export function shouldPublishCaptainPresence(
    foreground: boolean, hasPermission: boolean, authenticated: boolean,
    available: boolean,
): boolean {
    return foreground && hasPermission && authenticated && available;
}
