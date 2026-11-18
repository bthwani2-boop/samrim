import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dev.ps1");

test("the unified dev launcher and each embedded PowerShell block parse on Windows", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = scriptPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$tok=$null;$errors=$null",
    `$ast=[Management.Automation.Language.Parser]::ParseFile('${quoted}',[ref]$tok,[ref]$errors)`,
    "if($errors.Count){throw ('ROOT_PARSE '+($errors -join '|'))}",
    "$blocks=@($ast.FindAll({param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.StringConstantType.ToString() -eq 'SingleQuotedHereString'},$true))",
    "if($blocks.Count -lt 6){throw ('MISSING_EMBEDDED_BLOCKS '+$blocks.Count)}",
    "foreach($block in $blocks){$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseInput($block.Value,[ref]$t,[ref]$e);if($e.Count){throw ('EMBEDDED_PARSE '+($e -join '|'))}}",
    "Write-Output ('EMBEDDED_PARSE_PASS blocks='+$blocks.Count)",
  ].join("; ");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /EMBEDDED_PARSE_PASS blocks=\d+/);
});
