[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $env:TEMP 'GoogleCloudSDKInstaller.exe'),
    [switch]$Force
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($env:TEMP)) {
    throw 'The TEMP environment variable is not set.'
}

$resolvedOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutputPath

if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}

if ((Test-Path -LiteralPath $resolvedOutputPath) -and -not $Force) {
    throw "File already exists: $resolvedOutputPath. Pass -Force to replace it."
}

$downloadUrl = 'https://dl.google.com/dl/cloudsdk/channels/rapid/GoogleCloudSDKInstaller.exe'
$partialPath = Join-Path $outputDirectory ".GoogleCloudSDKInstaller.$([guid]::NewGuid().ToString('N')).download"

try {
    Invoke-WebRequest -Uri $downloadUrl -OutFile $partialPath -UseBasicParsing

    $signature = Get-AuthenticodeSignature -FilePath $partialPath
    if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
        throw "Downloaded installer signature is not valid (status: $($signature.Status))."
    }

    if ($signature.SignerCertificate.Subject -notmatch '(?i)(^|,\s*)CN=Google LLC(,|$)') {
        throw "Downloaded installer is not signed by Google LLC (signer: $($signature.SignerCertificate.Subject))."
    }

    Move-Item -LiteralPath $partialPath -Destination $resolvedOutputPath -Force:$Force
    Write-Output "Google Cloud CLI installer downloaded and signature verified: $resolvedOutputPath"
}
finally {
    if (Test-Path -LiteralPath $partialPath) {
        Remove-Item -LiteralPath $partialPath -Force
    }
}
