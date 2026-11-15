"""Pause an abandoned Spec Kit run using the installed engine's state API.

Never call this while any workflow executor for this checkout is still alive.
Only an expired RUNNING checkpoint with an unfinished current step is eligible.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
import shutil
import subprocess
import sys

from specify_cli.workflows.base import RunStatus
from specify_cli.workflows.engine import RunState


ROOT = Path(__file__).resolve().parents[2]


def active_engine_pids() -> list[str]:
    ps = (
        "$ErrorActionPreference='Stop'; "
        "$p=Get-CimInstance Win32_Process | Where-Object { "
        "$_.Name -eq 'specify.exe' -or "
        "($_.Name -eq 'python.exe' -and $_.CommandLine -match 'specify_cli.*workflow (run|resume)') -or "
        "($_.Name -eq 'codex.exe' -and $_.CommandLine -match 'speckit') }; "
        "$p | ForEach-Object { $_.ProcessId }"
    )
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", ps],
        text=True, capture_output=True, timeout=15, check=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def recover(run_id: str) -> None:
    if not re.fullmatch(r"[0-9a-f]{8}", run_id):
        raise ValueError("Expected an exact eight-character run ID")
    state = RunState.load(run_id, ROOT)
    if state.status is not RunStatus.RUNNING:
        raise ValueError("Only a RUNNING checkpoint may be recovered")
    if state.current_step_id in state.step_results:
        raise ValueError("Current step already has a result; inspect before retry")
    updated = datetime.fromisoformat(state.updated_at.replace("Z", "+00:00"))
    if datetime.now(timezone.utc) - updated < timedelta(minutes=2):
        raise ValueError("Checkpoint is too recent to regard as abandoned")
    pids = active_engine_pids()
    if pids:
        raise ValueError("Spec Kit/Codex executor could still be active; PIDs: " + ",".join(pids))
    path = ROOT / ".specify" / "workflows" / "runs" / run_id / "state.json"
    backup = path.with_name("state.json.abandoned-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    if backup.exists():
        raise ValueError("Recovery backup already exists; inspect the run first")
    shutil.copy2(path, backup)
    state.status = RunStatus.PAUSED
    state.error = "Interrupted outside the engine; unfinished current step must rerun on resume"
    state.append_log({
        "event": "abandoned_run_paused",
        "step_id": state.current_step_id,
        "reason": "No active workflow executor; original checkpoint backed up; completed steps retained",
    })
    state.save()
    print(f"PAUSED {run_id} at {state.current_step_id}, completed={len(state.step_results)}")
    print(f"BACKUP {backup.name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    args = parser.parse_args()
    try:
        recover(args.run_id)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
