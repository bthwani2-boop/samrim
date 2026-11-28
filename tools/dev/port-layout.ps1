#Requires -Version 7.0
# One admission boundary for the existing development transport inventory.
function Assert-DevelopmentLayoutFields {
  param([System.Text.Json.JsonElement]$Object, [string[]]$Names)
  if ($Object.ValueKind -ne 'Object') { throw 'APP_PORT_LAYOUT_FIELDS' }
  $properties = @($Object.EnumerateObject())
  if ($properties.Count -ne $Names.Count) { throw 'APP_PORT_LAYOUT_FIELDS' }
  foreach ($name in $Names) {
    if (@($properties | Where-Object Name -CEQ $name).Count -ne 1) { throw 'APP_PORT_LAYOUT_FIELDS' }
  }
}

function Get-DevelopmentLayoutPort {
  param([System.Text.Json.JsonElement]$Value)
  $port = 0
  if ($Value.ValueKind -ne 'Number' -or !$Value.TryGetInt32([ref]$port) -or
      $port -lt 1024 -or $port -gt 65535) { throw 'APP_PORT_LAYOUT_PORT' }
  return $port
}

function ConvertFrom-DevelopmentPortLayout {
  param([AllowEmptyString()][string]$Json)
  $document = $null
  try {
    $document = [System.Text.Json.JsonDocument]::Parse($Json)
    $root = $document.RootElement
    Assert-DevelopmentLayoutFields $root @('apps','ownerForwards')
    $apps = $root.GetProperty('apps')
    $owners = $root.GetProperty('ownerForwards')
    $names = @('customer','merchant','captain','control-panel')
    Assert-DevelopmentLayoutFields $apps $names
    Assert-DevelopmentLayoutFields $owners @('identity','dsh')
    $identity = Get-DevelopmentLayoutPort ($owners.GetProperty('identity'))
    $dsh = Get-DevelopmentLayoutPort ($owners.GetProperty('dsh'))
    if ($identity -ne 3201 -or $dsh -ne 3202) { throw 'APP_PORT_LAYOUT_FIXED_OWNER' }
    # The published Compose endpoints are reserved, including Lenovo-only WLT.
    $reserved = @($identity,$dsh,3203,3226,3233,3290)
    $resultApps = [ordered]@{}
    foreach ($name in $names) {
      $entry = $apps.GetProperty($name)
      Assert-DevelopmentLayoutFields $entry @('surface','lenovo','task','cli')
      $surface = Get-DevelopmentLayoutPort ($entry.GetProperty('surface'))
      $lenovo = Get-DevelopmentLayoutPort ($entry.GetProperty('lenovo'))
      $task = $entry.GetProperty('task').GetString()
      $cli = $entry.GetProperty('cli').GetString()
      if ($surface -in $reserved -or $lenovo -in $reserved) { throw 'APP_PORT_LAYOUT_RESERVED_PORT' }
      if ($name -ceq 'control-panel') {
        $expectedTask = 'BThwani Control Next Native'
        $expectedCli = 'next'
        if ($surface -ne 13000 -or $lenovo -ne 23010) { throw 'APP_PORT_LAYOUT_FIXED_ORIGIN' }
      } else {
        $expectedTask = 'BThwani ' + $name.Substring(0,1).ToUpperInvariant() + $name.Substring(1) + ' Metro Native'
        $expectedCli = 'expo'
        # Existing Android public origin and browser tab signatures.
        if (($name -ceq 'customer' -and $surface -ne 18101) -or
            ($name -ceq 'merchant' -and $surface -ne 18102)) { throw 'APP_PORT_LAYOUT_FIXED_ORIGIN' }
      }
      if ($task -cne $expectedTask -or $cli -cne $expectedCli) { throw 'APP_PORT_LAYOUT_TASK' }
      $resultApps[$name] = [pscustomobject]@{surface=$surface;lenovo=$lenovo;task=$task;cli=$cli}
    }
    $localPorts = @($resultApps.Values | ForEach-Object {$_.surface})
    $remotePorts = @($resultApps.Values | ForEach-Object {$_.lenovo})
    foreach ($ports in @(@{Values=$localPorts},@{Values=$remotePorts})) {
      if (@($ports.Values | Sort-Object -Unique).Count -ne $ports.Values.Count) { throw 'APP_PORT_LAYOUT_COLLISION' }
    }
    return [pscustomobject]@{apps=[pscustomobject]$resultApps;ownerForwards=[pscustomobject][ordered]@{identity=$identity;dsh=$dsh}}
  } catch {
    if ($_.Exception.Message -clike 'APP_PORT_LAYOUT_*') { throw }
    throw 'APP_PORT_LAYOUT_INVALID_JSON'
  } finally {
    if ($document) { $document.Dispose() }
  }
}

function Read-DevelopmentPortLayout {
  param([string]$Path)
  $encoding = [System.Text.UTF8Encoding]::new($false,$true)
  return ConvertFrom-DevelopmentPortLayout ($encoding.GetString([System.IO.File]::ReadAllBytes($Path)))
}
