#Requires -Version 7.0
# One-time, synthetic Operator enrollment ticket for the isolated Lenovo Identity database.
# Run interactively on Surface. Never paste the ticket into chat, logs, or Git.
[CmdletBinding()]
param([switch]$CheckOnly, [switch]$CopyToClipboard)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ine 'BTHWANI') { throw 'SURFACE_ONLY: run this script on Surface.' }
if (-not [Environment]::UserInteractive) { throw 'INTERACTIVE_CONSOLE_REQUIRED' }

$dockerContext = 'bthwani-docker'
$expectedDockerEndpoint = 'ssh://bthwa@bthwani-docker'
$identityName = 'bthwani-operator-webauthn-s02-identity-1'
$postgresName = 'bthwani-session02-webauthn-pg'
$schema = 'identity_test_operator_s02'
$database = 'refoundation_webauthn_s02'
$dbUser = 'bthwani_fido_s02'

$endpoint = (& docker context inspect $dockerContext --format '{{.Endpoints.docker.Host}}' 2>$null)
if ($LASTEXITCODE -ne 0 -or $endpoint.Trim() -cne $expectedDockerEndpoint) {
    throw 'DOCKER_CONTEXT_NOT_THE_AUTHORIZED_LENOVO_SSH_ENDPOINT'
}

$identities = @(& docker --context $dockerContext inspect $identityName 2>$null | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $identities.Count -ne 1) {
    throw 'TEST_ENV_NOT_RUNNING: this ticket script only works with the isolated disposable Operator test container. It cannot issue or recover a passkey for any existing bthwani-refoundation Operator. Do not recreate a test Root to regain access to the primary control panel.'
}
$identity = $identities[0]
if ($identity.State.Running -ne $true -or $identity.State.Health.Status -cne 'healthy' -or
    $identity.Config.Labels.'com.bthwani.environment' -cne 'operator-webauthn-sandbox' -or
    $identity.Config.Labels.'com.bthwani.capability' -cne 'identity-synthetic-operator-bootstrap') {
    throw 'IDENTITY_CONTAINER_IS_NOT_THE_DISPOSABLE_OPERATOR_OWNER'
}
$flags = @(
  'BTHWANI_ISOLATED_TEST_MODE=true',
  'IDENTITY_DB_SCHEMA=identity_test_operator_s02',
  'IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true',
  'IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true',
  'IDENTITY_OPERATOR_PASSKEY_RPID=localhost',
  'IDENTITY_OPERATOR_PASSKEY_ORIGINS=http://localhost:13000'
)
foreach ($flag in $flags) {
    if (@($identity.Config.Env) -cnotcontains $flag) { throw 'IDENTITY_ISOLATION_OR_WEBAUTHN_CONFIG_MISMATCH' }
}
$dbURL = @($identity.Config.Env | Where-Object { $_ -clike 'IDENTITY_TEST_DATABASE_URL=*' })
$dbMatches = $false
if ($dbURL.Count -eq 1) {
    $rawURL = $dbURL[0].Substring('IDENTITY_TEST_DATABASE_URL='.Length)
    try {
        $parsed = [Uri]::new($rawURL)
        $dbMatches = ($parsed.Scheme -ceq 'postgres' -and
            $parsed.Host -ceq 'postgres' -and $parsed.Port -eq 5432 -and
            $parsed.AbsolutePath -ceq '/refoundation_webauthn_s02' -and
            $parsed.Query -ceq '?sslmode=disable' -and $parsed.Fragment -ceq '' -and
            $parsed.UserInfo -cmatch "^bthwani_fido_s02:[a-f0-9]{64}$" -and
            $parsed.OriginalString -ceq ('postgres://' + $parsed.UserInfo + '@postgres:5432/refoundation_webauthn_s02?sslmode=disable'))
    } catch {
        $dbMatches = $false
    }
}
if (-not $dbMatches) {
    throw 'IDENTITY_DATABASE_SCOPE_MISMATCH'
}
$containers = @(& docker --context $dockerContext inspect $postgresName 2>$null | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0 -or $containers.Count -ne 1) { throw 'DISPOSABLE_DATABASE_CONTAINER_MISSING' }
$dbContainer = $containers[0]
if ($dbContainer.State.Health.Status -cne 'healthy' -or
    $dbContainer.Config.Labels.'com.bthwani.capability' -cne 'operator-bootstrap-disposable-db') {
    throw 'DISPOSABLE_DATABASE_NOT_VERIFIED'
}
# Only metadata is returned. No credential/claim secret is read from SQL.
$sql = "SELECT current_database()||'|'||(SELECT count(*) FROM $schema.actor_roles WHERE role='operator')||'|'||(SELECT count(*) FROM $schema.operator_bootstrap)||'|'||(SELECT count(*) FROM $schema.operator_passkey_credentials)||'|'||(SELECT count(*) FROM $schema.operator_initial_bootstrap WHERE consumed_at IS NULL AND expires_at>clock_timestamp())"
$readback = @(& docker --context $dockerContext exec $postgresName psql -X -q -A -t -v ON_ERROR_STOP=1 -U $dbUser -d $database -c $sql 2>$null)
if ($LASTEXITCODE -ne 0 -or $readback.Count -ne 1 -or $readback[0].Trim() -cnotmatch '^refoundation_webauthn_s02\|[0-9]+\|[0-9]+\|[0-9]+\|[0-9]+$') {
    throw 'DISPOSABLE_OWNER_READBACK_FAILED'
}
$fields = $readback[0].Trim().Split('|')
if ($fields[1] -ne '0' -or $fields[2] -ne '0' -or $fields[3] -ne '0') {
    throw 'OPERATOR_ALREADY_EXISTS: use the existing account, not first-owner bootstrap.'
}
if ($fields[4] -ne '0') {
    throw 'UNEXPIRED_TICKET_EXISTS: the issuer cannot retrieve an existing digest-only ticket. Request a new one only after expiry.'
}
Write-Host 'PASS: isolated Identity, owner database, and empty Operator verified.'
if ($CheckOnly) {
    Write-Host 'CHECK_ONLY: no code was issued and no database row was changed.'
    return
}
Write-Warning 'This creates a TEST Operator only; it does not recover the original administrator.'
$approval = Read-Host 'Type ISSUE to create a 10-minute TEST enrollment code'
if ($approval -cne 'ISSUE') {
    Write-Host 'CANCELLED: no code was issued.'
    return
}
$ticket = $null
try {
    # Exact offline owner CLI; does not modify the shared bthwani-refoundation Identity.
    $lines = @(& docker --context $dockerContext exec $identityName /usr/local/bin/identity issue-synthetic-root-ticket 2>$null)
    if ($LASTEXITCODE -ne 0 -or $lines.Count -ne 1 -or
        $lines[0].Trim() -cnotmatch '^[A-Za-z0-9_-]{43}$') {
        throw 'TICKET_ISSUER_FAILED: recheck owner state before any retry.'
    }
    $ticket = $lines[0].Trim()
    if ($CopyToClipboard) {
        # Keep the 10-minute ticket on this Surface user's clipboard, never echo it or send it over chat.
        Set-Clipboard -Value $ticket -ErrorAction Stop
        Write-Host 'PASS: temporary TEST enrollment code copied to Surface clipboard (not printed).'
        Write-Host 'Paste it only into the TEST registration form while that isolated preview is running.'
        Write-Host 'Press Enter after pasting to clear the clipboard, if its content is unchanged.'
        [void][Console]::ReadLine()
        if ((Get-Clipboard -Raw) -ceq $ticket) {
            Set-Clipboard -Value '' -ErrorAction Stop
            Write-Host 'PASS: clipboard cleared.'
        } else {
            Write-Host 'CLIPBOARD_NOT_CLEARED: content changed after copying; no other clipboard data was touched.'
        }
    } else {
        Write-Host ''
        Write-Host 'LOCAL TEST ENROLLMENT CODE (valid for 10 minutes):'
        [Console]::WriteLine($ticket)
        Write-Host ''
        Write-Host 'Do not share this code; use it only for the disposable TEST owner.'
    }
    Write-Host 'Registration does not sign you in; afterwards use the Passkey sign-in button.'
}
finally {
    $ticket = $null
    $lines = $null
}
