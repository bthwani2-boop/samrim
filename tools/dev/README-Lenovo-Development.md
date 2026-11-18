# BThwani Surface-to-Lenovo development operations

One canonical source: Surface D:\samrim; Lenovo BTHWANI-DOCKER runs the apps.
Surface DHCP 192.168.0.100; Lenovo DHCP 192.168.0.101; SSH target alias bthwani-docker with strict host-key checks.

## Single existing owners
- SSH tunnels: four Scheduled Tasks invoke `tools/dev/Start-AppTunnel.ps1`. Customer uses Surface 18101 → Lenovo 28111 and Merchant uses 18102 → 28112. Optional local overrides use `SAMRIM_APP_CUSTOMER_METRO_PORT` and `SAMRIM_APP_MERCHANT_METRO_PORT`. Captain uses 18103 → 28113 and Control Panel uses 13000 → 23010.
- Source sync: the existing Scheduled Task BThwani Lenovo Source Sync directly runs pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch. Its direct process ownership ensures stopping the task also stops its Node watcher, without orphan duplicates. Start-LenovoSourceSync.ps1 is the manual validation/one-shot helper.
- The Surface sync target is `C:\Users\bthwa\BThwaniAppRunner\source-runtime`. The Lenovo app tasks invoke `infra\Start-RefoundationApp.ps1` in that mirror with `-App customer`, `-App merchant`, `-App captain`, or `-App control-panel`. Verify the task action, synced source revision, and listener owner when diagnosing a runtime issue.

## Guarantees and limits
- Mirroring is strictly Surface-to-Lenovo for approved tracked and untracked source paths. Service workspaces include the package manifests, TypeScript configs, and clients consumed by the apps. Service backend, migrations, .git, node_modules, .env*, credentials, secrets, DB and cache directories are excluded.
- Strict SSH host verification and SHA-256 validation remain enabled. Source bytes are copied by SCP to unique staging files and atomically published after checking the expected remote version. Unexpected mirror edits are archived with verified hashes before restoring the Surface copy; deletions affect only previously managed paths.
- File mirroring never reads, copies, repairs or deletes `node_modules` and never runs `pnpm install`. Source changes, including `pnpm-lock.yaml` and package manifests, sync one way even when Lenovo dependencies are missing or an install fails. Changed dependency files produce `DEPENDENCY_INSTALL_REQUIRED` in the existing sync log; this is an independent install status, not a source-sync failure.
- Lenovo installs the exact pinned dependencies **only when they change or the local install needs repair**, in one exclusive install operation with rollback available. Do not overlap installs or delete a working `node_modules` after failure. A source change not requiring new dependencies should appear through the already running Metro/Next.js dev servers without restarting tasks. New/changed dependencies may need a successful install before the new feature runs; source mirroring alone does not promise that runtime effect. Branch changes retain the existing archive-branch refusal, and never implicitly run installs or change Git refs.
- Manifest and bounded diagnostic log live outside the repo under %LOCALAPPDATA%\BThwani\Operations\SourceSync. Git commits and pushes are separate operations.
- The existing watcher checks Surface changes each second and audits Lenovo hashes periodically. Small lists use one SSH command; larger audits use a temporary SCP-transferred manifest. No binary SSH stdin transport, parallel source writer, new daemon, or separate Docker engine is introduced.
- A successful file mirror does not prove that running app processes are using it; validate source version, real Web/Android UI and Metro Fast Refresh. Go containers are source-SHA-built images, not hot-reloaded filesystem mirrors; use the existing infra runtime provenance check before any owner-approved rebuild.

## Commands
- Validate launcher: powershell.exe -NoProfile -File D:\samrim\tools\dev\Start-LenovoSourceSync.ps1 -ValidateOnly
- One pass: powershell.exe -NoProfile -File D:\samrim\tools\dev\Start-LenovoSourceSync.ps1 -Once
- Normal automatic mode: the existing Surface Scheduled Task invokes pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch directly; do not start duplicate watch processes.
- Test policy: node --test D:\samrim\tools\dev\sync-lenovo-source.test.mjs

## Cleanup rule
Keep currently used app tasks, tunnel tasks, active SSH sessions and guarded rollback data. Disabled tasks pointing to deleted scripts may be exported and retired only after proving no user or service depends on them; no blanket deletion of backups, mirror directories, Android packages or private keys.

## Lenovo SSH CLI control (manual, not a new watcher)

Use `tools/dev/Control-Lenovo-SSH.ps1` from PowerShell on **Surface**. This is a manually invoked SSH/SCP helper; it does not replace the existing tunnel or source-sync task, expose the Docker daemon to TCP, or change Lenovo configuration by itself. SSH host alias defaults to `bthwani-docker`. The helper requires strict host-key checking and checks the remote host identity.

```powershell
Set-Location D:\samrim
# Check both hosts, SSH command availability, sync task, and local forward listeners:
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Check
# Execute a read-only PowerShell/Docker command on Lenovo:
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'docker ps'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'hostname'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'whoami'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'Get-Service'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'Get-Process'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'Get-ChildItem C:\Users\bthwa\BThwaniAppRunner'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'node --version'
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Run -Command 'Get-PSDrive -PSProvider FileSystem'
# Preview installation (does not install):
.\tools\dev\Control-Lenovo-SSH.ps1 -Action Install -PackageId Git.Git -WhatIf
# Installation only when explicitly authorized:
# .\tools\dev\Control-Lenovo-SSH.ps1 -Action Install -PackageId Git.Git
# Transfer an EXISTING local file into an EXISTING remote directory:
# .\tools\dev\Control-Lenovo-SSH.ps1 -Action Upload -LocalPath 'D:\samrim\artifact.zip' -RemotePath 'C:\Users\bthwa\BThwaniAppRunner\incoming'
# Transfer a folder; -Recursive is required:
# .\tools\dev\Control-Lenovo-SSH.ps1 -Action Upload -LocalPath 'D:\samrim\dist' -RemotePath 'C:\Users\bthwa\BThwaniAppRunner\incoming' -Recursive
# Download into an EXISTING local directory:
# .\tools\dev\Control-Lenovo-SSH.ps1 -Action Download -RemotePath 'C:\Users\bthwa\BThwaniAppRunner\logs\app.log' -LocalPath 'C:\Users\bassa\Downloads'
```

Available parameters: `-Action Check|Run|Upload|Download|Install`, `-Command`, `-LocalPath`, `-RemotePath`, `-PackageId`, `-Recursive`, `-SshHost`, `-WhatIf`. `Upload -WhatIf` still requires an existing source path, and `Download` requires an existing Surface destination directory. Single-file uploads verify SHA-256; recursive uploads and downloads do not verify each transferred file's checksum.

### Docker CLI directly from Surface (runs on Lenovo)

```powershell
ssh bthwani-docker docker version
ssh bthwani-docker docker info
ssh bthwani-docker docker ps
ssh bthwani-docker docker ps -a
ssh bthwani-docker docker stats --no-stream
ssh bthwani-docker docker system df
ssh bthwani-docker docker images
ssh bthwani-docker docker network ls
ssh bthwani-docker docker volume ls
ssh bthwani-docker docker inspect bthwani-refoundation-dsh-1
ssh bthwani-docker docker logs --tail 100 bthwani-refoundation-dsh-1
ssh bthwani-docker docker top bthwani-refoundation-dsh-1
ssh bthwani-docker docker events --since 1h --until 0s
ssh bthwani-docker docker compose version
ssh bthwani-docker docker compose ls
ssh bthwani-docker docker compose ls -a
ssh bthwani-docker docker --help
ssh bthwani-docker docker container --help
ssh bthwani-docker docker image --help
ssh bthwani-docker docker compose --help
Get-Command .\tools\dev\Control-Lenovo-SSH.ps1 -Syntax
```

**State-changing Docker commands (reference only, do not run on live services without authorization):**
`ssh bthwani-docker docker start NAME`,
`ssh bthwani-docker docker stop NAME`,
`ssh bthwani-docker docker restart NAME`,
`ssh bthwani-docker docker pause NAME`,
`ssh bthwani-docker docker unpause NAME`,
`ssh bthwani-docker docker rm NAME`,
`ssh bthwani-docker docker rmi IMAGE`.
`docker build`, `docker compose up` and `docker compose down` additionally require the correct remote project context. Never remove protected volumes or restart shared services as a diagnostic step.
