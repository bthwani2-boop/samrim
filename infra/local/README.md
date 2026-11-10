# Local development runtime — Surface and Lenovo

This document is the **operator runbook**, not a second implementation authority. The single editable application runtime-owner map is [runtime-owners.json](runtime-owners.json); `tools/dev/start-surface.mjs`, `tools/dev/Start-LenovoSurface.ps1`, Docker Compose, Windows Scheduled Tasks and live process/port readback determine whether the declared environment is actually running. The agent execution law is [AGENTS.md](../../AGENTS.md).

## Machine boundaries (current local-development setup)

- **Surface / BTHWANI (Windows):** active UI development source `D:\samrim-governance-refoundation-20261110` (existing Git worktree); the original `D:\samrim` checkout remains separate and is not the active application mirror source. Git, ChatGPT/remote-control tools, browser, ADB and the attached Android device run here. Native application development servers are *not* owned here when their `runtime-owners.json` entry says `lenovo-native`.
- **Lenovo / BTHWANI-DOCKER (Windows 11):** Docker Desktop owns local backend/state containers through the Surface Docker SSH context `bthwani-docker`. Separately, **native Windows Node.js**, pnpm, Expo/Metro and Next.js run application development servers outside containers. Remote application source is a derived, one-way mirror at `C:\Users\bthwa\BThwaniAppRunner\source`, not another Git repository.
- **Third-party EAS builds** are independent of Metro runtime placement; do not install native Android/iOS build toolchains merely to move dev servers.

Do not infer machine ownership from a path called `Surface`, the `pnpm client|partner|captain|control` command, a selected terminal, or an old saved chat. Read `infra/local/runtime-owners.json`, then verify current Windows tasks, Node processes, Docker context and tunnel endpoints. The map intentionally describes the **current** cutover, not a universal product architecture or an assurance that a task is healthy.

## Current runtime wiring

The actual owner and **Lenovo** application port for each surface are in `runtime-owners.json`. The stable **Surface localhost** ports are in the ignored `infra/local/.env` (template: `.env.example`). A Surface SSH loopback tunnel forwards each stable port to its runtime-owner port on Lenovo. No application or database port needs to listen on Wi-Fi/LAN.

Windows Scheduled Tasks on **Lenovo** (the current live tasks were promoted to user-logon startup after cutover; `tools/dev/Register-LenovoAppTasks.ps1` creates the Client/Partner/Control tasks **without** logon triggers for initial on-demand trials). Always inspect each live trigger instead of assuming a freshly registered task starts automatically:

| Task | Native process |
| --- | --- |
| `BThwani Captain Metro Trial` | Captain Expo/Metro (historical task name, currently canonical owner) |
| `BThwani Client Metro Native` | Client Expo/Metro |
| `BThwani Partner Metro Native` | Partner Expo/Metro |
| `BThwani Control Next Native` | Control Panel Next.js |
| `BThwani Docker Desktop User Startup` | Docker Desktop engine only |

Windows Scheduled Tasks on **Surface**, also using user-logon triggers:

| Task | Purpose |
| --- | --- |
| `BThwani SSH Tunnel Auto Reconnect` | Backend service loopback forwards via `tools/dev/remote-tunnel.ps1` |
| `BThwani Captain Lenovo SSH Tunnel` | Captain app loopback tunnel |
| `BThwani Client Lenovo SSH Tunnel` | Client app loopback tunnel |
| `BThwani Partner Lenovo SSH Tunnel` | Partner app loopback tunnel |
| `BThwani Control Lenovo SSH Tunnel` | Control Panel loopback tunnel |
| `BThwani Lenovo Source Sync` | One-way source mirror from Surface |

The six Surface background jobs (four app tunnels, backend tunnel, and source synchronizer) now use **`-WindowStyle Hidden`** in their Windows Scheduled Task actions, while remaining discoverable in Task Scheduler (`Settings.Hidden` is not required). The synchronizer launches its one Node watcher under a hidden PowerShell parent. Check task state, the owning process, and SSH/HTTP readback before restarting anything. Terminal windows created by an operator or other remote-control apps are not these job owners and must not be closed indiscriminately.

The single per-app SSH tunnel owner is `tools/dev/Start-AppTunnel.ps1`; all four Surface app-tunnel Scheduled Tasks, including `BThwani Captain Lenovo SSH Tunnel` with `-App app-captain`, now invoke it. The native Windows app launcher is `tools/dev/Start-LenovoSurface.ps1` through `tools/dev/Invoke-LenovoApp.ps1`. The previous Captain script at `%LOCALAPPDATA%\BThwani\captain-metro-tunnel.ps1` is **inactive** (verified no running process or scheduled task references it on 2026-11-05). Keep that historical file as a recovery artifact unless its removal is separately authorized; never reactivate it or create a competing tunnel. Validate the live Scheduled Task action, owning process and localhost listener instead of assuming this documentation proves future state.

**Important:** An interactive Windows logon trigger does not prove unattended startup before login. Cold reboot/restore of SSH, Docker Desktop and each app requires a separate verified test. Likewise, running/healthy containers do not prove financial/order/security user journeys.

## Source freshness, Fast Refresh and dependency updates

- From Surface, `node tools/dev/sync-lenovo-source.mjs --once` establishes a verified baseline; `--watch` checks allowlisted tracked and nonignored source files for changes. The Surface Scheduled Task owns the long-running watcher; **do not start a duplicate watcher**.
- Verify a file required by a test: `node tools/dev/sync-lenovo-source.mjs --verify apps/app-client/src/bootstrap/identity.ts`. This checks SHA-256 against the Lenovo mirror and fails on mismatch. The watcher reports failures separately; check both its process and the per-file proof before accepting a result.
- Sync is only `Surface -> Lenovo`; it does not transfer `.git`, `node_modules`, generated build/test outputs, actual `.env`, private signing/Firebase files or secrets. Never edit the mirrored source as canonical. Do not interpret successful `pnpm check` on Surface as proof a change is visible on Lenovo.
- Changes to lockfiles or native dependencies may require installing dependencies on Lenovo with pnpm using the pinned versions and frozen lockfile. Restart only the materially affected app if Metro/Next cannot refresh it; a native rebuild is not needed for normal JS/CSS edits but may be needed for native configuration changes.
- Only one scheduled watcher and one owner task per app should run. Do not delete a remote file except within the authorized derived mirror scope, and inspect permanent data before cleanup.

## Start, inspect, stop and rollback (scoped)

Use a Surface PowerShell window for read-only checks:

```powershell
git -C D:\samrim-governance-refoundation-20261110 status --short --branch
docker context show
docker ps --format "{{.Names}} {{.Status}}"
Get-ScheduledTask -TaskName "BThwani*"
Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(18101,18102,18103,13000) } | Select-Object LocalAddress,LocalPort,OwningProcess
ssh bthwani-docker 'powershell.exe -NoProfile -Command "Get-ScheduledTask -TaskName ''BThwani*'' | Select-Object TaskName,State"'
```

Use `Start-ScheduledTask -TaskName '<exact owner task>'` on the proper machine only after confirming it is not already running and its source/config is ready. `Stop-ScheduledTask -TaskName '<exact task>'` is an explicitly scoped app stop, **not** a generic platform shutdown. Confirm its actual Node child/listener ended: a Windows task state or HTTP 200 alone is insufficient. For failures check `C:\Users\bthwa\BThwaniAppRunner\logs\<app-name>.out.log` and `.err.log` on Lenovo without exposing secrets.

`pnpm client`, `pnpm partner`, `pnpm captain` and `pnpm control` are **local package entrypoints**, not remote launch commands. `start-surface.mjs` rejects competing local launches when `runtime-owners.json` assigns Lenovo. To start/restart a remote app, use its **remote Task Scheduler owner**, then verify the Surface localhost listener routes through SSH. Do not edit the map or silently run a Surface fallback simply to make a broken remote runtime appear green. Any rollback to Surface requires a scoped authorized cutover and a verified owner/port transition.

When reverting an app from Lenovo to Surface, first inspect and stop the **exact corresponding Surface SSH tunnel Scheduled Task** (not the backend SSH tunnel or other app tasks). Check that its child SSH process actually ended and released the app's local loopback port; if an orphan remains, inspect and terminate **only** the matching PID and forwarding command before starting the replacement. Then change the runtime-owner map and perform a verified, scoped cutover. Updating the map alone does not interrupt a blocking live SSH tunnel, so do not assume it releases the port. No fallback is automatic.

`pnpm dev down` may stop **all backend services** and local repository app processes. Never use it to stop only one app. Docker belongs to Lenovo through the `bthwani-docker` context; `pnpm dev status` is safe for backend health observation. Never switch to `desktop-linux`, start a second engine, prune volumes, reset databases, expose Postgres on a LAN, or restore a VHDX to work around a connectivity failure. Refer to [Compose runtime and recovery](compose/README.md) for backend-specific details.

ADB remains on Surface. After ADB daemon/device reconnect, inspect `adb reverse --list` and restore only the required API and app loopback mappings (`pnpm scr` owns the established mappings). Physical phones access the mapped Surface localhost ports, not the private Lenovo loopback ports.

## Secrets, data and recovery

Mobile Google Maps keys and Control Panel development credentials are stored separately under `C:\Users\bthwa\BThwaniAppRunner\private\env` on Lenovo, **outside Git and the mirrored source**. Use the interactive `tools/dev/Set-LenovoRuntimeSecrets.ps1` on Lenovo to enter missing values securely; never print their contents, copy Surface's full secret set, or send keys in chat. Review the local ACLs and provider restrictions before claiming complete secret-hardening.

SSH currently uses the existing Windows OpenSSH server. Test public-key access and inspect effective Windows Firewall source-address filters before restricting TCP 22; an observed Wi-Fi IP is not proof of a DHCP reservation. Do not disable a working allow rule or password authentication until a validated independent recovery path exists. Prefer scoped changes to the existing rules rather than parallel rules or a second SSH daemon. Measure actual Wi-Fi throughput before tuning channel, router, network adapters or connection software.

If Lenovo/SSH is unavailable: report `BLOCKED` or `DEGRADED`; investigate existing tasks/network and known-good backups, restore the same owner, and verify canonical readback. **Never silently start a second Docker engine or Metro/Next server on Surface.** If an app cutover itself fails, preserve and restore the known-good service only with a scoped, inspected reversal; do not touch persistent Postgres/media volumes or unrelated user sessions. No scripts in this document imply authorization to merge, deploy or make destructive changes.
