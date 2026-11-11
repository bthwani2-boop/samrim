param(
  [string]$WltTestPattern = 'TestPartnerStoreFinanceAndRecipientSettlementLifecycle|TestCashIn|TestStoreCommercialAgreementLifecycleAndOrderSnapshots|TestPaymentRetryLostResponseAndParallelWorkers',
  [string]$DshTestPattern = '',
  [string]$WltHttpTestPattern = '',
  [string]$CrossServiceTestPattern = ''
)
$ErrorActionPreference = 'Stop'
# The DSH -> real WLT proof must start with TWO pristine, separate databases.
# Do not mix it with tests that already migrate the primary WLT database.
if ($CrossServiceTestPattern -and ($WltTestPattern -or $DshTestPattern -or $WltHttpTestPattern)) {
  throw 'CROSS_SERVICE_FINANCE_PROOF=BLOCKED select cross-service alone with -WltTestPattern empty'
}
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repositoryRoot
# A DOCKER_HOST override changes the effective daemon without changing context inspect.
# Reject it before any docker invocation creates a disposable container.
if (-not [string]::IsNullOrWhiteSpace($env:DOCKER_HOST)) {
  throw 'WLT_FINANCE_PROOF=BLOCKED DOCKER_HOST overrides the inspected Docker context'
}
function Assert-ProofRan([string]$label, [object[]]$lines) {
  $text = @($lines) -join "`n"
  $started = [regex]::Matches($text, '(?m)^=== RUN[ \t]+(\S+)')
  # Go prints nested/subprocess PASS lines indented; count only top-level
  # selected tests here. The go test exit code already rejects child failures.
  $passed = [regex]::Matches($text, '(?m)^--- PASS:[ \t]+(\S+)')
  if ($text -match '\[no tests to run\]' -or $text -match '(?m)^[ \t]*--- SKIP:' -or
      $started.Count -eq 0 -or $started.Count -ne $passed.Count) {
    throw "$label did not execute and pass all its selected tests"
  }
  $passedNames = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($match in $passed) { [void]$passedNames.Add($match.Groups[1].Value) }
  foreach ($match in $started) {
    if (-not $passedNames.Contains($match.Groups[1].Value)) {
      throw "$label did not pass selected test $($match.Groups[1].Value)"
    }
  }
}
$dockerOS = @(docker info --format '{{.OSType}}' 2>$null)
if ($LASTEXITCODE -ne 0 -or $dockerOS -notcontains 'linux') {
  throw 'WLT_FINANCE_PROOF=BLOCKED Docker Linux Engine is unavailable; no test container or database was created.'
}
# An SSH Docker context publishes loopback ports on the remote host, not this computer.
$contextName = (docker context show).Trim()
if ($LASTEXITCODE -ne 0 -or -not $contextName) { throw 'Docker context is unavailable' }
$endpoint = (docker context inspect $contextName --format '{{.Endpoints.docker.Host}}').Trim()
if ($LASTEXITCODE -ne 0 -or -not $endpoint) { throw 'Docker endpoint is unavailable' }
$dockerUri = [Uri]$endpoint
$sshTarget = $null
$sshPort = $null
switch ($dockerUri.Scheme) {
  'ssh' {
    if (-not $dockerUri.Host -or $dockerUri.UserInfo.Contains(':')) {
      throw 'Unsupported SSH Docker endpoint'
    }
    $sshTarget = if ($dockerUri.UserInfo) { "$($dockerUri.UserInfo)@$($dockerUri.Host)" } else { $dockerUri.Host }
    if ($dockerUri.Port -gt 0) { $sshPort = "$($dockerUri.Port)" }
  }
  'npipe' { }
  'unix' { }
  default { throw 'WLT_FINANCE_PROOF=BLOCKED Docker endpoint requires a loopback-safe transport' }
}
$name = 'bthwani-wlt-proof-isolated'
$port = 15439
$dbName = 'bthwani_wlt_finance_proof'
$dshDbName = 'bthwani_dsh_finance_proof'
$dbUser = 'finance_proof'
$passwordBytes = New-Object byte[] 20
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$password = ([BitConverter]::ToString($passwordBytes)).Replace('-', '')
$databaseUrl = "postgres://$($dbUser):$($password)@127.0.0.1:$($port)/$($dbName)?sslmode=disable&connect_timeout=5"
$existing = docker container ls --all --filter "name=^/$name$" --format "{{.Names}}"
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify isolated finance container ownership' }
if($existing){throw 'Isolated finance test container already exists; refusing to replace it'}
# The PostGIS image declares a data VOLUME. Bind it to tmpfs in isolated proofs
# so docker run --rm cannot leave anonymous PostgreSQL volumes behind.
docker run -d --rm --name $name --tmpfs '/var/lib/postgresql:rw,size=512m' -p "127.0.0.1:$($port):5432" -e "POSTGRES_DB=$dbName" -e "POSTGRES_USER=$dbUser" -e "POSTGRES_PASSWORD=$password" 'postgis/postgis:18-3.6@sha256:e84455a058f60f06dd8c40e66a2c628b8fc113d9fca0896e1f308b25b897207f' | Out-Null
if ($LASTEXITCODE -ne 0) {throw 'Could not create isolated PostgreSQL container'}
$tunnel = $null
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
  if ($sshTarget) {
    $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
    if (-not (Test-Path -LiteralPath $ssh)) { throw 'Windows OpenSSH client is unavailable' }
    $sshArgs = @('-N', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
      '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=8')
    if ($sshPort) { $sshArgs += @('-p', $sshPort) }
    $sshArgs += @('-L', "127.0.0.1:$($port):127.0.0.1:$($port)", $sshTarget)
    $tunnel = Start-Process -FilePath $ssh -ArgumentList $sshArgs -PassThru -WindowStyle Hidden
    $forwardReady = $false
    for ($i = 0; $i -lt 40; $i++) {
      if ($tunnel.HasExited) { throw 'SSH finance loopback tunnel exited before becoming ready' }
      $socket = [Net.Sockets.TcpClient]::new()
      try {
        $connection = $socket.BeginConnect('127.0.0.1', $port, $null, $null)
        if ($connection.AsyncWaitHandle.WaitOne(200) -and $socket.Connected) {
          $socket.EndConnect($connection)
          $forwardReady = $true
          break
        }
      } catch { }
      finally { $socket.Dispose() }
      Start-Sleep -Milliseconds 200
    }
    if (-not $forwardReady) { throw 'SSH finance loopback tunnel did not become ready' }
    Write-Output 'FINANCE_PROOF_TRANSPORT=SSH_LOOPBACK'
  }
  Write-Output 'FINANCE_PROOF_DATABASE=ISOLATED_READY'
  $env:WLT_TEST_DATABASE_URL = $databaseUrl
  $env:BTHWANI_EXPECTED_DATABASE_HOST = '127.0.0.1'
  $env:BTHWANI_EXPECTED_DATABASE_PORT = "$port"
  $env:BTHWANI_EXPECTED_DATABASE_NAME = $dbName
  $env:BTHWANI_EXPECTED_DATABASE_USER = $dbUser
  if ($WltTestPattern) {
    # A -run expression can select multiple PostgreSQL migration-heavy tests. The timeout
    # belongs to the entire Go process, not each selected test.
    & go test ./services/wlt/backend/internal/storage/postgres -run $WltTestPattern -v -count=1 -timeout 12m 2>&1 | Tee-Object -Variable wltProofOutput
    if ($LASTEXITCODE -ne 0) {throw 'WLT finance integration tests failed'}
    Assert-ProofRan 'WLT finance' $wltProofOutput
    Write-Output 'WLT_FINANCE_ISOLATED_TESTS=PASS'
  } else {
    Write-Output 'WLT_FINANCE_ISOLATED_TESTS=NOT_RUN'
  }
  if ($WltHttpTestPattern) {
    & go test ./services/wlt/backend/internal/transport/http -run $WltHttpTestPattern -v -count=1 -timeout 180s 2>&1 | Tee-Object -Variable wltHttpProofOutput
    if ($LASTEXITCODE -ne 0) {throw 'WLT isolated HTTP finance tests failed'}
    Assert-ProofRan 'WLT HTTP' $wltHttpProofOutput
    Write-Output 'WLT_FINANCE_ISOLATED_HTTP_TESTS=PASS'
  }
  if ($DshTestPattern) {
    $env:DSH_DATABASE_URL = $databaseUrl
    $env:BTHWANI_FINANCIAL_PROOF_ISOLATED = '1'
    $env:BTHWANI_ENV = 'test'
    # Joining proof uses an independent, strict isolation guard; the same
    # disposable PostgreSQL root is safe when its exact identity is verified.
    $env:DSH_JOINING_QA_DATABASE_URL = $databaseUrl
    $env:BTHWANI_JOINING_QA_ISOLATED = '1'
    # Joining, dispatch and checkout each migrate a fresh test schema: one
    # 240s process-wide deadline wrongly aborted the third passing proof.
    & go test ./services/dsh/backend/internal/storage/postgres -run $DshTestPattern -v -count=1 -timeout 12m 2>&1 | Tee-Object -Variable dshProofOutput
    if ($LASTEXITCODE -ne 0) {throw 'DSH isolated checkout integration tests failed'}
    Assert-ProofRan 'DSH integration' $dshProofOutput
    Write-Output 'DSH_CHECKOUT_ISOLATED_TESTS=PASS'
  }
  if ($CrossServiceTestPattern) {
    # Both PostgreSQL databases are created in THIS disposable container.
    # WLT and DSH retain distinct migration histories and domain schemas.
    docker exec $name psql -h 127.0.0.1 -U $dbUser -d $dbName -v ON_ERROR_STOP=1 -c "CREATE DATABASE $dshDbName" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot create isolated DSH financial handoff database' }
    $env:DSH_FINANCIAL_HANDOFF_TEST_DATABASE_URL = "postgres://$($dbUser):$($password)@127.0.0.1:$($port)/$($dshDbName)?sslmode=disable&connect_timeout=5"
    $env:BTHWANI_FINANCIAL_PROOF_ISOLATED = '1'
    $env:BTHWANI_ENV = 'test'
    & go test ./services/wlt/backend/cmd/api -run $CrossServiceTestPattern -v -count=1 -timeout 12m 2>&1 | Tee-Object -Variable crossServiceProofOutput
    if ($LASTEXITCODE -ne 0) { throw 'DSH to real WLT financial handoff integration test failed' }
    Assert-ProofRan 'DSH and WLT financial handoff' $crossServiceProofOutput
    Write-Output 'DSH_WLT_HANDOFF_ISOLATED_TESTS=PASS'
  }
} catch {
  Write-Output "WLT_PROOF_ERROR=$($_.Exception.Message)"
  docker logs --tail 25 $name 2>$null
  throw
} finally {
  try {
    # Release the disposable database even if stopping SSH fails.
    docker rm -f $name 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Isolated finance database removal failed' }
    Write-Output 'FINANCE_PROOF_DATABASE=STOPPED_REMOVED'
  } finally {
    if ($null -ne $tunnel) {
      try {
        if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue }
      } finally {
        $tunnel.Dispose()
      }
      Write-Output 'FINANCE_PROOF_TRANSPORT=STOPPED'
    }
  }
}
