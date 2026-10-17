import { test, expect } from "@playwright/test";

const store = {
 id:"store-catalog-proof",partnerActorId:"partner-proof",name:"متجر اختباري",partnerName:"شريك تجريبي",
 serviceCityName:"صنعاء",primaryVerticalName:"مطاعم",serviceCityId:"sanaa",primaryVerticalId:"restaurants",
 commercialStoreTypeId:null,deliveryOrigin:null,fulfillmentModes:["BTHWANI_CAPTAIN"],version:1,
 publicationState:"unpublished",publicationReadiness:{ready:false,blockedReason:"STORE_SCHEDULE_NOT_READY",blockedReasons:["STORE_SCHEDULE_NOT_READY","CATALOG_NOT_READY"]},
 createdAt:"2026-10-16T00:00:00Z",updatedAt:"2026-10-16T00:00:00Z"
};
const shared = {
 id:"product-pizza",verticalId:"restaurants",scope:"SHARED",canonicalName:"بيتزا مارجريتا",
 description:"",active:true,version:1,createdAt:"2026-10-16T00:00:00Z",updatedAt:"2026-10-16T00:00:00Z",
 categoryIds:["pizza"],attributes:[],media:[],variants:[{id:"variant-pizza",productId:"product-pizza",title:"الحجم العادي",measurementKind:"DISCRETE",baseUnit:"COUNT",active:true,version:1,identifiers:[],attributes:[],createdAt:"2026-10-16T00:00:00Z",updatedAt:"2026-10-16T00:00:00Z"}]
};

test("Store file creates its own draft offer from a Shared Product without partner impersonation",async({page})=>{
 const offers: Array<Record<string,unknown>>=[];
 let created:Record<string,unknown>|null=null;let key="";
 await page.route("**/api/**",(route)=>route.fulfill({status:503,json:{error:{code:"BLOCKED",message:"Unmocked request"}}}));
 await page.route("**/api/auth/session**",(route)=>route.fulfill({json:{identity:{subject:"operator-proof",sessionId:"session-proof",role:"operator",permissions:["partners","catalog"],surface:"control-panel",expiresAt:"2099-01-01T00:00:00Z"}}}));
 await page.route("**/api/notifications**",(route)=>route.fulfill({json:{notifications:[],unreadCount:0}}));
 await page.route("**/api/partners/workbench**",(route)=>route.fulfill({json:{rows:[{kind:"store",store,partnerRole:null}],nextCursor:""}}));
 await page.route("**/api/stores/store-catalog-proof/publication",(route)=>route.fulfill({json:{store,idempotentReplay:false}}));
 await page.route("**/api/stores/store-catalog-proof/offers**",async(route)=>{
  if(route.request().method()==="POST"){
   created=route.request().postDataJSON() as Record<string,unknown>;
   key=route.request().headers()["idempotency-key"]??"";
   const offer={offerId:"offer-pizza",storeId:store.id,variantId:"variant-pizza",productId:"product-pizza",productName:"بيتزا مارجريتا",variantTitle:"الحجم العادي",measurementKind:"DISCRETE",baseUnit:"COUNT",priceMinor:2500,currency:"YER",quantityPolicy:"DISCRETE",quantityMinBaseUnits:1,quantityMaxBaseUnits:100,quantityStepBaseUnits:1,pricingBasis:"PER_UNIT",pricingUnitBaseUnits:1,inventoryPolicy:"AVAILABILITY_ONLY",inventoryOnHandBaseUnits:0,inventoryReservedBaseUnits:0,availability:true,publicationState:"draft",productActive:true,variantActive:true,media:[],modifierGroups:[],version:1,createdAt:"2026-10-16T00:00:00Z",updatedAt:"2026-10-16T00:00:00Z"};
   offers.push(offer);
   return route.fulfill({status:201,json:{offer,idempotentReplay:false}});
  }
  return route.fulfill({json:{offers,nextCursor:""}});
 });
 await page.route("**/api/stores/store-catalog-proof/products**",(route)=>route.fulfill({json:{products:[shared],nextCursor:""}}));
 await page.goto("/partners?inspect=store-catalog-proof");
 const inspector=page.locator(".store-profile");
 await expect(inspector).toBeVisible();
 await expect(inspector.locator(".store-profile-blockers")).toContainText("ساعات عمل المتجر");
 await expect(inspector.locator(".store-profile-blockers")).toContainText("لا يوجد كتالوج");
 await inspector.getByRole("tab",{name:/المنتجات/}).click();
 const editor=inspector.locator(".store-product-management");
 await expect(editor).toBeVisible();
 await editor.getByRole("button",{name:"إضافة منتج"}).click();
 await editor.getByLabel("المنتج والنسخة").selectOption("variant-pizza");
 await editor.getByLabel("السعر بالريال اليمني").fill("2500");
 await editor.getByRole("button",{name:"حفظ المنتج"}).click();
 await expect(editor.getByRole("status")).toContainText("تم حفظ المنتج");
 await expect(editor).toContainText("بيتزا مارجريتا");
 expect(created).toMatchObject({variantId:"variant-pizza",priceMinor:2500,quantityPolicy:"DISCRETE"});
 expect(key.length).toBeGreaterThanOrEqual(8);
});
