import { expect, test } from "@playwright/test";

const root = {
 subject:"act_root_hr_manager",role:"operator",sessionId:"session_hr_manager",
 surface:"control-panel",permissions:["hr"],canManageOperatorPermissions:true,expiresAt:"2099-01-01T00:00:00Z",
};
const employee={
 id:"emp_11111111111111111111111111111111",fullNameAr:"علي الصنعاني",
 phoneE164:"+967777000101",department:"العمليات",jobTitle:"موظف",startDate:"2026-10-12",
 workLocation:"صنعاء",status:"active",version:1,createdAt:"2026-10-12T00:00:00Z",
};
const manager={
 ...employee,id:"emp_22222222222222222222222222222222",
 fullNameAr:"سليم مدير العمليات",phoneE164:"+967777000102",
};

test.beforeEach(async({page})=>{
 await page.route("**/api/auth/session**",r=>r.fulfill({json:{identity:root}}));
 await page.route("**/api/hr/access-requests?**",r=>r.fulfill({json:{items:[],nextCursor:""}}));
 await page.route("**/api/hr/employees?**",r=>{
   const query=new URL(r.request().url()).searchParams.get("q");
   return r.fulfill({json:{items:query==="سليم"?[manager]:[employee],nextCursor:""}});
 });
});

test("employee create can select an active manager outside the displayed directory page",async({page})=>{
 let savedManager="";
 await page.route("**/api/hr/employees",async r=>{
   if(r.request().method()!=="POST")return r.fallback();
   savedManager=r.request().postDataJSON().managerEmployeeId;
   return r.fulfill({status:201,json:{employee:{...employee,id:"emp_33333333333333333333333333333333",managerEmployeeId:savedManager},idempotentReplay:false}});
 });
 await page.goto("/hr/employees");
 await page.getByRole("button",{name:"إضافة موظف"}).click();
 await page.getByRole("textbox",{name:"البحث عن المسؤول المباشر"}).fill("سليم");
 await page.getByRole("button",{name:"بحث عن مسؤول"}).click();
 const selection=page.getByRole("combobox",{name:"المسؤول المباشر (اختياري)"});
 await expect(selection.getByRole("option",{name:manager.fullNameAr})).toBeAttached();
 await selection.selectOption(manager.id);
 await expect(selection).toHaveValue(manager.id);
 const form=page.locator("#employee-create");
 await form.getByRole("textbox",{name:"الاسم الكامل"}).fill("سعد علي الصنعاني");
 await form.getByRole("textbox",{name:"القسم",exact:true}).fill("العمليات");
 await form.getByRole("textbox",{name:"المسمى الوظيفي"}).fill("مساعد عمليات");
 await form.getByRole("textbox",{name:"موقع العمل"}).fill("صنعاء");
 await form.locator('input[type="date"]').fill("2026-10-12");
 await form.getByRole("button",{name:"حفظ الموظف"}).click();
 await expect.poll(()=>savedManager).toBe(manager.id);
});

test("employee edit retains and resolves an off-page reporting line",async({page})=>{
 await page.route("**/api/hr/employees?**",r=>{
   const query=new URL(r.request().url()).searchParams.get("q");
   return r.fulfill({json:{items:query==="سليم"?[manager]:[{...employee,managerEmployeeId:manager.id}],nextCursor:""}});
 });
 await page.goto("/hr/employees");
 await page.getByRole("button",{name:`فتح ملف ${employee.fullNameAr}`}).click();
 await page.getByRole("button",{name:"تعديل البيانات"}).click();
 const selection=page.getByRole("combobox",{name:"المسؤول المباشر (اختياري)"});
 await expect(selection).toHaveValue(manager.id);
 await page.getByRole("textbox",{name:"البحث عن المسؤول المباشر"}).fill("سليم");
 await page.getByRole("button",{name:"بحث عن مسؤول"}).click();
 await expect(selection.getByRole("option",{name:manager.fullNameAr})).toBeAttached();
 await expect(selection).toHaveValue(manager.id);
});

test("manager lookup continues across cursor pages without losing its selection",async({page})=>{
 await page.route("**/api/hr/employees?**",route=>{
   const url=new URL(route.request().url());
   const query=url.searchParams.get("q");
   const cursor=url.searchParams.get("cursor");
   if(query!=="سليم")return route.fulfill({json:{items:[employee],nextCursor:""}});
   expect(url.searchParams.get("limit")).toBe("50");
   if(cursor==="next")return route.fulfill({json:{items:[manager],nextCursor:""}});
   return route.fulfill({json:{items:[{...manager,id:"emp_44444444444444444444444444444444",fullNameAr:"سليم أول"}],nextCursor:"next"}});
 });
 await page.goto("/hr/employees");
 await page.getByRole("button",{name:"إضافة موظف"}).click();
 await page.getByRole("textbox",{name:"البحث عن المسؤول المباشر"}).fill("سليم");
 await page.getByRole("button",{name:"بحث عن مسؤول"}).click();
 await page.getByRole("button",{name:"عرض المزيد من نتائج البحث"}).click();
 const selection=page.getByRole("combobox",{name:"المسؤول المباشر (اختياري)"});
 await expect(selection.getByRole("option",{name:manager.fullNameAr})).toBeAttached();
 await selection.selectOption(manager.id);
 await expect(selection).toHaveValue(manager.id);
 await expect(page.getByRole("button",{name:"عرض المزيد من نتائج البحث"})).toHaveCount(0);
});
