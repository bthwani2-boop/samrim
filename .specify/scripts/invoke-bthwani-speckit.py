"""Run the official Spec Kit CLI with closed stdin for noninteractive agents.

Use a managed background process session for long SDD runs; never rerun an
unknown result. The CLI owns workflow state, recovery and human approval gates.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys


def _scoped_child_environment(source: dict[str, str] | None = None) -> dict[str, str]:
    """Skip WindowsApps shell aliases for this child process only.

    A WindowsApps pwsh.exe alias on the BThwani host is not a working PowerShell
    7 executable inside the Codex sandbox. Preserve all other PATH entries so
    the installed Windows PowerShell 5.1 is detected instead.
    """
    env = dict(os.environ if source is None else source)
    if os.name != "nt" or not env.get("LOCALAPPDATA"):
        return env
    windows_apps = os.path.normcase(os.path.normpath(
        os.path.join(env["LOCALAPPDATA"], "Microsoft", "WindowsApps")
    ))

    def canonical_path(item: str) -> str:
        return os.path.normcase(os.path.normpath(os.path.expandvars(item.strip().strip('"'))))

    entries = env.get("PATH", "").split(os.pathsep)
    env["PATH"] = os.pathsep.join(
        entry for entry in entries if entry and canonical_path(entry) != windows_apps
    )
    return env


def main() -> int:
    if len(sys.argv) < 3 or sys.argv[1] != "workflow" or sys.argv[2] not in ("run", "resume", "status", "definition"):
        print("Usage: invoke-bthwani-speckit.py workflow run|resume|status|definition ...", file=sys.stderr)
        return 2
    child_env = _scoped_child_environment()
    executable = shutil.which("specify", path=child_env.get("PATH"))
    if not executable:
        print("BLOCKED: specify CLI executable not found", file=sys.stderr)
        return 3
    # Neither the Windows host console nor an interactive remote session may
    # provide Codex with trailing input. The user prompt comes from argv.
    try:
        return subprocess.call([executable, *sys.argv[1:]], stdin=subprocess.DEVNULL, env=child_env)
    except KeyboardInterrupt:
        print("Interrupted: inspect the existing run and executor before retrying.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
