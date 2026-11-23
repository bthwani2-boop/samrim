#requires -Version 7.0
# Build-only WLT runtime image; never bootstraps a database or restarts services.
[CmdletBinding()]
param(
  [string]$DockerContext = 'bthwani-docker',
  [string]$Image = 'bthwani-refoundation-wlt:dev'
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$dockerfile = Join-Path $root 'services/wlt/backend/Dockerfile'
$pin = (Get-Content (Join-Path $root '.go-version') -Raw).Trim()
if ((Get-Content $dockerfile -Raw) -notmatch ('(?m)^FROM golang:' + [regex]::Escape($pin) + '-alpine@sha256:[0-9a-f]{64} AS build$')) {
  throw 'WLT image must use the pinned Go toolchain and immutable builder digest'
}
if ($DockerContext -notmatch '^[A-Za-z0-9._-]+$' -or $Image -notmatch '^bthwani-refoundation-wlt:[a-z0-9._-]+$') {
  throw 'Invalid isolated Docker context or image name'
}
$sha = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw 'Cannot identify source SHA' }
$dirty = @(& git -C $root status --porcelain -- services/wlt)
if ($LASTEXITCODE -ne 0 -or $dirty.Count -gt 0) { throw 'WLT source must be committed before image provenance is asserted' }
& docker --context $DockerContext build --pull=false -f $dockerfile --build-arg "SAMRIM_SOURCE_REVISION=$sha" --label "com.bthwani.source-sha=$sha" -t $Image (Join-Path $root 'services/wlt')
if ($LASTEXITCODE -ne 0) { throw 'WLT image build failed' }
$endSha = (& git -C $root rev-parse HEAD).Trim()
if ($endSha -ne $sha -or @(& git -C $root status --porcelain -- services/wlt).Count -gt 0) {
  throw 'WLT source changed during image build'
}
$revision = (& docker --context $DockerContext image inspect $Image --format '{{index .Config.Labels "org.opencontainers.image.revision"}}').Trim()
if ($revision -ne $sha) { throw 'WLT image provenance is not the committed source' }
Write-Output "WLT_IMAGE_BUILT source=$sha"
