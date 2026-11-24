#requires -Version 7.0
# Fresh DSH, Identity and WLT baselines, DSH restore, and owner permissions.
# Creates only an ephemeral, network-disabled PostgreSQL with tmpfs storage.
# Never attaches to the project's existing database, volumes or service ports.
[CmdletBinding()]
param([string]$DockerContext = 'bthwani-docker', [switch]$NoPull)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
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
$pullPolicy = if ($NoPull) { @('--pull','never') } else { @() }
try {
  $containerId = (& docker --context $DockerContext run -d --rm @pullPolicy --name $name `
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
    # The image's bootstrap server can accept Unix socket connections before
    # it stops and the final PostgreSQL TCP listener starts.
    $identity = & docker --context $DockerContext exec $containerId psql -X -At -h 127.0.0.1 -v ON_ERROR_STOP=1 -U $user -d $db -c 'SELECT current_database()' 2>$null
    if ($LASTEXITCODE -eq 0 -and $identity -ceq $db) { $ready = $true; break }
    Start-Sleep -Milliseconds 600
  }
  if (!$ready) { throw 'Disposable PostgreSQL did not become ready' }
  $baseline = @(Get-ChildItem (Join-Path $root 'services/dsh/database/schema') -Filter '*.sql' -File | Sort-Object Name)
  if ($baseline.Count -lt 7) { throw 'Missing essential DSH baseline domain files' }
  foreach ($file in $baseline) {
    $sql = [IO.File]::ReadAllText($file.FullName).Replace('__SCHEMA__', $schema)
    $output = $sql | & docker --context $DockerContext exec -i $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $db -f - 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Fresh DSH baseline failed: ' + $file.Name + ' ' + ($output | Out-String)) }
  }
  Write-Output "PG_FRESH_DSH_BASELINE=PASS count=$($baseline.Count) ephemeral=yes"

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
  function Assert-ReaderAccess([string]$Database) {
    $readSql = "BEGIN; SET LOCAL ROLE $reader; SELECT revision FROM $schema.public_revision WHERE singleton; ROLLBACK;"
    $readOutput = & docker --context $DockerContext exec $containerId psql -X -qAt -v ON_ERROR_STOP=1 -U $user -d $Database -c $readSql 2>&1
    if ($LASTEXITCODE -ne 0 -or ($readOutput | Out-String).Trim() -cne '0') {
      throw "Reader cannot read the intended synthetic revision in $Database"
    }
    $writeSql = "BEGIN; SET LOCAL ROLE $reader; UPDATE $schema.public_revision SET revision=revision+1 WHERE singleton; ROLLBACK;"
    $denyOutput = & docker --context $DockerContext exec $containerId psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U $user -d $Database -Atc $writeSql 2>&1
    if ($LASTEXITCODE -eq 0 -or ($denyOutput | Out-String) -notmatch '42501') {
      throw "Reader write-denial was not proven in $Database"
    }
  }
  Assert-ReaderAccess $db
  Write-Output 'PG_READER_ACCESS=PASS select=allowed update=denied(sqlstate42501)'

  function Assert-CityConstraint([string]$Database) {
    $writeCity = "INSERT INTO $schema.service_cities(id,active,timezone_name) VALUES ('restore-check',true,"
    $null = & docker --context $DockerContext exec $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $Database -c "BEGIN; $writeCity 'Asia/Aden'); ROLLBACK;" 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Valid synthetic timezone was refused in $Database" }
    $invalid = & docker --context $DockerContext exec $containerId psql -X -q -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U $user -d $Database -c "BEGIN; $writeCity '@invalid@'); ROLLBACK;" 2>&1
    $details = $invalid | Out-String
    if ($LASTEXITCODE -eq 0 -or $details -notmatch '23514' -or $details -notmatch 'service_cities_timezone_name_valid') {
      throw "Named timezone constraint did not reject invalid input in $Database"
    }
  }
  Assert-CityConstraint $db

  $dump = '/tmp/agent01-dsh.dump'
  $null = & docker --context $DockerContext exec $containerId pg_dump -Fc --no-owner --schema=$schema -U $user -d $db -f $dump 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic backup failed' }
  $null = & docker --context $DockerContext exec $containerId createdb -U $user $restoreDb 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create disposable restore target' }
  # A fresh database in the same disposable cluster can restore the original
  # schema and table grants to the synthetic reader.
  $null = & docker --context $DockerContext exec $containerId pg_restore --no-owner --exit-on-error --single-transaction -U $user -d $restoreDb $dump 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'Synthetic restore failed' }
  Assert-ReaderAccess $restoreDb
  Assert-CityConstraint $restoreDb

  # Both snapshots run on the same PostgreSQL version. Its precedence-aware
  # deparser removes redundant grouping introduced by dump/restore.
  $fingerprintSql = @"
SELECT jsonb_build_object(
  'columns', (SELECT jsonb_agg(jsonb_build_array(table_name, column_name, ordinal_position, column_default,
                  is_nullable, udt_schema, udt_name, character_maximum_length, numeric_precision, numeric_scale,
                  datetime_precision, is_identity, identity_generation, generation_expression)
                  ORDER BY table_name, ordinal_position)
              FROM information_schema.columns c WHERE table_schema = '$schema'),
  'constraints', (SELECT jsonb_agg(jsonb_build_array(cl.relname, c.conname, c.convalidated, pg_get_constraintdef(c.oid, true))
                                  ORDER BY cl.relname, c.conname)
                  FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
                  WHERE c.connamespace = '$schema'::regnamespace AND c.contype <> 'n'),
  'indexes', (SELECT jsonb_agg(indexdef ORDER BY tablename, indexname)
              FROM pg_indexes WHERE schemaname = '$schema'),
  'triggers', (SELECT jsonb_agg(pg_get_triggerdef(t.oid) ORDER BY cl.relname, t.tgname)
               FROM pg_trigger t JOIN pg_class cl ON cl.oid = t.tgrelid
               WHERE cl.relnamespace = '$schema'::regnamespace AND NOT t.tgisinternal),
  'functions', (SELECT jsonb_agg(jsonb_build_array(p.proname, pg_get_function_identity_arguments(p.oid),
                      pg_get_functiondef(p.oid)) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid))
                 FROM pg_proc p WHERE p.pronamespace = '$schema'::regnamespace),
  'revision', (SELECT revision FROM $schema.public_revision WHERE singleton)
);
"@
  function Read-Fingerprint([string]$Database) {
    $snapshot = & docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U $user -d $Database -c $fingerprintSql
    if ($LASTEXITCODE -ne 0 -or !$snapshot) { throw "Cannot inspect synthetic schema in $Database" }
    return ConvertFrom-Json -AsHashtable -InputObject $snapshot
  }
  $before = Read-Fingerprint $db
  $after = Read-Fingerprint $restoreDb
  # Column nullability is compared directly. PostgreSQL 18 can generate new
  # internal constraint names for inline NOT NULL while recreating a table.
  foreach ($property in @('columns', 'constraints', 'indexes', 'triggers', 'functions', 'revision')) {
    $original = ConvertTo-Json -Depth 12 -Compress -InputObject $before[$property]
    $restored = ConvertTo-Json -Depth 12 -Compress -InputObject $after[$property]
    if ($original -cne $restored) {
      if ($property -eq 'constraints') {
        $beforeRows = @($before[$property] | ForEach-Object { ConvertTo-Json -Compress -InputObject $_ })
        $afterRows = @($after[$property] | ForEach-Object { ConvertTo-Json -Compress -InputObject $_ })
        Compare-Object -ReferenceObject $beforeRows -DifferenceObject $afterRows -CaseSensitive |
          ForEach-Object { Write-Host "Synthetic constraint $($_.SideIndicator) $($_.InputObject)" }
      }
      throw "Synthetic backup/restore mismatch in $property"
    }
  }
  Write-Output 'PG_RESTORE_READBACK=PASS columns,keys,indexes,triggers,functions,revision,reader-grants,city-timezone-constraint'

  # Exercise a nonempty data-only transfer into the dedicated DSH database.
  # The original fixture remains intact. New baseline tables are not seeded
  # from a historical source; all FKs and triggers remain enabled.
  function Invoke-ProofSql([string]$Database, [string]$Sql) {
    $result = $Sql | & docker --context $DockerContext exec -i $containerId psql -X -qAt -v ON_ERROR_STOP=1 -U $user -d $Database -f - 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated owner database proof SQL failed' }
    return ($result | Out-String).Trim()
  }
  $null = Invoke-ProofSql $db "INSERT INTO $schema.service_cities(id,active,timezone_name) VALUES ('preserved-city',true,'Asia/Aden'); UPDATE $schema.public_revision SET revision=7 WHERE singleton;"
  $dshDb = 'bthwani_dsh_dev'
  $null = Invoke-ProofSql 'postgres' 'CREATE ROLE bthwani_dsh_owner NOLOGIN NOINHERIT; CREATE ROLE bthwani_dsh_runtime LOGIN NOINHERIT;'
  $null = & docker --context $DockerContext exec $containerId createdb -U $user -O bthwani_dsh_owner $dshDb
  if ($LASTEXITCODE -ne 0) { throw 'Dedicated DSH fixture database failed' }
  $null = Invoke-ProofSql 'postgres' "REVOKE ALL ON DATABASE $dshDb FROM PUBLIC; GRANT CONNECT ON DATABASE $dshDb TO bthwani_dsh_runtime;"
  $null = Invoke-ProofSql $dshDb "REVOKE ALL ON SCHEMA public FROM PUBLIC;"
  foreach ($file in $baseline) {
    $sql = "SET ROLE bthwani_dsh_owner;`n" + [IO.File]::ReadAllText($file.FullName).Replace('__SCHEMA__', $schema)
    $null = Invoke-ProofSql $dshDb $sql
  }
  $dshDataDump = '/tmp/agent01-dsh-data.dump'
  $null = & docker --context $DockerContext exec $containerId pg_dump -Fc --data-only --no-owner --no-acl "--schema=$schema" "--exclude-table=$schema.customer_addresses" "--exclude-table=$schema.service_city_delivery_policies" -U $user -d $db -f $dshDataDump
  if ($LASTEXITCODE -ne 0) { throw 'DSH synthetic compatible data export failed' }
  # Only the just-created fixture singleton is replaced; no old database is written.
  $null = Invoke-ProofSql $dshDb "DELETE FROM $schema.public_revision WHERE singleton;"
  $null = & docker --context $DockerContext exec $containerId pg_restore --data-only --no-owner --no-acl --exit-on-error --single-transaction -U $user -d $dshDb $dshDataDump
  if ($LASTEXITCODE -ne 0) { throw 'DSH synthetic compatible data restore failed' }
  $null = Invoke-ProofSql $dshDb "GRANT USAGE ON SCHEMA $schema TO bthwani_dsh_runtime; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA $schema TO bthwani_dsh_runtime; GRANT USAGE ON ALL SEQUENCES IN SCHEMA $schema TO bthwani_dsh_runtime;"
  $proof = Invoke-ProofSql $dshDb "SELECT CASE WHEN (SELECT count(*) FROM $schema.service_cities WHERE id='preserved-city' AND active AND timezone_name='Asia/Aden')=1 AND (SELECT revision FROM $schema.public_revision WHERE singleton)=7 AND (SELECT count(*) FROM $schema.customer_addresses)=0 AND (SELECT count(*) FROM $schema.service_city_delivery_policies)=0 THEN 'PASS' ELSE 'FAIL' END;"
  if ($proof -cne 'PASS') { throw 'Dedicated DSH fixture data transfer readback failed' }
  $sourceProof = Invoke-ProofSql $db "SELECT count(*) FROM $schema.service_cities WHERE id='preserved-city';"
  if ($sourceProof -cne '1') { throw 'DSH original fixture data no longer present' }
  # Execute the actual Go database boundary, not a second copy of its predicate.
  $binary = Join-Path ([IO.Path]::GetTempPath()) ('bthwani-dsh-dbproof-' + [guid]::NewGuid().ToString('N'))
  $priorGo = @{}
  foreach ($key in @('GOOS','GOARCH','CGO_ENABLED','GOTOOLCHAIN','GOWORK')) { $priorGo[$key] = [Environment]::GetEnvironmentVariable($key,'Process') }
  try {
    $env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'; $env:GOTOOLCHAIN='local'; $env:GOWORK='off'
    Push-Location (Join-Path $root 'services/dsh/backend')
    try {
      & go test -c -o $binary ./internal/dbscope
      if ($LASTEXITCODE -ne 0) { throw 'DSH database boundary test build failed' }
    } finally { Pop-Location }
    & docker --context $DockerContext cp $binary "${containerId}:/tmp/dsh-dbproof"
    if ($LASTEXITCODE -ne 0) { throw 'DSH database boundary test copy failed' }
    & docker --context $DockerContext exec $containerId chmod 755 /tmp/dsh-dbproof
    if ($LASTEXITCODE -ne 0) { throw 'DSH database boundary test permission failed' }
    $result = & docker --context $DockerContext exec -e BTHWANI_DSH_DEV_DB_PROOF=network-none-disposable $containerId /tmp/dsh-dbproof '-test.v' '-test.run' '^TestDedicatedDevelopmentRuntimePostgres$' '-test.count=1'
    if ($LASTEXITCODE -ne 0 -or ($result | Out-String) -notmatch '(?m)^--- PASS: TestDedicatedDevelopmentRuntimePostgres ' -or ($result | Out-String) -match '(?m)^--- SKIP:') { throw ('DSH real database runtime boundary failed: ' + ($result | Out-String)) }
  } finally {
    foreach ($key in $priorGo.Keys) { [Environment]::SetEnvironmentVariable($key,$priorGo[$key],'Process') }
    if ([IO.File]::Exists($binary)) { [IO.File]::Delete($binary) }
  }
  Write-Output 'PG_DSH_DEDICATED_RUNTIME=PASS data-preserved owner-ddl-denied admin-denied shared-db-denied'

  # Reuse the SAME network-disabled/tmpfs container to prove fresh Identity and
  # WLT baselines. Never connect these tests to retained or shared databases.
  $identitySchema = 'identity_test_fresh_baseline'
  $identityFiles = @(Get-ChildItem (Join-Path $root 'services/identity/database/schema') -Filter '*.sql' -File | Sort-Object Name)
  if ($identityFiles.Count -lt 5) { throw 'Missing essential Identity baseline domain files' }
  foreach ($file in $identityFiles) {
    $sql = [IO.File]::ReadAllText($file.FullName).Replace('__SCHEMA__', $identitySchema)
    $output = $sql | & docker --context $DockerContext exec -i $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $db -f - 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Fresh Identity baseline failed: ' + $file.Name + ' ' + ($output | Out-String)) }
  }
  $identityCheck = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U $user -d $db -c @"
SELECT CASE WHEN
  (SELECT count(*) FROM information_schema.tables WHERE table_schema='$identitySchema' AND table_type='BASE TABLE') = 15
  AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$identitySchema' AND table_name='auth_refresh_tokens')
  AND NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='$identitySchema' AND table_name='operator_merchant_scope_cutover_audit')
  AND EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='$identitySchema' AND t.relname='operator_permissions'
      AND c.conname='operator_permissions_permission_check'
      AND pg_get_constraintdef(c.oid) LIKE '%merchant%'
      AND pg_get_constraintdef(c.oid) NOT LIKE '%partners%')
THEN 'PASS' ELSE 'FAIL' END;
"@ | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $identityCheck -cne 'PASS') { throw 'Identity baseline object or canonical permission readback failed' }
  Write-Output "PG_FRESH_IDENTITY_BASELINE=PASS count=$($identityFiles.Count) tables=15 canonical-merchant-only=yes"

  foreach ($role in @('bthwani_wlt_owner NOLOGIN', 'bthwani_wlt_reader LOGIN', 'bthwani_wlt_sandbox LOGIN')) {
    $null = & docker --context $DockerContext exec $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d postgres -c "CREATE ROLE $role"
    if ($LASTEXITCODE -ne 0) { throw 'WLT disposable role bootstrap failed' }
  }
  $wltDb = 'bthwani_wlt_test'
  $null = & docker --context $DockerContext exec $containerId createdb -U $user -O bthwani_wlt_owner $wltDb
  if ($LASTEXITCODE -ne 0) { throw 'WLT disposable database bootstrap failed' }
  $wltSchemaFiles = @(Get-ChildItem (Join-Path $root 'services/wlt/database/schema') -Filter '*.sql' -File | Sort-Object Name)
  $wltSandboxFiles = @(Get-ChildItem (Join-Path $root 'services/wlt/database/sandbox') -Filter '*.sql' -File | Sort-Object Name)
  if ($wltSchemaFiles.Count -lt 3 -or $wltSandboxFiles.Count -lt 2) { throw 'WLT baseline or sandbox source incomplete' }
  foreach ($file in $wltSchemaFiles) {
    $sql = "SET ROLE bthwani_wlt_owner;`n" + [IO.File]::ReadAllText($file.FullName)
    $output = $sql | & docker --context $DockerContext exec -i $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $wltDb -f - 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Fresh WLT core schema failed: ' + $file.Name + ' ' + ($output | Out-String)) }
  }
  $sandboxAbsent = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U $user -d $wltDb -c @"
SELECT CASE WHEN
  to_regprocedure('wlt.post_sandbox_customer_funding(text,text,bigint)') IS NULL
  AND to_regprocedure('wlt.reverse_sandbox_customer_funding(text,text)') IS NULL
  AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='customer_funding_reversal_provider')
THEN 'PASS' ELSE 'FAIL' END;
"@ | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $sandboxAbsent -cne 'PASS') { throw 'WLT core schema unexpectedly exposes synthetic financial commands' }
  foreach ($file in $wltSandboxFiles) {
    $sql = "SET ROLE bthwani_wlt_owner;`n" + [IO.File]::ReadAllText($file.FullName)
    $output = $sql | & docker --context $DockerContext exec -i $containerId psql -X -q -v ON_ERROR_STOP=1 -U $user -d $wltDb -f - 2>&1
    if ($LASTEXITCODE -ne 0) { throw ('Fresh WLT sandbox schema failed: ' + $file.Name + ' ' + ($output | Out-String)) }
  }
  $wltPrivileges = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U $user -d $wltDb -c @"
SELECT CASE WHEN
  (SELECT count(*) FROM wlt.customer_funding_journal) = 0
  AND has_table_privilege('bthwani_wlt_reader','wlt.customer_wallet_balances','SELECT')
  AND has_table_privilege('bthwani_wlt_reader','wlt.customer_funding_history','SELECT')
  AND NOT has_any_column_privilege('bthwani_wlt_reader','wlt.customer_funding_journal','SELECT')
  AND NOT has_function_privilege('bthwani_wlt_reader','wlt.post_sandbox_customer_funding(text,text,bigint)','EXECUTE')
  AND NOT has_function_privilege('bthwani_wlt_reader','wlt.reverse_sandbox_customer_funding(text,text)','EXECUTE')
THEN 'PASS' ELSE 'FAIL' END;
"@ | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $wltPrivileges -cne 'PASS') { throw 'WLT baseline grants, owner or empty journal readback failed' }
  $denied = & docker --context $DockerContext exec $containerId psql -X -v ON_ERROR_STOP=1 -v VERBOSITY=verbose -U bthwani_wlt_reader -d $wltDb -c 'SELECT provider_reference FROM wlt.customer_funding_journal' 2>&1
  if ($LASTEXITCODE -eq 0 -or ($denied | Out-String) -notmatch '42501') { throw 'WLT private ledger reader denial not proven' }
  $reference = 'fresh-baseline-001'
  $testCustomer = 'synthetic-baseline-actor'
  $funding = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_sandbox -d $wltDb -c "SELECT wlt.post_sandbox_customer_funding('$reference','$testCustomer',53)" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $funding -cne 'POSTED') { throw 'WLT sandbox new posting failed' }
  $fundingReplay = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_sandbox -d $wltDb -c "SELECT wlt.post_sandbox_customer_funding('$reference','$testCustomer',53)" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $fundingReplay -cne 'REPLAYED') { throw 'WLT sandbox posting replay failed' }
  $reversal = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_sandbox -d $wltDb -c "SELECT wlt.reverse_sandbox_customer_funding('$reference','$testCustomer')" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $reversal -cne 'REVERSED') { throw 'WLT sandbox reversal failed' }
  $reversalReplay = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U bthwani_wlt_sandbox -d $wltDb -c "SELECT wlt.reverse_sandbox_customer_funding('$reference','$testCustomer')" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $reversalReplay -cne 'REPLAYED') { throw 'WLT sandbox reversal replay failed' }
  $moneyReadback = (& docker --context $DockerContext exec $containerId psql -X -At -v ON_ERROR_STOP=1 -U $user -d $wltDb -c "SELECT count(*) || ':' || sum(CASE side WHEN 'debit' THEN amount_yer ELSE -amount_yer END) FROM wlt.customer_funding_entries WHERE actor_id='$testCustomer'" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or $moneyReadback -cne '4:0') { throw 'WLT double-entry balance or idempotency readback failed' }
  Write-Output 'PG_FRESH_WLT_BASELINE=PASS schema=3 sandbox=2 privilege-isolation=yes posting-replay=yes reversal-replay=yes entries=4 net=0'
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
