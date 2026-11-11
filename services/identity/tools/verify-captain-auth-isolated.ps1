# Run the canonical two-Captain password/session proof against a disposable
# PostgreSQL instance. Never connect this proof to retained Identity state.
$ErrorActionPreference = 'Stop'
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if ((Get-Location).Path -ine $repositoryRoot) {
  throw 'Run the Captain authentication proof from the repository root'
}
if ($env:DOCKER_HOST -or $env:IDENTITY_DATABASE_URL -or $env:BTHWANI_CAPTAIN_AUTH_PROOF_ISOLATED) {
  throw 'Refusing a preconfigured Docker or Identity test database override'
}
$name = 'bthwani-captain-identity-proof-isolated'
$port = 15441
$existing = @(docker ps -a --filter 'name=^/bthwani-captain-identity-proof-isolated$' --format '{{.Names}}')
if ($LASTEXITCODE -ne 0 -or $existing.Count -gt 0) {
  throw 'Cannot prove the disposable Captain Identity container name is free'
}
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) {
  throw 'Captain Identity proof loopback port already in use'
}
if ((docker info --format '{{.OSType}}') -ne 'linux') {
  throw 'Docker Linux engine is required for isolated Identity testing'
}
$contextName = (docker context show).Trim()
$endpoint = (docker context inspect $contextName --format '{{.Endpoints.docker.Host}}').Trim()
$dockerUri = [Uri]$endpoint
if ($dockerUri.Scheme -ne 'ssh' -or -not $dockerUri.Host -or $dockerUri.UserInfo.Contains(':')) {
  throw 'The configured Docker endpoint must be a known SSH context'
}
$sshTarget = if ($dockerUri.UserInfo) {
  "$($dockerUri.UserInfo)@$($dockerUri.Host)"
} else {
  $dockerUri.Host
}
$passwordBytes = New-Object byte[] 24
$random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $random.GetBytes($passwordBytes) } finally { $random.Dispose() }
$password = ([BitConverter]::ToString($passwordBytes)).Replace('-', '')
$tunnel = $null
$started = $false
$passed = $false
try {
  docker run -d --rm --name bthwani-captain-identity-proof-isolated --tmpfs '/var/lib/postgresql:rw,size=512m' -p '127.0.0.1:15441:5432' -e 'POSTGRES_DB=bthwani_captain_identity_proof' -e 'POSTGRES_USER=captain_proof' -e ("POSTGRES_PASSWORD=" + $password) 'postgis/postgis:18-3.6@sha256:e84455a058f60f06dd8c40e66a2c628b8fc113d9fca0896e1f308b25b897207f' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start disposable PostgreSQL' }
  $started = $true
  $ready = $false
  for ($i=0; $i -lt 60; $i++) {
    docker exec bthwani-captain-identity-proof-isolated pg_isready -q -U captain_proof -d bthwani_captain_identity_proof 2>$null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Milliseconds 900
  }
  if (-not $ready) { throw 'Disposable PostgreSQL never became ready' }
  Start-Sleep -Seconds 3
  $ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
  $tunnel = Start-Process -FilePath $ssh -ArgumentList @('-N','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ConnectTimeout=8','-L','127.0.0.1:15441:127.0.0.1:15441',$sshTarget) -PassThru -WindowStyle Hidden
  $connected = $false
  for ($i=0; $i -lt 40; $i++) {
    if ($tunnel.HasExited) { throw 'Own loopback SSH forward exited' }
    $socket = [Net.Sockets.TcpClient]::new()
    try {
      $connection = $socket.BeginConnect('127.0.0.1',15441,$null,$null)
      if ($connection.AsyncWaitHandle.WaitOne(250) -and $socket.Connected) {
        $socket.EndConnect($connection)
        $connected = $true
        break
      }
    } catch {} finally { $socket.Dispose() }
    Start-Sleep -Milliseconds 200
  }
  if (-not $connected) { throw 'Own loopback SSH forward is unavailable' }
  Write-Output 'CAPTAIN_IDENTITY_PROOF_DATABASE=ISOLATED_READY'
  $env:IDENTITY_DATABASE_URL = "postgres://captain_proof:$($password)@127.0.0.1:15441/bthwani_captain_identity_proof?sslmode=disable&connect_timeout=5"
  $env:BTHWANI_CAPTAIN_AUTH_PROOF_ISOLATED = '1'
  $result = @(& go test ./services/identity/backend/internal/authentication -run '^TestCaptainTwoActorsLoginRefreshAndReauthentication$' -v -count=1 -timeout 4m 2>&1)
  $testExit = $LASTEXITCODE
  $result | ForEach-Object { Write-Output $_ }
  if ($testExit -ne 0) { throw "Canonical Captain Identity Go test failed ($testExit)" }
  if (@($result | Where-Object { "$_" -match '^--- PASS: TestCaptainTwoActorsLoginRefreshAndReauthentication' }).Count -ne 1) {
    throw 'Captain Identity test was skipped or returned no PASS marker'
  }
  Write-Output 'CAPTAIN_IDENTITY_TWO_ACTOR_REAL_LOGIN=PASS'
  $passed = $true
} catch {
  Write-Output ('CAPTAIN_IDENTITY_PROOF_ERROR=' + $_.Exception.Message)
} finally {
  Remove-Item Env:\IDENTITY_DATABASE_URL,Env:\BTHWANI_CAPTAIN_AUTH_PROOF_ISOLATED -ErrorAction SilentlyContinue
  if ($started) {
    docker rm -f bthwani-captain-identity-proof-isolated 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
      Write-Output 'CAPTAIN_IDENTITY_DATABASE_CLEANUP=FAIL'
      $passed = $false
    } else {
      Write-Output 'CAPTAIN_IDENTITY_DATABASE_CLEANUP=PASS'
    }
  }
  if ($null -ne $tunnel) {
    try {
      if (-not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force -ErrorAction Stop }
    } catch {
      Write-Output 'CAPTAIN_IDENTITY_TUNNEL_CLEANUP=FAIL'
      $passed = $false
    } finally { $tunnel.Dispose() }
  }
  $remaining = @(docker ps -a --filter 'name=^/bthwani-captain-identity-proof-isolated$' --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0 -or $remaining.Count -ne 0) {
    Write-Output 'CAPTAIN_IDENTITY_DATABASE_RESIDUE=FAIL'
    $passed = $false
  } else {
    Write-Output 'CAPTAIN_IDENTITY_DATABASE_RESIDUE=NONE'
  }
}
if (-not $passed) { exit 1 }
