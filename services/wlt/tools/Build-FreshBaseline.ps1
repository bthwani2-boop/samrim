param([switch]$WriteBaseline)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Development-only derived fresh baseline. No connection to protected databases.
$service = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$source = Join-Path $service 'database\migrations'
$target = Join-Path $service 'database\fresh-baseline.sql'
$migrations = @(Get-ChildItem -LiteralPath $source -File -Filter '*.sql' | Sort-Object Name)
if ($migrations.Count -lt 1) { throw 'WLT_BASELINE=BLOCKED no migrations' }
$rows = [Collections.Generic.List[string]]::new()
for ($i=0; $i -lt $migrations.Count; $i++) {
  $version=$i+1
  if (-not $migrations[$i].Name.StartsWith(('{0:d3}_' -f $version),[StringComparison]::Ordinal)) {
    throw "WLT_BASELINE=BLOCKED noncontiguous v$version"
  }
  $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([IO.File]::ReadAllBytes($migrations[$i].FullName))).ToLowerInvariant()
  $rows.Add("INSERT INTO wlt.schema_migrations(version,name,sha256) VALUES($version,'$($migrations[$i].Name)','$hash');")
}
if ($env:DOCKER_HOST) { throw 'WLT_BASELINE=BLOCKED unexpected Docker host override' }
if (@(docker info --format '{{.OSType}}') -notcontains 'linux') { throw 'WLT_BASELINE=BLOCKED Docker Linux required' }
$name = 'bthwani-wlt-fresh-baseline-proof'
if (@(docker container ls --all --filter "name=^/$name$" --format '{{.Names}}').Count -gt 0) {
  throw 'WLT_BASELINE=BLOCKED existing proof container has another owner'
}
$bytes=[byte[]]::new(16)
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
$password=[Convert]::ToHexString($bytes)
$created=$false
$temp=Join-Path ([IO.Path]::GetTempPath()) ('bthwani-wlt-baseline-' + [guid]::NewGuid().ToString('N') + '.sql')
try {
  docker run -d --rm --name $name --tmpfs '/var/lib/postgresql:rw,size=512m' -e 'POSTGRES_DB=wlt_fresh_proof' -e 'POSTGRES_USER=wlt_proof' -e "POSTGRES_PASSWORD=$password" 'postgis/postgis:18-3.6@sha256:e84455a058f60f06dd8c40e66a2c628b8fc113d9fca0896e1f308b25b897207f' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL docker start' }
  $created=$true
  $ready=$false
  for ($i=0; $i -lt 45; $i++) {
    docker exec $name pg_isready -q -U wlt_proof -d wlt_fresh_proof 2>$null
    if ($LASTEXITCODE -eq 0) { $ready=$true; break }
    Start-Sleep -Milliseconds 500
  }
  if (-not $ready) { throw 'WLT_BASELINE=FAIL database readiness' }
  # The PostGIS image starts a transient bootstrap postmaster before final startup.
  Start-Sleep -Seconds 4
  docker exec $name psql -X -v ON_ERROR_STOP=1 -U wlt_proof -d wlt_fresh_proof -A -t -c 'SELECT 1' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL final PostgreSQL not ready' }
  docker cp (Join-Path $source '.') "$($name):/tmp/wlt-migrations"
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL canonical SQL copy' }
  $migrate='set -eu; psql -X -q -v ON_ERROR_STOP=1 -U wlt_proof -d wlt_fresh_proof -c "CREATE SCHEMA wlt; CREATE TABLE wlt.schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp());"; for f in /tmp/wlt-migrations/*.sql; do psql -X -q -v ON_ERROR_STOP=1 -U wlt_proof -d wlt_fresh_proof -f "$f" >/dev/null; done'
  docker exec $name sh -ec $migrate
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL migration SQL' }
  $dump=@(docker exec $name pg_dump -U wlt_proof -d wlt_fresh_proof --schema-only --no-owner --no-acl --schema=wlt)
  if ($LASTEXITCODE -ne 0 -or $dump.Count -lt 10) { throw 'WLT_BASELINE=FAIL pg_dump' }
  $nl=[string][char]10
  $schema=(($dump | Where-Object { $_ -notmatch '^\\(un)?restrict\s+' }) -join $nl).TrimEnd() + $nl
  # A pure schema dump is NOT a complete bootstrap: owner migrations can create
  # required reference/policy rows. The source database is a fresh empty-data
  # disposable instance, so these are canonical bootstrap seeds, not user data.
  $dataDump=@(docker exec $name pg_dump -U wlt_proof -d wlt_fresh_proof --data-only --inserts --no-owner --no-acl --schema=wlt --exclude-table-data=wlt.schema_migrations)
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL canonical seed data dump' }
  $seed=(($dataDump | Where-Object { $_ -notmatch '^\\(un)?restrict\s+' }) -join $nl).TrimEnd() + $nl
  $seedRows=@($dataDump | Where-Object { $_ -match '^INSERT INTO ' }).Count
  $header='-- GENERATED WLT clean fresh-install schema from the canonical versioned migrations.' + $nl +
    '-- Fresh EMPTY databases only. Existing upgrade history remains unchanged.' + $nl +
    '-- The migration rows below signify equivalent baseline state, not individual executions.' + $nl
  [IO.File]::WriteAllText($temp,$header+$schema+$nl+$seed+$nl+($rows -join $nl)+$nl,[Text.UTF8Encoding]::new($false))
  docker exec $name createdb -U wlt_proof wlt_fresh_replay
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL replay database' }
  docker cp $temp "$($name):/tmp/fresh-baseline.sql"
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL replay copy' }
  docker exec $name psql -X -q -v ON_ERROR_STOP=1 -U wlt_proof -d wlt_fresh_replay -f /tmp/fresh-baseline.sql | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL replay SQL' }
  $actual=@(docker exec $name psql -X -A -t -U wlt_proof -d wlt_fresh_replay -c 'SELECT count(*) FROM wlt.schema_migrations')
  if ($LASTEXITCODE -ne 0 -or ($actual -join '').Trim() -ne [string]$migrations.Count) {
    throw 'WLT_BASELINE=FAIL version history not recreated'
  }
  $replay=@(docker exec $name pg_dump -U wlt_proof -d wlt_fresh_replay --schema-only --no-owner --no-acl --schema=wlt)
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL replay pg_dump' }
  $replaySchema=(($replay | Where-Object { $_ -notmatch '^\\(un)?restrict\s+' }) -join $nl).TrimEnd() + $nl
  # A pg_dump/psql round trip can remove redundant parentheses in CHECK
  # expressions while preserving SQL semantics. Compare PostgreSQL catalog
  # identities and critical structural flags, not dump text formatting.
  $catalogSql = @'
WITH objects AS (
 SELECT 'relation/' || c.relname AS key, c.relkind::text AS detail
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='wlt'
 UNION ALL
 SELECT 'column/' || c.relname || '/' || a.attname,
        format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull::text || ':' || a.attidentity::text || ':' || a.attgenerated::text
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='wlt' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint/' || co.conrelid::regclass::text || '/' || co.conname,
        co.contype::text || ':' || co.convalidated::text || ':' || co.condeferrable::text
 FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace
 WHERE n.nspname='wlt'
 UNION ALL
 SELECT 'index/' || ic.relname,
        i.indisunique::text || ':' || i.indisprimary::text || ':' || i.indisvalid::text
 FROM pg_index i JOIN pg_class ic ON ic.oid=i.indexrelid
 JOIN pg_namespace n ON n.oid=ic.relnamespace WHERE n.nspname='wlt'
 UNION ALL
 SELECT 'routine/' || p.proname || '/' || pg_get_function_identity_arguments(p.oid), p.prokind::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='wlt'
 UNION ALL
 SELECT 'trigger/' || c.relname || '/' || t.tgname,
        t.tgtype::text || ':' || t.tgenabled::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='wlt' AND NOT t.tgisinternal
)
SELECT md5(string_agg(key || '|' || detail, E'\n' ORDER BY key,detail)) FROM objects
'@
  $originalInventory=@(docker exec $name psql -X -A -t -v ON_ERROR_STOP=1 -U wlt_proof -d wlt_fresh_proof -c $catalogSql)
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL canonical catalog inventory' }
  $replayInventory=@(docker exec $name psql -X -A -t -v ON_ERROR_STOP=1 -U wlt_proof -d wlt_fresh_replay -c $catalogSql)
  if ($LASTEXITCODE -ne 0 -or ($originalInventory -join '') -cne ($replayInventory -join '')) {
    throw 'WLT_BASELINE=FAIL PostgreSQL relation/column/constraint/index/function/trigger inventory differs'
  }
  if ($schema -cne $replaySchema) { Write-Output 'WLT_BASELINE_DDL_ROUNDTRIP=POSTGRES_NORMALIZED_CHECK_PARENTHESES' }
  $replayData=@(docker exec $name pg_dump -U wlt_proof -d wlt_fresh_replay --data-only --inserts --no-owner --no-acl --schema=wlt --exclude-table-data=wlt.schema_migrations)
  if ($LASTEXITCODE -ne 0) { throw 'WLT_BASELINE=FAIL replay seed data dump' }
  $seedFacts = @($dataDump | Where-Object { $_ -match '^(INSERT INTO|SELECT pg_catalog.setval)' } | Sort-Object)
  $replayFacts = @($replayData | Where-Object { $_ -match '^(INSERT INTO|SELECT pg_catalog.setval)' } | Sort-Object)
  if (($seedFacts -join $nl) -cne ($replayFacts -join $nl)) {
    throw 'WLT_BASELINE=FAIL bootstrap reference rows/sequences do not match canonical migrations'
  }
  Write-Output "WLT_BASELINE_REFERENCE_DATA=PASS seeded_rows=$seedRows"
  if ($WriteBaseline) {
    Copy-Item -LiteralPath $temp -Destination $target -Force
    if ((Get-FileHash -LiteralPath $temp).Hash -ne (Get-FileHash -LiteralPath $target).Hash) {
      throw 'WLT_BASELINE=FAIL hash mismatch on published schema'
    }
    Write-Output "WLT_BASELINE=PASS versions=$($migrations.Count) schema=EQUIVALENT file=$target"
  } else {
    Write-Output "WLT_BASELINE=PASS versions=$($migrations.Count) schema=EQUIVALENT no_write"
  }
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Force }
  if ($created) {
    docker rm -f $name | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Output 'WLT_BASELINE_CLEANUP=PASS' }
    else { Write-Warning 'WLT_BASELINE_CLEANUP=FAIL inspect own container' }
  }
}
