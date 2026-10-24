import test from "node:test";
import assert from "node:assert/strict";
import { evaluateCaptainNativePermissions,expoCaptainLocationReady } from "./check-captain-native-permissions.mjs";

const fake={android:{package:"com.bthwani.captain"},plugins:[["expo-location",{isAndroidBackgroundLocationEnabled:true,isAndroidForegroundServiceEnabled:true}]]};
test("Expo configuration requests explicit background permission and foreground service",()=>{
 assert.equal(expoCaptainLocationReady(fake),true);
 assert.equal(expoCaptainLocationReady({...fake,plugins:[["expo-location",{isAndroidBackgroundLocationEnabled:false,isAndroidForegroundServiceEnabled:true}]]}),false);
});
test("installed Android package needs a new native build when permission declarations are absent",()=>{
 assert.deepEqual(evaluateCaptainNativePermissions("Package [com.bthwani.captain] android.permission.FOREGROUND_SERVICE"),{
 status:"NATIVE_REBUILD_REQUIRED",missing:["android.permission.ACCESS_BACKGROUND_LOCATION","android.permission.FOREGROUND_SERVICE_LOCATION"]
 });
 assert.equal(evaluateCaptainNativePermissions("Package [com.bthwani.captain] android.permission.ACCESS_BACKGROUND_LOCATION android.permission.FOREGROUND_SERVICE_LOCATION").status,"NATIVE_PERMISSION_DECLARATIONS_PRESENT");
 assert.equal(evaluateCaptainNativePermissions("Package [not_installed]").status,"NATIVE_REBUILD_REQUIRED");
});
