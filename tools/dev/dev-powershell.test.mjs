import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "dev.ps1");

test("opening Chrome and Android is owned by the single dev launcher", () => {
  assert.equal(existsSync(new URL("./open-dev-apps.ps1", import.meta.url)), false);
});

test("the Android Expo manifest check identifies the native platform", () => {
  const opener = readFileSync(scriptPath, "utf8");
  assert.match(opener, /'Expo-Platform: '\s*\+\s*\$platform/);
  assert.match(opener, /\$manifest=Probe[^\r\n]*'application\/expo\+json'\s+'android'/);
  assert.doesNotMatch(opener, /Start-Sleep -Seconds 3/);
});

test("Chrome reuses the intended customer, merchant and operator tabs when Expo shows a URL title", () => {
  const opener = readFileSync(scriptPath, "utf8");
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
  assert.match(opener, /\$tabs\.Count -lt 3/);
  assert.match(opener, /foreach\(\$signature in \$expected\)/);
  assert.match(opener, /\$matched\.Count -eq \$expected\.Count/);
  assert.doesNotMatch(opener, /bthwani2@gmail\.com/);
});

test("Operator opens at the exact WebAuthn localhost origin and reports auth readiness separately", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /'http:\/\/localhost:13000\/'/);
  assert.match(launcher, /function Show-OperatorAuthReadiness\b/);
  assert.match(launcher, /'http:\/\/localhost:13000\/api\/auth\/session'/);
  assert.match(launcher, /'OPERATOR_AUTH'/);
  assert.match(launcher, /'launch'\s*\{[\s\S]*?Open-AppSurfaces\s+Show-OperatorAuthReadiness/);
});

test("one dev command opens existing app surfaces after the owner tasks are ready", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /function Open-AppSurfaces\b/);
  assert.match(launcher, /\[string\]\$Action = 'Launch'/);
  const fastPath = launcher.match(/'launch'\s*\{([\s\S]*?)\n\s*break/);
  assert.ok(fastPath, "default launch action must be present");
  assert.match(fastPath[1], /Check-Ssh[\s\S]*?Start-LocalTasks[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces/);
  assert.doesNotMatch(fastPath[1], /Docker|Start-Base|Show-Docker|Assert-Compose/);
  assert.match(launcher, /'up'\s*\{[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces[\s\S]*?break/);
  assert.match(launcher, /'warm'\s*\{[\s\S]*?Start-LenovoTasks[\s\S]*?Open-AppSurfaces[\s\S]*?break/);
  assert.match(launcher, /if\s*\(\$DockerAction -eq 'open'\)\s*\{Open-AppSurfaces;Show-OperatorAuthReadiness;return\}/);
  assert.match(launcher, /if\s*\(\$selection -eq 'All'\)/);
  assert.match(launcher, /'SAMSUNG' 'SKIPPED/);
});

test("read-only diagnostics do not monopolize the global app lifecycle mutex", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  assert.match(launcher, /\$readOnlyOperation\s*=/);
  assert.match(launcher, /'status','verify','logs','android'/);
  assert.match(launcher, /if\s*\(-not\s+\$readOnlyOperation\)\s*\{/);
});

test("an offline Lenovo fails quickly without weakening SSH host-key checks", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const check = launcher.match(/function Check-Ssh \{([\s\S]*?)\n\}/);
  assert.ok(check);
  assert.match(check[1], /ConnectAsync/);
  assert.match(check[1], /\.Wait\(2000\)/);
  assert.match(check[1], /StrictHostKeyChecking=yes/);
});

test("the existing package script replaces the obsolete self-install branch", () => {
  const launcher = readFileSync(scriptPath, "utf8");
  const root = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(root.scripts.dev, "pwsh -NoProfile -File tools/dev/dev.ps1");
  assert.doesNotMatch(launcher, /function Install-CLI/);
  assert.doesNotMatch(launcher, /'install'\s*\{\s*Install-CLI/);
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
    "foreach($block in $blocks){if($block.Value.TrimStart().StartsWith('using System;')){if($block.Value -notmatch 'BthwaniChromeWindowLocator'){throw 'CHROME_CSHARP_BLOCK_CHANGED'};continue};$t=$null;$e=$null;[void][Management.Automation.Language.Parser]::ParseInput($block.Value,[ref]$t,[ref]$e);if($e.Count){throw ('EMBEDDED_PARSE '+($e -join '|'))}}",
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
