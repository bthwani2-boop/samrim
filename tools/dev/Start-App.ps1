#Requires -Version 5.1
param(
  [Parameter(Mandatory=$true)]
  [ValidateSet('customer','merchant','captain','control-panel')]
  [string]$App,
  [switch]$Surface,
  [ValidateRange(1024,65535)]
  [int]$IdentityPort=23201,
  [ValidateRange(1024,65535)]
  [int]$DshPort=23202,
  [switch]$EnableAndroidWalletPreview,
  [ValidateRange(1024,65535)]
  [int]$WltPort=23203,
  [switch]$EnableDockerWalletWebPreview,
  [switch]$EnableDockerCartWebPreview,
  [switch]$EnableDockerCustomerAndroidIdentityPreview,
  [switch]$EnableIsolatedOperatorPasskeyPreview,
  [switch]$EnableIsolatedRootBootstrap,
  [switch]$UseDisposableOperatorSandbox
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
if ($EnableAndroidWalletPreview -and (!$Surface -or $App -ne 'customer')) {
  throw 'NATIVE_WALLET_PREVIEW_REQUIRES_SURFACE_CUSTOMER'
}
if ($EnableDockerWalletWebPreview -and ($Surface -or $App -ne 'customer' -or $EnableAndroidWalletPreview)) {
  throw 'DOCKER_WALLET_WEB_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY'
}
if ($EnableDockerCartWebPreview -and ($Surface -or $App -ne 'customer' -or $EnableAndroidWalletPreview)) {
  throw 'DOCKER_CART_WEB_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY'
}
if ($EnableDockerCustomerAndroidIdentityPreview -and ($Surface -or $App -ne 'customer')) {
  throw 'DOCKER_ANDROID_IDENTITY_PREVIEW_REQUIRES_LENOVO_CUSTOMER_ONLY'
}
Remove-Item Env:EXPO_PUBLIC_BTHWANI_LENOVO_CUSTOMER_ANDROID_PREVIEW -ErrorAction SilentlyContinue
Remove-Item Env:BTHWANI_DOCKER_CART_WEB_PREVIEW -ErrorAction SilentlyContinue
Remove-Item Env:OPERATOR_FINANCE_WLT_ORIGIN -ErrorAction SilentlyContinue

# The launcher owns a job that terminates its Node process tree on exit.
function Invoke-OwnedAppProcess {
  param([string]$Executable,[string[]]$Arguments,[string]$WorkingDirectory,[string]$Stdout,[string]$Stderr)
  if (-not ('OwnedAppJob' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class OwnedAppJob {
 [StructLayout(LayoutKind.Sequential)] struct Basic {
  public long ProcessTime, JobTime; public uint Flags;
  public UIntPtr Min, Max; public uint Active; public UIntPtr Affinity; public uint Priority, Schedule;
 }
 [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct Limits {
  public Basic Basic; public Io Io; public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
 }
 [StructLayout(LayoutKind.Sequential)] struct Security {
  public int Length; public IntPtr Descriptor; public int Inherit;
 }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
  public uint Size; public string Reserved, Desktop, Title;
  public uint X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
  public ushort Show, ReservedSize; public IntPtr Reserved2, Input, Output, Error;
 }
 [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Startup; public IntPtr Attributes; }
 [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,uint size);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string file,uint access,uint share,ref Security security,uint creation,uint flags,IntPtr template);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr environment,string cwd,ref StartupEx startup,out ProcessInfo process);
 [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static void Check(bool ok,string name) { if(!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), name+" failed"); }
 static void Close(IntPtr h) { if(h!=IntPtr.Zero && h!=new IntPtr(-1)) CloseHandle(h); }
 static string Quote(string s) {
  StringBuilder b=new StringBuilder("\""); int slash=0;
  foreach(char c in s) { if(c=='\\'){slash++;continue;} if(c=='"'){b.Append('\\',2*slash+1);b.Append(c);}else{b.Append('\\',slash);b.Append(c);} slash=0; }
  b.Append('\\',2*slash);b.Append('"');return b.ToString();
 }
 public static int Run(string executable,string[] args,string cwd,string stdout,string stderr) {
  IntPtr job=IntPtr.Zero,input=IntPtr.Zero,output=IntPtr.Zero,error=IntPtr.Zero,list=IntPtr.Zero,handles=IntPtr.Zero,jobs=IntPtr.Zero;
  bool initialized=false; ProcessInfo process=new ProcessInfo();
  try{
   job=CreateJobObject(IntPtr.Zero,null);Check(job!=IntPtr.Zero,"CreateJobObject");
   Limits limits=new Limits();limits.Basic.Flags=0x2000;
   Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))),"SetInformationJobObject");
   Security security=new Security();security.Length=Marshal.SizeOf(typeof(Security));security.Inherit=1;
   input=CreateFile("NUL",0x80000000,7,ref security,3,0,IntPtr.Zero);Check(input!=new IntPtr(-1),"Open NUL");
   output=CreateFile(stdout,4,7,ref security,4,0,IntPtr.Zero);Check(output!=new IntPtr(-1),"Open stdout");
   error=CreateFile(stderr,4,7,ref security,4,0,IntPtr.Zero);Check(error!=new IntPtr(-1),"Open stderr");
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,2,0,ref size);
   Check(size!=IntPtr.Zero,"Get attribute list size");list=Marshal.AllocHGlobal(size);
   Check(InitializeProcThreadAttributeList(list,2,0,ref size),"Initialize attribute list");initialized=true;
   handles=Marshal.AllocHGlobal(3*IntPtr.Size);Marshal.WriteIntPtr(handles,0,input);Marshal.WriteIntPtr(handles,IntPtr.Size,output);Marshal.WriteIntPtr(handles,2*IntPtr.Size,error);
   jobs=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(jobs,job);
   Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20002),handles,new IntPtr(3*IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"Handle list");
   Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x2000D),jobs,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"Job list");
   StartupEx startup=new StartupEx();startup.Startup.Size=(uint)Marshal.SizeOf(typeof(StartupEx));startup.Startup.Flags=0x100;startup.Startup.Input=input;startup.Startup.Output=output;startup.Startup.Error=error;startup.Attributes=list;
   StringBuilder command=new StringBuilder(Quote(executable));foreach(string arg in args)command.Append(" ").Append(Quote(arg));
   Check(CreateProcess(executable,command,IntPtr.Zero,IntPtr.Zero,true,0x08080000,IntPtr.Zero,cwd,ref startup,out process),"CreateProcess in job");
   Check(WaitForSingleObject(process.Process,0xffffffff)==0,"WaitForSingleObject");
   uint code;Check(GetExitCodeProcess(process.Process,out code),"GetExitCodeProcess");return unchecked((int)code);
  }finally{
   Close(job);Close(process.Thread);Close(process.Process);Close(input);Close(output);Close(error);
   if(initialized)DeleteProcThreadAttributeList(list);if(list!=IntPtr.Zero)Marshal.FreeHGlobal(list);
   if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(jobs!=IntPtr.Zero)Marshal.FreeHGlobal(jobs);
  }
 }
}
'@
  }
  [OwnedAppJob]::Run($Executable,$Arguments,$WorkingDirectory,$Stdout,$Stderr)
}
function Wait-LenovoOwnerHealth {
  param(
    [Parameter(Mandatory=$true)][string[]]$Owners,
    [ValidateRange(1,600)][int]$TimeoutSeconds=300,
    [ValidateRange(10,10000)][int]$PollMilliseconds=2000,
    [scriptblock]$Probe={
      param([string[]]$Names)
      # Bound a stuck Docker client without stopping Docker or any container.
      $docker=(Get-Command docker.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
      $info=New-Object System.Diagnostics.ProcessStartInfo
      $info.FileName=$docker
      $info.Arguments='inspect --format "{{.State.Health.Status}}" '+($Names -join ' ')
      $info.UseShellExecute=$false
      $info.RedirectStandardOutput=$true
      $info.RedirectStandardError=$true
      $info.CreateNoWindow=$true
      $child=[System.Diagnostics.Process]::Start($info)
      try {
        $out=$child.StandardOutput.ReadToEndAsync()
        $err=$child.StandardError.ReadToEndAsync()
        if (!$child.WaitForExit(5000)) {
          if (!$child.HasExited) { $child.Kill() }
          $null=$child.WaitForExit(1000)
          return
        }
        if ($child.ExitCode -ne 0) { return }
        $out.GetAwaiter().GetResult().Trim() -split '\r?\n'
      } finally { $child.Dispose() }
    }
  )
  if (!$Owners.Count -or @($Owners | Where-Object {$_ -cnotmatch '^[a-z0-9][a-z0-9_.-]*$'}).Count) {
    throw 'LENOVO_OWNER_READINESS_INVALID_NAMES'
  }
  $clock=[System.Diagnostics.Stopwatch]::StartNew()
  do {
    $health=@(& $Probe $Owners)
    if ($health.Count -eq $Owners.Count -and @($health | Where-Object {$_ -cne 'healthy'}).Count -eq 0) {
      return
    }
    $remaining=($TimeoutSeconds*1000)-$clock.ElapsedMilliseconds
    if ($remaining -le 0) { break }
    Start-Sleep -Milliseconds ([int][Math]::Min($PollMilliseconds,$remaining))
  } while ($clock.ElapsedMilliseconds -lt ($TimeoutSeconds*1000))
  throw ('LENOVO_OWNER_READINESS_TIMEOUT owners='+($Owners -join ','))
}
function Assert-SurfaceCapability([string]$Uri, [int]$ExpectedStatus) {
  try {
    $status=[int](Invoke-WebRequest -Uri $Uri -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0).StatusCode
  } catch {
    $httpResponse=$_.Exception.PSObject.Properties['Response']
    if (!$httpResponse -or !$httpResponse.Value) { throw }
    $status=[int]$httpResponse.Value.StatusCode
  }
  if ($status -ne $ExpectedStatus) {
    throw ('SURFACE_PREVIEW_CAPABILITY_NOT_READY uri=' + $Uri + ' status=' + $status)
  }
}

$developmentPorts=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'ports.json') -Raw | ConvertFrom-Json
$ports=@{}
foreach($entry in $developmentPorts.apps.PSObject.Properties){$ports[$entry.Name]=[int]$entry.Value.lenovo}
if ($Surface) {
  $source=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
  $node=(Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $nodeDir=Split-Path -Parent $node
  $logs=Join-Path $source '.tmp\surface-preview-logs'
  foreach($entry in $developmentPorts.apps.PSObject.Properties){$ports[$entry.Name]=[int]$entry.Value.preview}
} else {
  $runner='C:\Users\bthwa\BThwaniAppRunner'
  $source=Join-Path $runner 'source-runtime'
  $nodeDir=Join-Path $runner 'tools\node-v24.22.1-refoundation'
  $node=Join-Path $nodeDir 'node.exe'
  $logs=Join-Path $runner 'logs'
  if ($EnableDockerWalletWebPreview) {
    if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
      throw 'DOCKER_WALLET_WEB_PREVIEW_REQUIRES_VERIFIED_LENOVO_HOST'
    }
    Wait-LenovoOwnerHealth -Owners @('bthwani-refoundation-identity-1','bthwani-refoundation-wlt-1')
    foreach ($owner in @(
      @{ Name='bthwani-refoundation-identity-1'; Capability='identity-synthetic-session-verifier' },
      @{ Name='bthwani-refoundation-wlt-1'; Capability='customer-wallet-read-only' }
    )) {
      $proof=(& docker inspect $owner.Name --format '{{index .Config.Labels "com.bthwani.capability"}}|{{index .Config.Labels "com.bthwani.environment"}}|{{.State.Health.Status}}').Trim()
      if ($LASTEXITCODE -ne 0 -or $proof -cne ($owner.Capability + '|refoundation|healthy')) {
        throw 'DOCKER_WALLET_WEB_PREVIEW_OWNER_NOT_VERIFIED'
      }
    }
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/customer-auth/phone-challenges' 405
    Assert-SurfaceCapability 'http://127.0.0.1:3203/v1/wallets/me' 401
    $env:BTHWANI_SURFACE_PREVIEW='0'
    $env:BTHWANI_ISOLATED_TEST_MODE='true'
    $env:BTHWANI_DOCKER_WALLET_WEB_PREVIEW='1'
    $env:CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN='http://127.0.0.1:3201'
    $env:CUSTOMER_SYNTHETIC_WLT_ORIGIN='http://127.0.0.1:3203'
    $env:EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='0'
    Remove-Item Env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN -ErrorAction SilentlyContinue
  }
  if ($EnableDockerCartWebPreview) {
    if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
      throw 'DOCKER_CART_WEB_PREVIEW_REQUIRES_VERIFIED_LENOVO_HOST'
    }
    Wait-LenovoOwnerHealth -Owners @('bthwani-refoundation-identity-1','bthwani-refoundation-dsh-1')
    $identityOwner = @(& docker inspect bthwani-refoundation-identity-1 | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $identityOwner.Count -ne 1) {
      throw 'DOCKER_CART_WEB_IDENTITY_OWNER_UNAVAILABLE'
    }
    $dshOwner = @(& docker inspect bthwani-refoundation-dsh-1 | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $dshOwner.Count -ne 1) {
      throw 'DOCKER_CART_WEB_DSH_OWNER_UNAVAILABLE'
    }
    $identityRuntime = $identityOwner[0]
    $dshRuntime = $dshOwner[0]
    $identityEnv = @($identityRuntime.Config.Env)
    $dshEnv = @($dshRuntime.Config.Env)
    $identitySchemas = @($identityEnv | Where-Object { $_ -clike 'IDENTITY_DB_SCHEMA=*' })
    $dshSchemas = @($dshEnv | Where-Object { $_ -clike 'DSH_DB_SCHEMA=*' })
    $identityBindings = @($identityRuntime.HostConfig.PortBindings.'3302/tcp')
    $dshBindings = @($dshRuntime.HostConfig.PortBindings.'8080/tcp')
    if ($identityRuntime.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
        $identityRuntime.Config.Labels.'com.bthwani.capability' -cne 'identity-synthetic-session-verifier' -or
        $identityRuntime.State.Health.Status -cne 'healthy' -or
        $dshRuntime.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
        $dshRuntime.Config.Labels.'com.bthwani.capability' -cne 'customer-store-catalog' -or
        $dshRuntime.State.Health.Status -cne 'healthy' -or
        $identityEnv -cnotcontains 'BTHWANI_ISOLATED_TEST_MODE=true' -or
        $identityEnv -cnotcontains 'BTHWANI_ISOLATED_CONTAINER_MODE=true' -or
        $identityEnv -cnotcontains 'IDENTITY_SYNTHETIC_PHONE_AUTH=true' -or
        $dshEnv -cnotcontains 'BTHWANI_ISOLATED_TEST_MODE=true' -or
        $dshEnv -cnotcontains 'BTHWANI_ISOLATED_CONTAINER_MODE=true' -or
        $dshEnv -cnotcontains 'DSH_ENABLE_ISOLATED_CUSTOMER_CART=true' -or
        $dshEnv -cnotcontains 'DSH_IDENTITY_VERIFIER_URL=https://identity:3343' -or
        $dshEnv -cnotcontains 'DSH_LISTEN_ADDR=0.0.0.0:8080' -or
        $identitySchemas.Count -ne 1 -or $identitySchemas[0] -cnotmatch '^IDENTITY_DB_SCHEMA=identity_test_[a-z0-9_]+$' -or
        $dshSchemas.Count -ne 1 -or $dshSchemas[0] -cnotmatch '^DSH_DB_SCHEMA=dsh_test_[a-z0-9_]+$' -or
        $identityBindings.Count -ne 1 -or $identityBindings[0].HostIp -cne '127.0.0.1' -or
        $identityBindings[0].HostPort -cne '3201' -or
        $dshBindings.Count -ne 1 -or $dshBindings[0].HostIp -cne '127.0.0.1' -or
        $dshBindings[0].HostPort -cne '3202') {
      throw 'DOCKER_CART_WEB_OWNERS_NOT_ISOLATED'
    }
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/sessions/current' 401
    Assert-SurfaceCapability 'http://127.0.0.1:3202/v1/carts/store-a' 401
    Assert-SurfaceCapability 'http://127.0.0.1:3202/v1/carts/store-a/merchandise-estimate?expectedVersion=0' 401
    $env:BTHWANI_SURFACE_PREVIEW='0'
    $env:BTHWANI_ISOLATED_TEST_MODE='true'
    $env:BTHWANI_DOCKER_CART_WEB_PREVIEW='1'
    $env:CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN='http://127.0.0.1:3201'
    $env:CUSTOMER_SYNTHETIC_DSH_ORIGIN='http://127.0.0.1:3202'
    $env:EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='0'
    Remove-Item Env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_DSH_ORIGIN -ErrorAction SilentlyContinue
  }
  if ($EnableDockerCustomerAndroidIdentityPreview) {
    if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
      throw 'DOCKER_ANDROID_IDENTITY_PREVIEW_REQUIRES_VERIFIED_LENOVO_HOST'
    }
    Wait-LenovoOwnerHealth -Owners @('bthwani-refoundation-identity-1')
    $identity = @(& docker inspect bthwani-refoundation-identity-1 | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $identity.Count -ne 1) { throw 'DOCKER_ANDROID_IDENTITY_OWNER_UNAVAILABLE' }
    $owner = $identity[0]
    $ownerEnv = @($owner.Config.Env)
    $schema = @($ownerEnv | Where-Object { $_ -clike 'IDENTITY_DB_SCHEMA=*' })
    $binding = @($owner.HostConfig.PortBindings.'3302/tcp')
    if ($owner.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
        $owner.Config.Labels.'com.bthwani.capability' -cne 'identity-synthetic-session-verifier' -or
        $owner.State.Health.Status -cne 'healthy' -or
        $ownerEnv -cnotcontains 'BTHWANI_ISOLATED_TEST_MODE=true' -or
        $ownerEnv -cnotcontains 'BTHWANI_ISOLATED_CONTAINER_MODE=true' -or
        $ownerEnv -cnotcontains 'IDENTITY_SYNTHETIC_PHONE_AUTH=true' -or
        $schema.Count -ne 1 -or $schema[0] -cnotmatch '^IDENTITY_DB_SCHEMA=identity_test_[a-z0-9_]+$' -or
        $binding.Count -ne 1 -or $binding[0].HostIp -cne '127.0.0.1' -or $binding[0].HostPort -cne '3201') {
      throw 'DOCKER_ANDROID_IDENTITY_OWNER_NOT_ISOLATED'
    }
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/customer-auth/phone-challenges' 405
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/sessions/current' 401
    $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN='http://127.0.0.1:3201'
    $env:EXPO_PUBLIC_BTHWANI_LENOVO_CUSTOMER_ANDROID_PREVIEW='1'
    # Android reaches this Metro server through the standard Surface USB tunnel.
    $env:EXPO_PACKAGER_PROXY_URL='http://127.0.0.1:18101'
  }
  if ($App -in @('merchant','captain')) {
    # Native admission requires verified isolated owners.
    if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
      throw 'DOCKER_ROLE_ANDROID_IDENTITY_REQUIRES_VERIFIED_LENOVO'
    }
    Wait-LenovoOwnerHealth -Owners @('bthwani-refoundation-identity-1','bthwani-refoundation-dsh-1')
    $identity = @(& docker inspect bthwani-refoundation-identity-1 | ConvertFrom-Json)
    $dsh = @(& docker inspect bthwani-refoundation-dsh-1 | ConvertFrom-Json)
    if ($LASTEXITCODE -ne 0 -or $identity.Count -ne 1 -or $dsh.Count -ne 1) {
      throw 'DOCKER_ROLE_ANDROID_OWNER_UNAVAILABLE'
    }
    $identityOwner = $identity[0]
    $dshOwner = $dsh[0]
    $identityEnv = @($identityOwner.Config.Env)
    $dshEnv = @($dshOwner.Config.Env)
    $identitySchemas = @($identityEnv | Where-Object { $_ -clike 'IDENTITY_DB_SCHEMA=*' })
    $dshSchemas = @($dshEnv | Where-Object { $_ -clike 'DSH_DB_SCHEMA=*' })
    $identityPorts = @($identityOwner.HostConfig.PortBindings.'3302/tcp')
    $dshPorts = @($dshOwner.HostConfig.PortBindings.'8080/tcp')
    if ($identityOwner.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
        $identityOwner.Config.Labels.'com.bthwani.capability' -cne 'identity-synthetic-session-verifier' -or
        $identityOwner.State.Health.Status -cne 'healthy' -or
        $identityEnv -cnotcontains 'BTHWANI_ISOLATED_TEST_MODE=true' -or
        $identityEnv -cnotcontains 'BTHWANI_ISOLATED_CONTAINER_MODE=true' -or
        $identityEnv -cnotcontains 'IDENTITY_SYNTHETIC_PHONE_AUTH=true' -or
        $identitySchemas.Count -ne 1 -or $identitySchemas[0] -cnotmatch '^IDENTITY_DB_SCHEMA=identity_test_[a-z0-9_]+$' -or
        $identityPorts.Count -ne 1 -or $identityPorts[0].HostIp -cne '127.0.0.1' -or
        $identityPorts[0].HostPort -cne '3201' -or
        $dshOwner.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
        $dshOwner.Config.Labels.'com.bthwani.capability' -cne 'customer-store-catalog' -or
        $dshOwner.State.Health.Status -cne 'healthy' -or
        $dshSchemas.Count -ne 1 -or $dshSchemas[0] -cnotmatch '^DSH_DB_SCHEMA=dsh_test_[a-z0-9_]+$' -or
        $dshPorts.Count -ne 1 -or $dshPorts[0].HostIp -cne '127.0.0.1' -or
        $dshPorts[0].HostPort -cne '3202') {
      throw 'DOCKER_ROLE_ANDROID_OWNERS_NOT_ISOLATED'
    }
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/customer-auth/phone-challenges' 405
    Assert-SurfaceCapability 'http://127.0.0.1:3201/v1/sessions/current' 401
    if ($App -eq 'merchant') {
      Assert-SurfaceCapability 'http://127.0.0.1:3202/v1/stores/mine' 401
      $env:EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN='http://127.0.0.1:3201'
      $env:EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN='http://127.0.0.1:3202'
      $env:EXPO_PACKAGER_PROXY_URL='http://127.0.0.1:18102'
    } else {
      # An isolated DSH may be running without the opt-in Captain routes.
      # Keep the public Expo shell available, but never present a Native
      # admission path until the authoritative standing read denies 401.
      $captainStandingReady=$false
      try {
        Assert-SurfaceCapability 'http://127.0.0.1:3202/v1/captains/me/standing' 401
        $captainStandingReady=$true
      } catch {
        if ($_.Exception.Message -notmatch '^SURFACE_PREVIEW_CAPABILITY_NOT_READY uri=http://127[.]0[.]0[.]1:3202/v1/captains/me/standing status=404$') {
          throw
        }
        Write-Warning 'CAPTAIN_NATIVE_ADMISSION_DISABLED_DSH_ROUTE_NOT_ACTIVATED'
      }
      # Identity's isolated phone entry is independent of DSH standing.
      # Keep the real phone form visible but do not permit code consumption
      # or workspace admission until DSH's owner endpoint is available.
      $env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN='http://127.0.0.1:3201'
      if ($captainStandingReady) {
        $env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN='http://127.0.0.1:3202'
      } else {
        Remove-Item Env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN -ErrorAction SilentlyContinue
      }
      $env:EXPO_PACKAGER_PROXY_URL='http://127.0.0.1:18103'
    }
  }
}
if ($UseDisposableOperatorSandbox -and (!$EnableIsolatedOperatorPasskeyPreview -or $Surface -or $App -ne 'control-panel')) {
  throw 'OPERATOR_SANDBOX_REQUIRES_LENOVO_CONTROL_PASSKEY_PREVIEW'
}
if ($EnableIsolatedRootBootstrap -and !$EnableIsolatedOperatorPasskeyPreview) {
  throw 'OPERATOR_ROOT_BOOTSTRAP_REQUIRES_EXPLICIT_PASSKEY_PREVIEW'
}
if ($EnableIsolatedOperatorPasskeyPreview -and $App -ne 'control-panel') {
  throw 'OPERATOR_PASSKEY_PREVIEW_REQUIRES_CONTROL_PANEL'
}
if ($App -eq 'control-panel') {
  $env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='false'
}
# Starting the app never creates or recovers an Operator.
if ($EnableIsolatedOperatorPasskeyPreview -and !$Surface) {
  if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
    throw 'OPERATOR_PASSKEY_PREVIEW_REQUIRES_VERIFIED_LENOVO_OPERATOR'
  }
  $identityName = if ($UseDisposableOperatorSandbox) { 'bthwani-operator-webauthn-s02-identity-1' } else { 'bthwani-refoundation-identity-1' }
  $identityPort = if ($UseDisposableOperatorSandbox) { 3241 } else { 3201 }
  $identityOrigin = "http://127.0.0.1:$identityPort"
  Wait-LenovoOwnerHealth -Owners @($identityName)
  $identityRuntime = @(& docker inspect $identityName | ConvertFrom-Json)
  if ($LASTEXITCODE -ne 0 -or $identityRuntime.Count -ne 1) {
    throw 'OPERATOR_PASSKEY_IDENTITY_RUNTIME_UNAVAILABLE'
  }
  $identityOwner = $identityRuntime[0]
  $expectedEnvironment = if ($UseDisposableOperatorSandbox) { 'operator-webauthn-sandbox' } else { 'refoundation' }
  $expectedCapability = if ($UseDisposableOperatorSandbox) { 'identity-synthetic-operator-bootstrap' } else { 'identity-synthetic-session-verifier' }
  if ($identityOwner.Config.Labels.'com.bthwani.environment' -cne $expectedEnvironment -or
      $identityOwner.Config.Labels.'com.bthwani.capability' -cne $expectedCapability -or
      $identityOwner.State.Health.Status -cne 'healthy') {
    throw 'OPERATOR_PASSKEY_IDENTITY_OWNER_NOT_ISOLATED'
  }
  $ownerEnv = @($identityOwner.Config.Env)
  foreach ($required in @(
    'BTHWANI_ISOLATED_TEST_MODE=true',
    'BTHWANI_ISOLATED_CONTAINER_MODE=true',
    'IDENTITY_ENABLE_ISOLATED_OPERATOR_PASSKEY_AUTH=true',
    'IDENTITY_OPERATOR_PASSKEY_RPID=localhost',
    'IDENTITY_OPERATOR_PASSKEY_ORIGINS=http://localhost:13000'
  )) {
    if ($ownerEnv -cnotcontains $required) {
      throw 'OPERATOR_PASSKEY_IDENTITY_OWNER_NOT_OPTED_IN'
    }
  }
  $schemas = @($ownerEnv | Where-Object { $_ -like 'IDENTITY_DB_SCHEMA=*' })
  if ($schemas.Count -ne 1 -or
      ($schemas[0] -split '=',2)[1] -cnotmatch '^identity_test_[a-z0-9_]+$') {
    throw 'OPERATOR_PASSKEY_IDENTITY_SCHEMA_NOT_ISOLATED'
  }
  if ($UseDisposableOperatorSandbox) {
    $databaseEnv = @($ownerEnv | Where-Object { $_ -clike 'IDENTITY_TEST_DATABASE_URL=*' })
    $databaseMatches = $false
    if ($databaseEnv.Count -eq 1) {
      $dsn = $databaseEnv[0].Substring('IDENTITY_TEST_DATABASE_URL='.Length)
      try {
        $parsed = [Uri]::new($dsn)
        $databaseMatches = ($parsed.Scheme -ceq 'postgres' -and
          $parsed.Host -ceq 'postgres' -and $parsed.Port -eq 5432 -and
          $parsed.AbsolutePath -ceq '/refoundation_webauthn_s02' -and
          $parsed.Query -ceq '?sslmode=disable' -and $parsed.Fragment -ceq '' -and
          $parsed.UserInfo -cmatch "^bthwani_fido_s02:[a-f0-9]{64}$" -and
          $parsed.OriginalString -ceq ('postgres://' + $parsed.UserInfo + '@postgres:5432/refoundation_webauthn_s02?sslmode=disable'))
      } catch {
        $databaseMatches = $false
      }
    }
    if ($schemas[0] -cne 'IDENTITY_DB_SCHEMA=identity_test_operator_s02' -or -not $databaseMatches) {
      throw 'OPERATOR_SANDBOX_DATABASE_IDENTITY_MISMATCH'
    }
  }
  $bindings = @($identityOwner.HostConfig.PortBindings.'3302/tcp')
  if ($bindings.Count -ne 1 -or $bindings[0].HostIp -cne '127.0.0.1' -or
      $bindings[0].HostPort -cne "$identityPort") {
    throw 'OPERATOR_PASSKEY_IDENTITY_PORT_NOT_LOOPBACK'
  }
  Assert-SurfaceCapability "$identityOrigin/v1/operators/passkey/authentication/options" 405
  Assert-SurfaceCapability "$identityOrigin/v1/operators/passkey/authentication" 405
  Assert-SurfaceCapability "$identityOrigin/v1/sessions/current" 401
  $env:BTHWANI_ISOLATED_TEST_MODE='true'
  $env:OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF='true'
  $env:OPERATOR_PASSKEY_BROWSER_ORIGIN='http://localhost:13000'
  $env:OPERATOR_PASSKEY_IDENTITY_ORIGIN=$identityOrigin
  $env:OPERATOR_POLICY_DSH_ORIGIN='http://127.0.0.1:3202'
  # Finance readback uses the same shared isolated Identity, never the separate
  # disposable Operator sandbox. Keep other workspaces available on WLT failure.
  if (!$UseDisposableOperatorSandbox) {
    try {
      Wait-LenovoOwnerHealth -Owners @('bthwani-refoundation-wlt-1') -TimeoutSeconds 30
      $wltRuntime = @(& docker inspect bthwani-refoundation-wlt-1 | ConvertFrom-Json)
      if ($LASTEXITCODE -ne 0 -or $wltRuntime.Count -ne 1) { throw 'WLT_OWNER_UNAVAILABLE' }
      $wltOwner = $wltRuntime[0]
      $wltBindings = @($wltOwner.HostConfig.PortBindings.'8080/tcp')
      if ($wltOwner.Config.Labels.'com.bthwani.environment' -cne 'refoundation' -or
          $wltOwner.Config.Labels.'com.bthwani.capability' -cne 'customer-wallet-read-only' -or
          $wltOwner.Config.Labels.'com.docker.compose.project' -cne $identityOwner.Config.Labels.'com.docker.compose.project' -or
          $wltOwner.State.Health.Status -cne 'healthy' -or
          @($wltOwner.Config.Env) -cnotcontains 'WLT_TEST_IDENTITY_ORIGIN=http://identity:3302' -or
          $wltBindings.Count -ne 1 -or $wltBindings[0].HostIp -cne '127.0.0.1' -or
          $wltBindings[0].HostPort -cne '3203') { throw 'WLT_OWNER_NOT_VERIFIED' }
      Assert-SurfaceCapability 'http://127.0.0.1:3203/v1/operators/stores/capability-probe/commercial-agreement' 401
      $env:OPERATOR_FINANCE_WLT_ORIGIN='http://127.0.0.1:3203'
    } catch {
      Write-Warning 'OPERATOR_FINANCE_WLT_READBACK_UNAVAILABLE'
    }
  }
  if ($EnableIsolatedRootBootstrap) {
    if ($ownerEnv -cnotcontains 'IDENTITY_ENABLE_ISOLATED_OPERATOR_BOOTSTRAP=true') {
      throw 'OPERATOR_ROOT_BOOTSTRAP_OWNER_NOT_OPTED_IN'
    }
    Assert-SurfaceCapability "$identityOrigin/v1/operators/passkey/bootstrap/options" 405
    Assert-SurfaceCapability "$identityOrigin/v1/operators/passkey/bootstrap" 405
    $env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='true'
  }
}
if(!(Test-Path -LiteralPath $node) -or !(Test-Path -LiteralPath (Join-Path $source 'pnpm-lock.yaml'))){
  throw 'REFOUNDATION_RUNTIME_SOURCE_OR_TOOLCHAIN_MISSING'
}
if ((& $node --version) -ne ('v' + (Get-Content -LiteralPath (Join-Path $source '.node-version') -Raw).Trim())) {
  throw 'REFOUNDATION_NODE_PIN_MISMATCH'
}
$port=$ports[$App]
if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -First 1) {
  throw ('REFOUNDATION_APP_PORT_IN_USE app=' + $App + ' port=' + $port)
}
if ($Surface) {
  if ($IdentityPort -eq $DshPort -or $ports.Values -contains $IdentityPort -or $ports.Values -contains $DshPort) {
    throw 'SURFACE_PREVIEW_PORT_COLLISION'
  }
  foreach ($ownerPort in @($IdentityPort,$DshPort)) {
    $listener=Get-NetTCPConnection -State Listen -LocalPort $ownerPort -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (!$listener -or (Get-Process -Id $listener.OwningProcess).ProcessName -match '^(ssh|plink)$') {
      throw ('SURFACE_PREVIEW_OWNER_NOT_LOCAL port=' + $ownerPort)
    }
    $health=Invoke-RestMethod -Uri ("http://127.0.0.1:$ownerPort/health") -TimeoutSec 3 -MaximumRedirection 0
    if ($health.status -ne 'ok') { throw ('SURFACE_PREVIEW_OWNER_NOT_READY port=' + $ownerPort) }
  }
  $identity="http://127.0.0.1:$IdentityPort"
  $dsh="http://127.0.0.1:$DshPort"
  if ($EnableAndroidWalletPreview) {
    if ($WltPort -eq $IdentityPort -or $WltPort -eq $DshPort -or
        $ports.Values -contains $WltPort) { throw 'SURFACE_PREVIEW_WLT_PORT_COLLISION' }
    $wltListener=Get-NetTCPConnection -State Listen -LocalPort $WltPort -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (!$wltListener -or (Get-Process -Id $wltListener.OwningProcess).ProcessName -match '^(ssh|plink)$') {
      throw 'SURFACE_PREVIEW_WLT_OWNER_NOT_LOCAL'
    }
    Assert-SurfaceCapability "http://127.0.0.1:$WltPort/v1/wallets/me" 401
  }
  if ($App -eq 'control-panel') {
    Assert-SurfaceCapability "$identity/v1/operators/passkey/authentication/options" 405
    if ($EnableIsolatedRootBootstrap) {
      Assert-SurfaceCapability "$identity/v1/operators/passkey/bootstrap/options" 405
      Assert-SurfaceCapability "$identity/v1/operators/passkey/bootstrap" 405
      Assert-SurfaceCapability "$identity/v1/sessions/current" 401
      $env:OPERATOR_ENABLE_ISOLATED_ROOT_BOOTSTRAP_BFF='true'
    }
  } else {
    Assert-SurfaceCapability "$identity/v1/customer-auth/phone-challenges" 405
  }
  if ($App -eq 'captain') { Assert-SurfaceCapability "$dsh/v1/captains/me/standing" 401 }
  if ($App -eq 'merchant') { Assert-SurfaceCapability "$dsh/v1/stores/mine" 401 }
  $env:BTHWANI_SURFACE_PREVIEW='1'
  $env:EXPO_PUBLIC_BTHWANI_SURFACE_PREVIEW='1'
  switch ($App) {
    'customer' {
      $env:CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_DSH_API_URL=$dsh
      if ($EnableAndroidWalletPreview) {
        # 10.0.2.2 maps from Android emulator back to Surface loopback.
        # The Web BFF retains 127.0.0.1 and an unrelated HttpOnly cookie.
        $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_IDENTITY_ORIGIN="http://10.0.2.2:$IdentityPort"
        $env:EXPO_PUBLIC_CUSTOMER_SYNTHETIC_WLT_ORIGIN="http://10.0.2.2:$WltPort"
        $env:CUSTOMER_SYNTHETIC_WLT_ORIGIN="http://127.0.0.1:$WltPort"
      }
    }
    'merchant' {
      $env:MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:MERCHANT_SYNTHETIC_DSH_ORIGIN=$dsh
      $env:EXPO_PUBLIC_MERCHANT_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_MERCHANT_SYNTHETIC_DSH_ORIGIN=$dsh
    }
    'captain' {
      $env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_IDENTITY_ORIGIN=$identity
      $env:EXPO_PUBLIC_CAPTAIN_SYNTHETIC_DSH_ORIGIN=$dsh
    }
    'control-panel' {
      $env:BTHWANI_ISOLATED_TEST_MODE='true'
      $env:OPERATOR_ENABLE_ISOLATED_PASSKEY_BFF='true'
      $env:OPERATOR_PASSKEY_BROWSER_ORIGIN="http://localhost:$port"
      $env:OPERATOR_PASSKEY_IDENTITY_ORIGIN=$identity
      $env:OPERATOR_POLICY_DSH_ORIGIN=$dsh
    }
  }
}
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$env:PATH="$nodeDir;$env:PATH"
$env:NODE_OPTIONS='--dns-result-order=ipv4first'
# Expo Web/Metro exhausted Node's default ~4 GiB V8 heap on Lenovo (exit 134).
# The ceiling is per process and does not reserve memory. Restrict the larger
# heap to the two Web Metro owners on a verified >=24 GiB development host;
# never alter Surface previews, Captain Metro or the Next.js Operator process.
if (!$Surface -and $App -in @('customer','merchant')) {
  if ((hostname).ToUpperInvariant() -ne 'BTHWANI-DOCKER') {
    throw 'WEB_METRO_HEAP_REQUIRES_VERIFIED_LENOVO'
  }
  $memory=Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
  if (!$memory -or [double]$memory.TotalVisibleMemorySize -lt (24 * 1MB)) {
    throw 'WEB_METRO_HEAP_REQUIRES_24_GIB_RAM'
  }
  $env:NODE_OPTIONS += ' --max-old-space-size=6144'
}
$env:EXPO_NO_TELEMETRY='1'
# Preserve the Metro cache and use only explicitly supplied credentials.
$dir=Join-Path $source ('apps\'+$App)
Set-Location -LiteralPath $dir
$log=Join-Path $logs ('refoundation-'+$App+'.out.log')
$err=Join-Path $logs ('refoundation-'+$App+'.err.log')
if ($App -eq 'control-panel') {
  $cli=Join-Path $dir 'node_modules\next\dist\bin\next'
  $bind=if ($Surface) {'localhost'} else {'127.0.0.1'}
  $args=@('dev','-H',$bind,'-p',"$port")
} else {
  $cli=Join-Path $dir 'node_modules\expo\bin\cli'
  $args=@('start')
  if ($App -in @('customer','merchant')) { $args+=@('--web') }
  $args+=@('--dev-client','--localhost','--port',"$port")
}
if ($Surface -and $App -ne 'control-panel') { $args+=@('--max-workers','2') }
if(!(Test-Path -LiteralPath $cli)){throw ('REFOUNDATION_APP_CLI_MISSING '+$cli)}
"START refoundation app=$App source=$source port=$port surface=$Surface" | Out-File -FilePath $log -Append -Encoding utf8
# PowerShell 5.1 wraps native stderr warnings as NativeCommandError when
# ErrorActionPreference=Stop. Keep stderr logged, but judge failure by exit code.
if (!$Surface) {
  $nativeExit=Invoke-OwnedAppProcess -Executable $node -Arguments ([string[]](@($cli)+$args)) -WorkingDirectory $dir -Stdout $log -Stderr $err
} else {
  $ErrorActionPreference='Continue'
  & $node $cli @args 1>> $log 2>> $err
  $nativeExit=$LASTEXITCODE
}
if($nativeExit -ne 0){
  "EXIT app=$App code=$nativeExit" | Out-File -FilePath $err -Append -Encoding utf8
}
exit $nativeExit
