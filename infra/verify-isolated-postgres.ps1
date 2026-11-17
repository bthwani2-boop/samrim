#requires -Version 7.0
# Fresh DSH migrations, least-privilege read denial and backup/restore proof.
# Creates only an ephemeral, network-disabled PostgreSQL with tmpfs storage.
# Never attaches to the project's existing database, volumes or service ports.
[CmdletBinding()]
param([string]$DockerContext = 'bthwani-docker')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$compose = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'compose.yaml'))
$imageMatch = [regex]::Match($compose, '(?m)^    image: (postgis/postgis:18-3\.6@sha256:[a-f0-9]{64})$')
if (!$imageMatch.Success) { throw 'Refusing unpinned database image' }
if ($DockerContext -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid Docker context' }
$image = $imageMatch.Groups[1].Value
$name = 'bthwani-agent01-pgproof-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$db = 'bthwani_agent01_synthetic'
$restoreDb = 'bthwani_agent01_restore'
$user = 'bthwani_agent01_admin'
$schema = 'dsh_test_agent01'
$reader = 'bthwani_agent01_reader'
$containerId = $null
try {
  $containerId = (& docker --context $DockerContext run -d --rm --name $name `
      --network none --mount 'type=tmpfs,dst=/var/lib/postgresql,tmpfs-size=536870912' `
      --label 'com.bthwani.test-scope=session01-disposable-sql' `
      -e 'POSTGRES_HOST_AUTH_METHOD=trust' -e ('POSTGRES_USER=' + $user) `
      -e ('POSTGRES_DB=' + $db) $image).Trim()
  if ($LASTEXITCODE -ne 0 -or $containerId -notmatch '^[a-f0-9]{64}$') { throw 'Cannot start disposable PostgreSQL' }
  $network = (& docker --context $DockerContext inspect $containerId --format '{{.HostConfig.NetworkMode}}').Trim()
  $published = (& docker --context $DockerContext inspect $containerId --format '{{len .HostConfig.PortBindings}}').Trim()
  $mounts = (& docker --context $DockerContext inspect $containerId --format '{{json .Mounts}}').Trim()
  if ($network -ne 'none' -or $published -ne '0' -or $mounts -match '"Type":"volume"') {
    throw 'Disposable PostgreSQL is not isolated from networks and persistent volumes'
  }
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    & docker --context $DockerContext exec $containerId pg_isready -q -U $user -d $db 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 600
  }
  if (!$ready) { throw 'Disposable PostgreSQL did not become ready' }
  $migrations = @(Get-ChildItem (Join-Path $root 'services/dsh/database/migrations') -Filter '*.sql' -File | Sort-Object Name)
  if ($migrations.Count -lt 5) { throw 'Missing a required DSH baseline migration in this bounded test' }
  foreach ($migration in $migrations) {
    $sql = [IO.File]::ReadAllText($migration.FullName).Replace('__SCHEMA__', $schema)
    $output = $sql | & docker --context $DockerContext exec -i $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $db -f - 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Fresh migration failed: ' + $migration.Name + ' ' + ($output | Out-String)) }
  }
  Write-Output "PG_FRESH_MIGRATIONS=PASS count=$($migrations.Count) ephemeral=yes"

  # The database owner retains migration rights; a new isolated reader must not.
  $grants = @(
    "CREATE ROLE $reader NOLOGIN",
    "GRANT USAGE ON SCHEMA $schema TO $reader",
    "GRANT SELECT ON ALL TABLES IN SCHEMA $schema TO $reader"
  )
  foreach ($sql in $grants) {
    $grantResult = & docker --context $DockerContext exec $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $db -c $sql 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Cannot provision disposable least-privilege reader: ' + $sql + ' result=' + ($grantResult | Out-String)) }
  }
  $readSql = 'BEGIN; SET LOCAL ROLE ' + $reader + '; SELECT count(*) FROM ' + $schema + '.public_revision; ROLLBACK;'
  $readOutput = & docker --context $DockerContext exec $containerId psql -X -v ON_ERROR_STOP=1 -U $user -d $db -Atc $readSql 2>&1
  if ($LASTEXITCODE -ne 0 -or !(@($readOutput | ForEach-Object { $_.ToString().Trim() }) -contains '1')) { throw 'Reader cannot read the intended synthetic table' }
  $writeSql = 'BEGIN; SET LOCAL ROLE ' + $reader + '; INSERT INTO ' + $schema + '.public_revision(singleton,revision) VALUES(false,1); ROLLBACK;'
  $denyOutput = & docker --context $DockerContext exec $containerId psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U $user -d $db -Atc $writeSql 2>&1
  if ($LASTEXITCODE -eq 0 -or ($denyOutput | Out-String) -notmatch '42501') { throw 'Reader write-denial was not proven' }
  Write-Output 'PG_READER_ACCESS=PASS select=allowed mutation=denied(sqlstate42501)'

  $dump = '/tmp/agent01-dsh.dump'
  $null = & docker --context $DockerContext exec $containerId pg_dump -Fc --no-owner --schema=$schema -U $user -d $db -f $dump 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic backup failed' }
  $null = & docker --context $DockerContext exec $containerId createdb -U $user $restoreDb 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create disposable restore target' }
  $null = & docker --context $DockerContext exec $containerId pg_restore --no-owner --no-privileges -U $user -d $restoreDb $dump 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic restore failed' }
  $fingerprintSql = "SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='$schema') || ':' || (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='$schema') || ':' || (SELECT count(*) FROM $schema.public_revision);"
  $before = (& docker --context $DockerContext exec $containerId psql -X -U $user -d $db -Atc $fingerprintSql).Trim()
  $after = (& docker --context $DockerContext exec $containerId psql -X -U $user -d $restoreDb -Atc $fingerprintSql).Trim()
  if ($LASTEXITCODE -ne 0 -or !$before -or $before -ne $after) {
    throw "Synthetic backup/restore readback mismatch (original=$before restored=$after)"
  }
  Write-Output "PG_RESTORE_READBACK=PASS table:constraint:revision-count=$before"
  Write-Output 'PG_ISOLATION=PASS network=none no-host-ports tmpfs-only'
} finally {
  if ($containerId -match '^[a-f0-9]{64}$') {
    # Stop only the exact ephemeral container started by this invocation.
    $label = (& docker --context $DockerContext inspect $containerId --format '{{index .Config.Labels "com.bthwani.test-scope"}}' 2>$null | Out-String).Trim()
    if ($label -eq 'session01-disposable-sql') {
      & docker --context $DockerContext stop $containerId | Out-Null
    } else {
      Write-Warning 'Disposable container ownership could not be verified; no cleanup performed'
    }
  }
}
