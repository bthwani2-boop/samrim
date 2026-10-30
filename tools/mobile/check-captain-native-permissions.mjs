import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const packageName="com.bthwani.captain";
const required=[
 "android.permission.ACCESS_BACKGROUND_LOCATION",
 "android.permission.FOREGROUND_SERVICE_LOCATION",
 // An older APK can declare both permissions but lack Expo TaskManager.
 "expo.modules.taskmanager.TaskBroadcastReceiver",
];

export function evaluateCaptainNativePermissions(dumpsys){
 if(typeof dumpsys!=="string"||!dumpsys.includes(`Package [${packageName}]`))return {status:"PACKAGE_NOT_INSTALLED",missing:required};
 const missing=required.filter(p=>!dumpsys.includes(p));
 return {status:missing.length?"NATIVE_REBUILD_REQUIRED":"NATIVE_PERMISSION_DECLARATIONS_PRESENT",missing};
}
export function expoCaptainLocationReady(config){
 const entry=config.plugins?.find(p=>Array.isArray(p)&&p[0]==="expo-location");
 const settings=entry?.[1];
 return config.android?.package===packageName &&
  settings?.isAndroidBackgroundLocationEnabled===true &&
  settings?.isAndroidForegroundServiceEnabled===true;
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=(await import(pathToFileURL(path.join(repo,"apps/app-captain/app.config.ts")).href)).default;
 if(!expoCaptainLocationReady(app)){
  console.error("EXPO_CONFIG_NOT_READY: background location and foreground service must be explicitly declared");
  process.exitCode=1;
 }else{
  console.log("EXPO_CONFIG=READY_FOR_NATIVE_BUILD");
  const result=spawnSync("adb",["shell","dumpsys","package",packageName],{encoding:"utf8",timeout:12000,maxBuffer:4_000_000});
  if(result.error||result.status!==0){
   console.log("ANDROID_DEVICE_UNAVAILABLE: verify ADB before validating native permissions");
   process.exitCode=2;
  }else{
   const proof=evaluateCaptainNativePermissions(result.stdout);
   console.log(`ANDROID_NATIVE_STATUS=${proof.status}`);
   if(proof.missing.length){
    console.log(`MISSING_NATIVE_REQUIREMENTS=${proof.missing.join(",")}`);
    console.log("NEXT_STEP=install updated Expo native APK/development build, then repeat this check and run mission background tests");
    process.exitCode=2;
   }else{
    console.log("NEXT_STEP=run Maestro Android foreground/background/lock/network/location-permission/logout scenarios. This check alone does not prove background GPS works");
   }
  }
 }
}
