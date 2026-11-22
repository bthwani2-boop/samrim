#Requires -Version 7.0
# Provision only the disposable Operator WebAuthn S02 owner on the authorized Lenovo SSH Docker context.
# Never changes bthwani-refoundation services, identities, sessions, or volumes.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if ((hostname).ToUpperInvariant() -ne 'BTHWANI') { throw 'OPERATOR_SANDBOX_SURFACE_ONLY' }
if ((& git -C $root branch --show-current) -like 'archive/*') { throw 'OPERATOR_SANDBOX_ARCHIVE_REFUSED' }
$head = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -notmatch '^[a-f0-9]{40}$') { throw 'OPERATOR_SANDBOX_SOURCE_UNVERIFIED' }
$context = (& docker context inspect bthwani-docker --format '{{.Endpoints.docker.Host}}').Trim()
if ($LASTEXITCODE -ne 0 -or $context -cne 'ssh://bthwa@bthwani-docker') {
  throw 'OPERATOR_SANDBOX_SSH_CONTEXT_MISMATCH'
}
# This existing project helper performs strict SSH identity and host verification.
& (Join-Path $root 'tools/dev/Control-Lenovo-SSH.ps1') -Action Check | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_SANDBOX_LENOVO_NOT_VERIFIED' }

$compose = Join-Path $PSScriptRoot 'compose.operator-webauthn-sandbox.yaml'
$secretDir = Join-Path $env:LOCALAPPDATA 'BThwani\Operations\OperatorSandbox'
$envFile = Join-Path $secretDir 'compose.env'
New-Item -ItemType Directory -Force -Path $secretDir | Out-Null
if (!(Test-Path -LiteralPath $envFile)) {
  $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
  [System.IO.File]::WriteAllText($envFile, "REF_OPERATOR_SANDBOX_PASSWORD=$password" + [Environment]::NewLine)
  # Limit the local secret file to this Windows account, SYSTEM, and administrators.
  $acl = Get-Acl -LiteralPath $envFile
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($id in @(
    [Security.Principal.WindowsIdentity]::GetCurrent().User,
    [Security.Principal.SecurityIdentifier]'S-1-5-18',
    [Security.Principal.SecurityIdentifier]'S-1-5-32-544'
  )) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $id,[Security.AccessControl.FileSystemRights]::FullControl,
      [Security.AccessControl.AccessControlType]::Allow))
  }
  Set-Acl -LiteralPath $envFile -AclObject $acl
}
$rawEnv = [System.IO.File]::ReadAllText($envFile).Trim()
if ($rawEnv -cnotmatch '^REF_OPERATOR_SANDBOX_PASSWORD=[a-f0-9]{64}$') {
  throw 'OPERATOR_SANDBOX_CREDENTIAL_FILE_INVALID'
}
$env:REF_OPERATOR_SOURCE_REVISION = $head
$dockerArgs = @('--context','bthwani-docker','compose','--env-file',$envFile,'-f',$compose,'-p','bthwani-operator-webauthn-s02')
& docker @dockerArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_SANDBOX_COMPOSE_INVALID' }

# Reuse the exact one-purpose disposable named volume; do not delete or reset it.
$existing = & docker --context bthwani-docker inspect bthwani-session02-webauthn-pg --format '{{index .Config.Labels "com.bthwani.capability"}}' 2>$null
if ($LASTEXITCODE -eq 0 -and $existing.Trim() -cne 'operator-bootstrap-disposable-db') {
  throw 'OPERATOR_SANDBOX_POSTGRES_OWNERSHIP_MISMATCH'
}
& docker @dockerArgs up -d --wait --wait-timeout 120 postgres
if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_SANDBOX_POSTGRES_START_FAILED' }
$pg = 'bthwani-session02-webauthn-pg'
$actual = (& docker --context bthwani-docker inspect $pg --format '{{index .Config.Labels "com.bthwani.environment"}}|{{index .Config.Labels "com.bthwani.capability"}}|{{.State.Health.Status}}').Trim()
if ($actual -cne 'operator-webauthn-sandbox|operator-bootstrap-disposable-db|healthy') {
  throw ('OPERATOR_SANDBOX_POSTGRES_NOT_HEALTHY status=' + $actual)
}
$db = 'refoundation_webauthn_s02'
$user = 'bthwani_fido_s02'
$schema = 'identity_test_operator_s02'
$check = (& docker --context bthwani-docker exec $pg psql -X -q -A -t -U $user -d $db -c "SELECT current_database()||'|'||current_user||'|'||(SELECT count(*) FROM pg_namespace WHERE nspname='$schema')").Trim()
if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_SANDBOX_DATABASE_READ_FAILED' }
if ($check -ceq "$db|$user|0") {
  $sql = [System.Text.StringBuilder]::new()
  foreach ($n in 1..8) {
    $filename = ('{0:D3}' -f $n) + '_' + @(
      'session_verification','operator_permission_read',
      'verified_customer_merchant_admission','customer_phone_verification',
      'operator_permission_management','operator_passkey_credentials',
      'operator_merchant_permission_cutover','operator_initial_bootstrap'
    )[$n-1] + '.sql'
    $path = Join-Path $root ('services/identity/database/migrations/' + $filename)
    [void]$sql.AppendLine(([IO.File]::ReadAllText($path)).Replace('__SCHEMA__',$schema))
  }
  $sql.ToString() | & docker --context bthwani-docker exec -i $pg psql -X -q -v ON_ERROR_STOP=1 --single-transaction -U $user -d $db
  if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_SANDBOX_MIGRATIONS_FAILED' }
  Write-Output 'MIGRATIONS=APPLIED_001_TO_008'
} elseif ($check -ceq "$db|$user|1") {
  Write-Output 'MIGRATIONS=PREEXISTING_SCHEMA_VERIFICATION'
} else {
  throw 'OPERATOR_SANDBOX_DATABASE_IDENTITY_MISMATCH'
}
$tables = (& docker --context bthwani-docker exec $pg psql -X -q -A -t -U $user -d $db -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='$schema' AND table_name IN ('actors','actor_roles','auth_sessions','operator_permissions','operator_bootstrap','operator_passkey_credentials','operator_initial_bootstrap')").Trim()
if ($LASTEXITCODE -ne 0 -or $tables -cne '7') { throw 'OPERATOR_SANDBOX_MIGRATION_READBACK_FAILED' }
$operatorCount = (& docker --context bthwani-docker exec $pg psql -X -q -A -t -U $user -d $db -c "SELECT (SELECT count(*) FROM $schema.actor_roles WHERE role='operator')||'|'||(SELECT count(*) FROM $schema.operator_bootstrap)||'|'||(SELECT count(*) FROM $schema.operator_initial_bootstrap)").Trim()
if ($LASTEXITCODE -ne 0 -or $operatorCount -cne '0|0|0') {
  throw 'OPERATOR_SANDBOX_EXISTING_OWNER_OR_CLAIM_REFUSED'
}
Write-Output 'DISPOSABLE_OWNER_SCHEMA=VERIFIED_EMPTY'
& docker @dockerArgs up -d --build --wait --wait-timeout 180 identity
if ($LASTEXITCODE -ne 0) { throw 'OPERATOR_SANDBOX_IDENTITY_START_FAILED' }
$identity = (& docker --context bthwani-docker inspect bthwani-operator-webauthn-s02-identity-1 --format '{{index .Config.Labels "com.bthwani.environment"}}|{{index .Config.Labels "com.bthwani.capability"}}|{{.State.Health.Status}}').Trim()
if ($identity -cne 'operator-webauthn-sandbox|identity-synthetic-operator-bootstrap|healthy') {
  throw ('OPERATOR_SANDBOX_IDENTITY_NOT_HEALTHY status=' + $identity)
}
Write-Output ('OPERATOR_SANDBOX=READY source_sha=' + $head + ' identity_loopback=3241 database=refoundation_webauthn_s02')
Write-Output 'OPERATOR_INITIAL_CLAIM=NOT_ISSUED (human-supervised one-time Windows Hello ceremony required)'
