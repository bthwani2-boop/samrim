from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_exact_count(path: str, old: str, new: str, expected: int) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


go_catalog = "services/dsh/backend/internal/storage/postgres/catalog_refoundation_test.go"
replace_once(
    go_catalog,
    '''\t\t\tif _, err := db.ExecContext(ctx, `INSERT INTO dsh.field_admissions(id,contact_phone_e164,full_name_ar,state,created_at)\n\t\t\t\tVALUES($1,$2,$3,'pending_identity',$4)`, "field_"+suffix, fmt.Sprintf("+967770011%03d", index+1), "مندوب "+suffix, createdAt); err != nil {''',
    '''\t\t\tif _, err := db.ExecContext(ctx, `INSERT INTO dsh.field_admissions(id,contact_phone_e164,full_name_ar,service_city_id,state,created_at)\n\t\t\t\tVALUES($1,$2,$3,$4,'pending_identity',$5)`, "field_"+suffix, fmt.Sprintf("+967770011%03d", index+1), "مندوب "+suffix, createdCity.City.ID, createdAt); err != nil {''',
)

go_fulfillment = "services/dsh/backend/internal/storage/postgres/store_fulfillment_modes_test.go"
replace_once(
    go_fulfillment,
    '''\tif _, err := db.ExecContext(ctx, "INSERT INTO dsh.stores(id, partner_actor_id, name) VALUES($1,$2,$3)", storeID, partnerActorID, "Fulfillment Modes Store"); err != nil {\n\t\tt.Fatalf("insert fulfillment mode Store fixture: %v", err)\n\t}\n''',
    '''\tinsertCanonicalStoreFixture(t, ctx, db, canonicalStoreFixture{\n\t\tID:             storeID,\n\t\tPartnerActorID: partnerActorID,\n\t\tName:           "Fulfillment Modes Store",\n\t})\n''',
)

ts = "apps/control-panel/tests/auth-shell.spec.ts"
replace_once(
    ts,
    '''async function exerciseReviewedDshCandidateFlow(page: Page, role: "captain" | "field", initialName: string, reviewedName: string, phone: string) {''',
    '''async function stubCommercialStoreTypes(page: Page) {\n  await page.route("**/api/catalog/commercial-store-types**", async (route) => {\n    await route.fulfill({\n      status: 200,\n      contentType: "application/json",\n      body: JSON.stringify({ storeTypes: [{ id: "grocery-market", verticalId: "grocery", nameAr: "بقالة عامة", nameEn: "Grocery Store", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }),\n    });\n  });\n}\n\nasync function exerciseReviewedDshCandidateFlow(page: Page, role: "captain" | "field", initialName: string, reviewedName: string, phone: string) {''',
)
replace_once(
    ts,
    '''  let profile: { id: string; actorId?: string; fullNameAr: string; contactPhoneE164: string; state: string; version: number } | null = null;\n  const mutations: Record<string, unknown>[] = [];\n\n  await page.route(`**/api/${surface}**`, async (route) => {''',
    '''  let profile: { id: string; actorId?: string; fullNameAr: string; contactPhoneE164: string; serviceCityId?: string; state: string; version: number } | null = null;\n  const mutations: Record<string, unknown>[] = [];\n\n  if (role === "field") {\n    await page.route("**/api/service-cities**", async (route) => {\n      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cities: [{ id: "sanaa", displayNameAr: "صنعاء", active: true, version: 1, createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }] }) });\n    });\n  }\n\n  await page.route(`**/api/${surface}**`, async (route) => {''',
)
replace_once(
    ts,
    '''      profile = { id: admissionID, fullNameAr: String(body.fullNameAr), contactPhoneE164: String(body.contactPhoneE164), state: "pending_review", version: 1 };''',
    '''      profile = { id: admissionID, fullNameAr: String(body.fullNameAr), contactPhoneE164: String(body.contactPhoneE164), ...(role === "field" ? { serviceCityId: String(body.serviceCityId) } : {}), state: "pending_review", version: 1 };''',
)
replace_once(
    ts,
    '''  await page.locator(`#${role}-candidate-phone`).fill(phone);\n  await page.getByRole("button", { name: role === "captain" ? "حفظ الملف للمراجعة" : "حفظ للمراجعة" }).click();''',
    '''  await page.locator(`#${role}-candidate-phone`).fill(phone);\n  if (role === "field") await page.locator("#field-candidate-city").selectOption("sanaa");\n  await page.getByRole("button", { name: role === "captain" ? "حفظ الملف للمراجعة" : "حفظ للمراجعة" }).click();''',
)
replace_once(
    ts,
    '''  expect(mutations).toEqual([\n    { action: "admit", fullNameAr: initialName, contactPhoneE164: phone },''',
    '''  expect(mutations).toEqual([\n    role === "field" ? { action: "admit", fullNameAr: initialName, contactPhoneE164: phone, serviceCityId: "sanaa" } : { action: "admit", fullNameAr: initialName, contactPhoneE164: phone },''',
)
replace_once(
    ts,
    '''  await expect(page.locator("p.identity-error")).toContainText("أُعيد تحميل الحالة الحالية");''',
    '''  await expect(page.getByText(/أُعيد تحميل الحالة الحالية/)).toBeVisible();''',
)

for title in [
    "operator creates a DSH-owned joining case from prospective partner facts",
    "operator resumes an uncertain joining-case create with the same idempotency key after reload",
    "partner Store publication exposes the canonical readiness block",
]:
    replace_once(
        ts,
        f'''test("{title}", async ({{ page }}) => {{\n  await stubAuthenticatedSession(page);''',
        f'''test("{title}", async ({{ page }}) => {{\n  await stubAuthenticatedSession(page);\n  await stubCommercialStoreTypes(page);''',
    )

replace_exact_count(
    ts,
    '''  await page.getByLabel("الفئة الرئيسية").selectOption("grocery");''',
    '''  await page.getByLabel("الفئة الرئيسية", { exact: true }).selectOption("grocery");\n  await page.getByLabel("نوع المتجر التجاري", { exact: true }).selectOption("grocery-market");''',
    3,
)
replace_once(
    ts,
    '''expect(requestBody).toEqual({ contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] });''',
    '''expect(requestBody).toEqual({ contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreCommercialTypeId: "grocery-market", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] });''',
)
replace_once(
    ts,
    '''  const expectedBody = { contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] };''',
    '''  const expectedBody = { contactPhoneE164: "+96777000100", businessName: "نشاط الاختبار", firstStoreName: "متجر الاختبار", serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreCommercialTypeId: "grocery-market", firstStoreLatitude: 15.369445, firstStoreLongitude: 44.191006, firstStoreFulfillmentModes: ["CUSTOMER_PICKUP"] };''',
)
replace_once(
    ts,
    '''  const createdCase = { id: "join_retry", contactPhoneE164: expectedBody.contactPhoneE164, businessName: expectedBody.businessName, firstStoreName: expectedBody.firstStoreName, serviceCityId: expectedBody.serviceCityId, firstStoreVerticalId: expectedBody.firstStoreVerticalId, firstStoreFulfillmentModes: expectedBody.firstStoreFulfillmentModes,''',
    '''  const createdCase = { id: "join_retry", contactPhoneE164: expectedBody.contactPhoneE164, businessName: expectedBody.businessName, firstStoreName: expectedBody.firstStoreName, serviceCityId: expectedBody.serviceCityId, firstStoreVerticalId: expectedBody.firstStoreVerticalId, firstStoreCommercialTypeId: expectedBody.firstStoreCommercialTypeId, firstStoreFulfillmentModes: expectedBody.firstStoreFulfillmentModes,''',
)
replace_once(
    ts,
    '''  await expect(page.locator(".catalog-taxonomy-section")).toHaveCount(1);\n''',
    '''''',
)
replace_once(
    ts,
    '''test("operator approves joining terms with commission and settlement cadence", async ({ page }) => {''',
    '''test("operator approves joining terms with the active settlement policy", async ({ page }) => {''',
)
replace_once(
    ts,
    '''  await expect(page.getByText(/سيُعتمد إصدار السياسة partner-terms-v3/)).toBeVisible();''',
    '''  await expect(page.getByText(/سيُعتمد إصدار شروط التسوية partner-terms-v3/)).toBeVisible();''',
)

# Keep mocked joining cases aligned with the now-required commercial store type.
for case_id in ["join_test"]:
    pass
replace_exact_count(
    ts,
    '''serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreFulfillmentModes:''',
    '''serviceCityId: "sanaa", firstStoreVerticalId: "grocery", firstStoreCommercialTypeId: "grocery-market", firstStoreFulfillmentModes:''',
    4,
)
replace_exact_count(
    ts,
    '''serviceCityId: "sanaa", primaryVerticalId: "grocery", fulfillmentModes:''',
    '''serviceCityId: "sanaa", primaryVerticalId: "grocery", commercialStoreTypeId: "grocery-market", fulfillmentModes:''',
    3,
)

print("ROOT_CLOSURE_PATCH=APPLIED")
