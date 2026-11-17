#requires -Version 5.1
# Build the actual IDENTITY owner using its pinned multi-stage Dockerfile.
# Build-only: no migrations, database mutations or service restarts.
[CmdletBinding()]
param(
  [string]$DockerContext = 'bthwani-docker',
  [string]$Image = 'bthwani-refoundation-identity-verifier:dev'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$service = Join-Path $root 'services\identity'
$dockerfile = Join-Path $service 'backend\Dockerfile'
$expectedGo = (Get-Content (Join-Path $root '.go-version') -Raw).Trim()
if ((Get-Content -LiteralPath $dockerfile -Raw) -notmatch ('(?m)^FROM golang:' + [regex]::Escape($expectedGo) + '-alpine@sha256:[0-9a-f]{64} AS build$')) {
  throw 'Service Dockerfile must pin the approved Go version and immutable builder digest.'
}
if ($Image -notmatch '^bthwani-refoundation-identity-verifier:[a-z0-9._-]+$') {
  throw 'Image tag must remain in the isolated refoundation namespace.'
}
$sourceSha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sourceSha -notmatch '^[0-9a-f]{40}$') {
  throw 'Cannot identify source revision.'
}
$ownerChanges = @(& git -C $root status --porcelain -- services/identity)
if ($LASTEXITCODE -ne 0 -or $ownerChanges.Count -gt 0) {
  throw 'Owner source is not committed: refusing misleading image provenance.'
}
& docker --context $DockerContext build --pull=false --file $dockerfile --build-arg "SAMRIM_SOURCE_REVISION=$sourceSha" --label "com.bthwani.source-sha=$sourceSha" --tag $Image $service
if ($LASTEXITCODE -ne 0) { throw 'IDENTITY Docker build failed.' }
$endSha = (& git -C $root rev-parse HEAD).Trim()
$endDirty = @(& git -C $root status --porcelain -- services/identity)
if ($LASTEXITCODE -ne 0 -or $endSha -ne $sourceSha -or $endDirty.Count -gt 0) {
  throw 'IDENTITY source changed during build; image must not be promoted.'
}
$imageSha = (& docker --context $DockerContext image inspect $Image --format '{{.Id}}').Trim()
if ($LASTEXITCODE -ne 0 -or !$imageSha) { throw 'Image readback failed.' }
Write-Output ("IDENTITY_IMAGE_BUILT source=$sourceSha image=$imageSha")
