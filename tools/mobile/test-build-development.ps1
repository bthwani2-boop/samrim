#Requires -Version 7.4
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Import-Module -Name (Join-Path $PSScriptRoot "eas-credential-materialization.psm1") -Force

$TestRoot = Join-Path ([IO.Path]::GetTempPath()) ("samrim-eas-atomicity-" + [Guid]::NewGuid().ToString("N"))
$CredentialVaultPath = Join-Path $TestRoot "vault-credentials.json"
$KeystoreVaultPath = Join-Path $TestRoot "vault-development.jks"
$Credential = [pscustomobject]@{
    android = [pscustomobject]@{
        keystore = [pscustomobject]@{
            keystorePath = "development.jks"
            keystorePassword = "synthetic-keystore-password"
            keyAlias = "synthetic"
            keyPassword = "synthetic-key-password"
        }
    }
}

function Assert-True([bool] $Condition, [string] $Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Throws([string] $Name, [scriptblock] $Action) {
    $Threw = $false
    try { & $Action }
    catch { $Threw = $true }
    Assert-True $Threw "$Name did not fail closed"
}

function Assert-Absent([string[]] $Paths, [string] $Name) {
    foreach ($Path in $Paths) {
        Assert-True (-not (Test-Path -LiteralPath $Path)) "$Name left residue: $Path"
    }
}

New-Item -ItemType Directory -Path $TestRoot | Out-Null
try {
    [IO.File]::WriteAllText($CredentialVaultPath, '{"synthetic":"credential"}', [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllBytes($KeystoreVaultPath, [Text.Encoding]::UTF8.GetBytes("synthetic-keystore"))
    $VaultCredentialHash = (Get-FileHash -LiteralPath $CredentialVaultPath -Algorithm SHA256).Hash
    $VaultKeystoreHash = (Get-FileHash -LiteralPath $KeystoreVaultPath -Algorithm SHA256).Hash

    $Case1Credential = Join-Path $TestRoot "case1-credentials.json"
    $Case1Keystore = Join-Path $TestRoot "case1-development.jks"
    [IO.File]::WriteAllText($Case1Credential, "pre-existing-credential")
    $Case1Hash = (Get-FileHash -LiteralPath $Case1Credential -Algorithm SHA256).Hash
    Assert-Throws "pre-existing credentials.json" {
        New-EasCredentialMaterialization -KeystoreVaultPath $KeystoreVaultPath -MaterializedCredentialPath $Case1Credential -MaterializedKeystorePath $Case1Keystore -Credential $Credential
    }
    Assert-True ((Get-FileHash -LiteralPath $Case1Credential -Algorithm SHA256).Hash -eq $Case1Hash) "pre-existing credentials.json changed"
    Assert-Absent @($Case1Keystore) "pre-existing credentials.json case"
    Write-Host "EAS_ATOMICITY=PASS case=pre-existing-credentials"
    Remove-Item -LiteralPath $Case1Credential -Force

    $Case2Credential = Join-Path $TestRoot "case2-credentials.json"
    $Case2Keystore = Join-Path $TestRoot "case2-development.jks"
    [IO.File]::WriteAllText($Case2Keystore, "pre-existing-keystore")
    $Case2Hash = (Get-FileHash -LiteralPath $Case2Keystore -Algorithm SHA256).Hash
    Assert-Throws "pre-existing development.jks" {
        New-EasCredentialMaterialization -KeystoreVaultPath $KeystoreVaultPath -MaterializedCredentialPath $Case2Credential -MaterializedKeystorePath $Case2Keystore -Credential $Credential
    }
    Assert-True ((Get-FileHash -LiteralPath $Case2Keystore -Algorithm SHA256).Hash -eq $Case2Hash) "pre-existing development.jks changed"
    Assert-Absent @($Case2Credential) "pre-existing development.jks case"
    Write-Host "EAS_ATOMICITY=PASS case=pre-existing-keystore"
    Remove-Item -LiteralPath $Case2Keystore -Force

    $BlockedParent = Join-Path $TestRoot "blocked-parent"
    [IO.File]::WriteAllText($BlockedParent, "not-a-directory")
    $Case3Keystore = Join-Path $TestRoot "case3-development.jks"
    $Case3Credential = Join-Path $BlockedParent "credentials.json"
    Assert-Throws "failure after first materialization" {
        New-EasCredentialMaterialization -KeystoreVaultPath $KeystoreVaultPath -MaterializedCredentialPath $Case3Credential -MaterializedKeystorePath $Case3Keystore -Credential $Credential
    }
    Assert-Absent @($Case3Keystore, $Case3Credential) "failure after first materialization"
    Write-Host "EAS_ATOMICITY=PASS case=failure-after-first-materialization"
    Remove-Item -LiteralPath $BlockedParent -Force

    $Case4Credential = Join-Path $TestRoot "case4-credentials.json"
    $Case4Keystore = Join-Path $TestRoot "case4-development.jks"
    $FailingWriter = {
        param($Path, $Value)
        [IO.File]::WriteAllText($Path, "synthetic-credential-material")
        throw "synthetic credential writer failure"
    }
    Assert-Throws "failure after second materialization" {
        New-EasCredentialMaterialization -KeystoreVaultPath $KeystoreVaultPath -MaterializedCredentialPath $Case4Credential -MaterializedKeystorePath $Case4Keystore -Credential $Credential -CredentialWriter $FailingWriter
    }
    Assert-Absent @($Case4Credential, $Case4Keystore) "failure after second materialization"
    Write-Host "EAS_ATOMICITY=PASS case=failure-after-second-materialization"

    $Case5Credential = Join-Path $TestRoot "case5-credentials.json"
    $Case5Keystore = Join-Path $TestRoot "case5-development.jks"
    $Case5Materialization = New-EasCredentialMaterialization -KeystoreVaultPath $KeystoreVaultPath -MaterializedCredentialPath $Case5Credential -MaterializedKeystorePath $Case5Keystore -Credential $Credential
    try { throw "synthetic downstream EAS failure" }
    catch { }
    finally { Remove-EasCredentialMaterialization -Materialization $Case5Materialization }
    Assert-Absent @($Case5Credential, $Case5Keystore) "downstream EAS failure"
    Write-Host "EAS_ATOMICITY=PASS case=downstream-failure"

    foreach ($Outcome in @("success", "reuse", "submission")) {
        $CredentialPath = Join-Path $TestRoot ("case6-" + $Outcome + "-credentials.json")
        $KeystorePath = Join-Path $TestRoot ("case6-" + $Outcome + "-development.jks")
        $Materialization = New-EasCredentialMaterialization -KeystoreVaultPath $KeystoreVaultPath -MaterializedCredentialPath $CredentialPath -MaterializedKeystorePath $KeystorePath -Credential $Credential
        try { }
        finally { Remove-EasCredentialMaterialization -Materialization $Materialization }
        Assert-Absent @($CredentialPath, $KeystorePath) "normal $Outcome exit"
        Write-Host "EAS_ATOMICITY=PASS case=normal-$Outcome-exit"
    }

    Assert-True ((Get-FileHash -LiteralPath $CredentialVaultPath -Algorithm SHA256).Hash -eq $VaultCredentialHash) "credential vault input changed"
    Assert-True ((Get-FileHash -LiteralPath $KeystoreVaultPath -Algorithm SHA256).Hash -eq $VaultKeystoreHash) "keystore vault input changed"
    Assert-Absent @($CredentialVaultPath.Replace("vault-credentials.json", "credentials.json"), $KeystoreVaultPath.Replace("vault-development.jks", "development.jks")) "repository materialization"
    Write-Host "EAS_VAULT_INPUTS=PASS external-inputs-unchanged=true"
    Write-Host "EAS_CREDENTIAL_ATOMICITY=PASS cases=9"
}
finally {
    if (Test-Path -LiteralPath $TestRoot) { Remove-Item -LiteralPath $TestRoot -Recurse -Force }
}
