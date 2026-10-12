import { expect,test } from "@playwright/test";

const employee={id:"emp_11111111111111111111111111111111",fullNameAr:"محمد علي صالح",phoneE164:"",
 department:"العمليات",jobTitle:"موظف",startDate:"2026-10-01",workLocation:"صنعاء",
 status:"active",version:1,createdAt:"2026-10-01T00:00:00Z"};
const root={subject:"act_root_attendance",role:"operator",sessionId:"root_session",surface:"control-panel",
 permissions:["hr"],canManageOperatorPermissions:true,expiresAt:"2099-01-01T00:00:00Z"};

test("Manual HR attendance is unknown by default and corrections use the latest optimistic version",async({page})=>{
 await page.route("**/api/auth/session**",route=>route.fulfill({json:{identity:root}}));
 await page.route("**/api/hr/employees?**",route=>route.fulfill({json:{items:[employee],nextCursor:""}}));
 let record:Record<string,unknown>|null=null, writes=0;
 await page.route("**/api/hr/employees/*/attendance?**",route=>route.fulfill({json:{items:record?[record]:[]}}));
 await page.route("**/api/hr/employees/*/attendance",async route=>{
  if(route.request().method()!=="POST"){await route.fallback();return;}
  const body=route.request().postDataJSON() as {date:string;status:string;note:string;expectedVersion:number;checkInAt?:string};
  expect(body.date).toBe("2026-10-12");
  expect(body.expectedVersion).toBe(writes);
  expect(body.note.length).toBeGreaterThanOrEqual(8);
  expect(route.request().headers()["idempotency-key"]).toBeTruthy();
  if(body.status==="absent")expect(body.checkInAt).toBeUndefined();
  writes++;
  record={employeeId:employee.id,date:body.date,status:body.status,note:body.note,version:writes,
    recordedByActorId:root.subject,recordedAt:"2026-10-12T10:00:00Z"};
  await route.fulfill({json:{record,idempotentReplay:false}});
 });
 await page.goto("/hr/employees");
 await page.locator(".hr-directory .operations-table button").first().click();
 const attendance=page.getByRole("region",{name:"الحضور اليدوي"});
 await expect(attendance.getByText("هذا اليوم غير مسجل", {exact:false})).toBeVisible();
 await attendance.getByLabel("التاريخ").fill("2026-10-12");
 await attendance.getByLabel("الحالة").selectOption("absent");
 await attendance.getByLabel("سبب التسجيل أو التصحيح").fill("سجل غياب يدوي بعد مراجعة تقرير المدير");
 await attendance.getByRole("button",{name:"تسجيل الحضور"}).click();
 await expect(attendance.getByText("الإصدار 1", {exact:false})).toBeVisible();
 await attendance.getByLabel("الحالة").selectOption("present");
 await attendance.getByLabel("سبب التسجيل أو التصحيح").fill("تصحيح حضور مثبت بمراجعة مسؤول الموارد");
 await attendance.getByRole("button",{name:"حفظ تصحيح موثق"}).click();
 await expect(attendance.getByText("الإصدار 2", {exact:false})).toBeVisible();
 expect(writes).toBe(2);
});

test("HR route is inaccessible without HR permission",async({page})=>{
 await page.route("**/api/auth/session**",route=>route.fulfill({json:{identity:{...root,permissions:["catalog"],canManageOperatorPermissions:false}}}));
 await page.goto("/hr/employees");
 await expect(page.getByRole("region",{name:"الحضور اليدوي"})).toHaveCount(0);
});
