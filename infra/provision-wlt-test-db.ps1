#requires -Version 7.0
# One-time additive setup of a NEW synthetic WLT database only.
# Refuses existing WLT roles, database, or credentials; does not reset anything.
[CmdletBinding()]
param([string]$DockerContext = 'bthwani-docker')
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$envPath = Join-Path $PSScriptRoot '.env'
if ($DockerContext -notmatch '^[a-zA-Z0-9._-]+$') { throw 'Invalid Docker context' }
$envFile = Get-Item -LiteralPath $envPath -ErrorAction Stop
if (!$envFile.PSIsContainer -and ($envFile.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) {
  $existingText = [IO.File]::ReadAllText($envPath)
} else { throw 'Refusing a nonregular environment file' }
if ($existingText -match '(?m)^REF_WLT_TEST_DATABASE_URL=') { throw 'Existing WLT credentials must not be overwritten' }
if ($existingText -notmatch '(?m)^REF_POSTGRES_DB=bthwani_refoundation$') { throw 'Not the expected refoundation database environment' }
$match = [regex]::Match($existingText, '(?m)^REF_POSTGRES_USER=([a-zA-Z][a-zA-Z0-9_]*)$')
if (!$match.Success) { throw 'Missing canonical isolated database admin name' }
$admin = $match.Groups[1].Value

$pg = 'bthwani-refoundation-postgres-1'
$runtime = (& docker --context $DockerContext inspect $pg --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Status}}').Trim()
if ($LASTEXITCODE -ne 0 -or $runtime -ne 'bthwani-refoundation|refoundation|running') {
  throw 'Refusing unexpected PostgreSQL instance'
}
function AdminSql([string]$database, [string]$statement) {
  $output = & docker --context $DockerContext exec $pg psql -X -At -v ON_ERROR_STOP=1 -U $admin -d $database -c $statement
  if ($LASTEXITCODE -ne 0) { throw 'Isolated SQL operation failed; inspect durable state before retry' }
  return ($output | Out-String).Trim()
}
$existing = AdminSql 'postgres' @"
SELECT (SELECT count(*) FROM pg_database WHERE datname='bthwani_wlt_test')
  + (SELECT count(*) FROM pg_roles WHERE rolname IN ('bthwani_wlt_owner','bthwani_wlt_reader','bthwani_wlt_sandbox'));
"@
if ($existing -ne '0') { throw 'WLT namespace already exists; refusing automatic mutation or replay' }
$isSuper = AdminSql 'postgres' "SELECT rolsuper::int FROM pg_roles WHERE rolname=current_user"
if ($isSuper -ne '1') { throw 'Provisioning requires the existing isolated PostgreSQL superuser' }

$secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$bootstrap = @"
BEGIN;
CREATE ROLE bthwani_wlt_owner NOLOGIN NOINHERIT;
CREATE ROLE bthwani_wlt_sandbox NOLOGIN NOINHERIT;
CREATE ROLE bthwani_wlt_reader LOGIN NOINHERIT PASSWORD '$secret';
COMMIT;
"@
$bootstrap | & docker --context $DockerContext exec -i $pg psql -X -q -v ON_ERROR_STOP=1 -U $admin -d postgres -f -
if ($LASTEXITCODE -ne 0) { throw 'Role bootstrap failed; do not retry without inspecting roles' }
$create = AdminSql 'postgres' 'CREATE DATABASE bthwani_wlt_test OWNER bthwani_wlt_owner TEMPLATE template0'
$grants = @"
REVOKE ALL ON DATABASE bthwani_wlt_test FROM PUBLIC;
GRANT CONNECT ON DATABASE bthwani_wlt_test TO bthwani_wlt_reader;
"@
$grants | & docker --context $DockerContext exec -i $pg psql -X -q -v ON_ERROR_STOP=1 -U $admin -d postgres -f -
if ($LASTEXITCODE -ne 0) { throw 'Database grants failed; inspect durable state before retry' }

$baseline = @(Get-ChildItem (Join-Path $root 'services/wlt/database/schema') -Filter '*.sql' -File | Sort-Object Name)
$sandbox = @(Get-ChildItem (Join-Path $root 'services/wlt/database/sandbox') -Filter '*.sql' -File | Sort-Object Name)
if ($baseline.Count -lt 3 -or $sandbox.Count -lt 2) { throw 'WLT baseline or sandbox source incomplete' }
foreach ($file in @($baseline) + @($sandbox)) {
  $sql = "SET ROLE bthwani_wlt_owner;`n" + [IO.File]::ReadAllText($file.FullName)
  $sql | & docker --context $DockerContext exec -i $pg psql -X -q -v ON_ERROR_STOP=1 -U $admin -d bthwani_wlt_test -f -
  if ($LASTEXITCODE -ne 0) { throw ('Fresh WLT baseline failed: ' + $file.Name + '; inspect durable state before retry') }
}
$proof = AdminSql 'bthwani_wlt_test' @"
SELECT CASE WHEN
  (SELECT count(*) FROM wlt.customer_funding_journal) = 0
  AND has_table_privilege('bthwani_wlt_reader', 'wlt.customer_wallet_balances', 'SELECT')
  AND has_table_privilege('bthwani_wlt_reader', 'wlt.customer_funding_history', 'SELECT')
  AND NOT has_any_column_privilege('bthwani_wlt_reader', 'wlt.customer_funding_journal', 'SELECT')
  AND NOT has_database_privilege('bthwani_wlt_reader','bthwani_wlt_test','CREATE')
  AND NOT has_function_privilege('bthwani_wlt_reader','wlt.post_sandbox_customer_funding(text,text,bigint)','EXECUTE')
  AND NOT has_function_privilege('bthwani_wlt_reader','wlt.reverse_sandbox_customer_funding(text,text)','EXECUTE')
THEN 'PASS' ELSE 'FAIL' END;
"@
if ($proof -ne 'PASS') { throw 'WLT empty ledger or reader privileges are unsafe; refusing runtime credentials' }
if (([IO.File]::ReadAllText($envPath)) -cne $existingText) { throw 'Environment file changed concurrently; credentials not written' }
$entry = 'REF_WLT_TEST_DATABASE_URL=postgres://bthwani_wlt_reader:' + $secret + '@postgres:5432/bthwani_wlt_test?sslmode=disable'
[IO.File]::AppendAllText($envPath, ([Environment]::NewLine + $entry + [Environment]::NewLine))
Write-Output 'WLT_ISOLATED_DATABASE_PROVISIONED roles=owner-no-login,reader-read-only,sandbox-no-login migrations=5 journal_empty=true'
