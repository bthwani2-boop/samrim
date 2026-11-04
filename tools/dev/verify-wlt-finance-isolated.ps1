$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $repositoryRoot
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
    if (-not $dockerUri.Host -or $dockerUri.UserInfo.Contains(':') -or $dockerUri.AbsolutePath -ne '/') {
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
  & go test ./services/wlt/backend/internal/storage/postgres -run 'TestPartnerStoreFinanceAndRecipientSettlementLifecycle|TestCashIn|TestStoreCommercialAgreementLifecycleAndOrderSnapshots' -v -count=1 -timeout 240s
  if ($LASTEXITCODE -ne 0) {throw 'WLT finance integration tests failed'}
  Write-Output 'WLT_FINANCE_ISOLATED_TESTS=PASS'
} catch {
  Write-Output "WLT_PROOF_ERROR=$($_.Exception.Message)"
  docker logs --tail 25 $name 2>$null
  throw
} finally {
  if ($null -ne $tunnel) {
    if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    $tunnel.Dispose()
    Write-Output 'FINANCE_PROOF_TRANSPORT=STOPPED'
  }
  docker rm -f $name 2>$null | Out-Null
  Write-Output 'FINANCE_PROOF_DATABASE=STOPPED_REMOVED'
}
