$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repositoryRoot
$dockerOS = @(docker info --format '{{.OSType}}' 2>$null)
if ($LASTEXITCODE -ne 0 -or $dockerOS -notcontains 'linux') {
  throw 'WLT_FINANCE_PROOF=BLOCKED Docker Linux Engine is unavailable; no test container or database was created.'
}
$name = 'bthwani-wlt-proof-isolated'
$port = 15439
$dbName = 'bthwani_wlt_finance_proof'
$dbUser = 'finance_proof'
$passwordBytes = New-Object byte[] 20
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$password = ([BitConverter]::ToString($passwordBytes)).Replace('-', '')
$databaseUrl = "postgres://$($dbUser):$($password)@127.0.0.1:$($port)/$($dbName)?sslmode=disable&connect_timeout=5"
$existing = docker container ls --all --filter "name=^/$name$" --format "{{.Names}}"
if($existing){throw 'Isolated finance test container already exists; refusing to replace it'}
# The PostGIS image declares a data VOLUME. Bind it to tmpfs in isolated proofs
# so docker run --rm cannot leave anonymous PostgreSQL volumes behind.
docker run -d --rm --name $name --tmpfs '/var/lib/postgresql:rw,size=512m' -p "127.0.0.1:$($port):5432" -e "POSTGRES_DB=$dbName" -e "POSTGRES_USER=$dbUser" -e "POSTGRES_PASSWORD=$password" 'postgis/postgis:18-3.6@sha256:e84455a058f60f06dd8c40e66a2c628b8fc113d9fca0896e1f308b25b897207f' | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Could not create isolated PostgreSQL container'}
try {
  $ready = $false
  for ($i=0;$i -lt 45;$i++) {
    docker exec $name pg_isready -h 127.0.0.1 -q -U $dbUser -d $dbName 2>$null
    if($LASTEXITCODE -eq 0){
      $sql = docker exec $name psql -h 127.0.0.1 -U $dbUser -d $dbName -At -c 'SELECT 1' 2>$null
      if($LASTEXITCODE -eq 0 -and $sql -eq '1'){$ready=$true;break}
    }
    Start-Sleep -Milliseconds 1000
  }
  if(-not $ready){throw 'Isolated PostgreSQL did not become ready'}
  # PostgreSQL runs a transient postmaster during initial bootstrap. Verify
  # the final listening daemon before attempting cross-host test connections.
  Start-Sleep -Seconds 4
  Write-Output 'FINANCE_PROOF_DATABASE=ISOLATED_READY'
  $env:WLT_TEST_DATABASE_URL = $databaseUrl
  $env:BTHWANI_EXPECTED_DATABASE_HOST = '127.0.0.1'
  $env:BTHWANI_EXPECTED_DATABASE_PORT = "$port"
  $env:BTHWANI_EXPECTED_DATABASE_NAME = $dbName
  $env:BTHWANI_EXPECTED_DATABASE_USER = $dbUser
  & go test ./services/wlt/backend/internal/storage/postgres -run 'TestPartnerStoreFinanceAndRecipientSettlementLifecycle|TestCashIn|TestStoreCommercialAgreementLifecycleAndOrderSnapshots' -v -count=1 -timeout 240s
  if ($LASTEXITCODE -ne 0) {throw 'WLT finance integration tests failed'}
  Write-Output 'WLT_FINANCE_ISOLATED_TESTS=PASS'
} catch {
  Write-Output "WLT_PROOF_ERROR=$($_.Exception.Message)"
  docker logs --tail 25 $name 2>$null
  throw
} finally {
  docker rm -f $name 2>$null | Out-Null
  Write-Output 'FINANCE_PROOF_DATABASE=STOPPED_REMOVED'
}
