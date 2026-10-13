import { expect, test } from "@playwright/test";

const person = {
  id:"emp_11111111111111111111111111111111",
  fullNameAr:"محمود علي الصنعاني",phoneE164:"+967777104052",department:"العمليات",jobTitle:"مشرف العمليات",
  startDate:"2026-10-12",workLocation:"صنعاء",status:"active",operatorActorId:"act_employee_proof",
  version:5,createdAt:"2026-10-12T00:00:00Z",
};
const root={subject:"act_root_proof",role:"operator",sessionId:"session_root_proof",surface:"control-panel",
  permissions:["hr"],canManageOperatorPermissions:true,expiresAt:"2099-01-01T00:00:00Z"};

test("Root ends employment on the same HR record and preserves operator actor identity",async({page})=>{
 await page.route("**/api/auth/session**",route=>route.fulfill({json:{identity:root}}));
 await page.route("**/api/hr/employees?**",route=>route.fulfill({json:{items:[person],nextCursor:""}}));
 await page.route("**/api/hr/access-requests?**",route=>route.fulfill({json:{items:[],nextCursor:""}}));
 let changes=0;
 await page.route("**/api/hr/employees/*/employment-status",route=>{
  const request=route.request();
  const body=request.postDataJSON() as {status:string;reason:string;expectedVersion:number};
  expect(body.status).toBe("inactive");
  expect(body.expectedVersion).toBe(5);
  expect(body.reason.length).toBeGreaterThanOrEqual(8);
  expect(request.headers()["idempotency-key"]).toBeTruthy();
  changes+=1;
  return route.fulfill({json:{employee:{...person,status:"inactive",version:6},idempotentReplay:false}});
 });
 await page.goto("/hr/employees");
 await page.locator(".hr-directory .operations-table button").first().click();
 await page.getByRole("textbox",{name:"سبب تغيير الحالة الوظيفية"}).fill("إنهاء خدمة الموظف وتقييد الوصول بعد المراجعة");
 await page.getByRole("button",{name:"إيقاف الحالة الوظيفية"}).click();
 await expect(page.getByText("تم إيقاف الحالة الوظيفية", {exact:false})).toBeVisible();
 await expect(page.locator(".hr-directory tbody").getByRole("img", {name:"غير نشط", exact:true})).toBeVisible();
 expect(changes).toBe(1);
});

test("HR operator without Root Owner role cannot end linked operator employment",async({page})=>{
 await page.route("**/api/auth/session**",route=>route.fulfill({json:{identity:{...root,canManageOperatorPermissions:false}}}));
 await page.route("**/api/hr/employees?**",route=>route.fulfill({json:{items:[person],nextCursor:""}}));
 await page.route("**/api/hr/access-requests?**",route=>route.fulfill({json:{items:[],nextCursor:""}}));
 await page.goto("/hr/employees");
 await page.locator(".hr-directory .operations-table button").first().click();
 await expect(page.getByRole("button",{name:"إيقاف الحالة الوظيفية"})).toHaveCount(0);
});


test("HR audit history shows attributed status reasons and paginates older employee events",async({page})=>{
 await page.route("**/api/auth/session**",route=>route.fulfill({json:{identity:root}}));
 await page.route("**/api/hr/employees?**",route=>route.fulfill({json:{items:[person],nextCursor:""}}));
 await page.route("**/api/hr/access-requests?**",route=>route.fulfill({json:{items:[],nextCursor:""}}));
 await page.route("**/api/hr/employees/*/events?**",route=>{
  const url=new URL(route.request().url());
  const cursor=url.searchParams.get("cursor");
  if(cursor==="cursor2")return route.fulfill({json:{items:[{eventType:"created",actingActorId:"act_initial",createdAt:"2026-10-10T10:00:00Z"}]}});
  return route.fulfill({json:{items:[{eventType:"status_changed",actingActorId:"act_root",reason:"المراجعة الوظيفية الموثقة",createdAt:"2026-10-12T12:00:00Z"}],nextCursor:"cursor2"}});
 });
 await page.goto("/hr/employees");
 await page.locator(".hr-directory .operations-table button").first().click();
 await page.getByRole("button",{name:"عرض سجل التغييرات"}).click();
 await expect(page.getByText("المراجعة الوظيفية الموثقة")).toBeVisible();
 await expect(page.getByText("act_root")).toBeVisible();
 await page.getByRole("button",{name:"عرض أحداث أقدم"}).click();
 await expect(page.getByText("إنشاء ملف الموظف")).toBeVisible();
});
