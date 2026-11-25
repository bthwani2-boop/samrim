# Surface is the only project source. Lenovo is an SSH-controlled execution host.
# This script does not configure RDP, UAC, Defender, firewall, SSH keys, sync tasks or Git.
[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [ValidateSet('Check','Run','Upload','Download','Install')][string]$Action='Check',
    [string]$Command,
    [string]$LocalPath,
    [string]$RemotePath,
    [string]$PackageId,
    [switch]$Recursive,
    [ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._-]*$')][string]$SshHost='bthwani-docker'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ($env:COMPUTERNAME -ine 'BTHWANI') { throw 'Run on Surface (BTHWANI) only.' }
# Match the existing tunnel, source-sync and unified dev owners. Never select
# a second OpenSSH installation through a caller-specific PATH.
$sshClient = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$scpClient = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
foreach ($client in @($sshClient,$scpClient)) {
    if (-not (Test-Path -LiteralPath $client -PathType Leaf)) { throw ('Canonical OpenSSH client missing on Surface: ' + $client) }
}
$scpOptions=@('-B','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ConnectionAttempts=1')
function Invoke-Lenovo([string]$body) {
    $wrapped = @'
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if ($env:COMPUTERNAME -ine 'BTHWANI-DOCKER') { throw 'SSH target is not the expected Lenovo.' }
try {
& {
'@ + [Environment]::NewLine + $body + [Environment]::NewLine + @'
}
if ($null -ne $global:LASTEXITCODE -and $global:LASTEXITCODE -ne 0) {
  throw ('Remote native exit code ' + $global:LASTEXITCODE)
}
} catch {
    [Console]::Error.WriteLine('REMOTE_FAILURE: ' + $_.Exception.Message)
    exit 1
}
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($wrapped))
    if ($encoded.Length -gt 14000) { throw 'Command too long; transfer a script to Lenovo as an explicit runtime artifact.' }
    & $sshClient -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 -o ConnectionAttempts=1 $SshHost pwsh.exe -NoProfile -NonInteractive -EncodedCommand $encoded
    if ($LASTEXITCODE -ne 0) { throw ('SSH or remote command failed: exit=' + $LASTEXITCODE) }
}
function Assert-RemotePath([string]$p) {
    if ($p -notmatch '^[A-Za-z]:[\\/]') { throw 'RemotePath must be absolute, e.g. C:\Users\bthwa\BThwaniAppRunner\incoming' }
}
function Get-RemoteFileHash([string]$path) {
    $literal=$path.Replace("'","''")
    $lines=@(Invoke-Lenovo "(Get-FileHash -LiteralPath '$literal' -Algorithm SHA256).Hash")
    if ($lines.Count -ne 1 -or $lines[0] -notmatch '^[A-Fa-f0-9]{64}$') { throw 'Invalid remote SHA256 result.' }
    return $lines[0]
}
function Assert-RemoteDirectory([string]$path) {
    $literal=$path.Replace("'","''")
    Invoke-Lenovo "if (-not (Test-Path -LiteralPath '$literal' -PathType Container)) { throw 'Remote directory does not exist.' }"
}
function Assert-FileHash([string]$path,[string]$expected) {
    $actual=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
    if ($actual -ine $expected) { throw 'SHA256 verification failed after transfer.' }
    return $actual
}
switch ($Action) {
    'Check' {
        Write-Output ('SURFACE=' + $env:COMPUTERNAME)
        Write-Output ('SOURCE_D_SAMRIM=' + (Test-Path -LiteralPath 'D:\samrim'))
        $t=Get-ScheduledTask -TaskName 'BThwani Lenovo Source Sync' -ErrorAction SilentlyContinue
        Write-Output ('SYNC_TASK=' + $(if($t){[string]$t.State}else{'NOT_FOUND'}))
        $remote=@'
Write-Output ('LENOVO=' + $env:COMPUTERNAME)
Write-Output ('USER=' + (whoami))
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
Write-Output ('ADMIN=' + $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
$s=Get-CimInstance Win32_Service -Filter "Name='sshd'"
Write-Output ('SSHD=' + $s.State + '; START=' + $s.StartMode)
foreach($n in @('ssh.exe','scp.exe','sftp.exe','docker.exe','node.exe','git.exe','pnpm','winget.exe')){
 $found=Get-Command $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
 Write-Output ($n + '=' + $(if($found){$found.Source}else{'NOT_IN_SSH_PATH'}))
}
'@
        Invoke-Lenovo $remote
        foreach($port in @(18101,18102,18103,13000)){
            $listeners=@(Get-NetTCPConnection -State Listen -LocalAddress 127.0.0.1 -LocalPort $port -ErrorAction SilentlyContinue)
            Write-Output ('SURFACE_TUNNEL_127.0.0.1:'+$port+'='+$listeners.Count)
        }
    }
    'Run' {
        if ([string]::IsNullOrWhiteSpace($Command)) { throw 'Run requires -Command.' }
        if ($PSCmdlet.ShouldProcess($SshHost,'Execute explicit remote PowerShell command')) {
            Invoke-Lenovo $Command
        }
    }
    'Upload' {
        if ([string]::IsNullOrWhiteSpace($LocalPath)) { throw 'Upload requires -LocalPath.' }
        Assert-RemotePath $RemotePath
        $source=(Resolve-Path -LiteralPath $LocalPath -ErrorAction Stop).ProviderPath
        $item=Get-Item -LiteralPath $source
        if ($item.PSIsContainer -and -not $Recursive) { throw 'Uploading a folder requires -Recursive.' }
        $destination=$SshHost+':'+$RemotePath.Replace('\','/')
        if ($PSCmdlet.ShouldProcess($destination,'SCP upload '+$source)) {
            # Verify the authorized host and destination before any remote write.
            Assert-RemoteDirectory $RemotePath
            $args=@($scpOptions)
            if($item.PSIsContainer){$args+='-r'}
            $args+=@($source,$destination)
            & $scpClient @args
            if($LASTEXITCODE -ne 0){throw('SCP upload failed, exit '+$LASTEXITCODE)}
            if(-not $item.PSIsContainer){
                $fullRemote=$RemotePath.TrimEnd('\','/')+'\'+$item.Name
                $localHash=Assert-FileHash $source (Get-RemoteFileHash $fullRemote)
                Write-Output ('UPLOAD_PASS SHA256='+$localHash)
            }else{Write-Output 'UPLOAD_COMPLETE: recursive directory checksum verification NOT_RUN'}
        }
    }
    'Download' {
        Assert-RemotePath $RemotePath
        if ([string]::IsNullOrWhiteSpace($LocalPath)) { throw 'Download requires -LocalPath pointing to an existing Surface directory.' }
        $dest=(Resolve-Path -LiteralPath $LocalPath -ErrorAction Stop).ProviderPath
        if (-not (Test-Path -LiteralPath $dest -PathType Container)) { throw 'LocalPath must be a directory.' }
        $source=$SshHost+':'+$RemotePath.Replace('\','/')
        if ($PSCmdlet.ShouldProcess($dest,'SCP download '+$source)) {
            if($Recursive){Assert-RemoteDirectory $RemotePath}
            else{$expected=Get-RemoteFileHash $RemotePath}
            $args=@($scpOptions)
            if($Recursive){$args+='-r'}
            $args+=@($source,$dest)
            & $scpClient @args
            if($LASTEXITCODE -ne 0){throw('SCP download failed, exit '+$LASTEXITCODE)}
            if($Recursive){Write-Output 'DOWNLOAD_COMPLETE: recursive directory checksum verification NOT_RUN'}
            else{
                $downloaded=Join-Path $dest ([IO.Path]::GetFileName($RemotePath))
                $localHash=Assert-FileHash $downloaded $expected
                Write-Output ('DOWNLOAD_PASS SHA256='+$localHash)
            }
        }
    }
    'Install' {
        if($PackageId -notmatch '^[A-Za-z0-9._+-]+$'){ throw 'Install requires a valid exact -PackageId (winget).' }
        $remote=@'
$installer=Get-Command winget.exe -ErrorAction Stop
& $installer.Source install --id '__PACKAGE__' --exact --source winget --accept-package-agreements --accept-source-agreements
if($LASTEXITCODE -ne 0){ throw ('winget failed: ' + $LASTEXITCODE) }
Write-Output 'WINGET_COMMAND_PASS'
'@
        $remote=$remote.Replace('__PACKAGE__',$PackageId)
        if($PSCmdlet.ShouldProcess($SshHost,'winget install --id '+$PackageId)) {
            Invoke-Lenovo $remote
            Write-Output 'Verify the installed executable in a new SSH session.'
        }
    }
}
