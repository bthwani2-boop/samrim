"""Fast isolated regression tests for BThwani's Spec Kit review gates."""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / ".specify" / "scripts"
SPECIFY = shutil.which("specify")
PYTHON = __import__("sys").executable


def run_cli(*args: str) -> dict:
    if not SPECIFY:
        raise AssertionError("Installed specify CLI missing")
    r = subprocess.run(
        [PYTHON, str(SCRIPTS / "invoke-bthwani-speckit.py"), "workflow", *args, "--json"],
        cwd=ROOT, stdin=subprocess.DEVNULL,
        text=True, capture_output=True, timeout=25,
    )
    try:
        payload = json.loads(r.stdout)
    except ValueError as exc:
        raise AssertionError(f"CLI did not return JSON: {r.stdout} {r.stderr}") from exc
    return payload


class ReviewedGatesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        spec = importlib.util.spec_from_file_location("bthwani_prepare", SCRIPTS / "prepare-bthwani-speckit.py")
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        cls.prepare = staticmethod(module.prepare)

    def test_actual_workflow_graph_and_gates(self) -> None:
        with tempfile.TemporaryDirectory(prefix="speckit-review-", dir=ROOT / ".bthwani-local") as d:
            path = Path(d) / "reviewed.yml"
            name = path.relative_to(ROOT).as_posix()
            self.prepare(name)
            source = path.read_text(encoding="utf-8")
            data = yaml.safe_load(source)
            self.assertEqual(len(data["steps"]), 13)
            gates = [s for s in data["steps"] if s.get("type") == "gate"]
            self.assertEqual(len(gates), 4)
            for gate in gates:
                self.assertIn(gate["verdict_input"], data["inputs"])
                self.assertEqual(gate["on_reject"], "retry")
                self.assertEqual(data["inputs"][gate["verdict_input"]]["default"], "reject")
            self.prepare(name)
            self.assertEqual(path.read_text(encoding="utf-8"), source)
            for bad in (".specify/evil.yml", ".bthwani-local/../bad.yml", "C:/outside.yml"):
                with self.assertRaises(ValueError):
                    self.prepare(bad)

    def test_missing_review_pauses_and_resumes_exact_step(self) -> None:
        with tempfile.TemporaryDirectory(prefix="speckit-gate-", dir=ROOT / ".bthwani-local") as d:
            test_file = Path(d) / "two-gates.yml"
            test_data = {
                "schema_version": "1.0",
                "workflow": {"id": "bthwani-gate-regression", "name": "Review gate regression", "version": "1.0.0"},
                "inputs": {
                    "spec_approval": {"type": "string", "default": "reject"},
                    "plan_approval": {"type": "string", "default": "reject"},
                },
                "steps": [
                    {"id": "review-spec", "type": "gate", "message": "Spec gate test", "options": ["approve", "reject"], "verdict_input": "spec_approval", "on_reject": "retry"},
                    {"id": "review-plan", "type": "gate", "message": "Plan gate test", "options": ["approve", "reject"], "verdict_input": "plan_approval", "on_reject": "retry"},
                    {"id": "proof", "type": "shell", "run": "node --version", "strict": True},
                ],
            }
            test_file.write_text(yaml.safe_dump(test_data, sort_keys=False), encoding="utf-8")
            first = run_cli("run", str(test_file))
            self.assertEqual(first["status"], "paused")
            self.assertEqual(first["current_step_id"], "review-spec")
            run_id = first["run_id"]
            step2 = run_cli("resume", run_id, "--input", "spec_approval=approve")
            self.assertEqual(step2["status"], "paused")
            self.assertEqual(step2["current_step_id"], "review-plan")
            end = run_cli("resume", run_id, "--input", "plan_approval=approve")
            self.assertEqual(end["status"], "completed")
            status = run_cli("status", run_id)
            self.assertEqual(status["status"], "completed")
            self.assertEqual(set(status["steps"]), {"review-spec", "review-plan", "proof"})
            self.assertTrue(all(x == "completed" for x in status["steps"].values()))
            another = run_cli("run", str(test_file), "--input", "spec_approval=reject")
            self.assertEqual(another["status"], "paused")
            self.assertEqual(another["current_step_id"], "review-spec")


if __name__ == "__main__":
    unittest.main(verbosity=2)
