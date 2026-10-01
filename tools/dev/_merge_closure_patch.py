from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


def replace_exact_count(path: str, old: str, new: str, expected: int) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{path}: expected {expected} matches, found {count}: {old[:160]!r}")
    file.write_text(text.replace(old, new), encoding="utf-8")


auth = "apps/control-panel/tests/auth-shell.spec.ts"
replace_once(
    auth,
    '''  await page.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  if (role === "field") {
    if (!(await page.getByRole("button", { name: "منح دور الميداني" }).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
  } else {''',
    '''  await page.getByRole("button", { name: "اعتماد الملف", exact: true }).click();
  if (role === "field") {
    await expect(page.getByText("اعتُمد الملف وأُعيدت قراءته؛ أصبح منح الدور خطوته التالية.")).toBeVisible();
    if (!(await page.getByRole("button", { name: "منح دور الميداني" }).isVisible())) await page.getByText("الخطوة التالية", { exact: true }).click();
  } else {''',
)
replace_exact_count(
    auth,
    '''  await page.getByLabel("الفئة الرئيسية", { exact: true }).selectOption("grocery");''',
    '''  await page.locator("#joining-vertical").selectOption("grocery");''',
    3,
)
replace_exact_count(
    auth,
    '''  await page.getByLabel("نوع المتجر التجاري", { exact: true }).selectOption("grocery-market");''',
    '''  await page.locator("#joining-commercial-type").selectOption("grocery-market");''',
    3,
)

speed = "tools/dev/verify-local-speed-contract.mjs"
replace_once(
    speed,
    '''  for (const failure of [...new Set(failures)].sort()) console.error(`  ${failure}`);''',
    '''  for (const failure of [...new Set(failures)].sort((left, right) => left.localeCompare(right, "en"))) console.error(`  ${failure}`);''',
)

resolve = "tools/dev/runtime-proof/resolve.mjs"
replace_once(
    resolve,
    '''import path from "node:path";

const root = path.resolve(import.meta.dirname, "../../..");''',
    '''import path from "node:path";
import { resolveTrustedExecutable } from "./trusted-executables.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const gitExecutable = resolveTrustedExecutable("git");''',
)
replace_exact_count(resolve, 'execFileSync("git",', 'execFileSync(gitExecutable,', 2)

store = "services/dsh/backend/internal/storage/postgres/store_publication.go"
replace_once(
    store,
    '''\tcursor = strings.TrimSpace(cursor)
\tascending := sort == "updated_asc"
\targs := []any{}
\twhere := "TRUE"
\tif state != "" {
\t\targs = append(args, state)
\t\twhere += " AND s.publication_state=$" + strconv.Itoa(len(args))
\t}
\tif query != "" {
\t\tif searchMode == "name_prefix" {
\t\t\targs = append(args, strings.ToLower(escapeOperatorStoreSearch(query))+"%")
\t\t\twhere += " AND lower(s.name) LIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!'"
\t\t} else {
\t\t\targs = append(args, "%"+escapeOperatorStoreSearch(query)+"%")
\t\t\twhere += " AND (s.id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.name ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!' OR s.partner_actor_id ILIKE $" + strconv.Itoa(len(args)) + " ESCAPE '!')"
\t\t}
\t}
\tif serviceCityID != "" {
\t\targs = append(args, serviceCityID)
\t\twhere += " AND s.service_city_id=$" + strconv.Itoa(len(args))
\t}
\tif strings.TrimSpace(cursor) != "" {
\t\tdecoded, err := decodeOperatorStoreCursor(cursor, state, query, serviceCityID, searchMode, sort)
\t\tif err != nil {
\t\t\treturn OperatorStorePage{}, err
\t\t}
\t\tif sort == "name_asc" {
\t\t\tanchorName := decoded.Name
\t\t\tif decoded.Scope != "" {
\t\t\t\tprefix := strings.ToLower(escapeOperatorStoreSearch(query)) + "%"
\t\t\t\terr := db.QueryRowContext(ctx, "SELECT name FROM dsh.stores WHERE id=$1 AND publication_state='published' AND service_city_id=$2 AND lower(name) LIKE $3 ESCAPE '!'", decoded.ID, serviceCityID, prefix).Scan(&anchorName)
\t\t\t\tif errors.Is(err, sql.ErrNoRows) {
\t\t\t\t\treturn OperatorStorePage{}, ErrOperatorStoreInvalidCursor
\t\t\t\t}
\t\t\t\tif err != nil {
\t\t\t\t\treturn OperatorStorePage{}, fmt.Errorf("read operator store cursor anchor: %w", err)
\t\t\t\t}
\t\t\t}
\t\t\targs = append(args, anchorName, decoded.ID)
\t\t\twhere += " AND (lower(s.name),s.id)>(lower($" + strconv.Itoa(len(args)-1) + "),$" + strconv.Itoa(len(args)) + ")"
\t\t} else {
\t\t\targs = append(args, decoded.UpdatedAt, decoded.ID)
\t\t\toperator := "<"
\t\t\tif ascending {
\t\t\t\toperator = ">"
\t\t\t}
\t\t\twhere += " AND (s.updated_at,s.id)" + operator + "($" + strconv.Itoa(len(args)-1) + ",$" + strconv.Itoa(len(args)) + ")"
\t\t}
\t}
\targs = append(args, limit+1)
\torder := "DESC"
\tif ascending {
\t\torder = "ASC"
\t}
\torderBy := "s.updated_at " + order + ",s.id " + order
\tif sort == "name_asc" {
\t\torderBy = "lower(s.name) ASC,s.id ASC"
\t}
\trows, err := db.QueryContext(ctx, `SELECT s.id,s.partner_actor_id,s.name,s.service_city_id,s.primary_vertical_id,s.commercial_store_type_id,s.version,s.publication_state,s.fulfillment_modes,s.created_at,s.updated_at
\t\tFROM dsh.stores s WHERE `+where+" ORDER BY "+orderBy+" LIMIT $"+strconv.Itoa(len(args)), args...)
\tif err != nil {
\t\treturn OperatorStorePage{}, fmt.Errorf("list canonical operator stores: %w", err)
\t}
\tdefer rows.Close()''',
    '''\tcursor = strings.TrimSpace(cursor)
\thasCursor := cursor != ""
\tvar cursorName, cursorID string
\tvar cursorUpdatedAt time.Time
\tif hasCursor {
\t\tdecoded, err := decodeOperatorStoreCursor(cursor, state, query, serviceCityID, searchMode, sort)
\t\tif err != nil {
\t\t\treturn OperatorStorePage{}, err
\t\t}
\t\tcursorID = decoded.ID
\t\tif sort == "name_asc" {
\t\t\tcursorName = decoded.Name
\t\t\tif decoded.Scope != "" {
\t\t\t\tprefix := strings.ToLower(escapeOperatorStoreSearch(query)) + "%"
\t\t\t\terr := db.QueryRowContext(ctx, "SELECT name FROM dsh.stores WHERE id=$1 AND publication_state='published' AND service_city_id=$2 AND lower(name) LIKE $3 ESCAPE '!'", decoded.ID, serviceCityID, prefix).Scan(&cursorName)
\t\t\t\tif errors.Is(err, sql.ErrNoRows) {
\t\t\t\t\treturn OperatorStorePage{}, ErrOperatorStoreInvalidCursor
\t\t\t\t}
\t\t\t\tif err != nil {
\t\t\t\t\treturn OperatorStorePage{}, fmt.Errorf("read operator store cursor anchor: %w", err)
\t\t\t\t}
\t\t\t}
\t\t} else {
\t\t\tcursorUpdatedAt = decoded.UpdatedAt
\t\t}
\t}
\tescapedQuery := escapeOperatorStoreSearch(query)
\tprefixPattern := ""
\tcontainsPattern := ""
\tif query != "" {
\t\tprefixPattern = strings.ToLower(escapedQuery) + "%"
\t\tcontainsPattern = "%" + escapedQuery + "%"
\t}
\trows, err := db.QueryContext(ctx, `SELECT s.id,s.partner_actor_id,s.name,s.service_city_id,s.primary_vertical_id,s.commercial_store_type_id,s.version,s.publication_state,s.fulfillment_modes,s.created_at,s.updated_at
\t\tFROM dsh.stores s
\t\tWHERE ($1::text='' OR s.publication_state=$1)
\t\t  AND ($2::text='' OR (($4::text='name_prefix' AND lower(s.name) LIKE $5::text ESCAPE '!') OR ($4::text='contains' AND (s.id ILIKE $6::text ESCAPE '!' OR s.name ILIKE $6::text ESCAPE '!' OR s.partner_actor_id ILIKE $6::text ESCAPE '!'))))
\t\t  AND ($3::text='' OR s.service_city_id=$3)
\t\t  AND (NOT $7::boolean OR ($8::text='name_asc' AND (lower(s.name),s.id)>(lower($9::text),$10::text)) OR ($8::text='updated_asc' AND (s.updated_at,s.id)>($11::timestamptz,$10::text)) OR ($8::text='updated_desc' AND (s.updated_at,s.id)<($11::timestamptz,$10::text)))
\t\tORDER BY
\t\t  CASE WHEN $8::text='name_asc' THEN lower(s.name) END ASC,
\t\t  CASE WHEN $8::text='name_asc' THEN s.id END ASC,
\t\t  CASE WHEN $8::text='updated_asc' THEN s.updated_at END ASC,
\t\t  CASE WHEN $8::text='updated_asc' THEN s.id END ASC,
\t\t  CASE WHEN $8::text='updated_desc' THEN s.updated_at END DESC,
\t\t  CASE WHEN $8::text='updated_desc' THEN s.id END DESC
\t\tLIMIT $12`, state, query, serviceCityID, searchMode, prefixPattern, containsPattern, hasCursor, sort, cursorName, cursorID, cursorUpdatedAt, limit+1)
\tif err != nil {
\t\treturn OperatorStorePage{}, fmt.Errorf("list canonical operator stores: %w", err)
\t}
\tdefer rows.Close()''',
)

sonar_props = Path("sonar-project.properties")
props = sonar_props.read_text(encoding="utf-8")
coverage_line = "sonar.coverage.exclusions=**/generated/**,**/*_generated.go\n"
if coverage_line not in props:
    marker = "sonar.javascript.lcov.reportPaths=coverage/sonar/tools-dev.lcov\n"
    if props.count(marker) != 1:
        raise SystemExit("sonar-project.properties: coverage marker mismatch")
    props = props.replace(marker, marker + coverage_line, 1)
    sonar_props.write_text(props, encoding="utf-8")

print("MERGE_CLOSURE_PATCH=APPLIED")
