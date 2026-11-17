# BThwani Surface-to-Lenovo development operations

One canonical source: Surface D:\samrim; Lenovo BTHWANI-DOCKER runs the apps.
Surface DHCP 192.168.0.100; Lenovo DHCP 192.168.0.101; SSH target alias bthwani-docker with strict host-key checks.

## Single existing owners
- SSH tunnels: four existing Scheduled Tasks invoke tools/dev/Start-AppTunnel.ps1; Surface 18101->Lenovo28111, 18102->28112, 18103->28113, 13000->23010.
- Source sync: the existing Scheduled Task BThwani Lenovo Source Sync directly runs pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch. Its direct process ownership ensures stopping the task also stops its Node watcher, without orphan duplicates. Start-LenovoSourceSync.ps1 is the manual validation/one-shot helper.
- Lenovo app tasks are intended to invoke infra/Start-RefoundationApp.ps1, which is a runtime launcher rather than a transport script. Their live task actions could not be confirmed during the latest SSH inspection.
- The configured target mirror in the Surface sync script is C:\Users\bthwa\BThwaniAppRunner\source-runtime. Its active use by Lenovo app tasks remains UNVERIFIED: the SSH task-inspection attempt returned exit 255 on 2026-11-17. Verify Lenovo task actions, source revision, and running process paths before claiming runtime cutover or retiring an older launcher. Do not create a second app source or delete rollback data without consumer verification.

## Guarantees and limits
- Mirroring is strictly Surface-to-Lenovo for approved tracked and untracked *source* paths only. .git, node_modules, .env*, credentials, secrets, DB and cache directories are excluded.
- SSH source/remote identities and SHA-256 file hashes are checked; files are staged before atomic replacement; deletions apply only to previously managed matching remote files.
- pnpm-lock.yaml and .node-version changes block sync until deliberate offline dependency preparation and restart. Branch switch also blocks until reconciliation.
- Manifest and bounded diagnostic log live outside the repo under %LOCALAPPDATA%\BThwani\Operations\SourceSync. Git commits and pushes are separate operations.
- A successful file mirror does not prove that running app processes are using it; validate source version, HTTP/UI and ADB after runtime cutover.

## Commands
- Validate launcher: powershell.exe -NoProfile -File D:\samrim\tools\dev\Start-LenovoSourceSync.ps1 -ValidateOnly
- One pass: powershell.exe -NoProfile -File D:\samrim\tools\dev\Start-LenovoSourceSync.ps1 -Once
- Normal automatic mode: the existing Surface Scheduled Task invokes pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch directly; do not start duplicate watch processes.
- Test policy: node --test D:\samrim\tools\dev\sync-lenovo-source.test.mjs

## Cleanup rule
Keep currently used app tasks, tunnel tasks, active SSH sessions and guarded rollback data. Disabled tasks pointing to deleted scripts may be exported and retired only after proving no user or service depends on them; no blanket deletion of backups, mirror directories, Android packages or private keys.
