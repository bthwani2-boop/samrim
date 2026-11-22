import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dev.ps1");

test("the Android Expo manifest check identifies the native platform", () => {
  const opener = readFileSync(new URL("./open-dev-apps.ps1", import.meta.url), "utf8");
  assert.match(opener, /'Expo-Platform: '\s*\+\s*\$platform/);
  assert.match(opener, /\$manifest=Probe[^\r\n]*'application\/expo\+json'\s+'android'/);
});

test("Chrome reuses the intended customer, merchant and operator tabs when Expo shows a URL title", () => {
  const opener = readFileSync(new URL("./open-dev-apps.ps1", import.meta.url), "utf8");
  const expected = opener.match(/\$expected=@\(([\s\S]*?)\r?\n\s*\)/);
  assert.ok(expected, "Chrome tab signatures must be declared");
  const patterns = [...expected[1].matchAll(/'([^']+)'/g)]
    .map(([, source]) => new RegExp(source.replace(/^\(\?i\)/, ""), "i"));
  assert.equal(patterns.length, 3);

  const validTitles = [
    "127.0.0.1:18101 - Memory usage - 30 MB",
    "بثواني — التاجر",
    "بثواني — لوحة التحكم",
  ];
  for (let i = 0; i < patterns.length; i++) {
    assert.match(validTitles[i], patterns[i]);
    assert.doesNotMatch(validTitles[(i + 1) % patterns.length], patterns[i]);
  }
  assert.match("بثواني — الرئيسية", patterns[0]);
  assert.match("127.0.0.1:18102", patterns[1]);
  assert.match("127.0.0.1:13000", patterns[2]);
});

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


test("the app verifier detects missing workspace dependency links", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /APP_WORKSPACE_LINK_MISSING/);
  assert.ok(launcher.includes("workspace:*"));
  assert.ok(launcher.includes("Test-Path -LiteralPath $dependencyPackage -PathType Leaf"));
});

test("the Merchant launcher preserves existing Windows task identities", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /N='BThwani Partner Metro Native';A='merchant'/);
  assert.match(launcher, /A='merchant';N='BThwani Partner Metro Native'/);
  assert.match(launcher, /'merchant'=@\{N='BThwani Partner Metro Native'/);
  assert.doesNotMatch(launcher, /BThwani Merchant Metro Native/);
});
