#Requires -Version 7.4
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidateSet('Up','Down','Restart','Status','Logs','Doctor','Reset','Purge','Control','Rebuild','RestartService','LogsService','Surface')]
    [string]$Action,
    [string]$Service = '',
    [ValidateSet('client','partner','captain','field')]
    [string]$Surface = '',
    [switch]$AllowDataLoss
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RuntimeModule = Join-Path $PSScriptRoot 'runtime.psm1'
Import-Module -Name $RuntimeModule -Force -WarningAction SilentlyContinue
Invoke-SamrimRuntime @PSBoundParameters
