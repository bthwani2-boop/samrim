#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

function Get-GitScalar([string[]] $Arguments) {
    $value = (& git @Arguments | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
    }
    return $value
}

function Get-NonCanonicalWorktreeEol {
    $lines = @(& git ls-files --eol)
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect tracked working-tree EOL state."
    }

    return @(
        $lines | Where-Object { $_ -match '\bw/(crlf|mixed)\b' }
    )
}

function Get-EolRecordPath([string] $Record) {
    $tab = $Record.IndexOf("`t")
    if ($tab -lt 0) {
        throw "Unable to parse git ls-files --eol record: $Record"
    }
    return $Record.Substring($tab + 1)
}

function Write-ExactIndexBlobToWorktree([string] $File, [string] $IndexHash) {
    $nativePath = $File.Replace("/", [IO.Path]::DirectorySeparatorChar)
    $destination = Join-Path $repo $nativePath
    $directory = Split-Path -Parent $destination
    $temporary = Join-Path $directory (".bthwani-eol-" + [Guid]::NewGuid().ToString("N") + ".tmp")

    $processInfo = [Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = "git"
    $processInfo.WorkingDirectory = $repo
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $null = $processInfo.ArgumentList.Add("cat-file")
    $null = $processInfo.ArgumentList.Add("blob")
    $null = $processInfo.ArgumentList.Add($IndexHash)

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $processInfo
    $stream = $null

    try {
        if (-not $process.Start()) {
            throw "Unable to start git cat-file for $File."
        }

        $stderrTask = $process.StandardError.ReadToEndAsync()

        $stream = [IO.File]::Open(
            $temporary,
            [IO.FileMode]::CreateNew,
            [IO.FileAccess]::Write,
            [IO.FileShare]::None
        )

        $process.StandardOutput.BaseStream.CopyTo($stream)
        $stream.Dispose()
        $stream = $null

        $process.WaitForExit()
        $stderr = $stderrTask.GetAwaiter().GetResult().Trim()

        if ($process.ExitCode -ne 0) {
            throw "git cat-file failed for ${File}: $stderr"
        }

        $temporaryHash = Get-GitScalar @("hash-object", "--no-filters", "--", $temporary)
        if ($temporaryHash -ne $IndexHash) {
            throw "Exact index-blob materialization hash mismatch for $File."
        }

        Move-Item -LiteralPath $temporary -Destination $destination -Force
    }
    finally {
        if ($null -ne $stream) {
            $stream.Dispose()
        }
        $process.Dispose()
        if (Test-Path -LiteralPath $temporary) {
            Remove-Item -LiteralPath $temporary -Force
        }
    }
}

function Ensure-CanonicalRepositoryGitCheckout {
    git config --local core.autocrlf false
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to set repository-local core.autocrlf=false."
    }

    git config --local core.safecrlf true
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to set repository-local core.safecrlf=true."
    }

    $bad = @(Get-NonCanonicalWorktreeEol)
    if ($bad.Count -eq 0) {
        Write-Host "REPOSITORY_GIT_EOL=PASS"
        return
    }

    foreach ($record in $bad) {
        if ($record -notmatch '\battr/.*\beol=lf\b') {
            throw "Tracked CRLF/mixed path is not governed by eol=lf: $record"
        }

        $file = Get-EolRecordPath $record
        $workHash = Get-GitScalar @("hash-object", "--path=$file", "--", $file)
        $indexHash = Get-GitScalar @("rev-parse", ":$file")

        if ($workHash -ne $indexHash) {
            throw "Refusing to overwrite semantic working-tree change while repairing EOL: $file"
        }
    }

    foreach ($record in $bad) {
        $file = Get-EolRecordPath $record
        $indexHash = Get-GitScalar @("rev-parse", ":$file")
        Write-ExactIndexBlobToWorktree -File $file -IndexHash $indexHash
    }

    git update-index --refresh
    if ($LASTEXITCODE -ne 0) {
        throw "Git index stat refresh failed after EOL materialization."
    }

    $remaining = @(Get-NonCanonicalWorktreeEol)
    if ($remaining.Count -gt 0) {
        throw "Tracked CRLF/mixed paths remain after exact index-blob materialization."
    }

    Write-Host "REPOSITORY_GIT_EOL=PASS"
}

Push-Location $repo
try {
    Ensure-CanonicalRepositoryGitCheckout

    & (Join-Path $PSScriptRoot "ensure-local-env.ps1")

    if (-not (Test-Path "pnpm-lock.yaml")) {
        throw "pnpm-lock.yaml is missing; generate and commit it before normal bootstrap."
    }

    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    go work sync
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host "Bootstrap PASS"
}
finally {
    Pop-Location
}
