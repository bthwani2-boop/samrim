[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'Start-BrowserAutomation.ps1'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -gt 0) { throw 'BROWSER_AUTOMATION_SCRIPT_INVALID' }
$function = $ast.Find({
    param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -eq 'Test-ExactBrowserProfile'
}, $true)
if (-not $function) { throw 'BROWSER_PROFILE_GUARD_MISSING' }
Invoke-Expression $function.Extent.Text

$profile = 'C:\Users\Tester\AppData\Local\BThwani\BrowserAutomation\Chrome'
$cases = @(
    @{ Cmd = ('chrome.exe --user-data-dir="' + $profile + '" --remote-debugging-port=9222'); Expected = $true },
    @{ Cmd = ('chrome.exe --user-data-dir=' + $profile + ' --remote-debugging-port=9222'); Expected = $true },
    @{ Cmd = ('chrome.exe --user-data-dir="' + $profile + '-old" --remote-debugging-port=9222'); Expected = $false },
    @{ Cmd = ('chrome.exe --user-data-dir="' + $profile + '\SubDir"'); Expected = $false },
    @{ Cmd = ('chrome.exe --about="' + $profile + '"'); Expected = $false },
    @{ Cmd = ('chrome.exe --user-data-dir="' + $profile + '"-suffix'); Expected = $false },
    @{ Cmd = ('chrome.exe --user-data-dir="' + $profile + '" --user-data-dir="' + $profile + '-other"'); Expected = $false }
)
foreach ($case in $cases) {
    $actual = Test-ExactBrowserProfile -CommandLine $case.Cmd -ProfileDir $profile
    if ($actual -ne $case.Expected) {
        throw "BROWSER_PROFILE_MATCH_FAILED expected=$($case.Expected) actual=$actual"
    }
}
$text = [IO.File]::ReadAllText($source)
if (-not $text.Contains('while (-not $ready -and $deadline.Elapsed -lt [TimeSpan]::FromSeconds(25))') -or
    -not $text.Contains("CDP_NOT_READY:") -or
    -not $text.Contains('if (-not $ready) { throw')) {
    throw 'BROWSER_CDP_TIMEOUT_GUARD_MISSING'
}
Write-Output "BROWSER_PROFILE_AND_CDP_POLLING=PASS cases=$($cases.Count)"
