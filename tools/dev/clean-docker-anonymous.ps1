# Remove only detached Docker-generated anonymous volumes. Named databases and media are never touched.
# Usage: pwsh -File tools/dev/clean-docker-anonymous.ps1 [-Apply]
[CmdletBinding()]
param([switch] $Apply)
$ErrorActionPreference = 'Stop'
$existing = @(docker volume ls --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw 'Docker is unavailable' }
$detached = @(docker volume ls --filter dangling=true --format '{{.Name}}')
if ($LASTEXITCODE -ne 0) { throw 'Failed to inspect Docker volumes' }
$targets = @($detached | Where-Object { $_ -cmatch '^[0-9a-f]{64}$' })
Write-Output "DOCKER_VOLUMES_TOTAL=$($existing.Count)"
Write-Output "DETACHED_ANONYMOUS_VOLUMES=$($targets.Count)"
if (-not $Apply) {
  Write-Output 'DRY_RUN=TRUE (pass -Apply to remove these anonymous volumes)'
  return
}
$removed = 0
foreach ($name in $targets) {
  # Verify again before each deletion; never force removal of an in-use volume.
  $stillDetached = @(docker volume ls --filter dangling=true --format '{{.Name}}')
  if ($LASTEXITCODE -ne 0 -or $name -notin $stillDetached) { continue }
  docker volume rm $name *> $null
  if ($LASTEXITCODE -eq 0) { $removed++ }
}
Write-Output "REMOVED_ANONYMOUS_VOLUMES=$removed"
Write-Output "DOCKER_VOLUMES_AFTER=$(@(docker volume ls --format '{{.Name}}').Count)"
