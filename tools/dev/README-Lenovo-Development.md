# BThwani Surface-to-Lenovo development operations

One canonical source: Surface D:\samrim; Lenovo BTHWANI-DOCKER runs the apps.
Surface hostname BTHWANI; Lenovo hostname BTHWANI-DOCKER. The SSH target alias is bthwani-docker with strict host-key checks; resolve its current network address rather than treating historical DHCP assignments as permanent.

## Daily launch — one command

From Surface PowerShell in `D:\samrim` run **`pnpm dev`**. This is the fast default: it verifies the existing Lenovo SSH endpoint, reuses the existing Surface sync/tunnel and Lenovo app tasks, and opens the three Chrome tabs plus Customer/Merchant/Captain on a connected Samsung. It never launches a second watcher or another Expo/Next server, and does not recreate Docker containers or touch data.

- `pnpm dev apps open` — reopen the existing Chrome window and connected Android apps without touching their servers. Use `-Mode Browser` when Samsung is disconnected.
- `pnpm dev apps status` / `pnpm dev apps verify` — targeted diagnostics, not required at every launch. The source check compares the current allowed paths and file digests with the watcher's last published manifest. It detects saved edits at the same Git SHA. The watcher's periodic Lenovo hash audit checks for remote drift.
- `pnpm dev up` — explicit, slower isolated infrastructure startup when the development Docker containers need starting; it preserves protected Identity/WLT state.

When Lenovo is unreachable on TCP port 22, the fast command reports a specific `BLOCKED` error instead of running lengthy Docker checks. The preexisting Scheduled Tasks keep retrying their SSH tunnels. Check Lenovo power/network before repeating a failed start; never launch a duplicate watcher or tunnel.

## Operator login is a separate Identity acceptance gate

The canonical **WebAuthn/Passkey browser origin is `http://localhost:13000`**, not `127.0.0.1:13000`; the latter redirects to the canonical entry. The URL is forwarded over the existing Surface SSH tunnel to Lenovo's Next.js port `23010`. `localhost:23100` belongs to a **different, optional Surface-only preview** and is not evidence of a logged-in Lenovo Operator.

`pnpm dev` reports `OPERATOR_AUTH` separately from `LAUNCH`. A successful app launch or an HTTP 200 does not prove Operator identity, enrollment, a verified cookie, or any of the seven Identity-owned grants. A `503` session response means the isolated login BFF or its owner is unavailable; do not restart Identity or bypass the gate automatically.

For a genuinely usable **isolated** Operator login, independently verify that the existing Identity test schema is disposable, its required owner migrations are applied, its Passkey origin/RP ID and authentication opt-ins are correct, and the actual Lenovo Control task is launched with `-EnableIsolatedOperatorPasskeyPreview`. The one-time initial Root bootstrap is a **separate protected operation**, never inferred from UI readiness. A real user must enroll their own Passkey; only Identity-owned current session and permission readback permits the workspace. Never fabricate a Root, re-enroll another identity or expose a bootstrap ticket in logs. See `governance/identity.md` and `services/identity/README.md` for owner authorization and recovery requirements.

## Single existing owners
- SSH tunnels: four Scheduled Tasks invoke `tools/dev/Start-AppTunnel.ps1`. Customer uses Surface 18101 → Lenovo 28111 and Merchant uses 18102 → 28112. Optional local overrides use `SAMRIM_APP_CUSTOMER_METRO_PORT` and `SAMRIM_APP_MERCHANT_METRO_PORT`. Captain uses 18103 → 28113 and Control Panel uses 13000 → 23010. The existing Customer tunnel also carries loopback-only Identity 3201 and DSH 3202 for native synthetic authentication; those owner forwards require that the existing tunnel task actually reload the current script.
- Source sync: the existing Scheduled Task BThwani Lenovo Source Sync directly runs pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch. Its direct process ownership ensures stopping the task also stops its Node watcher, without orphan duplicates. The scheduled task directly owns the sole watch process; no manual wrapper or second watcher is necessary.
- The Surface sync target is `C:\Users\bthwa\BThwaniAppRunner\source-runtime`. The Lenovo app tasks invoke `infra\Start-RefoundationApp.ps1` in that mirror with `-App customer`, `-App merchant`, `-App captain`, or `-App control-panel`. Verify the task action, synced source revision, and listener owner when diagnosing a runtime issue.

## Guarantees and limits
- Mirroring is strictly Surface-to-Lenovo for approved tracked and untracked source paths. Service workspaces include the package manifests, TypeScript configs, and clients consumed by the apps. Service backend, migrations, .git, node_modules, .env*, credentials, secrets, DB and cache directories are excluded.
- Strict SSH host verification and SHA-256 validation remain enabled. Source bytes are copied by SCP to unique staging files and atomically published after checking the expected remote version. Unexpected mirror edits are archived with verified hashes before restoring the Surface copy; deletions affect only previously managed paths.
- File mirroring never reads, copies, repairs or deletes `node_modules` and never runs `pnpm install`. Source changes, including `pnpm-lock.yaml` and package manifests, sync one way even when Lenovo dependencies are missing or an install fails. Added, changed or removed mirrored dependency inputs (including workspace manifests, workspace configuration and patches) produce `DEPENDENCY_INSTALL_REQUIRED` in the existing sync log; this is an independent install status, not a source-sync failure. The existing watcher schedules pnpm dev apps reconcile -Apply -Automatic after verified sync using the same lifecycle child slot and mutex as Docker. It is a no-op when the installed graph and input receipt match; otherwise it drains verified app owners, retains previous installed trees, runs pinned frozen pnpm, verifies the result and restarts only previously running tasks. Known failed inputs are not retried automatically; an ambiguous receipt requires owner readback. Manual check/retry: pnpm dev apps reconcile [-Apply].
- Lenovo installs the exact pinned dependencies **only when they change or the local install needs repair**, in one exclusive install operation with rollback available. Do not overlap installs or delete a working `node_modules` after failure. A source change not requiring new dependencies should appear through the already running Metro/Next.js dev servers without restarting tasks. New/changed dependencies may need a successful install before the new feature runs; source mirroring alone does not promise that runtime effect. Branch changes retain the existing archive-branch refusal and never change Git refs; dependency input changes may schedule the same unified dependency reconcile after verified sync.
- Manifest and bounded diagnostic log live outside the repo under %LOCALAPPDATA%\BThwani\Operations\SourceSync. Git commits and pushes are separate operations.
- The existing watcher checks Surface changes each second and audits Lenovo hashes periodically. Small lists use one SSH command; larger audits use a temporary SCP-transferred manifest. No binary SSH stdin transport, parallel source writer, new daemon, or separate Docker engine is introduced.
- A successful file mirror does not prove that running app processes are using it; validate source version, real Web/Android UI and Metro Fast Refresh. Go containers are source-SHA-built images, not hot-reloaded filesystem mirrors; use the existing infra runtime provenance check before any owner-approved rebuild.

## Commands
- Validate the existing watcher code: `node --check tools/dev/sync-lenovo-source.mjs`.
- The running Scheduled Task already reconciles changes automatically; do not launch a second `--once`/`--watch` source writer.
- Normal automatic mode: the existing Surface Scheduled Task invokes pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch directly; do not start duplicate watch processes.
- Test policy: node --test D:\samrim\tools\dev\sync-lenovo-source.test.mjs

## Isolated owner runtime reconciliation

Use the existing unified lifecycle CLI, from Surface, not a second watcher:

- `pnpm dev docker reconcile` checks the running Compose configuration and owner source drift.
- `pnpm dev docker reconcile -Apply` runs fresh owner tests without live DB test credentials, builds through the existing pinned owner build scripts, verifies image labels, and replaces only changed running owners with `--no-deps --no-build --pull never`. Previous image tags and reconstructed Compose hashes must match before replacement; failed known replacements restore the previous configuration/images, and ambiguous writes stop. Never start SQL/migration roles or change volumes.
- `pnpm dev docker reconcile -Apply -EnableCaptain` explicitly admits the existing Captain overlay once, only in the isolated development environment, after checking the pre-provisioned read-only TLS volumes. This option is never used by the automatic watcher.

Automatic committed-owner reconciliation is opt-in for the canonical Surface watcher. After explicit owner authorization, set the existing SourceSync state directory's `runtime-reconcile.enabled` file to the exact text `isolated-committed-owner-images-v1` and reload the existing watcher task through its authorized owner; do not create another watcher. The watcher checks the owner/configuration source fingerprint on its normal cycle, runs the unified CLI asynchronously under its existing lifecycle mutex, and audits unchanged source at a bounded interval. Its attempt record is stored beside the existing sync manifest. An ambiguous or interrupted attempt blocks future automatic writes pending owner readback and reconciliation; a known rolled-back attempt is not repeated for the same source. The actual automatic reconciler publishes one atomic terminal receipt in SourceSync, keyed to a unique attempt, so a watcher interruption after a proven successful apply no longer strands the scheduler. The watcher remains the sole scheduling-state writer; a stale or unrelated receipt never releases a hold. For a genuinely unresolved or legacy attempt, inspect the previous operation and its durable effects, then use `pnpm dev docker reconcile -RecoverRuntimeAttempt <exact-reviewed-64-character-key>` only after explicit owner review. The existing lifecycle mutex protects the read-only owner/configuration and database-principal checks; the command refuses stale, unhealthy, dirty, or concurrently changing owners. It acknowledges the exact reviewed state as retry, not historical success; it never replaces a container or runs SQL writes. The existing watcher consumes the receipt and resumes its normal guarded cycle. Preflight failures are retried at most once per minute. The original opt-in allows only committed owner source. GitHub Push is not required for local committed image reconciliation. For the separately authorized uncommitted Go preview, use the exact opt-in value `isolated-owner-go-preview-v2` and reload the same existing watcher. The watcher detects changed Go bytes, not just commit IDs, and invokes the same unified CLI with `-Apply -Preview`.

The preview builds and tests an allowlisted, immutable owner snapshot (Go source and unchanged committed build/schema inputs); the image carries a worktree digest and separate base SHA, not a committed source label. Added and removed Go files are included, ignored secrets are excluded, and a changed snapshot before replacement is rejected. `pnpm dev docker reconcile` reports `PREVIEW_CURRENT` when the live preview matches. The strict committed provenance check intentionally rejects a preview until a clean committed image is restored. Uncommitted SQL, contracts, dependencies, Compose or tooling changes, new capabilities/containers and protected configuration changes remain blocked pending explicit review; frontend Fast Refresh remains independent. Do not treat image/health proof as full login or financial acceptance.

## Scoped app checks and recovery

From Surface run the existing central CLI (it uses the same Lenovo Scheduled Tasks, SSH and source-sync watcher):

    Set-Location D:\samrim
    pnpm dev apps help
    pnpm dev apps status
    pnpm dev apps verify
    pnpm dev apps android
    pnpm dev apps logs -App merchant
    pnpm dev apps start -App captain
    pnpm dev apps restart -App captain

The apps status command reports the existing Surface watcher state, last task result and committed mirror revision, the single Lenovo listener and its Node/launcher ancestry, application CLI, pinned Node and mirrored dependency-lock SHA. It separately compares the installed pnpm virtual-store lock against the workspace document of the mirrored pnpm lock (the separate package-manager document is not an installed workspace graph). Apps verify fails closed on a stopped/stale source mirror or mismatched installed graph; it also probes the customer/merchant/control Web endpoints and Captain Metro /status. Cold Expo compilation gets up to three bounded HTTP attempts with per-endpoint timing and failure reasons; persistent HTTP failures still fail the verification. The lightweight `pnpm dev status` probe uses one attempt and the same URL inventory. Web HTTP/Metro success does not close Fast Refresh, browser journeys or Android UI tests. `pnpm dev docker status` reads Docker source-image provenance for DSH and Identity and includes WLT only when its container has verified ownership in the same isolated Compose project; an old running image is reported as FAIL, not rebuilt or silently replaced. Apps android only reports connected ADB devices and existing reverse mappings; it never changes mappings, installs APKs or clears sessions.

App log diagnostics read only the final 64 KiB of each existing log using a shared read-only file handle, redact known credential forms before output truncation, and return at most 20 complete lines of 300 characters each. Incomplete boundary lines are omitted; an oversized line without a complete line in the bounded window reports `APP_LOG_NO_COMPLETE_LINES`. Never use unbounded `Get-Content -Tail` against live app logs: stalled readers have exhausted Lenovo CPU. Long bounded PowerShell diagnostics use a single base64 input line over the existing strict SSH connection to avoid Windows command-line limits; no remote helper, watcher or permanent file is created.

Start and restart are dry run by default. Explicit -App customer|merchant|captain|control-panel -Apply applies to one app only. Start is idempotent for a running owned application. Restart declines a healthy endpoint. On an unhealthy target, it verifies task action, mirror lock hash, runtime CLI and ownership of any listener. Both scoped restart and the unified stop capture the selected task's pinned Node descendant tree and verify process identities before stopping the task. They wait for the verified descendants to exit (terminating only the captured owned Node processes if needed) and prove that the tree and listener are gone. An unproven orphan or foreign process fails closed; the launcher never kills unknown processes, clears Metro cache, reinstalls dependencies, manipulates Docker or stops tunnels as part of scoped restart. Dependency maintenance must use this verified shutdown before moving an installed tree, preserve rollback and restart the existing tasks only after install verification. Dry-run alone does not prove recovery.

Historical Windows registration keys for Customer/Merchant tasks may still contain Client/Partner; these are not active application names. Canonical running app identities are customer, merchant, captain, control-panel. Do not rename active Scheduled Tasks unless all their consumers are migrated and proven. Native EAS/Android/iOS published IDs are separate contractual identities.

## Cleanup rule
Keep currently used app tasks, tunnel tasks, active SSH sessions and guarded rollback data. Disabled tasks pointing to deleted scripts may be exported and retired only after proving no user or service depends on them; no blanket deletion of backups, mirror directories, Android packages or private keys.

## Local Graphify reconciliation

The existing Surface source-sync process can also schedule the **native local Graphify runner**. With explicit human authorization, write the exact value `local-graphify-reconcile-v1` to `%LOCALAPPDATA%\BThwani\Operations\SourceSync\graphify-reconcile.enabled`, then reload the same existing watcher through its authorized owner. Do not launch another source-sync process or a standalone Graphify watcher.

The in-process source event subscription coalesces changes for 3 seconds (maximum coalescing window 15 seconds); a 30-second status audit is the fallback for missed events. These are scheduling targets, not guaranteed end-to-end latency: source reconciliation, host load and native extraction may delay them. Generated graphs, dependencies and internal Git writes do not trigger another refresh. The runner owns the index fingerprint, native incremental AST cache, exclusive refresh lock and provenance check; the scheduler never writes the graph directly. A trusted, current index is not rebuilt. The scheduler defers while the runner or AGENTS authority is being edited or the runner reports unsafe untracked paths. Safe uncommitted source is fingerprinted by content and refreshed without requiring Commit. Native extraction uses a separate generated candidate under graphify-out; only validated graph bytes and matching provenance are published. Queries remain available against the last same-branch published graph during extraction; stale source or a changing graph is reported, never certified as current. The task-owned watcher checks its loaded source and imported dependencies against committed on-disk code every five seconds. After an approved committed watcher change it drains active Graphify/runtime children, closes its subscription, and exits its worker thread with code 75. The existing task-owned Node process starts a fresh thread only after the prior thread has exited, so the imported module graph is reloaded without depending on Task Scheduler to restart a deliberately exited process. Unexpected failures still propagate to the task; its existing bounded restart-on-error policy remains a fallback, not the planned-reload mechanism. Do not start a second watcher or stop a busy task. A stopped task or an older pre-fix watcher requires an authorized start through the existing task owner before this recovery mechanism is active.

The local sync log records `GRAPHIFY_RECONCILE_STARTED`, `GRAPHIFY_RECONCILE_PASS elapsedMs=...`, or the applicable `DEFERRED`, `RETRY` or `BLOCKED` reason. `PASS` here means the runner's verified index freshness, not full-source graph coverage or engineering acceptance. Read `node tools/dev/graphify-local.mjs status` for the exact current provenance. No SSH or Docker changes are needed for Graphify itself.

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
