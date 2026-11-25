import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const helperPath = fileURLToPath(new URL("./Control-Lenovo-SSH.ps1", import.meta.url));
const source = readFileSync(helperPath, "utf8");

test("manual SCP checks host and transfer integrity in both directions", () => {
  const upload = source.slice(source.indexOf("    'Upload' {"), source.indexOf("    'Download' {"));
  const download = source.slice(source.indexOf("    'Download' {"), source.indexOf("    'Install' {"));
  assert.match(upload, /Assert-RemoteDirectory \$RemotePath[\s\S]*?& \$scpClient @args[\s\S]*?Assert-FileHash \$source \(Get-RemoteFileHash \$fullRemote\)/);
  assert.match(download, /Get-RemoteFileHash \$RemotePath[\s\S]*?& \$scpClient @args[\s\S]*?Assert-FileHash \$downloaded \$expected[\s\S]*?DOWNLOAD_PASS SHA256=/);
  assert.match(download, /recursive directory checksum verification NOT_RUN/);
  assert.match(upload, /recursive directory checksum verification NOT_RUN/);
});

test("actual PowerShell hash guards reject mismatch, ambiguous remote output and option-like host", {
  skip: process.platform !== "win32",
}, () => {
  const quoted = helperPath.replaceAll("'", "''");
  const ps = [
    "$ErrorActionPreference='Stop'",
    "$tokens=$null;$errors=$null",
    "$ast=[Management.Automation.Language.Parser]::ParseFile('" + quoted + "',[ref]$tokens,[ref]$errors)",
    "if($errors.Count){throw 'HELPER_PARSE_FAILED'}",
    "foreach($name in @('Assert-FileHash','Get-RemoteFileHash','Assert-RemoteDirectory')){$fn=$ast.Find({param($n)$n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name},$true);if(!$fn){throw ('MISSING_FUNCTION '+$name)};. ([scriptblock]::Create($fn.Extent.Text))}",
    "function ExpectFailure([scriptblock]$body,[string]$expected){try{& $body|Out-Null}catch{if($_.Exception.Message -notmatch [regex]::Escape($expected)){throw};return};throw ('EXPECTED_FAILURE_MISSING '+$expected)}",
    "function Invoke-Lenovo([string]$body){$script:remoteBody=$body;if($script:remoteFailure){throw 'remote missing'};$script:remoteOutput}",
    "$dir=Join-Path ([IO.Path]::GetTempPath()) ('bthwani-ssh-test-'+[guid]::NewGuid().ToString('N'))",
    "New-Item -ItemType Directory -Path $dir|Out-Null",
    "try{$file=Join-Path $dir 'file with space.bin';[IO.File]::WriteAllBytes($file,[byte[]](0..255));$hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash;if((Assert-FileHash $file $hash) -cne $hash){throw 'MATCH_REJECTED'};ExpectFailure {Assert-FileHash $file ('0'*64)} 'SHA256 verification failed';$script:remoteFailure=$false;$script:remoteOutput=@($hash);$remote='C:\\fixture\\file'+[char]39+'s.bin';if((Get-RemoteFileHash $remote) -cne $hash){throw 'REMOTE_HASH_REJECTED'};if(!$script:remoteBody.Contains(([string][char]39)+[char]39)){throw 'REMOTE_LITERAL_NOT_ESCAPED'};$script:remoteOutput=@($hash,$hash);ExpectFailure {Get-RemoteFileHash $remote} 'Invalid remote SHA256 result';$script:remoteOutput=@('not-a-hash');ExpectFailure {Get-RemoteFileHash $remote} 'Invalid remote SHA256 result';$script:remoteOutput=@();ExpectFailure {Get-RemoteFileHash $remote} 'Invalid remote SHA256 result';$script:remoteFailure=$true;ExpectFailure {Assert-RemoteDirectory 'C:\\fixture'} 'remote missing';$rejected=$false;try{& '" + quoted + "' -Action Run -SshHost '-F' -Command 'hostname' -WhatIf}catch [System.Management.Automation.ParameterBindingException]{$rejected=$true};if(!$rejected){throw 'OPTION_LIKE_HOST_ACCEPTED'}}finally{Remove-Item -LiteralPath $dir -Recurse -Force}",
    "Write-Output 'HASH_AND_REMOTE_GUARDS_PASS'",
  ].join("; ");
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  const result = spawnSync("pwsh.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
    encoding: "utf8", timeout: 15000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error));
  assert.match(result.stdout, /HASH_AND_REMOTE_GUARDS_PASS/);
});
