"""Run the official Spec Kit CLI with closed stdin for noninteractive agents.

Use a managed background process session for long SDD runs; never rerun an
unknown result. The CLI owns workflow state, recovery and human approval gates.
"""
from __future__ import annotations

import shutil
import subprocess
import sys


def main() -> int:
    if len(sys.argv) < 3 or sys.argv[1] != "workflow" or sys.argv[2] not in ("run", "resume", "status", "definition"):
        print("Usage: invoke-bthwani-speckit.py workflow run|resume|status|definition ...", file=sys.stderr)
        return 2
    executable = shutil.which("specify")
    if not executable:
        print("BLOCKED: specify CLI executable not found", file=sys.stderr)
        return 3
    # Neither the Windows host console nor an interactive remote session may
    # provide Codex with trailing input. The user prompt comes from argv.
    try:
        return subprocess.call([executable, *sys.argv[1:]], stdin=subprocess.DEVNULL)
    except KeyboardInterrupt:
        print("Interrupted: inspect the existing run and executor before retrying.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
