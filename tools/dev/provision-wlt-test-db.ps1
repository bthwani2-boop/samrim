#Requires -Version 7.0
# First-use WLT provisioning only. The SQL owner and credential publication are
# separate phases of one operation; never upgrade or replay retained state.
[CmdletBinding()]
param([string]$DockerContext = 'bthwani-docker')

# FileSystemInfo works for hidden files on Unix and Windows, independently of
# PowerShell provider visibility rules. Decode strictly and keep the original
# text (including an existing UTF-8 BOM) for comparison and publication.
function Read-WltRegularText([string]$Path) {
  $file = [IO.FileInfo]::new([IO.Path]::GetFullPath($Path))
  $file.Refresh()
  if (!$file.Exists -or ($file.Attributes -band ([IO.FileAttributes]::Directory -bor [IO.FileAttributes]::ReparsePoint))) {
    throw 'WLT_ENV_NOT_REGULAR'
  }
  $parent = $file.Directory
  if (!$parent.Exists -or ($parent.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'WLT_ENV_UNSAFE_DIRECTORY'
  }
  $utf8 = [Text.UTF8Encoding]::new($false,$true)
  return $utf8.GetString([IO.File]::ReadAllBytes($file.FullName))
}

function Read-WltEnvironment([string]$Path) {
  $text = Read-WltRegularText $Path
  if ($text.Contains([char]0)) { throw 'WLT_ENV_INVALID_OR_DUPLICATE' }
  $parse = if ($text.StartsWith([string][char]0xFEFF)) { $text.Substring(1) } else { $text }
  $keys = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
  foreach ($line in ($parse -split '\r?\n')) {
    if (!$line.Trim() -or $line.TrimStart().StartsWith('#')) { continue }
    $match = [regex]::Match($line,'^([A-Z][A-Z0-9_]*)=(.*)$')
    if (!$match.Success -or !$keys.TryAdd($match.Groups[1].Value,$match.Groups[2].Value)) {
      throw 'WLT_ENV_INVALID_OR_DUPLICATE'
    }
  }
  if ($keys.ContainsKey('REF_WLT_TEST_DATABASE_URL')) { throw 'WLT_EXISTING_CREDENTIAL' }
  if (!$keys.ContainsKey('REF_POSTGRES_DB') -or $keys['REF_POSTGRES_DB'] -cne 'bthwani_refoundation' -or
      !$keys.ContainsKey('REF_POSTGRES_USER') -or $keys['REF_POSTGRES_USER'] -cnotmatch '^[A-Za-z][A-Za-z0-9_]{0,62}$') {
    throw 'WLT_ENV_WRONG_DATABASE'
  }
  return @{Text=$text;Admin=$keys['REF_POSTGRES_USER']}
}

# Prepare the credential privately, on the same filesystem as the destination.
# The caller holds the existing lifecycle mutex for the entire DB/publication
# operation. A competing source edit or changed candidate fails closed.
function New-WltCandidate([string]$Path,[string]$Original,[string]$Secret) {
  if ($Secret -cnotmatch '^[a-f0-9]{64}$') { throw 'WLT_SECRET_INVALID' }
  $target = [IO.Path]::GetFullPath($Path)
  if ((Read-WltEnvironment $target).Text -cne $Original) { throw 'WLT_ENV_CHANGED' }
  $parent = [IO.Path]::GetDirectoryName($target)
  $directory = Join-Path $parent ('.env.prepare-wlt-'+[guid]::NewGuid().ToString('N'))
  $privateMode = [IO.UnixFileMode]::UserRead -bor [IO.UnixFileMode]::UserWrite
  if ($IsWindows) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
  else { [IO.Directory]::CreateDirectory($directory,($privateMode -bor [IO.UnixFileMode]::UserExecute)) | Out-Null }
  $candidate = Join-Path $directory '.env'
  $separator = if ($Original.EndsWith([string][char]10)) { '' } else { [Environment]::NewLine }
  $expected = $Original+$separator+'REF_WLT_TEST_DATABASE_URL=postgres://bthwani_wlt_reader:'+$Secret+'@postgres:5432/bthwani_wlt_test?sslmode=disable'+[Environment]::NewLine

  $options = [IO.FileStreamOptions]::new()
  $options.Mode = [IO.FileMode]::CreateNew
  $options.Access = [IO.FileAccess]::Write
  $options.Share = [IO.FileShare]::None
  if (!$IsWindows) { $options.UnixCreateMode = $privateMode }
  # The file is empty until the destination's Windows ACL is applied.
  $stream = [IO.FileStream]::new($candidate,$options)
  $stream.Dispose()
  if ($IsWindows) { Set-Acl -LiteralPath $candidate -AclObject (Get-Acl -LiteralPath $target -ErrorAction Stop) -ErrorAction Stop }
  $stream = [IO.File]::Open($candidate,[IO.FileMode]::Open,[IO.FileAccess]::Write,[IO.FileShare]::None)
  try {
    $bytes = [Text.UTF8Encoding]::new($false,$true).GetBytes($expected)
    $stream.Write($bytes,0,$bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
  if ((Read-WltRegularText $candidate) -cne $expected) { throw 'WLT_CANDIDATE_CHANGED' }
  return @{Path=$candidate;Directory=$directory;Text=$expected}
}

function Publish-WltCandidate([string]$Path,[string]$Original,[hashtable]$Candidate) {
  $target = [IO.Path]::GetFullPath($Path)
  $directory = [IO.Path]::GetFullPath([string]$Candidate.Directory)
  $candidatePath = [IO.Path]::GetFullPath([string]$Candidate.Path)
  if ([IO.Path]::GetDirectoryName($directory) -cne [IO.Path]::GetDirectoryName($target) -or
      [IO.Path]::GetFileName($directory) -cnotmatch '^\.env\.prepare-wlt-[a-f0-9]{32}$' -or
      $candidatePath -cne (Join-Path $directory '.env')) { throw 'WLT_CANDIDATE_WRONG_PATH' }
  if ((Read-WltRegularText $candidatePath) -cne $Candidate.Text) { throw 'WLT_CANDIDATE_CHANGED' }
  if ((Read-WltEnvironment $target).Text -cne $Original) { throw 'WLT_ENV_CHANGED' }
  [IO.File]::Replace($candidatePath,$target,[NullString]::Value)
  if ((Read-WltRegularText $target) -cne $Candidate.Text) { throw 'WLT_ENV_READBACK_FAILED' }
  [IO.Directory]::Delete($directory)
}

function Read-WltSources([string]$Root) {
  $groups = @{}
  foreach ($group in @('schema','sandbox')) {
    $directory = Get-Item -LiteralPath (Join-Path $Root ('services/wlt/database/'+$group))
    if (!$directory.PSIsContainer -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'WLT_BASELINE_UNSAFE_DIRECTORY' }
    $files = @(Get-ChildItem -LiteralPath $directory.FullName -Filter '*.sql' -File | Sort-Object Name)
    $required = if ($group -eq 'schema') {
      @('00_ledger.sql','10_projections.sql','20_permissions.sql','30_commercial_agreements.sql','40_order_wallet_reservations.sql')
    } else { @('10_test_funding.sql','20_test_reversal.sql') }
    foreach ($name in $required) {
      if (@($files | ForEach-Object Name) -cnotcontains $name) { throw 'WLT_BASELINE_INCOMPLETE' }
    }
    $groups[$group] = @(foreach ($file in $files) {
      if ($file.Name -cnotmatch '^[0-9]{2}_[a-z0-9_]+\.sql$' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'WLT_BASELINE_UNSAFE_FILE' }
      $sql = [IO.File]::ReadAllText($file.FullName,[Text.UTF8Encoding]::new($false,$true))
      if (!$sql.Trim() -or $sql -match '(?m)^\s*\\') {
        throw 'WLT_BASELINE_INVALID_SQL'
      }
      $sql
    })
  }
  return $groups
}

function Invoke-WltSql([string]$Context,[string]$Container,[string]$Admin,[string]$Database,[string]$Sql,[string]$Stage) {
  $output = $Sql | & docker --context $Context exec -i $Container psql -X -qAt -v ON_ERROR_STOP=1 -U $Admin -d $Database -f - 2>&1
  if ($LASTEXITCODE -ne 0) { throw ('WLT_SQL_FAILED stage='+$Stage) }
  return ($output | Out-String).Trim()
}

function Assert-WltFresh([string]$Context,[string]$Container,[string]$Admin) {
  if ($Context -cnotmatch '^[A-Za-z0-9._-]+$' -or $Container -cnotmatch '^[a-f0-9]{64}$' -or $Admin -cnotmatch '^[A-Za-z][A-Za-z0-9_]{0,62}$') { throw 'WLT_TARGET_INVALID' }
  $proof = Invoke-WltSql $Context $Container $Admin 'postgres' @"
SELECT CASE WHEN current_database()='postgres' AND current_user='$Admin'
 AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolsuper)
 AND NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='bthwani_wlt_test')
 AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN('bthwani_wlt_owner','bthwani_wlt_reader','bthwani_wlt_sandbox'))
THEN 'ABSENT' ELSE 'BLOCKED' END;
"@ 'fresh-admission'
  if ($proof -cne 'ABSENT') { throw 'WLT_EXISTING_NAMESPACE_OR_ADMIN' }
}

function Initialize-WltDatabase([string]$Context,[string]$Container,[string]$Admin,[hashtable]$Sources,[string]$Secret) {
  if ($Secret -cnotmatch '^[a-f0-9]{64}$' -or !$Sources.schema.Count -or !$Sources.sandbox.Count) { throw 'WLT_INPUT_INVALID' }
  Assert-WltFresh $Context $Container $Admin
  $null = Invoke-WltSql $Context $Container $Admin 'postgres' @"
BEGIN;
CREATE ROLE bthwani_wlt_owner NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE bthwani_wlt_sandbox NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE bthwani_wlt_reader LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$Secret';
COMMIT;
"@ 'roles'
  # PostgreSQL CREATE DATABASE cannot join a transaction. Keep it inaccessible
  # until the private ACL is established; never replay an interrupted creation.
  $null = Invoke-WltSql $Context $Container $Admin 'postgres' 'CREATE DATABASE bthwani_wlt_test OWNER bthwani_wlt_owner TEMPLATE template0 ALLOW_CONNECTIONS false;' 'database'
  $null = Invoke-WltSql $Context $Container $Admin 'postgres' @'
BEGIN;
REVOKE ALL ON DATABASE bthwani_wlt_test FROM PUBLIC;
ALTER DATABASE bthwani_wlt_test ALLOW_CONNECTIONS true;
COMMIT;
'@ 'database-access'
  $sandboxGuard = @'
DO $boundary$
BEGIN
 IF to_regprocedure('wlt.post_sandbox_customer_funding(text,text,bigint)') IS NOT NULL
 OR to_regprocedure('wlt.reverse_sandbox_customer_funding(text,text)') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_constraint WHERE conname='customer_funding_reversal_provider')
 THEN RAISE EXCEPTION 'sandbox command in core baseline'; END IF;
END $boundary$;
'@
  $proof = @'
SELECT CASE WHEN current_database()='bthwani_wlt_test'
 AND EXISTS(SELECT 1 FROM pg_database WHERE datname=current_database() AND pg_get_userbyid(datdba)='bthwani_wlt_owner')
 AND (SELECT count(*) FROM pg_roles WHERE rolname IN('bthwani_wlt_owner','bthwani_wlt_reader','bthwani_wlt_sandbox')
 AND NOT(rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR rolinherit)
 AND rolcanlogin=(rolname='bthwani_wlt_reader'))=3
 AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member IN(SELECT oid FROM pg_roles WHERE rolname IN('bthwani_wlt_owner','bthwani_wlt_reader','bthwani_wlt_sandbox')))
 AND has_database_privilege('bthwani_wlt_reader',current_database(),'CONNECT')
 AND NOT has_database_privilege('bthwani_wlt_reader',current_database(),'CREATE,TEMP')
 AND NOT has_schema_privilege('bthwani_wlt_reader','public','CREATE')
 AND has_schema_privilege('bthwani_wlt_reader','wlt','USAGE')
 AND NOT has_schema_privilege('bthwani_wlt_reader','wlt','CREATE,USAGE WITH GRANT OPTION')
 AND (SELECT count(*) FROM wlt.customer_funding_journal)=0
 AND (SELECT count(*) FROM wlt.store_commercial_agreement_proposals)=0
 AND (SELECT count(*) FROM wlt.store_commercial_agreement_decisions)=0
 AND (SELECT count(*) FROM wlt.order_payment_allocations)=0
 AND (SELECT count(*) FROM wlt.order_payment_releases)=0
 AND (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='wlt' AND c.relkind='v' AND c.relname IN('customer_wallet_balances','customer_wallet_availability','customer_funding_history','latest_commercial_agreement_reviews','customer_order_payment_readback')
   AND has_table_privilege('bthwani_wlt_reader',c.oid,'SELECT'))=5
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='wlt' AND c.relkind IN('r','v','p','m') AND (
     pg_get_userbyid(c.relowner)<>'bthwani_wlt_owner'
     OR has_table_privilege('bthwani_wlt_reader',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN,SELECT WITH GRANT OPTION')
     OR has_any_column_privilege('bthwani_wlt_reader',c.oid,'INSERT,UPDATE,REFERENCES,SELECT WITH GRANT OPTION')
     OR (c.relname NOT IN('customer_wallet_balances','customer_wallet_availability','customer_funding_history','latest_commercial_agreement_reviews','customer_order_payment_readback')
         AND has_any_column_privilege('bthwani_wlt_reader',c.oid,'SELECT'))))
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='wlt' AND p.prorettype<>'trigger'::regtype AND has_function_privilege('bthwani_wlt_reader',p.oid,'EXECUTE'))
 AND has_function_privilege('bthwani_wlt_sandbox','wlt.post_sandbox_customer_funding(text,text,bigint)','EXECUTE')
 AND has_function_privilege('bthwani_wlt_sandbox','wlt.reverse_sandbox_customer_funding(text,text)','EXECUTE')
THEN 'PASS' ELSE 'FAIL' END
'@
  $assertion = 'DO $verified$ BEGIN IF (' + $proof + ") IS DISTINCT FROM 'PASS' THEN RAISE EXCEPTION 'WLT baseline proof failed'; END IF; END " + '$verified$;'
  # Install the ordered owner baseline and sandbox, prove grants, and admit
  # the reader in ONE transaction. A failure leaves no partial WLT schema.
  $sql = @(
    'BEGIN; SET LOCAL lock_timeout=''5s''; SET LOCAL statement_timeout=''90s'';'
    'REVOKE ALL ON SCHEMA public FROM PUBLIC; SET LOCAL ROLE bthwani_wlt_owner;'
    $Sources.schema
    $sandboxGuard
    $Sources.sandbox
    'RESET ROLE; GRANT CONNECT ON DATABASE bthwani_wlt_test TO bthwani_wlt_reader;'
    $assertion
    'COMMIT;'
  ) -join [Environment]::NewLine
  $null = Invoke-WltSql $Context $Container $Admin 'bthwani_wlt_test' $sql 'baseline-transaction'
  if ((Invoke-WltSql $Context $Container $Admin 'bthwani_wlt_test' ($proof+';') 'durable-readback') -cne 'PASS') { throw 'WLT_READBACK_FAILED' }
  return @{SchemaCount=$Sources.schema.Count;SandboxCount=$Sources.sandbox.Count}
}

# The existing disposable proof imports these exact functions without running
# the live entrypoint. No alternative production bootstrap is introduced.
if ($MyInvocation.InvocationName -eq '.') { return }

$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-StrictMode -Version Latest
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
if ([Environment]::MachineName -ine 'BTHWANI' -or $root -ine 'D:\samrim' -or $DockerContext -cne 'bthwani-docker') { throw 'WLT_CANONICAL_TARGET_REQUIRED' }
$branch = (& git -C $root branch --show-current | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or !$branch -or $branch -eq 'main' -or $branch.StartsWith('archive/')) { throw 'WLT_BRANCH_UNAUTHORIZED' }
$mutex = [Threading.Mutex]::new($false,'Local\BThwaniUnifiedDevV1')
$held = $false
$oldPath = $env:Path
try {
  try { $held = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $held = $true; throw 'WLT_RECOVERY_REQUIRED' }
  if (!$held) { throw 'WLT_LIFECYCLE_BUSY' }
  $path = Join-Path $root 'infra/.env'
  $environment = Read-WltEnvironment $path
  if (@(Get-ChildItem -LiteralPath (Split-Path -Parent $path) -Filter '.env.prepare-wlt-*' -Force).Count) { throw 'WLT_PRIOR_CANDIDATE_REQUIRES_REVIEW' }
  $sources = Read-WltSources $root
  $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
  if (!(Test-Path -LiteralPath $ssh -PathType Leaf)) { throw 'WLT_SSH_MISSING' }
  $env:Path = (Split-Path -Parent $ssh)+';'+$env:Path
  $endpoint = (& docker context inspect $DockerContext --format '{{.Endpoints.docker.Host}}' | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $endpoint -cne 'ssh://bthwa@bthwani-docker') { throw 'WLT_CONTEXT_MISMATCH' }
  $identity = (& $ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 bthwani-docker hostname | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $identity -ine 'BTHWANI-DOCKER') { throw 'WLT_REMOTE_HOST_MISMATCH' }
  $runtime = (& docker --context $DockerContext inspect bthwani-refoundation-postgres-1 --format '{{.Id}}|{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}|{{len .HostConfig.PortBindings}}' | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $runtime -cnotmatch '^([a-f0-9]{64})\|bthwani-refoundation\|postgres\|refoundation\|healthy\|0$') { throw 'WLT_POSTGRES_UNVERIFIED' }
  $container = $Matches[1]
  Assert-WltFresh $DockerContext $container $environment.Admin
  $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  # Stage the private credential before the first DB write. Keep it on any
  # uncertain cross-resource outcome; never lose the only generated credential.
  $candidate = New-WltCandidate $path $environment.Text $secret
  try {
    $proof = Initialize-WltDatabase $DockerContext $container $environment.Admin $sources $secret
    Publish-WltCandidate $path $environment.Text $candidate
    Write-Output ('WLT_ISOLATED_DATABASE_PROVISIONED schema='+$proof.SchemaCount+' sandbox='+$proof.SandboxCount+' atomic-baseline=yes durable-readback=yes')
  } catch {
    Write-Warning 'WLT_RECOVERY_REQUIRED: preserve the private ignored candidate and inspect durable state before any retry.'
    throw
  }
} finally {
  $env:Path = $oldPath
  if ($held) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
