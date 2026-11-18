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
- Dependency pin changes require an exact Lenovo runtime install with the pinned Node/pnpm versions; file mirroring alone does not install node_modules. A mismatch in mirrored pnpm-lock.yaml or .node-version blocks reconciliation. After a reviewed local dependency install, the existing watch task continues; changing branches stops the watcher until the new source is reconciled.
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
