#Requires -Version 7.4

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-CredentialMaterial([string] $Path, $Value) {
    $Json = $Value | ConvertTo-Json -Depth 20
    [IO.File]::WriteAllText($Path, $Json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
}

function New-OwnedFile([string] $Path) {
    $Stream = $null
    try {
        $Stream = [IO.File]::Open($Path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    }
    finally {
        if ($null -ne $Stream) { $Stream.Dispose() }
    }
}

function Remove-EasCredentialMaterialization([psobject] $Materialization) {
    $Failures = @()
    foreach ($Entry in @(
        @{ Path = [string]$Materialization.CredentialPath; Owned = [bool]$Materialization.OwnsCredential },
        @{ Path = [string]$Materialization.KeystorePath; Owned = [bool]$Materialization.OwnsKeystore }
    )) {
        if (-not $Entry.Owned -or -not (Test-Path -LiteralPath $Entry.Path)) { continue }
        try {
            Remove-Item -LiteralPath $Entry.Path -Force -ErrorAction Stop
        }
        catch {
            $Failures += "$($Entry.Path): $($_.Exception.Message)"
        }
    }
    if ($Failures.Count -gt 0) {
        throw "Unable to remove owned EAS materialization: $($Failures -join '; ')"
    }
}

function New-EasCredentialMaterialization {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string] $KeystoreVaultPath,
        [Parameter(Mandatory = $true)]
        [string] $MaterializedCredentialPath,
        [Parameter(Mandatory = $true)]
        [string] $MaterializedKeystorePath,
        [Parameter(Mandatory = $true)]
        $Credential,
        [scriptblock] $CredentialWriter
    )

    foreach ($Destination in @($MaterializedCredentialPath, $MaterializedKeystorePath)) {
        if (Test-Path -LiteralPath $Destination) {
            throw "Refusing to overwrite pre-existing EAS material: $Destination"
        }
    }

    $Materialization = [pscustomobject]@{
        CredentialPath = $MaterializedCredentialPath
        KeystorePath = $MaterializedKeystorePath
        OwnsCredential = $false
        OwnsKeystore = $false
    }

    try {
        New-OwnedFile -Path $MaterializedKeystorePath
        $Materialization.OwnsKeystore = $true
        [IO.File]::WriteAllBytes($MaterializedKeystorePath, [IO.File]::ReadAllBytes($KeystoreVaultPath))

        New-OwnedFile -Path $MaterializedCredentialPath
        $Materialization.OwnsCredential = $true
        if ($null -ne $CredentialWriter) {
            & $CredentialWriter $MaterializedCredentialPath $Credential
        }
        else {
            Write-CredentialMaterial -Path $MaterializedCredentialPath -Value $Credential
        }

        return $Materialization
    }
    catch {
        if ($Materialization.OwnsCredential -or $Materialization.OwnsKeystore) {
            Remove-EasCredentialMaterialization -Materialization $Materialization
        }
        throw
    }
}

Export-ModuleMember -Function New-EasCredentialMaterialization, Remove-EasCredentialMaterialization
