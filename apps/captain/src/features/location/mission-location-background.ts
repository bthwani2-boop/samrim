/** Gating only; no native background task starts without explicit device and owner consent. */
export function canEnableBackgroundMissionLocation(s:Readonly<{
  foregroundGranted:boolean;backgroundGranted:boolean;activeAssignment:boolean;
  ownerAllowsBackground:boolean;identityVerified:boolean;android:boolean;
}>):boolean {
  return s.android && s.foregroundGranted && s.backgroundGranted && s.activeAssignment &&
    s.ownerAllowsBackground && s.identityVerified;
}
