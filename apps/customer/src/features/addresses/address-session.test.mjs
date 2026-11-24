import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source=file=>readFileSync(new URL(file,import.meta.url),"utf8");
test("address screens read and save through the verified DSH adapter; map choice is not a write",()=>{
  assert.match(source("addresses-screen.tsx"),/readVerifiedAddresses\(/);
  assert.match(source("addresses-screen.tsx"),/writeVerifiedAddress\(/);
  assert.match(source("address-transport.ts"),/withVerifiedNativeCustomerRead/);
  assert.match(source("address-transport.ts"),/readCustomerAdmission/);
  assert.doesNotMatch(source("addresses-screen.tsx"),/fetch\(|AsyncStorage|SecureStore/);
  assert.doesNotMatch(source("address-editor.native.tsx"),/fetch\(|writeVerifiedAddress|saveCustomerAddress/);
  assert.match(source("address-editor.native.tsx"),/onSelect\(pin\)/);
});
