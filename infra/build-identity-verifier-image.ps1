#requires -Version 5.1
# Package the NEW refoundation Identity verifier, never a donor runtime.
# Source SHA is only valid when all Identity Go/SQL owner files are committed.
[CmdletBinding()]
param(
  [string]$DockerContext = 'bthwani-docker',
  [string]$Image = 'bthwani-refoundation-identity-verifier:dev'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'services\identity\backend'
$migrations = Join-Path $root 'services\identity\database\migrations'
$expectedGo = (Get-Content (Join-Path $root '.go-version') -Raw).Trim()
$actualGo = (& go version)
if ($LASTEXITCODE -ne 0 -or $actualGo -notmatch ('\bgo' + [regex]::Escape($expectedGo) + '\b')) {
  throw "Pinned Go $expectedGo required. Found: $actualGo"
}
$sourceSha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceSha -notmatch '^[0-9a-f]{40}$') {
  throw 'Cannot identify source commit.'
}
$ownerChanges = @(& git -C $root status --porcelain -- services/identity/backend services/identity/database)
if ($LASTEXITCODE -ne 0 -or $ownerChanges.Count -gt 0) {
  throw 'Identity Go/SQL source is uncommitted; refusing incorrect image provenance.'
}
if ($Image -notmatch '^bthwani-refoundation-identity-verifier:[a-z0-9._-]+$') {
  throw 'Image tag must remain in the isolated refoundation namespace.'
}
if (!(Test-Path -LiteralPath (Join-Path $migrations '001_session_verification.sql'))) {
  throw 'Canonical Identity synthetic migration source is missing.'
}
$buildDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bthwani-identity-verifier-' + [guid]::NewGuid().ToString('N'))
$priorGoos = $env:GOOS
$priorGoarch = $env:GOARCH
$priorCgo = $env:CGO_ENABLED
$priorToolchain = $env:GOTOOLCHAIN
try {
  $sqlDir = Join-Path $buildDir 'database\migrations'
  New-Item -ItemType Directory -Path $sqlDir -Force | Out-Null
  Copy-Item -Path (Join-Path $migrations '*.sql') -Destination $sqlDir
  $env:GOOS = 'linux'
  $env:GOARCH = 'amd64'
  $env:CGO_ENABLED = '0'
  $env:GOTOOLCHAIN = 'local'
  Push-Location $backend
  try {
    & go build -trimpath -ldflags='-s -w' -o (Join-Path $buildDir 'identity') ./cmd/identity
    if ($LASTEXITCODE -ne 0) { throw 'Identity Go build failed.' }
  } finally {
    Pop-Location
  }
  # Another session may commit or edit the Identity owner while Go compiles.
  # Never publish an image labelled with a different revision than its sources.
  $nowSha = (& git -C $root rev-parse HEAD).Trim()
  $nowDirty = @(& git -C $root status --porcelain -- services/identity/backend services/identity/database)
  if ($LASTEXITCODE -ne 0 -or $nowSha -ne $sourceSha -or $nowDirty.Count -gt 0) {
    throw 'Identity source revision changed during build; image not published.'
  }
  & docker --context $DockerContext build --pull=false --file (Join-Path $PSScriptRoot 'docker\identity-verifier.Dockerfile') --label "com.bthwani.source-sha=$sourceSha" --tag $Image $buildDir
  if ($LASTEXITCODE -ne 0) { throw 'Identity Docker image build failed.' }
  $imageDigest = (& docker --context $DockerContext image inspect $Image --format '{{.Id}}').Trim()
  if ($LASTEXITCODE -ne 0 -or !$imageDigest) { throw 'Identity image readback failed.' }
  Write-Output "IDENTITY_VERIFIER_IMAGE_BUILT source=$sourceSha image=$imageDigest"
} finally {
  $env:GOOS = $priorGoos
  $env:GOARCH = $priorGoarch
  $env:CGO_ENABLED = $priorCgo
  $env:GOTOOLCHAIN = $priorToolchain
  if (Test-Path -LiteralPath $buildDir) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
  }
}
