# Disables the desktop-sidebar-topics mod: removes its folder from CLAUDE_CODE_PLUGIN_DIRS
# in ~/.claude/settings.json and drops its stored options. Pass -RemoveFiles to
# delete the mod folder as well. Run it in Windows PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File "$HOME\.claude\mods\desktop-sidebar-topics\uninstall.ps1" [-RemoveFiles]

param([switch]$RemoveFiles)

$modDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$settingsPath = Join-Path $HOME ".claude\settings.json"

if (Test-Path $settingsPath) {
  $raw = Get-Content $settingsPath -Raw
  if ($raw.Trim().Length -gt 0) {
    $settings = $raw | ConvertFrom-Json
    $env = $settings.env
    if ($env -and $env.CLAUDE_CODE_PLUGIN_DIRS) {
      $dirs = $env.CLAUDE_CODE_PLUGIN_DIRS -split ";" | Where-Object { $_.Trim().Length -gt 0 -and $_ -ne $modDir }
      if ($dirs.Count -gt 0) {
        $env.CLAUDE_CODE_PLUGIN_DIRS = ($dirs -join ";")
      } else {
        $env.PSObject.Properties.Remove("CLAUDE_CODE_PLUGIN_DIRS")
      }
      if ($env.PSObject.Properties.Count -eq 0) { $settings.PSObject.Properties.Remove("env") }
    }
    if ($settings.pluginConfigs) {
      $settings.pluginConfigs.PSObject.Properties.Remove("desktop-sidebar-topics")
      if ($settings.pluginConfigs.PSObject.Properties.Count -eq 0) { $settings.PSObject.Properties.Remove("pluginConfigs") }
    }
    $json = $settings | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($settingsPath, $json, (New-Object System.Text.UTF8Encoding $false))
    Write-Host "desktop-sidebar-topics removed from $settingsPath"
  }
}

if ($RemoveFiles) {
  Remove-Item -Recurse -Force $modDir -Confirm:$false
  Write-Host "Deleted $modDir"
} else {
  Write-Host "Mod files kept in $modDir (pass -RemoveFiles to delete them)."
}
Write-Host "Sessions already open keep the mod until they are restarted."
