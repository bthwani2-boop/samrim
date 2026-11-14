#requires -Version 5.1
# Build the real DSH owner source using the repo-pinned Go toolchain.
# Keep all code, image tags and Docker contexts confined to refoundation.
[CmdletBinding()]
param(
  [string]$DockerContext = 'bthwani-docker',
  [string]$Image = 'bthwani-refoundation-dsh:dev'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$backend = Join-Path $root 'services\dsh\backend'
$migrations = Join-Path $root 'services\dsh\database\migrations'
$expectedGo = (Get-Content (Join-Path $root '.go-version') -Raw).Trim()
$actualGo = (& go version)
if ($LASTEXITCODE -ne 0 -or $actualGo -notmatch ('\bgo' + [regex]::Escape($expectedGo) + '\b')) {
  throw "Pinned Go $expectedGo required. Found: $actualGo"
}
$sourceSha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceSha -notmatch '^[0-9a-f]{40}$') {
  throw 'Cannot identify source revision.'
}
# Do not label a working tree build as a clean commit.
$uncommittedOwnerFiles = @(& git -C $root status --porcelain -- services/dsh/backend services/dsh/database)
if ($LASTEXITCODE -ne 0 -or $uncommittedOwnerFiles.Count -gt 0) {
  throw 'DSH source/migrations are uncommitted; image provenance would be inaccurate.'
}
if ($Image -notmatch '^bthwani-refoundation-dsh:[a-z0-9._-]+$') {
  throw 'Image tag must remain worktree-namespaced.'
}
if (!(Test-Path -LiteralPath (Join-Path $migrations '001_public_discovery.sql'))) {
  throw 'Reviewed DSH migration source missing.'
}
$buildDir = Join-Path ([System.IO.Path]::GetTempPath()) ('bthwani-dsh-build-' + [guid]::NewGuid().ToString('N'))
$originalGoos = $env:GOOS
$originalGoarch = $env:GOARCH
$originalCgo = $env:CGO_ENABLED
try {
  $sqlDir = Join-Path $buildDir 'database\migrations'
  New-Item -ItemType Directory -Path $sqlDir -Force | Out-Null
  Copy-Item -Path (Join-Path $migrations '*.sql') -Destination $sqlDir
  $env:GOOS = 'linux'
  $env:GOARCH = 'amd64'
  $env:CGO_ENABLED = '0'
  Push-Location $backend
  try {
    & go build -trimpath -ldflags='-s -w' -o (Join-Path $buildDir 'dsh') ./cmd/dsh
    if ($LASTEXITCODE -ne 0) { throw 'DSH Go build failed.' }
  } finally { Pop-Location }
  & docker --context $DockerContext build --pull=false --file (Join-Path $PSScriptRoot 'docker\dsh-public.Dockerfile') --label "com.bthwani.source-sha=$sourceSha" --tag $Image $buildDir
  if ($LASTEXITCODE -ne 0) { throw 'DSH Docker build failed.' }
  $imageSha = (& docker --context $DockerContext image inspect $Image --format '{{.Id}}').Trim()
  if ($LASTEXITCODE -ne 0 -or !$imageSha) { throw 'DSH image readback failed.' }
  Write-Output "DSH_IMAGE_BUILT source=$sourceSha image=$imageSha"
} finally {
  $env:GOOS = $originalGoos
  $env:GOARCH = $originalGoarch
  $env:CGO_ENABLED = $originalCgo
  if (Test-Path -LiteralPath $buildDir) {
    Remove-Item -LiteralPath $buildDir -Recurse -Force
  }
}
