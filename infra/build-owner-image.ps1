#requires -Version 5.1
# Build only: no SQL execution, container restarts or volume changes.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('dsh','identity','wlt')][string]$Owner,
  [string]$DockerContext = 'bthwani-docker',
  [string]$Image
)
$ErrorActionPreference = 'Stop'
$Owner = $Owner.ToLowerInvariant()
$namespace = @{
  dsh = 'bthwani-refoundation-dsh'
  identity = 'bthwani-refoundation-identity-verifier'
  wlt = 'bthwani-refoundation-wlt'
}[$Owner]
if (!$Image) { $Image = $namespace + ':dev' }
if ($DockerContext -notmatch '^[A-Za-z0-9._-]+$' -or
    $Image -cnotmatch ('^' + [regex]::Escape($namespace) + ':[a-z0-9._-]+$')) {
  throw 'Invalid isolated Docker context or owner image name.'
}
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$service = Join-Path $root ('services/' + $Owner)
$dockerfile = Join-Path $service 'backend/Dockerfile'
$pin = (Get-Content -LiteralPath (Join-Path $root '.go-version') -Raw).Trim()
if ((Get-Content -LiteralPath $dockerfile -Raw) -notmatch ('(?m)^FROM golang:' + [regex]::Escape($pin) + '-alpine@sha256:[0-9a-f]{64} AS build\r?$')) {
  throw 'Owner Dockerfile must pin the approved Go version and immutable builder digest.'
}
function Read-Revision {
  $value = @(& git -C $root rev-parse HEAD)
  if ($LASTEXITCODE -ne 0 -or $value.Count -ne 1 -or $value[0] -cnotmatch '^[0-9a-f]{40}$') { throw 'Cannot identify source revision.' }
  return $value[0]
}
function Assert-CleanOwner {
  $changes = @(& git -C $root status --porcelain --untracked-files=all -- ('services/' + $Owner) '.go-version' 'infra/build-owner-image.ps1')
  if ($LASTEXITCODE -ne 0 -or $changes.Count -gt 0) { throw 'Owner or shared build input is not committed: refusing misleading image provenance.' }
}
$sha = Read-Revision
Assert-CleanOwner
& docker --context $DockerContext build --pull=false --file $dockerfile --build-arg "SAMRIM_SOURCE_REVISION=$sha" --label "com.bthwani.source-sha=$sha" --tag $Image $service
if ($LASTEXITCODE -ne 0) { throw "$Owner Docker build failed." }
if ((Read-Revision) -cne $sha) { throw 'Source changed during image build; image must not be promoted.' }
Assert-CleanOwner
$raw = @(& docker --context $DockerContext image inspect $Image --format '{{json .Config.Labels}}')
if ($LASTEXITCODE -ne 0 -or $raw.Count -ne 1) { throw 'Image label readback failed.' }
$labels = $raw[0] | ConvertFrom-Json
if ($labels.'org.opencontainers.image.revision' -cne $sha -or $labels.'com.bthwani.source-sha' -cne $sha) {
  throw 'Image provenance is not the committed source.'
}
$imageId = @(& docker --context $DockerContext image inspect $Image --format '{{.Id}}')
if ($LASTEXITCODE -ne 0 -or $imageId.Count -ne 1 -or $imageId[0] -cnotmatch '^sha256:[0-9a-f]{64}$') { throw 'Image ID readback failed.' }
Write-Output ($Owner.ToUpperInvariant() + "_IMAGE_BUILT source=$sha image=" + $imageId[0])
