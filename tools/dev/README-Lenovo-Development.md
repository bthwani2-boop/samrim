# BThwani Surface-to-Lenovo development operations

One canonical source: Surface D:\samrim; Lenovo BTHWANI-DOCKER runs the apps.
Surface hostname BTHWANI; Lenovo hostname BTHWANI-DOCKER. The SSH target alias is bthwani-docker with strict host-key checks; resolve its current network address rather than treating historical DHCP assignments as permanent.

## Daily launch — one command

From Surface PowerShell 7 in `D:\samrim` run **`pnpm dev`**. This is the fast default: it verifies the existing Lenovo SSH endpoint, reuses the existing Surface sync/tunnel and Lenovo app tasks, and opens the three Chrome tabs plus Customer/Merchant/Captain on a connected Samsung. It never launches a second watcher or another Expo/Next server, and does not recreate Docker containers or touch data. After opening existing surfaces, it checks the complete Compose configuration, all three committed owner images and actual app source/dependencies/ownership/HTTP. A partial environment is reported as BLOCKED and exits nonzero even when independent surfaces were opened. The same read-only readiness checks run after up/warm and in verify. This is not proof of authenticated journeys, financial correctness or visual Fast Refresh.

- `pnpm dev apps open` — reopen the existing Chrome window and connected Android apps without touching their servers. Use `-Mode Browser` when Samsung is disconnected.
- `pnpm dev apps status` / `pnpm dev apps verify` — targeted diagnostics, reusable by the launch readiness check. The source check compares the current allowed paths and file digests with the watcher's last published manifest. It detects saved edits at the same Git SHA. The watcher's periodic Lenovo hash audit checks for remote drift.
- `pnpm dev up` / `pnpm dev warm` — the same explicit startup of the seven previously provisioned services, including Identity, DSH and WLT. Verify owner source first; use native Compose start/wait without creating containers, applying migrations or changing credentials. Missing/stale services require the existing guarded lifecycle or explicit first-time provisioning.
- `pnpm dev down` preflights the isolated Docker inventory before stopping any app or tunnel. It refuses while Identity or WLT is running, or when project container ownership/state is unresolved; it never removes volumes.

When Lenovo is unreachable on TCP port 22, the fast command reports a specific `BLOCKED` error instead of running lengthy Docker checks. The preexisting Scheduled Tasks keep retrying their SSH tunnels. Check Lenovo power/network before repeating a failed start; never launch a duplicate watcher or tunnel.

The existing Surface BThwani Android USB Recovery task invokes dev.ps1 apps recover -Automatic at logon and every minute, using native Task Scheduler IgnoreNew. It checks the designated device and exact tunnel ownership, adds only missing mappings with --no-rebind, and verifies readback without opening apps, starting Metro, or acquiring the Docker/dependency lifecycle lock. Explicit apps open retains the manifest probes and UI launch. Recovery proves transport only, not rendered screens or authenticated journeys.

## Operator login is a separate Identity acceptance gate

The canonical **WebAuthn/Passkey browser origin is `http://localhost:13000`**, not `127.0.0.1:13000`; the latter redirects to the canonical entry. The URL is forwarded over the existing Surface SSH tunnel to Lenovo's Next.js port `23010`.

`pnpm dev` reports `OPERATOR_AUTH` separately from `SURFACES_LAUNCH` and `ENVIRONMENT_READINESS`. A successful app launch or an HTTP 200 does not prove Operator identity, enrollment, a verified cookie, or any of the seven Identity-owned grants. A `503` session response means the isolated login BFF or its owner is unavailable; do not restart Identity or bypass the gate automatically.

For a genuinely usable **isolated** Operator login, independently verify that the existing Identity test schema is disposable, its required owner migrations are applied, its Passkey origin/RP ID and authentication opt-ins are correct, and the actual Lenovo Control task is launched with `-EnableIsolatedOperatorPasskeyPreview`. The one-time initial Root bootstrap is a **separate protected operation**, never inferred from UI readiness. A real user must enroll their own Passkey; only Identity-owned current session and permission readback permits the workspace. Never fabricate a Root, re-enroll another identity or expose a bootstrap ticket in logs. See `governance/identity.md` and `services/identity/README.md` for owner authorization and recovery requirements.

## Single existing owners
- SSH: the single BThwani Lenovo SSH Tunnel Scheduled Task invokes tools/dev/Start-AppTunnel.ps1 with all six loopback forwards. tools/dev/ports.json owns app transport ports and the two shared owner forwards (Identity and DSH); WebAuthn's existing localhost origin remains fixed. WLT is accessed on Lenovo by its existing Web BFF, not exposed by another tunnel.
- Source sync: the existing Scheduled Task BThwani Lenovo Source Sync directly runs pinned node.exe with tools/dev/sync-lenovo-source.mjs --watch. Its direct process ownership ensures stopping the task also stops its Node watcher, without orphan duplicates. The scheduled task directly owns the sole watch process; no manual wrapper or second watcher is necessary.
- The Surface sync target is `C:\Users\bthwa\BThwaniAppRunner\source-runtime`. The Lenovo app tasks invoke `tools\dev\Start-App.ps1` in that mirror with `-App customer`, `-App merchant`, `-App captain`, or `-App control-panel`. Verify the task action, synced source revision, and listener owner when diagnosing a runtime issue.

## Guarantees and limits
- Mirroring is strictly Surface-to-Lenovo for approved tracked and untracked source paths. Service workspaces include the package manifests, TypeScript configs, and clients consumed by the apps. Service backend, migrations, .git, node_modules, .env*, credentials, secrets, DB and cache directories are excluded.
- Strict SSH host verification and SHA-256 validation remain enabled. Source bytes are copied by SCP to unique staging files and atomically published after checking the expected remote version. Unexpected mirror edits are archived with verified hashes before restoring the Surface copy; deletions affect only previously managed paths.
- File mirroring never reads, copies, repairs or deletes `node_modules` and never runs `pnpm install`. Source changes, including `pnpm-lock.yaml` and package manifests, sync one way even when Lenovo dependencies are missing or an install fails. Added, changed or removed mirrored dependency inputs (including workspace manifests, workspace configuration and patches) produce `DEPENDENCY_INSTALL_REQUIRED` in the existing sync log; this is an independent install status, not a source-sync failure. The existing watcher schedules pnpm dev apps reconcile -Apply -Automatic after verified sync using the same lifecycle child slot and mutex as Docker. It is a no-op when the installed graph and input receipt match; otherwise it drains verified app owners, retains previous installed trees, runs pinned frozen pnpm, verifies the result and restarts only previously running tasks. Known failed inputs are not retried automatically; an ambiguous receipt requires owner readback. Manual check/retry: pnpm dev apps reconcile [-Apply].
- Lenovo installs the exact pinned dependencies **only when they change or the local install needs repair**, in one exclusive install operation with rollback available. Do not overlap installs or delete a working `node_modules` after failure. A source change not requiring new dependencies should appear through the already running Metro/Next.js dev servers without restarting tasks. New/changed dependencies may need a successful install before the new feature runs; source mirroring alone does not promise that runtime effect. Branch changes retain the existing archive-branch refusal and never change Git refs; dependency input changes may schedule the same unified dependency reconcile after verified sync.
- Manifest and bounded diagnostic log live outside the repo under %LOCALAPPDATA%\BThwani\Operations\SourceSync. Git commits and pushes are separate operations.
- The single existing watcher uses native recursive source events for mirroring, dependency/runtime scheduling and Graphify. The one-second timer dispatches pending events; a full bounded audit every 30 seconds recovers missed events and remote drift. A failed sync retries after five seconds; deferred dependency inputs resume when the existing lifecycle child finishes. Idle ticks do not scan Git or hash all source files. Small lists use one SSH command; larger audits use a temporary SCP-transferred manifest. No binary SSH stdin transport, parallel source writer, new daemon, or separate Docker engine is introduced.
- A successful file mirror does not prove that running app processes are using it; validate source version, real Web/Android UI and Metro Fast Refresh. Go containers are source-SHA-built images, not hot-reloaded filesystem mirrors; use the existing infra runtime provenance check before any owner-approved rebuild.

## Commands
- Validate the existing watcher code: `node --check tools/dev/sync-lenovo-source.mjs`.
- The running Scheduled Task already reconciles changes automatically; the task owns the sole `--watch` writer. The manual `--once` entry has been removed. Read-only manifest and dependency verification is portable to CI; it never admits a remote write.
- Test policy: run `node --test tools/dev/sync-lenovo-source.test.mjs` from the checkout, on Windows or Linux with PowerShell 7. Windows-only process/mutex proofs retain their actual platform requirements.

## Isolated owner runtime reconciliation

Use the existing unified lifecycle CLI, from Surface, not a second watcher:

- `pnpm dev docker reconcile` checks the running Compose configuration and owner source drift.
- `pnpm dev docker reconcile -Apply` runs fresh owner tests without live DB test credentials, builds through the existing pinned owner build scripts, verifies image labels, and replaces only changed running owners with `--no-deps --no-build --pull never`. Previous image tags and reconstructed Compose hashes must match before replacement; failed known replacements restore the previous configuration/images, and ambiguous writes stop. Never start SQL/migration roles or change volumes.
- `pnpm dev docker reconcile -Apply -EnableCaptain` explicitly admits the Captain owner capability once, only in the isolated development environment, after checking the pre-provisioned read-only TLS volumes. This option is never used by the automatic watcher.

Automatic committed-owner reconciliation is opt-in for the canonical Surface watcher. After explicit owner authorization, set the existing SourceSync state directory's `runtime-reconcile.enabled` file to the exact text `isolated-committed-owner-images-v1` and reload the existing watcher task through its authorized owner; do not create another watcher. The watcher checks the owner/configuration source fingerprint on its normal cycle, runs guarded apply through the unified CLI under its existing lifecycle mutex when the source key changes or a verified audit selects an eligible stale owner. For settled unchanged source the same watcher invokes the existing native reconciler in read-only --check mode at a bounded interval, without creating an apply attempt or unified lifecycle transcript. A failed audit preserves the prior receipt and retries the audit; a confirmed eligible drift schedules a fresh guarded apply. Its attempt record is stored beside the existing sync manifest. An ambiguous or interrupted attempt blocks future automatic writes pending owner readback and reconciliation; a known rolled-back attempt is not repeated for the same source. The actual automatic reconciler publishes one atomic terminal receipt in SourceSync, keyed to a unique attempt, so a watcher interruption after a proven successful apply no longer strands the scheduler. The watcher remains the sole scheduling-state writer; a stale or unrelated receipt never releases a hold. For a genuinely unresolved or legacy attempt, inspect the previous operation and its durable effects, then use `pnpm dev docker reconcile -RecoverRuntimeAttempt <exact-reviewed-64-character-key>` only after explicit owner review. The existing lifecycle mutex protects the read-only owner/configuration and database-principal checks; the command refuses stale, unhealthy, dirty, or concurrently changing owners. It acknowledges the exact reviewed state as retry, not historical success; it never replaces a container or runs SQL writes. The existing watcher consumes the receipt and resumes its normal guarded cycle. Transient preflight failures are retried at most once per minute. A partial result containing only explicit source-admission holds and their dependent peer holds stops automatic apply for that source/authority key; a changed key resumes it. Configuration and schema review holds retain bounded periodic review. The original opt-in allows only committed owner source. GitHub Push is not required for local committed image reconciliation. For the separately authorized uncommitted Go preview, use the exact opt-in value `isolated-owner-go-preview-v2` and reload the same existing watcher. The watcher detects changed Go bytes, not just commit IDs, and invokes the same unified CLI with `-Apply -Preview`.

The preview builds and tests an allowlisted, immutable owner snapshot (Go source and unchanged committed build/schema inputs); the image carries a worktree digest and separate base SHA, not a committed source label. Added and removed Go files are included, ignored secrets are excluded, and a changed snapshot before replacement is rejected. `pnpm dev docker reconcile` reports `PREVIEW_CURRENT` when the live preview matches. The strict committed provenance check intentionally rejects a preview until a clean committed image is restored. Uncommitted SQL, contracts, dependencies, Compose or tooling changes, new capabilities/containers and protected configuration changes remain blocked pending explicit review; frontend Fast Refresh remains independent. A change or verified hash mismatch in the separate WLT verification group holds WLT only during ordinary reconciliation; independently eligible DSH and Identity updates still require their exact running configuration, owner tests and readback. Shared Compose inputs and explicit capability/database transitions retain their existing strict checks. Do not treat image/health proof as full login or financial acceptance.

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

The apps status command reports the existing Surface watcher state, last task result and committed mirror revision, the single Lenovo listener and its Node/launcher ancestry, application CLI, pinned Node and mirrored dependency-lock SHA. It separately compares the installed pnpm virtual-store lock against the workspace document of the mirrored pnpm lock (the separate package-manager document is not an installed workspace graph). Apps verify fails closed on a stopped/stale source mirror or mismatched installed graph; it also probes the customer/merchant/control Web endpoints and Captain Metro /status. Cold Expo compilation gets up to three bounded HTTP attempts with per-endpoint timing and failure reasons; persistent HTTP failures still fail the verification. The lightweight `pnpm dev status` probe uses one attempt and the same URL inventory. Web HTTP/Metro success does not close Fast Refresh, browser journeys or Android UI tests. `pnpm dev docker status` requires Docker source-image provenance for all three serving owners in the same isolated Compose project; an old running image is reported as FAIL, not rebuilt or silently replaced. Strict pnpm dev docker verify requires all three owners, including WLT; missing or stale owners fail verification. Docker config validates the single canonical infra/compose.yaml configuration without printing resolved credentials. Apps android requires the designated device and complete verified reverse mappings, returning failure when incomplete; it never changes mappings, installs APKs or clears sessions.

App log diagnostics read only the final 64 KiB of each existing log using a shared read-only file handle, redact known credential forms before output truncation, and return at most 20 complete lines of 300 characters each. Incomplete boundary lines are omitted; an oversized line without a complete line in the bounded window reports `APP_LOG_NO_COMPLETE_LINES`. Never use unbounded `Get-Content -Tail` against live app logs: stalled readers have exhausted Lenovo CPU. Long bounded PowerShell diagnostics use a single base64 input line over the existing strict SSH connection to avoid Windows command-line limits; no remote helper, watcher or permanent file is created.

Start and restart are dry run by default. Explicit -App customer|merchant|captain|control-panel -Apply applies to one app only. Start is idempotent for a running owned application. Restart declines a healthy endpoint. On an unhealthy target, it verifies task action, mirror lock hash, runtime CLI and ownership of any listener. Both scoped restart and the unified stop capture the selected task's pinned Node descendant tree and verify process identities before stopping the task. They wait for the verified descendants to exit (terminating only the captured owned Node processes if needed) and prove that the tree and listener are gone. An unproven orphan or foreign process fails closed; the launcher never kills unknown processes, clears Metro cache, reinstalls dependencies, manipulates Docker or stops tunnels as part of scoped restart. Dependency maintenance must use this verified shutdown before moving an installed tree, preserve rollback and restart the existing tasks only after install verification. Dry-run alone does not prove recovery.

Historical Windows registration keys for Customer/Merchant tasks may still contain Client/Partner; these are not active application names. Canonical running app identities are customer, merchant, captain, control-panel. Do not rename active Scheduled Tasks unless all their consumers are migrated and proven. Native EAS/Android/iOS published IDs are separate contractual identities.

## Cleanup rule
Keep currently used app tasks, tunnel tasks, active SSH sessions and guarded rollback data. Disabled tasks pointing to deleted scripts may be exported and retired only after proving no user or service depends on them; no blanket deletion of backups, mirror directories, Android packages or private keys.

## Isolated verification (not a second daily runtime)

The daily launcher runs only on Lenovo using PowerShell 7 and the existing owner services. The old Surface app launcher and its reserved preview ports have been retired. Tests can still use isolated fixtures and temporary loopback endpoints: existing Customer wallet/cart BFF and Native wallet tests, Operator Passkey BFF tests, and the disposable Operator WebAuthn sandbox. The Expo Web verification harness in tools/mobile/verify-expo-web-http.mjs manages its own temporary test server. These fixtures do not authorize a second persistent environment.

Native wallet emulator/device end-to-end verification remains a separate acceptance requirement; the existing isolated source tests are not proof of device execution. Do not enable a private finance origin on a real user device or use shared development state for destructive tests.

### Opt-in Lenovo Customer Web wallet

The active Lenovo Customer Web server is **not** silently reconfigured when
Docker WLT appears. With its existing default launcher environment, its
`/api/customer-auth/wallet` and `/wallet-transactions` routes remain disabled
(`503`). Once the isolated `identity` and `wlt` containers are healthy,
a **separately controlled Customer Web start** on Lenovo can use
`pwsh -NoProfile -File tools/dev/Start-App.ps1 -App customer -EnableDockerWalletWebPreview`
from the verified runtime source. Only this opt-in sets the Web BFF's private
`BTHWANI_DOCKER_WALLET_WEB_PREVIEW` flag, explicit isolated-test mode,
and fixed local Identity `3201`
and WLT `3203` owner origins. The launcher validates the actual Docker
container capability labels, health and unauthenticated route denial before
starting Expo. It refuses Surface/native previews and all other applications;
the browser session is still an HttpOnly same-origin Customer cookie.
The public/native Expo preview flags stay disabled and the BFF refuses any
other wallet port even if other preview flags are set. **Do not restart the
shared running Customer task to opt in without checking its ownership and
other active sessions.** Only the synthetic development customer can sign in
through Mailpit. No payment mutation is enabled.
Neither an Expo Android JS export nor source tests prove actual emulator/device
execution; test its complete network and session behavior separately.

### Opt-in Lenovo Customer Android sign-in

Use `-EnableDockerCustomerAndroidIdentityPreview` on the Customer launcher
with the standard Customer Metro tunnel and ADB reverse on port `18101`.
The isolated Identity owner must be published on Lenovo loopback port `3201`.
Forward that owner over the approved private SSH connection to a Surface
loopback port and map device port `3201` to that Surface port with ADB reverse.
This preview uses a separate Android session namespace and synthetic phones.
The Web wallet option can coexist with it and continues to use its own cookie.

The existing Surface development launcher adds ADB reverse mappings for the
three Metro ports and the two owner ports (Identity 3201, DSH 3202) only after
verifying all listeners and exact process ownership of the canonical loopback SSH
tunnel. The unified SSH tunnel carries both owner forwards; do not
start another SSH process for them or replace an unrelated ADB mapping.
A change to tunnel arguments requires a separately controlled reload of that
existing task before the new mappings can be used. The Lenovo Merchant and
Captain launchers require healthy, isolated Identity and DSH owners before
considering native admission. Merchant admission stays blocked when its owner
endpoint is unavailable. If the isolated DSH has not enabled Captain standing
and returns exactly HTTP 404, the Captain launcher keeps the verified isolated
Identity origin so the public phone login form remains visible, but removes
the DSH origin. The Captain form explains that code submission is disabled
until owner standing is available; it never consumes OTP or grants workspace
access while DSH is missing. Any other unexpected Captain owner response aborts
startup. Once the DSH owner is migrated and independently enabled, an
unauthenticated standing read must return HTTP 401 before Captain native
admission can be configured. Browser
cookies and native SecureStore remain separate.

## Local Graphify reconciliation

The existing Surface source-sync process can also schedule the **native local Graphify runner**. With explicit human authorization, write the exact value `local-graphify-reconcile-v1` to `%LOCALAPPDATA%\BThwani\Operations\SourceSync\graphify-reconcile.enabled`, then reload the same existing watcher through its authorized owner. Do not launch another source-sync process or a standalone Graphify watcher.

The shared in-process source event subscription wakes mirroring independently of Graphify opt-in; Graphify coalesces changes for 3 seconds (maximum coalescing window 15 seconds); a 30-second status audit is the fallback for missed events. These are scheduling targets, not guaranteed end-to-end latency: source reconciliation, host load and native extraction may delay them. Generated graphs, dependencies and internal Git writes do not trigger another refresh. The runner owns the index fingerprint, native incremental AST cache, exclusive refresh lock and provenance check; the scheduler never writes the graph directly. A trusted, current index is not rebuilt. The scheduler defers while the runner or AGENTS authority is being edited or the runner reports unsafe untracked paths. Safe uncommitted source is fingerprinted by content and refreshed without requiring Commit. Native extraction uses a separate generated candidate under graphify-out; only validated graph bytes and matching provenance are published. Queries remain available against the last same-branch published graph during extraction; stale source or a changing graph is reported, never certified as current. The task-owned watcher checks its loaded source and imported dependencies against committed on-disk code every five seconds. After an approved committed watcher change it drains active Graphify/runtime children, closes its subscription, and exits its worker thread with code 75. The existing task-owned Node process starts a fresh thread only after the prior thread has exited, so the imported module graph is reloaded without depending on Task Scheduler to restart a deliberately exited process. Unexpected failures still propagate to the task; its existing bounded restart-on-error policy remains a fallback, not the planned-reload mechanism. Do not start a second watcher or stop a busy task. A stopped task or an older pre-fix watcher requires an authorized start through the existing task owner before this recovery mechanism is active.

The local sync log records `GRAPHIFY_RECONCILE_STARTED`, `GRAPHIFY_RECONCILE_PASS elapsedMs=...`, or the applicable `DEFERRED`, `RETRY` or `BLOCKED` reason. `PASS` here means the runner's verified index freshness, not full-source graph coverage or engineering acceptance. Read `node tools/dev/graphify-local.mjs status` for the exact current provenance. No SSH or Docker changes are needed for Graphify itself.

## Manual Lenovo diagnostics — native OpenSSH

Use the verified Windows OpenSSH client on Surface directly, with strict host-key checking and noninteractive authentication. Verify the Lenovo identity before additional authorized operations. Use the unified development CLI for application and Docker lifecycle; manual SSH is not another runtime owner.

~~~powershell
$ssh = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$opts = @('-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1')
$hostName = @(& $ssh @opts bthwani-docker hostname.exe)
if ($LASTEXITCODE -ne 0 -or $hostName.Count -ne 1 -or $hostName[0].Trim() -ine 'BTHWANI-DOCKER') { throw 'Unexpected SSH target' }
& $ssh @opts bthwani-docker docker ps
~~~

For explicitly authorized manual file transfer, use native System32 OpenSSH SCP, strict host verification and an exact existing destination. Compare SHA-256 at both endpoints before relying on the transferred file; recursive transfer needs an inventory and per-file verification. Never use manual transfer as a second source-sync writer. Installation, permissions, credentials and protected data retain separate authorization.

### Docker diagnostics

Use `pnpm dev docker help` for the current, owner-scoped Docker commands and [isolated infrastructure](../../infra/README.md) for provisioning, schema and security boundaries. For a diagnostic that the unified CLI does not provide, use native SSH above with a read-only command (for example docker stats --no-stream). Do not start, stop, recreate or remove containers/images through ad hoc SSH commands; use the unified lifecycle and its explicit authorization and verification gates. Never prune protected volumes or restart shared services as a diagnostic step.
