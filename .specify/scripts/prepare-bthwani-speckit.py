"""Derive a review-safe Spec Kit workflow from the installed, overlaid one.

Only the official Spec Kit engine runs workflows. This prepares an ignored YAML
with explicit, fail-closed human review inputs; it neither runs agents nor
records/assumes any approval.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import sys

import yaml
from specify_cli.workflows.engine import WorkflowDefinition, WorkflowEngine


ROOT = Path(__file__).resolve().parents[2]
EXPECTED_STEPS = (
    "bthwani-preflight", "specify", "clarify", "review-spec", "plan",
    "review-plan", "checklist", "tasks", "analyze", "review-implementation",
    "implement", "converge", "bthwani-final-review",
)
REVIEW_INPUTS = {
    "review-spec": "spec_approval",
    "review-plan": "plan_approval",
    "review-implementation": "implementation_approval",
    "bthwani-final-review": "final_approval",
}


def prepare(relative_output: str) -> Path:
    output = Path(relative_output.replace("\\", "/"))
    parts = output.parts
    if (
        output.is_absolute()
        or len(parts) < 3
        or parts[0] != ".bthwani-local"
        or any(part in ("", ".", "..") for part in parts)
        or output.suffix not in (".yml", ".yaml")
    ):
        raise ValueError("Output must be a unique relative .bthwani-local/<feature>/<file>.yml path")

    local_root = ROOT / ".bthwani-local"
    if local_root.is_symlink() or not local_root.resolve().is_relative_to(ROOT.resolve()):
        raise ValueError("Local test root must not be a symlink outside the repository")
    resolved = ROOT / output
    if resolved.is_symlink():
        raise ValueError("Refusing to use a symlink as output")
    target_parent = resolved.parent.resolve()
    if not target_parent.is_relative_to(local_root.resolve()):
        raise ValueError("Output escapes the local ignored directory")
    if not target_parent.is_dir():
        raise ValueError("Create the designated local feature directory first")

    engine = WorkflowEngine(ROOT)
    original = engine.load_workflow("speckit")
    if tuple(step.get("id") for step in original.steps) != EXPECTED_STEPS:
        raise ValueError("Installed Spec Kit step graph changed: review before regeneration")
    expected_commands = {name: "speckit." + name for name in (
        "specify", "clarify", "plan", "checklist", "tasks", "analyze", "implement", "converge"
    )}
    for step in original.steps:
        command = expected_commands.get(step["id"])
        if command and (
            step.get("command") != command
            or step.get("integration") != "codex"
            or step.get("input", {}).get("args") != "{{ inputs.spec }}"
        ):
            raise ValueError("Installed agent command or integration changed: " + step["id"])
    preflight = original.steps[0]
    if (
        preflight.get("type") != "shell"
        or not preflight.get("strict")
        or "verify-bthwani-codex.ps1" not in preflight.get("run", "")
    ):
        raise ValueError("Mandatory preflight changed")
    data = deepcopy(original.data)
    data["workflow"]["id"] = "bthwani-speckit-reviewed"
    data["workflow"]["name"] = "BThwani full Spec Kit cycle with explicit review"

    # The user input describes the feature, not the whole orchestration task.
    # Keep the original requirements but explicitly limit each Codex dispatch
    # to its one official skill, avoiding repeat exploration of old run state.
    for step in data["steps"]:
        if step["id"] in expected_commands:
            step["input"]["args"] = (
                "{{ inputs.spec }}\n\n"
                "[Orchestrated Spec Kit phase: " + step["id"] + "] "
                "Execute only this official skill phase; the workflow engine runs "
                "all other phases and human review gates. Follow mandatory "
                "prerequisites, hooks, governance and acceptance checks. "
                "Prefer the active feature files and canonical owners; do not "
                "enumerate historic run directories or Codex memories unless "
                "a specific requirement needs them. If required work cannot "
                "run under current permissions, report BLOCKED; never claim "
                "a skipped artifact was generated."
            )

    for step in data["steps"]:
        input_name = REVIEW_INPUTS.get(step["id"])
        if not input_name:
            continue
        if (
            step.get("type") != "gate"
            or step.get("options") != ["approve", "reject"]
            or step.get("on_reject") != "abort"
        ):
            raise ValueError("Review gate changed: " + step["id"])
        step["verdict_input"] = input_name
        # An unapproved gate must PAUSE even when the host fakes console input
        # and turns EOF into an unrequested 'reject' decision.
        step["on_reject"] = "retry"
        data["inputs"][input_name] = {"type": "string", "default": "reject"}

    derived = WorkflowDefinition(data)
    errors = engine.validate(derived)
    if errors:
        raise ValueError("Derived workflow validation failed: " + "; ".join(errors))
    text = yaml.safe_dump(data, allow_unicode=True, sort_keys=False)
    if resolved.exists():
        if resolved.read_text(encoding="utf-8") != text:
            raise ValueError("Refusing to overwrite a different workflow or active run file")
        print("UNCHANGED " + str(output))
    else:
        resolved.write_text(text, encoding="utf-8", newline="\n")
        print("PREPARED " + str(output))
    print("GATES " + " ".join(REVIEW_INPUTS.values()) + " (default pending)")
    return resolved


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", help="Relative .bthwani-local/<feature>/<file>.yml output")
    args = parser.parse_args()
    try:
        prepare(args.output)
    except (ValueError, OSError) as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
