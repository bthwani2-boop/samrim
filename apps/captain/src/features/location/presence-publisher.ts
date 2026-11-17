/** Latest-fix only. Owner DSH policy is supplied, never duplicated as client constants. */
export type CaptainFix=Readonly<{latitude:number;longitude:number;accuracyM:number;capturedAtMs:number}>;
export type OwnerFixPolicy=Readonly<{maxAgeMs:number;maxFutureSkewMs:number;maxAccuracyM:number}>;
export function isAcceptableFix(f:CaptainFix,p:OwnerFixPolicy,now=Date.now()):boolean {
  return [f.latitude,f.longitude,f.accuracyM,f.capturedAtMs,p.maxAgeMs,p.maxFutureSkewMs,p.maxAccuracyM,now].every(Number.isFinite) &&
    Math.abs(f.latitude)<=90 && Math.abs(f.longitude)<=180 && f.accuracyM>=0 &&
    p.maxAgeMs>0 && p.maxFutureSkewMs>=0 && p.maxAccuracyM>0 && f.accuracyM<=p.maxAccuracyM &&
    f.capturedAtMs>=now-p.maxAgeMs && f.capturedAtMs<=now+p.maxFutureSkewMs;
}
export async function publishLatestPresence(f:CaptainFix,p:OwnerFixPolicy,
  rights:Readonly<{foregroundGranted:boolean;identityVerified:boolean;ownerReady:boolean}>,
  ownerPublish:(fix:CaptainFix)=>Promise<void>,now=Date.now()):Promise<boolean> {
  if(!rights.foregroundGranted || !rights.identityVerified || !rights.ownerReady || !isAcceptableFix(f,p,now)) return false;
  await ownerPublish(f);
  return true;
}
